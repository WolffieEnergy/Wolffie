// core/system/services/eventLogService.js
//
// Unified event log — the single audit trail for every module in Wolffie.
//
// Events are the primary record. Events with sufficient severity automatically
// surface as "alerts" on the dashboard (severity >= alertThreshold).
// Active events (resolved_at IS NULL) represent ongoing state — e.g. a manual
// discharge in progress. Resolved events are historical.
//
// Usage from any module:
//
//   import eventLog from '../../system/services/eventLogService.js';
//
//   // Fire-and-forget informational event
//   eventLog.log('collector:alphaess-modbus-tcp', 'collector', 'collect_success',
//     'info', 'Collected 12 registers in 340ms');
//
//   // Trackable event with lifecycle (returns id for later resolution)
//   const id = await eventLog.log('manual:api', 'dispatch', 'discharge_started',
//     'notice', 'Manual discharge at 3000W', { watts: 3000, soc: 82 });
//
//   // ... later, when the discharge completes:
//   await eventLog.resolve(id);
//
//   // Or resolve all active events from a source:
//   await eventLog.resolveBySource('manual:api', 'discharge_started');
//
// Deduplication
//   An unresolved event IS ongoing state (see above). Logging the same
//   source+category+event again while the first is still unresolved therefore
//   describes the SAME condition, not a new one — so it updates that row's
//   occurrence count and message instead of inserting a duplicate.
//
//   Without this, a collector retrying every 12 minutes wrote 45 identical
//   unresolved rows over two days, buried two genuine faults among them, and
//   could never be pruned (prune() spares unresolved rows by design).
//
//   The counterpart is resolution: whatever raises a recurring condition must
//   clear it when it recovers, e.g. on a successful collect:
//     await eventLog.resolveBySource('collector:alphaess-modbus-tcp', 'collect_paused');
//
//   Pass { dedupe: false } for events that genuinely should repeat while an
//   earlier one is still open.
//
// Conditions — the generic pattern for every module
//   Most module alerting is not "an event happened" but "a condition is true
//   right now": a collector is down, a socket is drawing power, the battery is
//   below its floor. Those need opening AND closing, plus debouncing so a value
//   hovering on the boundary does not flap.
//
//   condition() does all of it in one idempotent call. Call it on EVERY tick
//   with the current truth; it only writes when the state actually changes:
//
//     await eventLog.condition({
//       key:      `device:${d.id}:over_threshold`,   // identifies this condition
//       active:   watts > threshold,
//       source:   'module:homewizard',
//       category: 'device',
//       event:    'power_threshold_exceeded',
//       severity: 'info',
//       message:  `${d.name} drawing ${watts} W`,
//       metadata: { deviceId: d.id, name: d.name, watts, threshold },
//     });
//
//   Do NOT add an "already flagged" boolean to your module's tables. The
//   unresolved row IS the flag; a second copy drifts out of sync on restart or
//   manual resolution. condition() rehydrates its in-memory state from
//   event_log on first use, so a restart mid-condition does not re-fire.
//
// Severity levels (lowest → highest):
//   debug    — verbose diagnostics, not stored unless log level is debug
//   info     — normal operation confirmations
//   notice   — noteworthy but expected (default alert threshold)
//   warning  — something may need attention
//   error    — something failed
//   critical — system-level failure requiring immediate attention
//
// The alert threshold is configurable via system_settings:
//   category = 'event_log', setting_key = 'alert_threshold', value = 'notice'

import db from '../../database.js';
import { padName } from '../../utils/logger.js';

const PREFIX = padName('EventLog');

// Severity levels ordered by significance
const SEVERITY_LEVELS = {
  debug:    0,
  info:     1,
  notice:   2,
  warning:  3,
  error:    4,
  critical: 5,
};

// Valid categories — kept as a set for O(1) validation
const VALID_CATEGORIES = new Set([
  'dispatch',    // battery charge/discharge commands
  'collector',   // data collection lifecycle
  'strategy',    // strategy decisions and switches
  'settings',    // configuration changes
  'system',      // core system events (startup, shutdown, migration)
  'device',      // smart device control events
  'solar',       // solar forecast and curtailment events
  'grid',        // grid status changes
  'battery',     // battery state transitions (full, below floor)
]);

// Defaults
const DEFAULT_ALERT_THRESHOLD   = 'notice';
const DEFAULT_RETENTION_DAYS    = 180;   // 6 months
const DEFAULT_LOG_LEVEL         = 'info'; // don't store debug by default
const MAX_HISTORY_LIMIT         = 500;
const DEFAULT_HISTORY_LIMIT     = 50;

/**
 * One malformed metadata row must not take out an entire query — a bare
 * JSON.parse in a .map() throws for the whole page, not just that row.
 */
function safeParse(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

/** Local components, matching the table's own strftime(...,'localtime'). */
function nowLocal() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
       + ` ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

class EventLogService {
  constructor() {
    this._initialized = false;
    this._alertThreshold = DEFAULT_ALERT_THRESHOLD;
    this._retentionDays  = DEFAULT_RETENTION_DAYS;
    this._logLevel       = DEFAULT_LOG_LEVEL;
    // key -> { openId, trueRun, falseRun } for condition() debouncing
    this._conditions     = new Map();
  }

  // ── Initialization ──────────────────────────────────────────────────────────

  /**
   * Ensure the event_log table exists and load configuration.
   * Called lazily on first log() call, or explicitly during server startup.
   * Safe to call multiple times — no-ops after the first.
   */
  async initialize() {
    if (this._initialized) return;

    try {
      // Create table if it doesn't exist (idempotent)
      db.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS event_log (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')),
          source      TEXT    NOT NULL,
          category    TEXT    NOT NULL,
          event       TEXT    NOT NULL,
          severity    TEXT    NOT NULL DEFAULT 'info',
          message     TEXT    NOT NULL,
          metadata    TEXT,
          resolved_at TEXT
        )
      `);

      // Indices for the two primary access patterns:
      //   1. Dashboard: active events above severity threshold
      //   2. History:   paginated by timestamp with optional filters
      db.sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_event_log_active
          ON event_log(severity, resolved_at)
          WHERE resolved_at IS NULL
      `);
      db.sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_event_log_timestamp
          ON event_log(timestamp DESC)
      `);
      db.sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_event_log_category
          ON event_log(category)
      `);
      db.sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_event_log_source
          ON event_log(source)
      `);

      // Load configuration from system_settings (if present)
      await this._loadConfig();

      this._initialized = true;
      console.log(`   • ${PREFIX} — initialized (threshold: ${this._alertThreshold}, retention: ${this._retentionDays}d)`);
    } catch (err) {
      console.error(`   • ${PREFIX} — initialization failed: ${err.message}`);
      // Set initialized anyway to prevent infinite retry loops.
      // The service degrades gracefully — log() calls will fail individually.
      this._initialized = true;
    }
  }

  /**
   * Load alert threshold, retention days, and log level from system_settings.
   * Falls back to defaults if not configured.
   */
  async _loadConfig() {
    try {
      const [rows] = await db.pool.query(
        `SELECT setting_key, setting_value
           FROM system_settings
          WHERE category = 'event_log'`
      );

      for (const row of rows) {
        switch (row.setting_key) {
          case 'alert_threshold':
            if (SEVERITY_LEVELS[row.setting_value] !== undefined) {
              this._alertThreshold = row.setting_value;
            }
            break;
          case 'retention_days': {
            const days = Number(row.setting_value);
            if (days > 0) this._retentionDays = days;
            break;
          }
          case 'log_level':
            if (SEVERITY_LEVELS[row.setting_value] !== undefined) {
              this._logLevel = row.setting_value;
            }
            break;
        }
      }
    } catch (_) {
      // system_settings may not have event_log rows yet — use defaults
    }
  }

  // ── Core API ────────────────────────────────────────────────────────────────

  /**
   * Log an event.
   *
   * @param {string} source    — who raised it (e.g. 'strategy:smart-eco', 'manual:api')
   * @param {string} category  — grouping key (e.g. 'dispatch', 'collector')
   * @param {string} event     — what happened (e.g. 'discharge_started')
   * @param {string} severity  — 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical'
   * @param {string} message   — human-readable description
   * @param {object} [metadata] — optional structured data (stored as JSON)
   * @param {object} [options]
   * @param {boolean} [options.dedupe=true] — fold into an existing unresolved
   *        event with the same source/category/event rather than inserting a
   *        duplicate. Set false for events that may legitimately overlap.
   * @returns {number|null}    — row id (existing one when deduped), or null
   */
  async log(source, category, event, severity, message, metadata = null, options = {}) {
    if (!this._initialized) await this.initialize();

    // Validate severity
    if (SEVERITY_LEVELS[severity] === undefined) {
      console.warn(`   • ${PREFIX} - invalid severity '${severity}', defaulting to 'info'`);
      severity = 'info';
    }

    // Suppress events below configured log level
    if (SEVERITY_LEVELS[severity] < SEVERITY_LEVELS[this._logLevel]) {
      return null;
    }

    // Validate category — warn but don't reject (extensible)
    if (!VALID_CATEGORIES.has(category)) {
      console.warn(`   • ${PREFIX} - unknown category '${category}' (allowed but consider adding to VALID_CATEGORIES)`);
    }

    const { dedupe = true } = options;

    try {
      // Fold into the open occurrence of the same condition, if there is one.
      if (dedupe) {
        const existing = await this._findActive(source, category, event);
        if (existing) return this._touch(existing, severity, message, metadata);
      }

      const metadataJson = metadata ? JSON.stringify(metadata) : null;

      const [result] = await db.pool.query(
        `INSERT INTO event_log (source, category, event, severity, message, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [source, category, event, severity, message, metadataJson]
      );

      // Console output for visibility during development
      const sevTag = severity.toUpperCase().padEnd(8);
      const isAlert = SEVERITY_LEVELS[severity] >= SEVERITY_LEVELS[this._alertThreshold];
      const alertFlag = isAlert ? ' 🔔' : '';
      console.log(`   • ${PREFIX} - ${sevTag} ${source}/${event} — ${message}${alertFlag}`);

      return result.insertId ?? null;
    } catch (err) {
      console.error(`   • ${PREFIX} — log failed: ${err.message}`);
      return null;
    }
  }

  /** The open (unresolved) occurrence of this exact condition, if any. */
  async _findActive(source, category, event) {
    const [rows] = await db.pool.query(
      `SELECT id, metadata, severity
         FROM event_log
        WHERE source = ? AND category = ? AND event = ? AND resolved_at IS NULL
        ORDER BY id DESC
        LIMIT 1`,
      [source, category, event]
    );
    return rows?.[0] ?? null;
  }

  /**
   * Record another occurrence of an already-open condition.
   *
   * The original `timestamp` is left alone — it is when the condition STARTED,
   * which is the useful number. `occurrences` and `lastSeen` carry the rest,
   * and the message is refreshed so the latest detail (a changed lastError,
   * say) is what the panel shows.
   *
   * Severity only ever escalates: a condition that degrades from warning to
   * error should not silently drop back on the next sample.
   */
  async _touch(existing, severity, message, metadata) {
    const prev = safeParse(existing.metadata) || {};
    const merged = {
      ...prev,
      ...(metadata || {}),
      occurrences: (prev.occurrences ?? 1) + 1,
      firstSeen: prev.firstSeen ?? undefined,
      lastSeen: nowLocal(),
    };

    const escalated =
      (SEVERITY_LEVELS[severity] ?? 0) > (SEVERITY_LEVELS[existing.severity] ?? 0)
        ? severity
        : existing.severity;

    try {
      await db.pool.query(
        `UPDATE event_log
            SET message = ?, metadata = ?, severity = ?
          WHERE id = ?`,
        [message, JSON.stringify(merged), escalated, existing.id]
      );
    } catch (err) {
      console.error(`   • ${PREFIX} - dedupe update failed: ${err.message}`);
    }

    // Deliberately NOT logged to console on every repeat: the 45-row incident
    // produced 45 identical console lines as well as 45 rows.
    return existing.id;
  }

  // ── Conditions ──────────────────────────────────────────────────────────────

  /**
   * Declare whether a condition is currently true. Idempotent and safe to call
   * on every collector tick — it writes only on a transition.
   *
   * @param {object} c
   * @param {string}  c.key        stable identity, e.g. `device:7:over_threshold`
   * @param {boolean} c.active     is the condition true right now
   * @param {string}  c.source
   * @param {string}  c.category
   * @param {string}  c.event
   * @param {string}  [c.severity='info']
   * @param {string}  c.message
   * @param {object}  [c.metadata]
   * @param {number}  [c.confirmFor=1] consecutive true ticks before opening
   * @param {number}  [c.clearFor=1]   consecutive false ticks before resolving
   * @returns {'opened'|'closed'|null}
   */
  async condition({
    key, active, source, category, event,
    severity = 'info', message, metadata = null,
    confirmFor = 1, clearFor = 1,
  }) {
    if (!this._initialized) await this.initialize();
    if (!key) throw new Error('eventLog.condition: key is required');

    let st = this._conditions.get(key);
    if (!st) {
      // Rehydrate from the log, so a restart mid-condition does not re-fire.
      const open = await this._findActive(source, category, event);
      st = { openId: open?.id ?? null, trueRun: 0, falseRun: 0 };
      this._conditions.set(key, st);
    }

    if (active) {
      st.falseRun = 0;
      st.trueRun += 1;
      if (st.openId || st.trueRun < confirmFor) return null;

      st.openId = await this.log(source, category, event, severity, message, metadata);
      return 'opened';
    }

    st.trueRun = 0;
    st.falseRun += 1;
    if (!st.openId || st.falseRun < clearFor) return null;

    await this.resolve(st.openId);
    st.openId = null;
    return 'closed';
  }

  /** Is this condition currently open? */
  isConditionOpen(key) {
    return Boolean(this._conditions.get(key)?.openId);
  }

  /**
   * Drop in-memory condition state — call when a module reloads its devices,
   * so a removed device does not leave a stale entry behind.
   */
  forgetConditions(prefix = null) {
    if (!prefix) { this._conditions.clear(); return; }
    for (const k of this._conditions.keys()) {
      if (k.startsWith(prefix)) this._conditions.delete(k);
    }
  }

  // ── Resolution ──────────────────────────────────────────────────────────────

  /**
   * Resolve a specific event by its id.
   *
   * @param {number} id — the event_log row id
   * @returns {boolean} — true if a row was updated
   */
  async resolve(id) {
    if (!this._initialized) await this.initialize();

    try {
      const [result] = await db.pool.query(
        `UPDATE event_log
            SET resolved_at = strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')
          WHERE id = ? AND resolved_at IS NULL`,
        [id]
      );
      return (result.affectedRows ?? 0) > 0;
    } catch (err) {
      console.error(`   • ${PREFIX} - resolve(${id}) failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Resolve all active events matching a source and optionally an event name.
   * Useful for clearing state: e.g. resolve all active dispatches from manual:api.
   *
   * @param {string} source       — event source to match
   * @param {string} [eventName]  — optional event name filter
   * @returns {number}            — number of rows resolved
   */
  async resolveBySource(source, eventName = null) {
    if (!this._initialized) await this.initialize();

    try {
      let sql = `UPDATE event_log
                    SET resolved_at = strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')
                  WHERE source = ? AND resolved_at IS NULL`;
      const params = [source];

      if (eventName) {
        sql += ' AND event = ?';
        params.push(eventName);
      }

      const [result] = await db.pool.query(sql, params);
      return result.affectedRows ?? 0;
    } catch (err) {
      console.error(`   • ${PREFIX} - resolveBySource(${source}) failed: ${err.message}`);
      return 0;
    }
  }

  /**
   * Resolve all active events in a category.
   *
   * @param {string} category
   * @returns {number} — number of rows resolved
   */
  async resolveByCategory(category) {
    if (!this._initialized) await this.initialize();

    try {
      const [result] = await db.pool.query(
        `UPDATE event_log
            SET resolved_at = strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')
          WHERE category = ? AND resolved_at IS NULL`,
        [category]
      );
      return result.affectedRows ?? 0;
    } catch (err) {
      console.error(`   • ${PREFIX} - resolveByCategory(${category}) failed: ${err.message}`);
      return 0;
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  /**
   * Get all active (unresolved) events at or above the alert threshold.
   * Used by the dashboard to surface current alerts.
   *
   * @param {string} [minSeverity] — override alert threshold (default: configured threshold)
   * @returns {Array} — active events, newest first
   */
  async getActive(minSeverity = null) {
    if (!this._initialized) await this.initialize();

    const threshold = minSeverity ?? this._alertThreshold;
    const minLevel  = SEVERITY_LEVELS[threshold] ?? SEVERITY_LEVELS[DEFAULT_ALERT_THRESHOLD];

    // Filter in JS since SQLite doesn't natively sort by severity enum.
    // The active set is small (typically < 20 rows), so this is fine.
    try {
      const [rows] = await db.pool.query(
        `SELECT id, timestamp, source, category, event, severity, message, metadata
           FROM event_log
          WHERE resolved_at IS NULL
          ORDER BY timestamp DESC
          LIMIT 100`
      );

      return rows
        .filter(r => (SEVERITY_LEVELS[r.severity] ?? 0) >= minLevel)
        .map(r => ({ ...r, metadata: safeParse(r.metadata) }));
    } catch (err) {
      console.error(`   • ${PREFIX} - getActive failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Get paginated event history with optional filters.
   *
   * @param {object} options
   * @param {string}  [options.category]   — filter by category
   * @param {string}  [options.source]     — filter by source (exact or prefix with *)
   * @param {string}  [options.severity]   — minimum severity filter
   * @param {string}  [options.from]       — ISO date/datetime lower bound
   * @param {string}  [options.to]         — ISO date/datetime upper bound
   * @param {number}  [options.limit=50]   — page size (max 500)
   * @param {number}  [options.offset=0]   — pagination offset
   * @returns {{ events: Array, total: number, limit: number, offset: number }}
   */
  async getHistory({ category, source, severity, from, to, limit = DEFAULT_HISTORY_LIMIT, offset = 0 } = {}) {
    if (!this._initialized) await this.initialize();

    const conditions = [];
    const params     = [];

    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
    if (source) {
      if (source.endsWith('*')) {
        conditions.push('source LIKE ?');
        params.push(source.slice(0, -1) + '%');
      } else {
        conditions.push('source = ?');
        params.push(source);
      }
    }
    if (severity && SEVERITY_LEVELS[severity] !== undefined) {
      // Include this severity and above — filter all valid severity names
      const minLevel = SEVERITY_LEVELS[severity];
      const allowed  = Object.entries(SEVERITY_LEVELS)
        .filter(([, v]) => v >= minLevel)
        .map(([k]) => k);
      conditions.push(`severity IN (${allowed.map(() => '?').join(',')})`);
      params.push(...allowed);
    }
    if (from) {
      conditions.push('timestamp >= ?');
      params.push(from);
    }
    if (to) {
      conditions.push('timestamp <= ?');
      params.push(to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const safeLimit  = Math.max(1, Math.min(MAX_HISTORY_LIMIT, Number(limit) || DEFAULT_HISTORY_LIMIT));
    const safeOffset = Math.max(0, Number(offset) || 0);

    try {
      // Count total matching rows (for pagination)
      const [countRows] = await db.pool.query(
        `SELECT COUNT(*) AS total FROM event_log ${where}`,
        params
      );
      const total = countRows[0]?.total ?? 0;

      // Fetch page
      const [rows] = await db.pool.query(
        `SELECT id, timestamp, source, category, event, severity, message, metadata, resolved_at
           FROM event_log ${where}
          ORDER BY timestamp DESC
          LIMIT ? OFFSET ?`,
        [...params, safeLimit, safeOffset]
      );

      const events = rows.map(r => ({ ...r, metadata: safeParse(r.metadata) }));

      return { events, total, limit: safeLimit, offset: safeOffset };
    } catch (err) {
      console.error(`   • ${PREFIX} - getHistory failed: ${err.message}`);
      return { events: [], total: 0, limit: safeLimit, offset: safeOffset };
    }
  }

  // ── Maintenance ─────────────────────────────────────────────────────────────

  /**
   * Delete resolved events older than the configured retention period.
   * Unresolved events are NEVER pruned — they represent active state.
   * Called by aggregatorService on its nightly cycle.
   *
   * @param {number} [retentionDays] — override configured retention
   * @returns {number} — number of rows deleted
   */
  async prune(retentionDays = null) {
    if (!this._initialized) await this.initialize();

    const days = retentionDays ?? this._retentionDays;

    try {
      const [result] = await db.pool.query(
        `DELETE FROM event_log
          WHERE resolved_at IS NOT NULL
            AND timestamp < datetime('now', '-' || ? || ' days')`,
        [days]
      );

      const deleted = result.affectedRows ?? 0;
      if (deleted > 0) {
        console.log(`   • ${PREFIX} - pruned ${deleted} events older than ${days} days`);
      }
      return deleted;
    } catch (err) {
      console.error(`   • ${PREFIX} - prune failed: ${err.message}`);
      return 0;
    }
  }

  // ── Utility ─────────────────────────────────────────────────────────────────

  /** Check if a severity level qualifies as an alert under current config. */
  isAlert(severity) {
    return (SEVERITY_LEVELS[severity] ?? 0) >= (SEVERITY_LEVELS[this._alertThreshold] ?? 0);
  }

  /** Get the configured alert threshold. */
  get alertThreshold() {
    return this._alertThreshold;
  }

  /** Get the configured retention in days. */
  get retentionDays() {
    return this._retentionDays;
  }

  /** Expose severity levels for consumers that need to compare. */
  get severityLevels() {
    return { ...SEVERITY_LEVELS };
  }

  /** Expose valid categories for consumers / validation. */
  get validCategories() {
    return [...VALID_CATEGORIES];
  }
}

export default new EventLogService();