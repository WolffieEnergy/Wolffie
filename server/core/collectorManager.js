// core/collectorManager.js
//
// Owns the timing lifecycle for all module collectors.
// Each module gets an independent setTimeout chain — no setInterval, no drift.
//
// Interval resolution order (first non-null wins):
//   1. device_settings.poll_interval  (per-device DB override)
//   2. manifest.json → collector.interval
//   3. FALLBACK_INTERVAL (30 000 ms)
//
// Module collector contract (what each collector.js must expose):
//   collect()   → async, does one poll cycle, returns true/false
//   getStatus() → { lastCollection, lastError, consecutiveErrors, ... }
//
// Optional contract:
//   abort()     → async, best-effort force-teardown of any in-flight
//                 connection. Called when a collect() cycle has exceeded
//                 its hang-timeout (see _collectWithTimeout below) and
//                 this manager has stopped waiting on it. No-op if a
//                 module doesn't implement it — purely opt-in. Modules
//                 with stricter connection-sharing constraints (e.g. a
//                 single shared TCP connection also used for dispatch
//                 writes) can deliberately skip this and still get full
//                 hang-detection/reporting without their connection ever
//                 being forcibly killed.

import db from './database.js';
import capabilityRegistry from './capabilityRegistry.js';
import settingsService from './system/services/settingsService.js';
import eventLog from './system/services/eventLogService.js';
import { padName } from './utils/logger.js';
import { localTimestamp } from './utils/localTimestamp.js';
const PREFIX = padName('CollectorManager');

const FALLBACK_INTERVAL                  = 30000; // 30 s — used when nothing else is configured
const MAX_CONSECUTIVE_ERRORS             = 15;    // pause a collector after this many back-to-back failures
const DERIVED_METRICS_INTERVAL           = 15000; // 15 s — derived load calculation cadence
const DEFAULT_COLLECTOR_RESTART_MINUTES  = 30;    // fallback if system_settings not found
const DEFAULT_COLLECT_TIMEOUT_MS         = 8000;  // 8 s — hard deadline for a single collect() cycle.
                                                   // A cycle that hangs past this is treated as a normal
                                                   // failure (counts toward MAX_CONSECUTIVE_ERRORS).
                                                   // Override per module via manifest.collector.timeout.

class CollectorManager {
  constructor() {
    // Map<moduleId, ScheduleEntry>
    // ScheduleEntry = {
    //   id:                string,        // e.g. 'alphaess-cloud'
    //   name:              string,        // human-readable from manifest
    //   collector:         object,        // the imported collector instance
    //   interval:          number,        // resolved poll interval in ms
    //   timeout:           number,        // hard deadline (ms) for a single collect() cycle —
    //                                      // exceeding this is treated as a failure (possible hang)
    //   enabled:           boolean,
    //   timer:             Timeout|null,  // current pending setTimeout handle
    //   lastRun:           Date|null,
    //   nextRun:           Date|null,
    //   lastError:         string|null,
    //   consecutiveErrors: number,
    //   paused:            boolean,       // true after MAX_CONSECUTIVE_ERRORS
    //   recoveryTimer:     Timeout|null,  // one-shot auto-restart timer
    //   pauseEventOpen:    boolean,       // an unresolved collect_paused row exists
    //                                      // in event_log for this module. NOT the same
    //                                      // as `paused`: the recovery timer clears
    //                                      // `paused` before its probe, so only this
    //                                      // tracks whether the ALERT is still open.
    // }
    this.schedules = new Map();
    this.isRunning = false;

    // Derived metrics state
    this._derivedTimer     = null;
    this._derivedLastRun   = null;
    this._derivedLastError = null;

    // Resolved at start() from system_settings — cached for the session
    this._collectorRestartMs = DEFAULT_COLLECTOR_RESTART_MINUTES * 60 * 1000;
  }

  /**
   * Check if a module is enabled in the database
   * @param {string} moduleId - The module ID to check
   * @returns {Promise<boolean>} - True if enabled, false otherwise
   */
  async isModuleEnabled(moduleId) {
    try {
      const [rows] = await db.pool.query(
        `SELECT setting_value FROM system_settings 
         WHERE module_id = ? AND setting_key = 'enabled' 
         LIMIT 1`,
        [moduleId]
      );

      if (rows.length > 0) {
        const value = rows[0].setting_value;
        // Handle both string 'true'/'false' and boolean values
        return value === true || value === 'true' || value === '1' || value === 1;
      }

      // If no setting found, module is disabled by default for safety
      return false;
    } catch (error) {
      console.warn(` - ⚠️  Failed to check enabled status for ${moduleId}:`, error.message);
      // On error, assume disabled for safety
      return false;
    }
  }

  // ─── Public API ─────────────────────────────────────────────────

  /**
   * Register a module collector from a loaded module object.
   * Call once per module during server startup, before start().
   *
   * @param {object} module  – the module's default export (has .manifest attached by moduleLoader)
   */
  register(module) {
    const manifest = module.manifest;
    const loader='';
    if (!manifest?.capabilities?.dataCollection) {
      return; // Module doesn't do data collection — nothing to register
    }

    if (typeof module.collect !== 'function') {
      console.warn(` - ⚠️  CollectorManager: ${manifest?.id || 'unknown'} has dataCollection capability but no collect() method — skipped`);
      return;
    }

    const id = manifest.id;

    this.schedules.set(id, {
      id,
      name:              manifest.name,
      collector:         module,
      interval:          manifest.collector?.interval || FALLBACK_INTERVAL,
      timeout:           manifest.collector?.timeout  || DEFAULT_COLLECT_TIMEOUT_MS,
      enabled:           manifest.collector?.enabled !== false,
      timer:             null,
      lastRun:           null,
      nextRun:           null,
      lastError:         null,
      consecutiveErrors: 0,
      paused:            false,
      recoveryTimer:     null,
      pauseEventOpen:    false,
    });

    console.log(`     - Registered collector: ${manifest.name} (default interval: ${manifest.collector?.interval || FALLBACK_INTERVAL}ms, hang timeout: ${manifest.collector?.timeout || DEFAULT_COLLECT_TIMEOUT_MS}ms)`);
  }

  /**
   * Start all registered collectors.
   * For each enabled module: resolves the final interval (checking device_settings),
   * does an immediate first collect, then arms the setTimeout chain.
   */
  async start() {
    if (this.isRunning) {
      console.log('- CollectorManager already running');
      return;
    }
    this.isRunning = true;

    // Resolve auto-restart period from system_settings
    await this._resolveRestartInterval();

    // Phase 1 — resolve enabled state and interval for every module (DB reads,
    // fast and sequential so logs appear in a predictable order).
    for (const [id, entry] of this.schedules) {
      const isEnabled = await this.isModuleEnabled(id);
      entry.enabled = isEnabled;

      if (!isEnabled) {
        console.log(`\x1b[91m   - Skipped (disabled): ${entry.name} \x1b[37m`);
        continue;
      }

      entry.interval = await this._resolveInterval(id, entry.interval);
      console.log(`\x1b[37m   - Collector activated: ${entry.name} (interval: ${entry.interval / 1000}s)\x1b[37m`);
    }

    // Phase 2 — fire all initial collections concurrently and WITHOUT awaiting.
    // Each collector arms its own next timer after its first run completes.
    // This makes start() return immediately so server init can continue
    // (aggregatorService, strategyManager) without waiting for slow collectors.
    for (const [id, entry] of this.schedules) {
      if (!entry.enabled) continue;

      this._runCollector(id)
        .then(() => this._armNext(id))
        .catch((err) => {
          console.error(`\x1b[91m   - ${entry.name}: initial collect failed — ${err.message}\x1b[37m`);
          this._armNext(id); // still arm next even after a hard failure
        });
    }

    // Arm derived metrics — only when explicitly enabled via core setting.
    // Disabled by default: the current formula has known sign-convention issues
    // with bidirectional flows. Users opt in via Settings → Core → Data Collection.
    const dc = await settingsService.getCategory('data_collection');
    if (dc?.derive_home_load === true || dc?.derive_home_load === '1' || dc?.derive_home_load === 1) {
      this._derivedTimer = setTimeout(
        () => this._runDerivedMetrics(),
        DERIVED_METRICS_INTERVAL
      );
      console.log(`\x1b[37m   - Derived metrics armed (interval: ${DERIVED_METRICS_INTERVAL / 1000}s)\x1b[37m`);
    } else {
      console.log(`\x1b[37m   - Derived metrics: disabled (enable via Core Settings → Data Collection)\x1b[37m`);
    }

    console.log('\x1b[32m   • all collectors fired (running in background)\n \x1b[37m');
  }

  /**
   * Stop all collectors and clear all pending timers.
   */
  async stop() {
    console.log('\x1b[91m   - CollectorManager: stopping all collectors...\x1b[37m');

    for (const [id, entry] of this.schedules) {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      // Cancel any pending auto-recovery timer
      if (entry.recoveryTimer) {
        clearTimeout(entry.recoveryTimer);
        entry.recoveryTimer = null;
      }
    }

    // Stop derived metrics timer
    if (this._derivedTimer) {
      clearTimeout(this._derivedTimer);
      this._derivedTimer = null;
    }

    this.isRunning = false;
    console.log('\x1b[91m   - CollectorManager: all collectors stopped\x1b[37m');
  }

  /**
   * Get the live in-memory schedule state for all modules.
   * Suitable for a status/health API endpoint.
   */
  getSchedules() {
    const result = [];

    for (const [id, entry] of this.schedules) {
      result.push({
        id:                entry.id,
        name:              entry.name,
        enabled:           entry.enabled,
        paused:            entry.paused,
        interval:          entry.interval,
        lastRun:           entry.lastRun,
        nextRun:           entry.nextRun,
        lastError:         entry.lastError,
        consecutiveErrors: entry.consecutiveErrors,
        // Merge in whatever the collector itself reports
        ...(typeof entry.collector.getStatus === 'function' ? entry.collector.getStatus() : {})
      });
    }

    return result;
  }

  /**
   * Restart a single collector (re-resolve interval, immediate collect, re-arm).
   */
  async restart(moduleId) {
    const entry = this.schedules.get(moduleId);
    if (!entry) {
      throw new Error(`CollectorManager: no collector registered as '${moduleId}'`);
    }

    // Clear existing timers
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (entry.recoveryTimer) {
      clearTimeout(entry.recoveryTimer);
      entry.recoveryTimer = null;
    }

    // Reset error state
    entry.consecutiveErrors = 0;
    entry.paused = false;
    entry.lastError = null;

    // Re-resolve interval
    entry.interval = await this._resolveInterval(moduleId, entry.interval);

    console.log(` - CollectorManager: restarting ${entry.name} (interval: ${entry.interval / 1000}s)`);

    // Fire non-blocking
    this._runCollector(moduleId)
      .then(() => this._armNext(moduleId))
      .catch((err) => {
        console.error(`\x1b[91m   ❌ ${entry.name}: collect after restart failed — ${err.message}\x1b[37m`);
        this._armNext(moduleId);
      });
  }

  /**
   * Enable or disable a single collector at runtime.
   * Called by the settings route when a module is activated/deactivated.
   * Persists nothing — the caller is responsible for writing to system_settings first.
   *
   * @param {string} moduleId
   * @param {boolean} enabled
   */
  async setEnabled(moduleId, enabled) {
    const entry = this.schedules.get(moduleId);
    if (!entry) {
      throw new Error(`CollectorManager: no collector registered as '${moduleId}'`);
    }

    // Clear any running timers regardless of direction
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (entry.recoveryTimer) {
      clearTimeout(entry.recoveryTimer);
      entry.recoveryTimer = null;
    }

    entry.enabled = enabled;

    if (enabled) {
      // Reset error state so a freshly enabled collector starts clean
      entry.consecutiveErrors = 0;
      entry.paused = false;
      entry.lastError = null;

      // Re-resolve interval (settings may have changed since startup)
      entry.interval = await this._resolveInterval(moduleId, entry.interval);

      console.log(`\x1b[32m   ▶ Collector enabled: ${entry.name} (interval: ${entry.interval / 1000}s)\x1b[37m`);

      // Fire non-blocking so the settings route returns immediately
      this._runCollector(moduleId)
        .then(() => this._armNext(moduleId))
        .catch((err) => {
          console.error(`\x1b[91m   ❌ ${entry.name}: collect after enable failed — ${err.message}\x1b[37m`);
          this._armNext(moduleId);
        });
    } else {
      entry.paused = false; // not paused, just disabled
      entry.nextRun = null;
      console.log(`\x1b[91m   ⏹ Collector disabled: ${entry.name}\x1b[37m`);
    }

    return {
      id:      entry.id,
      name:    entry.name,
      enabled: entry.enabled,
      paused:  entry.paused,
    };
  }

  // ─── Internal: timing ───────────────────────────────────────────

  /**
   * Arm the next setTimeout for a given module.
   * This is the core of the "no drift" pattern:
   * the next timer is set only AFTER the current collect() finishes.
   */
  _armNext(moduleId) {
    const entry = this.schedules.get(moduleId);
    if (!entry || !this.isRunning || !entry.enabled || entry.paused) return;

    entry.nextRun = new Date(Date.now() + entry.interval);

    entry.timer = setTimeout(async () => {
      entry.timer = null; // Clear handle before running — _armNext will set the next one
      await this._runCollector(moduleId);
      this._armNext(moduleId); // Re-arm for next cycle
    }, entry.interval);
  }

  /**
   * Run entry.collector.collect() under a hard outer deadline (entry.timeout).
   *
   * Why this exists:
   *   _armNext() only schedules the NEXT cycle after this one resolves — the
   *   "no drift" pattern. That means if collect() never settles at all (e.g.
   *   a TCP connect() that hangs because the remote device silently drops
   *   the handshake instead of erroring), this module's schedule stops
   *   forever: no error, no log line, nothing — until the whole process is
   *   restarted.
   *
   * What this does:
   *   - Races collect() against a timeout. Whichever settles first wins.
   *   - If collect() loses (times out), we stop waiting on it and report a
   *     timeout error up to _runCollector — but the original promise may
   *     still be running underneath. We attach a no-op .catch() to it so
   *     that whenever it does eventually settle (e.g. an OS-level TCP
   *     timeout firing minutes later), it can never surface as a confusing
   *     unhandled rejection.
   *   - If the module exposes an optional abort() method, we call it after
   *     a timeout so it can forcibly tear down whatever connection is
   *     stuck, instead of leaking it until GC. Opt-in per module — see the
   *     "Module collector contract" note at the top of this file.
   */
  async _collectWithTimeout(entry) {
    const timeoutMs = entry.timeout || DEFAULT_COLLECT_TIMEOUT_MS;
    let timedOut = false;

    const collectPromise = Promise.resolve()
      .then(() => entry.collector.collect())
      .catch((err) => {
        // Cycle already timed out and _runCollector has moved on — this
        // rejection belongs to an orphaned attempt. Swallow it so it can
        // never surface as an unhandled rejection later.
        if (timedOut) return;
        throw err;
      });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        timedOut = true;
        reject(new Error(`Collection timed out after ${timeoutMs}ms (possible hang)`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([collectPromise, timeoutPromise]);
    } catch (err) {
      if (timedOut && typeof entry.collector.abort === 'function') {
        try {
          await entry.collector.abort();
        } catch (abortErr) {
          console.warn(`\x1b[93m   • ${entry.name}: abort() after timeout failed — ${abortErr.message}\x1b[37m`);
        }
      }
      throw err;
    }
  }

  /**
   * Execute one collection cycle for a module.
   * Updates lastRun, error tracking, and pauses on too many failures.
   *
   * The actual call to entry.collector.collect() is wrapped by
   * _collectWithTimeout() so a hung Modbus/TCP/HTTP call can never block
   * this module's schedule forever — see that method for details.
   */
  async _runCollector(moduleId) {
    const entry = this.schedules.get(moduleId);
    if (!entry) return;

    const startTime = Date.now();

    try {
      const success = await this._collectWithTimeout(entry);
      const elapsed = Date.now() - startTime;

      entry.lastRun = new Date();

      if (success) {
        entry.consecutiveErrors = 0;
        entry.lastError = null;
        entry.paused = false;
        await this._clearPauseAlert(entry);
      } else {
        // collect() returned false — treat as a soft failure
        entry.consecutiveErrors++;
        entry.lastError = entry.collector.lastError || 'collect() returned false';
        this._checkPause(entry);
      }

    } catch (error) {
      // collect() threw, or _collectWithTimeout() rejected (including a
      // hang-timeout) — hard failure either way.
      entry.lastRun = new Date();
      entry.consecutiveErrors++;
      entry.lastError = error.message;
      console.error(`\x1b[91m -   ❌ ${entry.name}: ${error.message} \x1b[37m`);
      this._checkPause(entry);
    }
  }

  /**
   * Close the open collect_paused alert once a module is collecting again.
   *
   * This previously only happened on the auto-recovery path — inside the
   * recovery timer, and only if that single probe succeeded. In practice a
   * device usually comes back during normal cycling rather than during that
   * one probe, so the alert stayed open forever, `prune()` spares unresolved
   * rows by design, and the dashboard card never went away.
   *
   * `pauseEventOpen` rather than `paused`, because the recovery timer clears
   * `paused` before probing — by the time a probe succeeds, `paused` is
   * already false and cannot tell us whether an alert is outstanding.
   */
  async _clearPauseAlert(entry) {
    if (!entry.pauseEventOpen) return;
    entry.pauseEventOpen = false;

    try {
      // Resolves EVERY unresolved collect_paused row for this source, so the
      // backlog written before this fix is cleared by the first success too.
      const resolved = await eventLog.resolveBySource(`collector:${entry.id}`, 'collect_paused');

      await eventLog.log(
        `collector:${entry.id}`,
        'collector',
        'collect_resumed',
        'info',
        `${entry.name} recovered`,
        { resolvedAlerts: resolved }
      );

      console.log(`\x1b[32m   • ${entry.name}: collecting again — alert cleared\x1b[37m`);
    } catch (err) {
      console.warn(`\x1b[93m   • ${entry.name}: failed to clear collect_paused alert — ${err.message}\x1b[37m`);
    }
  }

  /**
   * Pause a collector if it has hit the consecutive error limit.
   * Arms a one-shot recovery timer based on system_settings
   * category='data_collection', setting_key='collector_restart_minutes'.
   * Also raises a 'collector' event-log entry (category='collector',
   * event='collect_paused') so the failure shows up as a proper audit-trail
   * alert, not just a console line. The event is resolved automatically
   * once the auto-recovery attempt below succeeds.
   */
  _checkPause(entry) {
    if (entry.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS && !entry.paused) {
      entry.paused = true;
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }

      const restartMinutes = Math.round(this._collectorRestartMs / 60000);
      console.warn(
        `\x1b[93m   • ${entry.name}: paused after ${MAX_CONSECUTIVE_ERRORS} consecutive errors. ` +
        `Auto-restart in ${restartMinutes}m.\x1b[37m`
      );

      entry.pauseEventOpen = true;

      eventLog.log(
        `collector:${entry.id}`,
        'collector',
        'collect_paused',
        'error',
        `Communication failed with ${entry.name} after ${MAX_CONSECUTIVE_ERRORS} consecutive failures — retrying in ${restartMinutes}m`,
        { consecutiveErrors: entry.consecutiveErrors, lastError: entry.lastError, restartMinutes }
      ).catch((err) => {
        console.warn(`\x1b[93m   • ${entry.name}: failed to log collect_paused event — ${err.message}\x1b[37m`);
      });

      // Cancel any existing recovery timer before arming a new one
      if (entry.recoveryTimer) {
        clearTimeout(entry.recoveryTimer);
      }

      entry.recoveryTimer = setTimeout(() => {
        entry.recoveryTimer = null;
        if (!this.isRunning) return;
        console.log(`\x1b[32m   • ${entry.name}: auto-recovering after ${restartMinutes}m pause\x1b[37m`);
        entry.consecutiveErrors = 0;
        entry.paused            = false;
        entry.lastError         = null;
        this._runCollector(entry.id)
          .then(() => {
            this._armNext(entry.id);
            if (entry.consecutiveErrors === 0) {
              // Recovery probe succeeded. _runCollector has normally already
              // cleared the alert via _clearPauseAlert; this is a no-op in
              // that case and a safety net if the ordering ever changes.
              this._clearPauseAlert(entry).catch(() => {});
            }
          })
          .catch((err) => {
            console.error(`\x1b[91m   ❌ ${entry.name}: auto-recovery failed — ${err.message}\x1b[37m`);
            this._armNext(entry.id);
          });
      }, this._collectorRestartMs);
    }
  }

  // ─── Derived Metrics ────────────────────────────────────────────────────────

  /**
   * Derives load_power and load_energy_today from capability registry readings.
   * Writes a synthetic energy_snapshots row with source = 'wolffie-core'.
   * Owns only load_power and load_energy_today — all other fields NULL.
   *
   * Sign conventions (canonical across all modules):
   *   solar    always positive (production)
   *   battery  positive = charging (absorbing power), negative = discharging (supplying power)
   *   grid     positive = importing, negative = exporting
   *
   * load_power formula:
   *   load = solar - battery + grid
   *
   *   Rationale:
   *     - Solar produces power available to home               → +solar
   *     - Battery charging consumes power (raises load)        → -battery when positive
   *     - Battery discharging supplies power (lowers net load) → -battery when negative = +
   *     - Grid import supplies power to home                   → +grid when positive
   *     - Grid export removes surplus from home                → +grid when negative = -
   *
   * load_energy_today:
   *   load_today = solar_today + (import_today - export_today) + (discharge_today - charge_today)
   */
  async _runDerivedMetrics() {
    if (!this.isRunning) return;

    try {
      // ── Read from capability registry ────────────────────────────────────
      const [solar, battery, grid] = await Promise.all([
        capabilityRegistry.has('solar:read')   ? capabilityRegistry.get('solar:read')()   : null,
        capabilityRegistry.has('battery:read') ? capabilityRegistry.get('battery:read')() : null,
        capabilityRegistry.has('grid:read')    ? capabilityRegistry.get('grid:read')()    : null,
      ]);

      const solarPower   = solar?.power   ?? 0;
      const batteryPower = battery?.power ?? 0;
      const gridPower    = grid?.power    ?? 0;

      // ── Derive live load ─────────────────────────────────────────────────
      // battery positive = charging (consuming power) → subtract from load
      // battery negative = discharging (supplying power) → subtract negative = add to load
      const loadPower = Math.max(0, solarPower - batteryPower + gridPower);

      // ── Derive daily load total ──────────────────────────────────────────
      const solarToday     = solar?.energy_today      ?? 0;
      const importToday    = grid?.import_today       ?? 0;
      const exportToday    = grid?.export_today       ?? 0;
      const chargeToday    = battery?.charge_today    ?? 0;
      const dischargeToday = battery?.discharge_today ?? 0;

      const loadEnergyToday = Math.max(0,
        solarToday +
        (importToday    - exportToday) +
        (dischargeToday - chargeToday)
      );

      // ── Write synthetic snapshot ─────────────────────────────────────────
      // All energy_snapshots rows use local time (CET/CEST without offset marker)
      // to match the alphaess-cloud and homewizard collectors. Earlier versions
      // wrote UTC here via .toISOString(); that put wolffie-core rows in different
      // hour buckets than other sources, breaking the aggregator's strftime-based
      // bucketing for all consumers downstream.
      const localNow = localTimestamp();

      await db.pool.query(
        `INSERT INTO energy_snapshots (
          timestamp, source, device_id,
          load_power, load_energy_today
        ) VALUES (?, 'wolffie-core', 'derived', ?, ?)
        ON CONFLICT(timestamp, source) DO UPDATE SET
          load_power        = excluded.load_power,
          load_energy_today = excluded.load_energy_today`,
        [localNow, Math.round(loadPower), loadEnergyToday]
      );

      this._derivedLastRun   = new Date();
      this._derivedLastError = null;

      console.log(
        `   • ${PREFIX} – Load=${Math.round(loadPower)}W` +
        ` (Solar=${solarPower}W Battery=${batteryPower}W Grid=${gridPower}W)` +
        ` LoadToday=${loadEnergyToday.toFixed(3)}kWh`
      );

    } catch (err) {
      this._derivedLastError = err.message;
      console.error(`\x1b[31m   • ${PREFIX} derived metrics failed: ${err.message}\x1b[37m`);
    }

    // Re-arm — only if still running
    if (this.isRunning) {
      this._derivedTimer = setTimeout(
        () => this._runDerivedMetrics(),
        DERIVED_METRICS_INTERVAL
      );
    }
  }

  // ─── Internal: interval resolution ──────────────────────────────

  /**
   * Resolve the auto-restart period from system_settings.
   * category='data_collection', setting_key='collector_restart_minutes'
   * Falls back to DEFAULT_COLLECTOR_RESTART_MINUTES if not found.
   */
  async _resolveRestartInterval() {
    try {
      const [rows] = await db.pool.query(
        `SELECT setting_value FROM system_settings
          WHERE category    = 'data_collection'
            AND setting_key = 'collector_restart_minutes'
          LIMIT 1`
      );
      if (rows.length > 0 && rows[0].setting_value) {
        const minutes = Number(rows[0].setting_value);
        if (minutes > 0) {
          this._collectorRestartMs = minutes * 60 * 1000;
          console.log(`\x1b[37m   - Collector auto-restart: ${minutes}m (from system_settings)\x1b[37m`);
          return;
        }
      }
    } catch (err) {
      console.warn(`   - collector_restart_minutes lookup failed: ${err.message}, using default`);
    }
    console.log(`\x1b[37m   - Collector auto-restart: ${DEFAULT_COLLECTOR_RESTART_MINUTES}m (default)\x1b[37m`);
  }

  /**
   * Resolve the effective poll interval for a module.
   *
   * Priority:
   *   1. system_settings.setting_value WHERE module_id = moduleId AND setting_key = 'poll_interval'
   *   2. The default passed in (from manifest.json)
   *
   * Returns the interval in milliseconds.
   */
  async _resolveInterval(moduleId, manifestDefault) {
    try {
      const [rows] = await db.pool.query(
        `SELECT setting_value FROM system_settings
         WHERE module_id = ? AND setting_key = 'poll_interval' 
         LIMIT 1`,
        [moduleId]
      );

      if (rows.length > 0 && rows[0].setting_value) {
        const dbInterval = Number(rows[0].setting_value);
        if (dbInterval > 0) {
          return dbInterval;
        }
      }
    } catch (error) {
      console.log(`\x1b[91m   • ${moduleId}: system_settings lookup failed (${error.message}), using manifest default\x1b[37m `);
    }

    return manifestDefault;
  }
}

export default new CollectorManager();