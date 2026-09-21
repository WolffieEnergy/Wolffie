// server/core/system/routes/data.js
//
// Wijzigingen t.o.v. MySQL-versie:
//   CURDATE()                           →  date('now')
//   DATE_SUB(CURDATE(), INTERVAL 1 DAY) →  date('now', '-1 day')

import express from 'express';
import db from '../../database.js';
import systemConfigService from '../services/systemconfigservice.js';
import collectorManager from '../../collectorManager.js';
import capabilityRegistry from '../../capabilityRegistry.js';

const router = express.Router();

// ── Dashboard v2 extension helpers ────────────────────────────────────────
//
// These helpers compute the additive blocks added to /summary for the v2
// dashboard. Each is wrapped in try/catch by its caller and returns a safe
// default on failure — the v1 response shape is never broken.
//
// Stub status (PR 2 partial implementation):
//   peak                          stub  — needs day-ahead-prices peak detection PR
//   advisory                      stub  — needs advisory engine PR
//   forecast[1] (tomorrow)        stub  — needs Solar Forecast 3-day extension
//   forecast[2] (day after)       stub  — needs Solar Forecast 3-day extension
//   dayPlan.batteryAtPeak*Pct     stub  — depends on peak window from peak detection
//   dayPlan.expectedGridImport... real  — derived from strategy_day_plan

/** Default ISO-8601 local string formatter — matches localTimestamp() shape. */
function localDateStr(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Find tonight's window using solar forecast hourly data:
 *   sunset  = MAX(slot_datetime) for today  where hourly_wh > 0
 *   sunrise = MIN(slot_datetime) for tomorrow where hourly_wh > 0
 *
 * Returns { sunset: 'YYYY-MM-DD HH:MM:SS', sunrise: 'YYYY-MM-DD HH:MM:SS' }
 * or null if either bound can't be determined (no forecast data, all-night
 * day, etc.). Hour-precision approximation; good enough for "tonight" sums.
 */
async function _getTonightWindow() {
  const now      = new Date();
  const today    = localDateStr(now);
  const tomorrow = localDateStr(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  const [sunsetRows] = await db.pool.query(
    `SELECT MAX(slot_datetime) AS slot
       FROM solar_forecast_hourly
      WHERE date = ? AND hourly_wh > 0`,
    [today]
  );
  const [sunriseRows] = await db.pool.query(
    `SELECT MIN(slot_datetime) AS slot
       FROM solar_forecast_hourly
      WHERE date = ? AND hourly_wh > 0`,
    [tomorrow]
  );

  const sunset  = sunsetRows[0]?.slot;
  const sunrise = sunriseRows[0]?.slot;
  if (!sunset || !sunrise) return null;
  return { sunset, sunrise };
}

/**
 * Build the dayPlan block from the most recent strategy_day_plan row.
 *
 * - Reads the latest plan (one row per day, JSON-encoded slots in `plan`).
 * - Reconstructs each slot's local timestamp as window_start + slot * 15min.
 *   We do NOT use slot.datetime — it's a known UTC bug deferred from PR 1.
 * - Sums simGridImportKwh for slots inside the tonight window.
 * - batteryAtPeakStartPct / batteryAtPeakEndPct stay null until peak detection
 *   ships (the peak window is required to query SoC at its edges).
 *
 * Returns { batteryAtPeakStartPct, batteryAtPeakEndPct, expectedGridImportKwhTonight }
 * with all fields possibly null if any required input is missing.
 */
async function _buildDayPlanBlock() {
  const result = {
    batteryAtPeakStartPct:        null, // stub — needs peak window
    batteryAtPeakEndPct:          null, // stub — needs peak window
    expectedGridImportKwhTonight: null,
  };

  const [rows] = await db.pool.query(
    `SELECT plan, window_start
       FROM strategy_day_plan
      ORDER BY generated_at DESC
      LIMIT 1`
  );
  if (!rows.length) return result;

  let slots;
  try {
    slots = JSON.parse(rows[0].plan);
  } catch (e) {
    return result; // malformed plan — return stub block
  }
  if (!Array.isArray(slots) || slots.length === 0) return result;

  const windowStart = new Date(rows[0].window_start.replace(' ', 'T'));
  if (isNaN(windowStart.getTime())) return result;

  const tonight = await _getTonightWindow();
  if (!tonight) return result; // no forecast = can't bound the night

  const sunsetMs  = new Date(tonight.sunset.replace(' ', 'T')).getTime();
  const sunriseMs = new Date(tonight.sunrise.replace(' ', 'T')).getTime();

  // Sum simGridImportKwh for slots whose reconstructed local timestamp
  // falls inside [sunset, sunrise]. Track whether ALL in-window slots
  // had the field — if any slot is missing it, return null per spec
  // (partial sums are misleading).
  let total            = 0;
  let inWindowSlots    = 0;
  let slotsWithImport  = 0;
  for (const slot of slots) {
    const slotMs = windowStart.getTime() + slot.slot * 15 * 60 * 1000;
    if (slotMs >= sunsetMs && slotMs < sunriseMs) {
      inWindowSlots++;
      if (typeof slot.simGridImportKwh === 'number') {
        total += slot.simGridImportKwh;
        slotsWithImport++;
      }
    }
  }

  if (inWindowSlots === 0) return result;
  if (slotsWithImport < inWindowSlots) return result; // partial = null

  result.expectedGridImportKwhTonight = Math.round(total * 1000) / 1000;
  return result;
}

/**
 * Build the forecast block — today is real, tomorrow + day-after are stubs
 * until the Solar Forecast 3-day extension PR.
 *
 * Returns an array of 3 entries:
 *   [{ date, condition, expectedKwh, isLowYield }, ...]
 */
async function _buildForecastBlock() {
  const now    = new Date();
  const today  = localDateStr(now);
  const tomDay = localDateStr(new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000));
  const aftDay = localDateStr(new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000));

  const [rows] = await db.pool.query(
    `SELECT date, expected_kwh
       FROM solar_forecasts
      WHERE date IN (?, ?, ?)`,
    [today, tomDay, aftDay]
  );
  const byDate = Object.fromEntries(rows.map(r => [r.date, r.expected_kwh]));

  // Day is "low yield" if expected_kwh is < 50% of the best of the three.
  // Real today, stub future = low-yield comparison only meaningful for today.
  const todayKwh = byDate[today] ?? null;

  return [
    {
      date:        today,
      condition:   'unknown',                 // stub — needs cloud-cover lookup
      expectedKwh: todayKwh,
      isLowYield:  false,                     // stub — needs 3-day comparison
    },
    {
      date:        tomDay,
      condition:   'unknown',
      expectedKwh: byDate[tomDay] ?? null,    // may be null until 3-day forecast PR
      isLowYield:  false,
    },
    {
      date:        aftDay,
      condition:   'unknown',
      expectedKwh: byDate[aftDay] ?? null,
      isLowYield:  false,
    },
  ];
}

/**
 * Build the health block from collectorManager.getSchedules().
 *
 * A collector is "degraded" if it is currently active (enabled && !paused)
 * AND any of:
 *   - lastError is non-null  (most recent run threw an error)
 *   - consecutiveErrors > 0  (errors are accumulating)
 *   - lastRun is older than 3 missed intervals (intervalMs * 3)
 *   - lastRun is null AND time-since-registration exceeds the interval
 *     (collector should have run by now but hasn't)
 *
 * The "3 missed intervals" rule scales with each collector's natural cadence:
 *   - 20s collector → degraded after ~60s silent
 *   - 60min collector → degraded after ~180min silent
 * Three consecutive missed runs is a real signal; one or two is a transient.
 *
 * Inactive collectors (disabled or paused) are never reported. Old data from
 * uninstalled modules isn't reported either — it never enters this block
 * because the module isn't in getSchedules() anymore.
 *
 * Note: 'wolffie-core' (the internal derivation in collectorManager) is NOT
 * tracked here. It's a derivation that fills in load_power, not a peer
 * collector. If derivation fails, the symptom surfaces via realtime.home.power
 * being null/zero — that's the correct place to detect it.
 */
function _buildHealthBlock() {
  const STALE_INTERVAL_FACTOR = 3;     // degraded after 3 missed intervals
  const nowMs                 = Date.now();
  const degraded              = [];
  let mostRecentMs            = 0;

  const schedules = collectorManager.getSchedules();

  for (const s of schedules) {
    // Inactive collectors are never reported — they're not expected to produce data.
    if (!s.enabled || s.paused) continue;

    const intervalMs    = Number(s.intervalMs ?? s.interval ?? 0);
    const staleAfterMs  = intervalMs * STALE_INTERVAL_FACTOR;
    const lastRunMs     = s.lastRun ? new Date(s.lastRun).getTime() : null;

    let isDegraded = false;
    if (s.lastError !== null && s.lastError !== undefined)              isDegraded = true;
    if ((s.consecutiveErrors ?? 0) > 0)                                  isDegraded = true;
    if (lastRunMs !== null && nowMs - lastRunMs > staleAfterMs)          isDegraded = true;

    // lastRun: null is only degraded if the collector has had time to run.
    // We use the next scheduled run as a proxy for "registration time + interval":
    // if nextRun is in the past, the collector should have produced a lastRun by now.
    if (lastRunMs === null && s.nextRun) {
      const nextRunMs = new Date(s.nextRun).getTime();
      if (!isNaN(nextRunMs) && nextRunMs < nowMs - intervalMs) {
        isDegraded = true;
      }
    }

    if (isDegraded) degraded.push(s.id);

    if (lastRunMs !== null && lastRunMs > mostRecentMs) {
      mostRecentMs = lastRunMs;
    }
  }

  const lastCollectorRunAt = mostRecentMs > 0
    ? new Date(mostRecentMs).toISOString()
    : null;

  return {
    lastCollectorRunAt,
    stale:           degraded.length > 0,
    degradedSources: degraded,
  };
}

/**
 * Fetch the most recent smart-eco strategy decision from strategy_decisions.
 * Only returns a result when:
 *   - strategy_id = 'smart-eco'
 *   - evaluated_at is within the last 90 minutes (stale decisions are not useful)
 *
 * Returns:
 *   { reason: string, evaluatedAt: string } | null
 */
async function _buildStrategyDecisionBlock() {
  const [rows] = await db.pool.query(`
    SELECT reason, evaluated_at
    FROM   strategy_decisions
    WHERE  strategy_id = 'smart-eco'
      AND  evaluated_at >= datetime('now', '-90 minutes')
    ORDER  BY evaluated_at DESC
    LIMIT  1
  `);

  if (!rows || rows.length === 0) return null;

  return {
    reason:      rows[0].reason      ?? null,
    evaluatedAt: rows[0].evaluated_at ?? null,
  };
}

/**
 * Build the averages block — 14-day mean daily totals, used as the reference
 * scale for the overview gauges and printed in the caption under each one.
 *
 * Contract consumed by Dashboard.vue:
 *   averages.avg_solar_14d, avg_load_14d, avg_grid_import_14d, avg_grid_export_14d
 * Each is kWh/day, or null when there isn't enough history. Null renders as
 * "no avg yet" / a hidden arc rather than a fabricated fraction.
 *
 * Completeness is enforced PER SERIES: a day counts toward a series' average
 * only if that column has 24 non-null hours. Load derivation returns NULL
 * unless all three domains are present, so load has gaps that solar and grid
 * do not — a single shared "complete day" filter would discard good solar
 * data to protect load. Partial days are dropped, never scaled: they
 * understate their own total and would bias every average low.
 *
 * Column sources (verified against the live DB, not assumed):
 *   solar  pv_power_avg        W, hourly mean → /1000 = kWh for that hour
 *   load   load_power_avg      W, hourly mean → /1000
 *   grid   grid_import_kwh / grid_export_kwh   already kWh
 * The parallel *_wh columns (pv_energy_wh, load_consumption_wh,
 * grid_import_wh, grid_export_wh) are a dead migration leftover — 0 rows
 * populated in the last 30 days. Do not reach for them.
 * solar_to_grid_kwh is NOT used: it is known-mislabelled (holds solar→battery).
 */
const AVG_WINDOW_DAYS = 14;   // trailing complete days — consumption is seasonal
const AVG_MIN_DAYS    = 7;    // below this, report null rather than a weak mean
const AVG_CACHE_MS    = 60 * 60 * 1000;  // only changes when a day completes

let _averagesCache = { value: null, computedAtMs: 0 };

/**
 * Mean daily total for one series.
 * `expr` is the per-hour contribution in kWh; `col` is the column whose
 * non-nullness defines a complete hour. Both are module constants, never
 * request input.
 */
async function _avgDailyTotal(col, expr) {
  // energy_hours.timestamp is LOCAL time — date() buckets local days directly.
  const [rows] = await db.pool.query(`
    WITH daily AS (
      SELECT date(timestamp) AS d, SUM(${expr}) AS total
      FROM   energy_hours
      WHERE  ${col} IS NOT NULL
      GROUP  BY d
      HAVING COUNT(${col}) = 24
      ORDER  BY d DESC
      LIMIT  ${AVG_WINDOW_DAYS}
    )
    SELECT AVG(total) AS avg_kwh, COUNT(*) AS days FROM daily
  `);

  const row  = rows?.[0];
  const days = Number(row?.days) || 0;
  if (days < AVG_MIN_DAYS || row?.avg_kwh === null) return { value: null, days };

  return { value: Math.round(Number(row.avg_kwh) * 100) / 100, days };
}

async function _buildAveragesBlock() {
  const nowMs = Date.now();
  if (_averagesCache.value && nowMs - _averagesCache.computedAtMs < AVG_CACHE_MS) {
    return _averagesCache.value;
  }

  const [solar, load, imp, exp] = await Promise.all([
    _avgDailyTotal('pv_power_avg',    'pv_power_avg / 1000.0'),
    _avgDailyTotal('load_power_avg',  'load_power_avg / 1000.0'),
    _avgDailyTotal('grid_import_kwh', 'grid_import_kwh'),
    // grid_export_kwh is signed: negative = energy leaving the house.
    // Verified against the live DB (min -4.803, max 0.0). Import is the
    // opposite convention (min 0.0, max 3.589) and needs no negation.
    // The gauge caption wants a positive magnitude, so flip the sign here.
    _avgDailyTotal('grid_export_kwh', '-grid_export_kwh'),
  ]);

  const value = {
    avg_solar_14d:       solar.value,
    avg_load_14d:        load.value,
    avg_grid_import_14d: imp.value,
    avg_grid_export_14d: exp.value,
    // Sample size per series — they differ, because completeness differs.
    sampleDays: {
      solar:       solar.days,
      load:        load.days,
      grid_import: imp.days,
      grid_export: exp.days,
    },
  };

  _averagesCache = { value, computedAtMs: nowMs };
  return value;
}

// ── GET /api/system/summary ────────────────────────────────────────────────

router.get('/summary', async (req, res) => {
  try {
    // Fetch the latest snapshot per source within the last 2 hours.
    // This ensures each module (SolarEdge, AlphaESS, HomeWizard) contributes
    // its own fields, instead of a single LIMIT 1 always returning the module
    // that collects most frequently (HomeWizard), whose solar/battery fields are null.
    // When AlphaESS Cloud is the only source, GROUP BY returns one row with all
    // fields — firstNonNull() reads from that single row, so it works identically.
    const [rows] = await db.pool.query(`
      SELECT s.timestamp, s.source,
             s.solar_power, s.battery_power, s.battery_soc, s.grid_power, s.load_power,
             s.solar_energy_today, s.grid_energy_import_today, s.grid_energy_export_today,
             s.load_energy_today, s.battery_charge_today, s.battery_discharge_today,
             s.trees_equivalent, s.co2_offset_kg
      FROM energy_snapshots s
      INNER JOIN (
        SELECT source, MAX(timestamp) AS latest
        FROM energy_snapshots
        WHERE timestamp >= datetime('now', '-2 hours')
        GROUP BY source
      ) latest ON s.source = latest.source AND s.timestamp = latest.latest
      ORDER BY s.timestamp DESC
    `);

    if (rows.length === 0) {
      return res.json({
        collector:     { connected: false, message: 'No data yet' },
        today:         {},
        realtime:      {},
        environmental: {},
      });
    }

    // Return the first non-null value for a field across all source rows.
    // Rows are ordered newest-first, so the freshest value always wins.
    const firstNonNull = (field) => {
      for (const row of rows) {
        if (row[field] !== null && row[field] !== undefined) return row[field];
      }
      return null;
    };

    const newest     = rows[0]; // Most recent row overall — used for timestamp/source reporting
    const lastUpdate = new Date(newest.timestamp);
    const dataAge    = Date.now() - lastUpdate.getTime();
    const isConnected = dataAge < 300000;

    // Resolve shared power values used for derivation
    const rawSolarP   = parseFloat(firstNonNull('solar_power'))   || 0;
    const rawBatteryP = parseFloat(firstNonNull('battery_power')) || 0;
    const rawGridP    = parseFloat(firstNonNull('grid_power'))    || 0;
    const rawHomeP    = firstNonNull('load_power');

    // Home consumption is not directly measured in AC-coupled topology.
    // Derive from power balance: home = solar + battery + grid
    //   battery_power < 0 → charging (consuming)   grid_power < 0 → exporting
    // Use a direct load_power measurement when available and non-zero.
    const homePower = (rawHomeP !== null && parseFloat(rawHomeP) > 0)
      ? parseFloat(rawHomeP)
      : Math.max(0, rawSolarP + rawBatteryP + rawGridP);

    // Resolve daily energy totals — reuse named vars to avoid double firstNonNull calls
    const pvGen         = parseFloat(firstNonNull('solar_energy_today'))       || 0;
    const battCharge    = parseFloat(firstNonNull('battery_charge_today'))     || 0;
    const battDischarge = parseFloat(firstNonNull('battery_discharge_today'))  || 0;
    const gridImport    = parseFloat(firstNonNull('grid_energy_import_today')) || 0;
    const gridExport    = parseFloat(firstNonNull('grid_energy_export_today')) || 0;
    const rawLoadEnergy = firstNonNull('load_energy_today');

    // Daily home consumption: pv_gen + batt_discharge − batt_charge + import − export
    const loadEnergy = (rawLoadEnergy !== null && parseFloat(rawLoadEnergy) > 0)
      ? parseFloat(rawLoadEnergy)
      : Math.max(0, pvGen + battDischarge - battCharge + gridImport - gridExport);

    // Build the v1 response shape (unchanged from prior version).
    const responseBody = {
      collector: {
        connected:  isConnected,
        lastUpdate: lastUpdate.toISOString(),
        ageSeconds: Math.floor(dataAge / 1000),
        source:     newest.source,
      },
      today: {
        pv_generation:     pvGen,
        load_consumption:  loadEnergy,
        grid_import:       gridImport,
        grid_export:       gridExport,
        battery_charge:    battCharge,
        battery_discharge: battDischarge,
      },
      realtime: {
        timestamp: newest.timestamp,
        battery: {
          soc:   parseFloat(firstNonNull('battery_soc')) || 0,
          power: rawBatteryP,
        },
        solar: {
          total: rawSolarP,
          pv1: 0, pv2: 0, pv3: 0,
        },
        grid: {
          power: rawGridP,
          gridConnected: (() => {
            try {
              if (capabilityRegistry.has('grid:status')) {
                const status = capabilityRegistry.get('grid:status')();
                return status?.gridConnected ?? true;
              }
            } catch (_) {}
            return true; // default to connected if capability unavailable
          })(),
        },
        home: { power: homePower },
      },
      environmental: {
        co2_saved:        parseFloat(firstNonNull('co2_offset_kg'))    || 0,
        trees_equivalent: parseFloat(firstNonNull('trees_equivalent')) || 0,
      },
    };

    // ── v2 dashboard additive blocks ──────────────────────────────────────
    // Each block is computed inside its own try/catch. Failure of any block
    // returns a safe default for that block — the v1 response above is never
    // affected.

    // peak — fully stubbed until day-ahead-prices peak detection PR
    responseBody.peak = {
      state:        'idle',
      severity:     null,
      window:       null,
      minutesUntil: null,
      reason:       null,
    };

    // dayPlan — partially real (expectedGridImportKwhTonight only)
    try {
      responseBody.dayPlan = await _buildDayPlanBlock();
    } catch (err) {
      console.error('[summary] dayPlan failed:', err.message);
      responseBody.dayPlan = {
        batteryAtPeakStartPct:        null,
        batteryAtPeakEndPct:          null,
        expectedGridImportKwhTonight: null,
      };
    }

    // forecast — today real, tomorrow + day-after stub
    try {
      responseBody.forecast = await _buildForecastBlock();
    } catch (err) {
      console.error('[summary] forecast failed:', err.message);
      responseBody.forecast = [];
    }

    // advisory — fully stubbed until advisory engine PR
    responseBody.advisory = {
      id:        'idle-default',
      tone:      'neutral',
      headline:  '',
      body:      '',
      constraint: null,
    };

    // strategyDecision — latest smart-eco decision reason for dashboard display
    try {
      responseBody.strategyDecision = await _buildStrategyDecisionBlock();
    } catch (err) {
      console.error('[summary] strategyDecision failed:', err.message);
      responseBody.strategyDecision = null;
    }

    // health — derived from collectorManager.getSchedules()
    try {
      responseBody.health = _buildHealthBlock();
    } catch (err) {
      console.error('[summary] health failed:', err.message);
      responseBody.health = {
        lastCollectorRunAt: null,
        stale:              true,
        degradedSources:    [],
      };
    }

    // averages — 14-day reference scales for the overview gauges
    try {
      responseBody.averages = await _buildAveragesBlock();
    } catch (err) {
      console.error('[summary] averages failed:', err.message);
      responseBody.averages = {
        avg_solar_14d:       null,
        avg_load_14d:        null,
        avg_grid_import_14d: null,
        avg_grid_export_14d: null,
        sampleDays:          null,
      };
    }

    // _meta — names what's stub so consumers know not to render as authoritative
    responseBody._meta = {
      partialImplementation: [
        'peak',
        'dayPlan.batteryAtPeakStartPct',
        'dayPlan.batteryAtPeakEndPct',
        'forecast.condition',
        'forecast.isLowYield',
        'forecast[1].expectedKwh',
        'forecast[2].expectedKwh',
        'advisory',
      ],
    };

    res.json(responseBody);
  } catch (error) {
    console.error('Error getting summary:', error);
    res.status(500).json({
      error:         error.message,
      collector:     { connected: false },
      today:         {},
      realtime:      {},
      environmental: {},
    });
  }
});

// ── GET /api/system/collector-status ──────────────────────────────────────

router.get('/collector-status', async (req, res) => {
  try {
    const [recent] = await db.pool.query(
      'SELECT timestamp, source FROM energy_snapshots ORDER BY timestamp DESC LIMIT 1'
    );

    if (recent.length === 0) {
      return res.json({ connected: false, message: 'No data yet' });
    }

    const lastUpdate = new Date(recent[0].timestamp);
    const ageMs      = Date.now() - lastUpdate.getTime();

    res.json({
      connected:   ageMs < 300000,
      lastUpdate:  lastUpdate.toISOString(),
      ageSeconds:  Math.floor(ageMs / 1000),
      source:      recent[0].source,
    });
  } catch (error) {
    console.error('Error getting collector status:', error);
    res.json({ connected: false, error: error.message });
  }
});

// ── GET /api/system/realtime ───────────────────────────────────────────────

router.get('/realtime', async (req, res) => {
  console.log(`   • Front-End - [${new Date().toLocaleString()}] - Collect Power measurements...`);
  try {
    // Same per-source strategy as /summary — see comment there.
    const [rows] = await db.pool.query(`
      SELECT s.battery_soc, s.battery_power, s.solar_power, s.grid_power, s.load_power, s.timestamp, s.source
      FROM energy_snapshots s
      INNER JOIN (
        SELECT source, MAX(timestamp) AS latest
        FROM energy_snapshots
        WHERE timestamp >= datetime('now', '-2 hours')
        GROUP BY source
      ) latest ON s.source = latest.source AND s.timestamp = latest.latest
      ORDER BY s.timestamp DESC
    `);

    if (rows.length === 0) {
      return res.status(503).json({ error: 'No data available' });
    }

    const firstNonNull = (field) => {
      for (const row of rows) {
        if (row[field] !== null && row[field] !== undefined) return row[field];
      }
      return null;
    };

    const rawSolarP   = parseFloat(firstNonNull('solar_power'))   || 0;
    const rawBatteryP = parseFloat(firstNonNull('battery_power')) || 0;
    const rawGridP    = parseFloat(firstNonNull('grid_power'))    || 0;
    const rawHomeP    = firstNonNull('load_power');
    const homePower   = (rawHomeP !== null && parseFloat(rawHomeP) > 0)
      ? parseFloat(rawHomeP)
      : Math.max(0, rawSolarP + rawBatteryP + rawGridP);

    res.json({
      timestamp: rows[0].timestamp,
      battery: {
        soc:   parseFloat(firstNonNull('battery_soc')) || 0,
        power: rawBatteryP,
      },
      solar: { total: rawSolarP, pv1: 0, pv2: 0, pv3: 0 },
      grid:  { power: rawGridP },
      home:  { power: homePower },
    });
  } catch (error) {
    console.error('Error getting realtime data:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/system/devices ────────────────────────────────────────────────
//
// Wijzigingen:
//   CURDATE()                           →  date('now')
//   DATE_SUB(CURDATE(), INTERVAL 1 DAY) →  date('now', '-1 day')
//
// SQLite ondersteunt geen correlated subqueries in het FROM-deel op dezelfde manier,
// maar de subqueries IN de SELECT zijn wel ondersteund.

router.get('/devices', async (req, res) => {
  try {
    console.log(`   • Front-End - [${new Date().toLocaleString()}] - Fetching device measurements...`);

    const [devices] = await db.pool.query(`
      SELECT
        dm.*,ds.id as device_settings_id,
        ds.name, ds.ip_address, ds.product_type, ds.module,
        ds.enabled, ds.brightness, ds.switch_lock, ds.priority,
        (
          SELECT energy_total
          FROM device_measurements
          WHERE device_id = dm.device_id
            AND date(timestamp) = date('now')
          ORDER BY timestamp DESC
          LIMIT 1
        )
        -
        (
          SELECT energy_total
          FROM device_measurements
          WHERE device_id = dm.device_id
            AND date(timestamp) = date('now', '-1 day')
          ORDER BY timestamp DESC
          LIMIT 1
        )
        AS energy_today_calc

      FROM device_measurements dm
        INNER JOIN (
          SELECT device_id, MAX(timestamp) AS latest_timestamp
          FROM device_measurements
          GROUP BY device_id
        ) latest ON dm.device_id = latest.device_id
               AND dm.timestamp  = latest.latest_timestamp
        LEFT JOIN device_settings ds ON ds.serial = dm.device_id
      WHERE ds.enabled = 1
      ORDER BY dm.power DESC
    `);

    console.log(`   - Found ${devices.length} devices with measurements`);

    const devicesWithParsedMetrics = devices.map(device => {
      let extraMetrics = null;
      if (device.extra_metrics) {
        try {
          extraMetrics = typeof device.extra_metrics === 'string'
            ? JSON.parse(device.extra_metrics)
            : device.extra_metrics;
        } catch (error) {
          console.warn(`Failed to parse extra_metrics for device ${device.device_id}:`, error);
        }
      }

      const energyToday = device.energy_today_calc !== null && device.energy_today_calc !== undefined
        ? parseFloat(device.energy_today_calc)
        : parseFloat(device.energy_today) || 0;

      return {
        id:            device.id,
        device_settings_id: device.device_settings_id,
        timestamp:     device.timestamp,
        device_id:     device.device_id,
        device_type:   device.device_type,
        device_name:   device.device_name,
        source:        device.source,
        brightness:    device.brightness,
        switch_lock:   device.switch_lock,
        power:         parseFloat(device.power)        || 0,
        voltage:       parseFloat(device.voltage)      || 0,
        current:       parseFloat(device.current)      || 0,
        energy_today:  energyToday,
        energy_total:  parseFloat(device.energy_total) || 0,
        extra_metrics: extraMetrics,
        wifi_ssid:     extraMetrics?.wifi_ssid     || null,
        wifi_strength: extraMetrics?.wifi_strength || null,
        ipaddress:     device.ip_address,
        enabled:       device.enabled,
      };
    });

    res.json({
      devices:   devicesWithParsedMetrics,
      count:     devicesWithParsedMetrics.length,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('✗ Error fetching device measurements:', error);
    res.status(500).json({
      error:   'Failed to fetch device measurements',
      message: error.message,
      stack:   process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

// ── GET /api/system/schemas/active ────────────────────────────────────────

router.get('/schemas/active', async (req, res) => {
  try {
    const [modules] = await db.pool.query(
      'SELECT module FROM device_settings GROUP BY module'
    );

    const activeSchemas = {};
    for (const row of modules) {
      const moduleName = row.module;
      if (!moduleName) continue;
      const schema = await systemConfigService.getSchemaByModule(moduleName);
      if (schema) activeSchemas[moduleName] = schema;
    }

    res.json({ success: true, schemas: activeSchemas, count: Object.keys(activeSchemas).length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── GET /api/system/devices/:deviceId ─────────────────────────────────────

router.get('/devices/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    console.log(`   • FrontEnd - [${new Date().toLocaleString()}] - Fetching measurements for device: ${deviceId}`);

    const [devices] = await db.pool.query(
      `SELECT * FROM device_measurements WHERE device_id = ? ORDER BY timestamp DESC LIMIT 1`,
      [deviceId]
    );

    if (devices.length === 0) {
      return res.status(404).json({
        error:   'Device not found',
        message: `No measurements found for device ${deviceId}`,
      });
    }

    const device = devices[0];
    let extraMetrics = null;
    if (device.extra_metrics) {
      try {
        extraMetrics = typeof device.extra_metrics === 'string'
          ? JSON.parse(device.extra_metrics)
          : device.extra_metrics;
      } catch (error) {
        console.warn(`Failed to parse extra_metrics for device ${deviceId}:`, error);
      }
    }

    res.json({
      id:            device.id,
      timestamp:     device.timestamp,
      device_id:     device.device_id,
      device_type:   device.device_type,
      device_name:   device.device_name,
      source:        device.source,
      power:         parseFloat(device.power)        || 0,
      voltage:       parseFloat(device.voltage)      || 0,
      current:       parseFloat(device.current)      || 0,
      energy_today:  parseFloat(device.energy_today) || 0,
      energy_total:  parseFloat(device.energy_total) || 0,
      extra_metrics: extraMetrics,
      wifi_ssid:     extraMetrics?.wifi_ssid     || null,
      wifi_strength: extraMetrics?.wifi_strength || null,
    });

  } catch (error) {
    console.error('✗ Error fetching device measurement:', error);
    res.status(500).json({
      error:   'Failed to fetch device measurement',
      message: error.message,
      stack:   process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

// ── GET /api/system/devices-list ──────────────────────────────────────────
//
// Wijziging:
//   ddu.date = CURDATE()  →  ddu.date = date('now')

router.get('/devices-list', async (req, res) => {
  try {
    console.log(`   • FrontEnd - [${new Date().toLocaleString()}] - Fetching aggregated device usage...`);

    const [devices] = await db.pool.query(`
      SELECT
        ds.*,
        COALESCE(ddu.usage_kwh, 0) AS usage_today,
        ddu.last_update
      FROM device_settings ds
      LEFT JOIN device_daily_usage ddu
        ON ds.serial = ddu.device_id
        AND ddu.date = date('now')
      ORDER BY usage_today DESC
    `);

    const normalizedDevices = devices.map(device => ({
      id:            device.id,
      name:          device.name,
      brightness:    device.brightness,
      switch_lock:   device.switch_lock,
      power:         parseFloat(device.power) || 0,
      serial:        device.serial,
      module:        device.module,
      product_type:  device.product_type,
      ip_address:    device.ip_address,
      usage_today:   parseFloat(device.usage_today) || 0,
      last_update:   device.last_update,
      priority:      device.priority,
      enabled:       device.enabled,
      poll_interval: device.poll_interval,
    }));

    res.json({
      success:   true,
      count:     normalizedDevices.length,
      devices:   normalizedDevices,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('✗ Error fetching aggregated device usage:', error.message);
    res.status(500).json({
      success: false,
      error:   'Failed to fetch device usage data',
      message: error.message,
    });
  }
});

// ── GET /api/system/events ─────────────────────────────────────────────────

// Replace the existing GET /api/system/events handler with:
router.get('/events', (_req, res) => {
  res.redirect(307, '/api/events');
});
// ── GET /api/system/devices/chart ─────────────────────────────────────────
//
// Returns time-bucketed average power per smart device for a given date.
// Excludes P1 meter (HWE-P1). Only returns devices with actual usage (MAX > 0).
// Device name always sourced from device_settings to avoid stale names in
// device_measurements (some rows have generic "Energy Socket" as device_name).

router.get('/devices-chart', async (req, res) => {
  try {
    const { date, granularity = '5' } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'date parameter required (YYYY-MM-DD)' });
    }

    const interval = Math.max(1, Math.min(60, parseInt(granularity, 10) || 5));
    const start    = `${date} 00:00:00`;
    const end      = `${date} 23:59:59`;

    // interval appears twice: once for integer division, once for multiplication
    const [rows] = await db.pool.query(`
      SELECT
        dm.device_id,
        ds.name                                             AS device_name,
        STRFTIME('%Y-%m-%d %H:', dm.timestamp) ||
          PRINTF('%02d',
            (CAST(STRFTIME('%M', dm.timestamp) AS INTEGER) / ?) * ?
          )                                                 AS bucket,
        ROUND(AVG(dm.power), 1)                             AS avg_power,
        ROUND(MAX(dm.power), 1)                             AS peak_power
      FROM device_measurements dm
      JOIN device_settings ds ON ds.serial = dm.device_id
      WHERE dm.device_type  = 'HWE-SKT'
        AND dm.timestamp   >= ?
        AND dm.timestamp   <= ?
        AND dm.power       IS NOT NULL
      GROUP BY dm.device_id, bucket
      HAVING MAX(dm.power) >= 0
      ORDER BY ds.name, bucket
    `, [interval, interval, start, end]);

    // Pivot flat rows → one entry per device, preserving insertion order (sorted by name)
    const deviceMap = new Map();
    for (const row of rows) {
      if (!deviceMap.has(row.device_id)) {
        deviceMap.set(row.device_id, {
          device_id:   row.device_id,
          device_name: row.device_name,
          data:        [],
        });
      }
      deviceMap.get(row.device_id).data.push({
        bucket:     row.bucket,
        avg_power:  row.avg_power,
        peak_power: row.peak_power,
      });
    }

    res.json({
      date,
      granularity: interval,
      devices:     [...deviceMap.values()],
      count:       deviceMap.size,
    });

  } catch (error) {
    console.error('✗ Error fetching device chart data:', error.message);
    res.status(500).json({
      error:   'Failed to fetch device chart data',
      message: error.message,
      stack:   process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});
router.get('/devices-daily', async (req, res) => {
  try {
    const { date } = req.query;
 
    if (!date) {
      return res.status(400).json({ error: 'date parameter required (YYYY-MM-DD)' });
    }
 
    const [rows] = await db.pool.query(`
      SELECT
        ds.serial AS device_id,
        ds.name   AS device_name,
        ROUND(
          COALESCE((
            SELECT energy_total FROM device_measurements
            WHERE device_id       = ds.serial
              AND date(timestamp) = ?
            ORDER BY timestamp DESC LIMIT 1
          ), 0)
          -
          COALESCE((
            SELECT energy_total FROM device_measurements
            WHERE device_id       = ds.serial
              AND date(timestamp) = date(?, '-1 day')
            ORDER BY timestamp DESC LIMIT 1
          ), 0)
        , 3) AS daily_kwh
      FROM device_settings ds
      WHERE ds.product_type = 'HWE-SKT'
        AND ds.enabled      = 1
      ORDER BY daily_kwh DESC
    `, [date, date]);
 
    res.json({
      date,
      devices: rows,
      count:   rows.length,
    });
 
  } catch (error) {
    console.error('✗ Error fetching daily device usage:', error.message);
    res.status(500).json({
      error:   'Failed to fetch daily device usage',
      message: error.message,
      stack:   process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});
// ── GET /api/system/hourly ────────────────────────────────────────────────
//
// Returns hourly aggregated self-consumption data for a given date.
// Used by DashboardGraph.vue stacked bar chart.
//
// Query params:
//   date  YYYY-MM-DD  (required)
//
// Response:
//   { date, rows: [{ hour, solar_to_load_kwh, battery_to_load_kwh,
//                    grid_to_load_kwh, solar_to_grid_kwh }, ...] }

router.get('/hourly', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ error: 'date parameter required (YYYY-MM-DD)' });
    }

    const [rows] = await db.pool.query(`
      SELECT
        CAST(strftime('%H', timestamp) AS INTEGER)  AS hour,
        ROUND(COALESCE(solar_to_load_kwh,   0), 3) AS solar_to_load_kwh,
        ROUND(COALESCE(battery_to_load_kwh, 0), 3) AS battery_to_load_kwh,
        ROUND(COALESCE(grid_to_load_kwh,    0), 3) AS grid_to_load_kwh,
        ROUND(COALESCE(solar_to_grid_kwh,   0), 3) AS solar_to_grid_kwh
      FROM energy_hours
      WHERE date(timestamp) = ?
      ORDER BY hour ASC
    `, [date]);

    res.json({ date, rows });
  } catch (error) {
    console.error('✗ Error fetching hourly data:', error.message);
    res.status(500).json({
      error:   'Failed to fetch hourly data',
      message: error.message,
    });
  }
});

export default router;