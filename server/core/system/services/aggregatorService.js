// server/core/system/services/aggregatorService.js
//
// v2.0 — load derivation, fail-safe source gates, local-time windows.
//
// CHANGES vs v1.x
// ───────────────
// 1. LOAD DERIVATION (root cause of home = 0 everywhere)
//    `load_power` is NULL in every energy_snapshots row unless collectorManager's
//    derive_home_load timer is armed. The old code gated load on
//    sourceMap.home = find('home:read'), but nothing registers 'home:read' —
//    so `source = NULL` never matched and load was NULL even when rows existed.
//
//    Now: prefer the authoritative wolffie-core row; fall back to SQL derivation
//    from the three hardware domains. The fallback works identically on historical
//    data, which is what makes the backfill possible.
//
//    Sign convention in energy_snapshots.battery_power is RAW AlphaESS:
//        positive = DISCHARGING, negative = CHARGING
//    (opposite to the canonical battery:read capability). Hence:
//        load = solar + battery_raw + grid          (grid positive = import)
//
// 2. BATTERY EFFICIENCY
//    Registers 0x0120/0x0122 are in the Household Battery block, alongside cell
//    voltages and temperatures — they measure at the DC terminals. The AC-side
//    equivalents (0x52E3/0x52E5) exist only in the Industry PCS block, not on
//    this unit. So the naive balance overstates load by the conversion losses.
//
//        discharging (raw > 0): AC delivered  = raw * eff
//        charging    (raw < 0): AC consumed   = raw / eff
//
//    eff is one-way efficiency, default 0.95 (≈90% round-trip). Configurable via
//    system_settings category 'data_collection', key 'battery_efficiency'.
//
// 3. FAIL-SAFE SOURCE GATES
//    _buildSourceMap() re-reads the capability registry every 60s. When a module
//    drops its capability (single-client Modbus contention, settings save, etc.)
//    the CASE stopped matching and ON CONFLICT DO UPDATE wrote NULL straight over
//    two hours of good minute rows — which then propagated into hours.
//
//    Now every DO UPDATE uses COALESCE(excluded.col, col): a NULL never overwrites
//    an existing value. Trade-off: a value can no longer be cleared by
//    re-aggregation. Deliberate — stale beats destroyed.
//
// 4. LOCAL TIME THROUGHOUT
//    SQLite datetime('now') returns UTC; every timestamp in this database is a
//    local CET/CEST string with no offset marker. Every window was therefore
//    skewed by the UTC offset (2h in summer), and the JS toISOString() date
//    calculations picked the wrong day between 00:00 and 02:00 local.
//    All bounds are now computed in JS local time and passed as parameters —
//    no datetime('now') or toISOString() remains in this file.
//
// 5. REUSABLE WINDOWS
//    Every aggregate method takes optional {from, to}. The live loop passes
//    nothing (rolling window); scripts/rebuild-history.js passes explicit bounds.
//    One implementation, no drift between live and backfill.
//
// KNOWN, DELIBERATELY UNTOUCHED
//   - battery_temperature_avg still uses AVG(). Per the collector, battery_temp
//     holds MAX cell temperature and averaging it destroys the degradation
//     signal. Out of scope for this change; column name would need to change too.

import db from '../../database.js';
import capabilityRegistry from '../../capabilityRegistry.js';
import settingsService from './settingsService.js';
import { padName } from '../../utils/logger.js';
const PREFIX = padName('Aggregator');

const DEFAULT_BATTERY_EFFICIENCY = 0.95;

class AggregatorService {
  constructor() {
    this.isRunning              = false;
    this.aggregationInterval    = null;
    this.lastComparisonDate     = null;
    this.lastNightlyProfileDate = null;
    this._lastEventPruneDate    = null;   // was unreachable dead code after `return`
  }

  // ── Local-time helpers ──────────────────────────────────────────────────────
  // Node's local timezone matches the collectors' timestamps. Never use
  // toISOString() here — it converts to UTC and shifts the date.

  _p(n) { return String(n).padStart(2, '0'); }

  _localDate(d = new Date()) {
    return `${d.getFullYear()}-${this._p(d.getMonth() + 1)}-${this._p(d.getDate())}`;
  }

  _localSecond(d = new Date()) {
    return `${this._localDate(d)} ${this._p(d.getHours())}:${this._p(d.getMinutes())}:${this._p(d.getSeconds())}`;
  }

  _localMinute(d = new Date()) {
    return `${this._localDate(d)} ${this._p(d.getHours())}:${this._p(d.getMinutes())}:00`;
  }

  _localHour(d = new Date()) {
    return `${this._localDate(d)} ${this._p(d.getHours())}:00:00`;
  }

  _daysAgo(n, d = new Date()) {
    const x = new Date(d);
    x.setDate(x.getDate() - n);
    return x;
  }

  _hoursAgo(n, d = new Date()) {
    return new Date(d.getTime() - n * 3600 * 1000);
  }

  // ── Source resolution ───────────────────────────────────────────────────────
  // 'home' is deliberately absent. Load is never owned by a hardware module —
  // it is derived, either by collectorManager (source 'wolffie-core') or in SQL.

  _buildSourceMap() {
    const entries = capabilityRegistry.list();
    const find = (type) => entries.find(e => e.type === type)?.moduleId ?? null;
    return {
      solar:   find('solar:read'),
      battery: find('battery:read'),
      grid:    find('grid:read'),
    };
  }

  async _batteryEfficiency() {
    try {
      const dc  = await settingsService.getCategory('data_collection');
      const raw = parseFloat(dc?.battery_efficiency);
      if (!isNaN(raw) && raw > 0 && raw <= 1) return raw;
    } catch {
      // settings unavailable — fall through to default
    }
    return DEFAULT_BATTERY_EFFICIENCY;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  start() {
    if (this.isRunning) {
      console.log(`   - {${PREFIX}} already running`);
      return;
    }

    console.log(`   - {${PREFIX}} starting...`);
    this.isRunning = true;

    this.aggregate();

    this.aggregationInterval = setInterval(async () => {
      await this.aggregate();
    }, 60000);

    console.log(`   - {${PREFIX}} started (1 minute interval)`);
  }

  stop() {
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
      this.aggregationInterval = null;
    }
    this.isRunning = false;
    console.log(`   - {${PREFIX}} stopped`);
  }

  async aggregate() {
    try {
      const sourceMap = this._buildSourceMap();
      const eff       = await this._batteryEfficiency();

      await this.aggregateMinutes(sourceMap, eff);
      await this.aggregateHours();
      await this.aggregateDaily(sourceMap, eff);
      await this.aggregateMonthly();
      await this.aggregateDevices();

      const today = this._localDate();
      const hour  = new Date().getHours();

      if (this.lastComparisonDate !== today && hour >= 1) {
        await this.compareForecastWithActual();
        this.lastComparisonDate = today;
      }

      if (this.lastNightlyProfileDate !== today && hour >= 2) {
        await this.calculateNightlyProfile();
        this.lastNightlyProfileDate = today;
      }

      if (this._lastEventPruneDate !== today && hour >= 3) {
        try {
          const { default: eventLogService } = await import('./eventLogService.js');
          await eventLogService.prune();
        } catch (err) {
          console.error(`   • ${PREFIX} — event log prune failed: ${err.message}`);
        }
        this._lastEventPruneDate = today;
      }
    } catch (error) {
      console.error(`   - {${PREFIX}} error:`, error.message);
    }
  }

  // ── Minute aggregation ──────────────────────────────────────────────────────
  //
  // Rolling 2-hour window by default (not a cursor: different source modules may
  // write at slightly different clock offsets, and a MAX(timestamp) cursor would
  // drift ahead and permanently skip rows from slower sources).
  //
  // The inner subquery groups snapshots into minutes with each domain gated on
  // its authoritative module. The outer SELECT derives load from those three
  // aggregates — done outside the GROUP BY so each average is computed once.

  async aggregateMinutes(sourceMap, eff, { from = null, to = null } = {}) {
    try {
      const now      = new Date();
      const winFrom  = from ?? this._localSecond(this._hoursAgo(2, now));
      const winTo    = to   ?? this._localMinute(now);

      const [result] = await db.pool.query(`
        INSERT INTO energy_minutes (
          timestamp,
          battery_soc_avg, battery_soc_min, battery_soc_max,
          battery_power_avg, battery_temperature_avg,
          grid_power_avg, grid_power_min, grid_power_max,
          pv_power_avg, pv_power_max,
          load_power_avg, sample_count
        )
        SELECT
          minute_timestamp,
          soc_avg, soc_min, soc_max,
          bat_avg, temp_avg,
          grid_avg, grid_min, grid_max,
          pv_avg, pv_max,

          -- Load: authoritative wolffie-core row first, SQL derivation as fallback.
          -- NULL (not 0) when no domain reported at all — a false zero in the
          -- load series is indistinguishable from a genuinely idle house.
          COALESCE(
            core_load,
            CASE
              -- All three domains required. A partial balance is not a smaller
              -- error, it is a wrong number: omitting a 1200 W battery term
              -- reports 1700 W for a house actually drawing 437 W. NULL renders
              -- as a gap; a wrong value renders as fact.
              WHEN pv_avg IS NULL OR bat_avg IS NULL OR grid_avg IS NULL THEN NULL
              ELSE MAX(
                pv_avg
                + CASE WHEN bat_avg > 0 THEN bat_avg * ? ELSE bat_avg / ? END
                + grid_avg,
                0)
            END
          ),
          sample_count
        FROM (
          SELECT
            strftime('%Y-%m-%d %H:%M:00', timestamp)              AS minute_timestamp,
            AVG(CASE WHEN source = ? THEN battery_soc   END)      AS soc_avg,
            MIN(CASE WHEN source = ? THEN battery_soc   END)      AS soc_min,
            MAX(CASE WHEN source = ? THEN battery_soc   END)      AS soc_max,
            AVG(CASE WHEN source = ? THEN battery_power END)      AS bat_avg,
            AVG(CASE WHEN source = ? THEN battery_temp  END)      AS temp_avg,
            AVG(CASE WHEN source = ? THEN grid_power    END)      AS grid_avg,
            MIN(CASE WHEN source = ? THEN grid_power    END)      AS grid_min,
            MAX(CASE WHEN source = ? THEN grid_power    END)      AS grid_max,
            AVG(CASE WHEN source = ? THEN solar_power   END)      AS pv_avg,
            MAX(CASE WHEN source = ? THEN solar_power   END)      AS pv_max,
            AVG(CASE WHEN source = 'wolffie-core' THEN load_power END) AS core_load,
            COUNT(*)                                              AS sample_count
          FROM energy_snapshots
          WHERE timestamp >= ?
            AND timestamp <  ?
          GROUP BY minute_timestamp
        )
        WHERE true   -- required: disambiguates upsert ON from a join ON (SQLite upsert parsing)
        ON CONFLICT(timestamp) DO UPDATE SET
          battery_soc_avg         = COALESCE(excluded.battery_soc_avg,         battery_soc_avg),
          battery_soc_min         = COALESCE(excluded.battery_soc_min,         battery_soc_min),
          battery_soc_max         = COALESCE(excluded.battery_soc_max,         battery_soc_max),
          battery_power_avg       = COALESCE(excluded.battery_power_avg,       battery_power_avg),
          battery_temperature_avg = COALESCE(excluded.battery_temperature_avg, battery_temperature_avg),
          grid_power_avg          = COALESCE(excluded.grid_power_avg,          grid_power_avg),
          grid_power_min          = COALESCE(excluded.grid_power_min,          grid_power_min),
          grid_power_max          = COALESCE(excluded.grid_power_max,          grid_power_max),
          pv_power_avg            = COALESCE(excluded.pv_power_avg,            pv_power_avg),
          pv_power_max            = COALESCE(excluded.pv_power_max,            pv_power_max),
          load_power_avg          = COALESCE(excluded.load_power_avg,          load_power_avg),
          sample_count            = excluded.sample_count
      `, [
        eff, eff,                                                  // battery AC conversion
        sourceMap.battery, sourceMap.battery, sourceMap.battery,   // soc avg/min/max
        sourceMap.battery, sourceMap.battery,                      // power avg, temp avg
        sourceMap.grid,    sourceMap.grid,    sourceMap.grid,      // grid avg/min/max
        sourceMap.solar,   sourceMap.solar,                        // pv avg/max
        winFrom, winTo,
      ]);

      if (result.affectedRows > 0)
        console.log(`\x1b[37m   • ${PREFIX} - snapshots → minutes`);
      return result.affectedRows ?? 0;
    } catch (error) {
      console.error(`\x1b[91m   • ${PREFIX} - Minute aggregation failed:`, error.message, '\x1b[37m');
      return 0;
    }
  }

  // ── Hour aggregation ────────────────────────────────────────────────────────
  //
  // Power flow model (raw AlphaESS sign: battery_power < 0 = charging):
  //   solar_to_load    = MIN(pv, load)
  //   battery_to_load  = MIN(MAX(load-pv,0), MAX(battery_power,0))
  //   grid_to_load     = MAX(load - pv - battery_discharge, 0)
  //   solar_to_battery = MIN(MAX(pv-load,0), MAX(-battery_power,0))  → stored negative
  //
  // These columns were all computing to 0 while load_power_avg was NULL, because
  // COALESCE(load, 0) collapsed every term. They only become meaningful once the
  // minute-level load derivation above is populated.

  async aggregateHours({ from = null, to = null } = {}) {
    try {
      const now     = new Date();
      const winFrom = from ?? this._localSecond(this._hoursAgo(25, now));
      const winTo   = to   ?? this._localHour(now);

      const [result] = await db.pool.query(`
        INSERT INTO energy_hours (
          timestamp,
          battery_soc_avg, battery_power_avg,
          pv_power_avg, grid_power_avg, load_power_avg,
          grid_import_kwh, grid_export_kwh,
          solar_to_load_kwh, battery_to_load_kwh, grid_to_load_kwh, solar_to_grid_kwh
        )
        SELECT
          hour_timestamp,
          soc_avg, bat_avg, pv_avg, grid_avg, load_avg,

          ROUND(MAX(COALESCE(grid_avg, 0), 0) / 1000.0, 3),
          ROUND(MIN(COALESCE(grid_avg, 0), 0) / 1000.0, 3),

          ROUND(MIN(COALESCE(pv_avg, 0), COALESCE(load_avg, 0)) / 1000.0, 3),

          ROUND(MIN(
            MAX(COALESCE(load_avg, 0) - COALESCE(pv_avg, 0), 0),
            MAX(COALESCE(bat_avg, 0), 0)
          ) / 1000.0, 3),

          ROUND(MAX(
            COALESCE(load_avg, 0)
            - COALESCE(pv_avg, 0)
            - MAX(COALESCE(bat_avg, 0), 0),
            0
          ) / 1000.0, 3),

          ROUND(-MIN(
            MAX(COALESCE(pv_avg, 0) - COALESCE(load_avg, 0), 0),
            MAX(-COALESCE(bat_avg, 0), 0)
          ) / 1000.0, 3)

        FROM (
          SELECT
            strftime('%Y-%m-%d %H:00:00', timestamp) AS hour_timestamp,
            AVG(battery_soc_avg)                     AS soc_avg,
            AVG(battery_power_avg)                   AS bat_avg,
            AVG(pv_power_avg)                        AS pv_avg,
            AVG(grid_power_avg)                      AS grid_avg,
            AVG(load_power_avg)                      AS load_avg
          FROM energy_minutes
          WHERE timestamp >= ?
            AND timestamp <  ?
          GROUP BY hour_timestamp
        )
        WHERE true   -- required: disambiguates upsert ON from a join ON (SQLite upsert parsing)
        ON CONFLICT(timestamp) DO UPDATE SET
          battery_soc_avg      = COALESCE(excluded.battery_soc_avg,   battery_soc_avg),
          battery_power_avg    = COALESCE(excluded.battery_power_avg, battery_power_avg),
          pv_power_avg         = COALESCE(excluded.pv_power_avg,      pv_power_avg),
          grid_power_avg       = COALESCE(excluded.grid_power_avg,    grid_power_avg),
          load_power_avg       = COALESCE(excluded.load_power_avg,    load_power_avg),
          grid_import_kwh      = excluded.grid_import_kwh,
          grid_export_kwh      = excluded.grid_export_kwh,
          solar_to_load_kwh    = excluded.solar_to_load_kwh,
          battery_to_load_kwh  = excluded.battery_to_load_kwh,
          grid_to_load_kwh     = excluded.grid_to_load_kwh,
          solar_to_grid_kwh    = excluded.solar_to_grid_kwh
      `, [winFrom, winTo]);

      if (result.affectedRows > 0)
        console.log(`\x1b[37m   • ${PREFIX} - minutes → hours`);
      return result.affectedRows ?? 0;
    } catch (error) {
      console.error(`\x1b[91m   • ${PREFIX} - Hour aggregation failed:`, error.message, '\x1b[37m');
      return 0;
    }
  }

  // ── Daily aggregation ───────────────────────────────────────────────────────
  //
  // load_consumption_kwh: wolffie-core's load_energy_today when present, else
  // derived from the meter balance at the AC boundary:
  //
  //   load = pv + import - export + (discharge * eff) - (charge / eff)
  //
  // Without the eff terms this overstates load by the round-trip conversion
  // losses — measurably so: ~6.7 kWh over the 8 days to 2026-08-30.

  async aggregateDaily(sourceMap, eff, { from = null, to = null } = {}) {
    try {
      const now     = new Date();
      const winFrom = from ?? this._localDate(this._daysAgo(1, now));
      const winTo   = to   ?? this._localDate(now);

      const [result] = await db.pool.query(`
        INSERT INTO energy_daily (
          date,
          pv_generation_kwh, load_consumption_kwh,
          grid_import_kwh,   grid_export_kwh,
          battery_charge_kwh, battery_discharge_kwh
        )
        SELECT
          day,
          pv, 
          COALESCE(
            core_load,
            CASE
              -- Same rule as the minute derivation: every term required, or NULL.
              WHEN pv IS NULL OR imp IS NULL OR exp IS NULL
                OR chg IS NULL OR dis IS NULL THEN NULL
              ELSE MAX(pv + imp - exp + dis * ? - chg / ?, 0)
            END
          ),
          imp, exp, chg, dis
        FROM (
          SELECT
            date(timestamp) AS day,
            MAX(CASE WHEN source = ? THEN solar_energy_today       END) AS pv,
            MAX(CASE WHEN source = ? THEN grid_energy_import_today END) AS imp,
            MAX(CASE WHEN source = ? THEN grid_energy_export_today END) AS exp,
            MAX(CASE WHEN source = ? THEN battery_charge_today     END) AS chg,
            MAX(CASE WHEN source = ? THEN battery_discharge_today  END) AS dis,
            MAX(CASE WHEN source = 'wolffie-core' THEN load_energy_today END) AS core_load
          FROM energy_snapshots
          WHERE date(timestamp) >= ?
            AND date(timestamp) <= ?
          GROUP BY day
        )
        WHERE true   -- required: disambiguates upsert ON from a join ON (SQLite upsert parsing)
        ON CONFLICT(date) DO UPDATE SET
          pv_generation_kwh     = COALESCE(excluded.pv_generation_kwh,     pv_generation_kwh),
          load_consumption_kwh  = COALESCE(excluded.load_consumption_kwh,  load_consumption_kwh),
          grid_import_kwh       = COALESCE(excluded.grid_import_kwh,       grid_import_kwh),
          grid_export_kwh       = COALESCE(excluded.grid_export_kwh,       grid_export_kwh),
          battery_charge_kwh    = COALESCE(excluded.battery_charge_kwh,    battery_charge_kwh),
          battery_discharge_kwh = COALESCE(excluded.battery_discharge_kwh, battery_discharge_kwh)
      `, [
        eff, eff,
        sourceMap.solar,
        sourceMap.grid,
        sourceMap.grid,
        sourceMap.battery,
        sourceMap.battery,
        winFrom, winTo,
      ]);

      if (result.affectedRows > 0)
        console.log(`\x1b[37m   • ${PREFIX} - snapshots → daily`);
      return result.affectedRows ?? 0;
    } catch (error) {
      console.error(`\x1b[91m   • ${PREFIX} - Daily aggregation failed:`, error.message, '\x1b[37m');
      return 0;
    }
  }

  // ── Monthly aggregation ─────────────────────────────────────────────────────
  //
  // `rebuildAll` forces a full recompute regardless of the last aggregated month —
  // needed after a backfill, since load_consumption_kwh changes for every past day.

  async aggregateMonthly({ rebuildAll = false } = {}) {
    try {
      let lastMonth = '1970-01';

      if (!rebuildAll) {
        const [lastAgg] = await db.pool.query(
          `SELECT MAX(year || '-' || printf('%02d', month)) AS last_month
           FROM energy_monthly`
        );
        lastMonth = lastAgg[0]?.last_month || '1970-01';
      }

      const [result] = await db.pool.query(`
        INSERT INTO energy_monthly (
          year, month,
          pv_generation_kwh, load_consumption_kwh,
          grid_import_kwh,   grid_export_kwh,
          battery_charge_kwh, battery_discharge_kwh
        )
        SELECT
          CAST(strftime('%Y', date) AS INTEGER) AS year,
          CAST(strftime('%m', date) AS INTEGER) AS month,
          SUM(pv_generation_kwh),
          SUM(load_consumption_kwh),
          SUM(grid_import_kwh),
          SUM(grid_export_kwh),
          SUM(battery_charge_kwh),
          SUM(battery_discharge_kwh)
        FROM energy_daily
        WHERE strftime('%Y-%m', date) > ?
        GROUP BY year, month
        ON CONFLICT(year, month) DO UPDATE SET
          pv_generation_kwh     = excluded.pv_generation_kwh,
          load_consumption_kwh  = excluded.load_consumption_kwh,
          grid_import_kwh       = excluded.grid_import_kwh,
          grid_export_kwh       = excluded.grid_export_kwh,
          battery_charge_kwh    = excluded.battery_charge_kwh,
          battery_discharge_kwh = excluded.battery_discharge_kwh
      `, [lastMonth]);

      if (result.affectedRows > 0)
        console.log(`\x1b[37m   • ${PREFIX} - daily → monthly`);
      return result.affectedRows ?? 0;
    } catch (error) {
      console.error(`\x1b[91m   • ${PREFIX} - Monthly aggregation failed:`, error.message, '\x1b[37m');
      return 0;
    }
  }

  // ── Device aggregation + 7-day purge ────────────────────────────────────────
  //
  // dateStr was built with toISOString() — UTC. Between 00:00 and 02:00 local
  // that names the day before yesterday, so yesterday never got aggregated on
  // those cycles. Now local.

  async aggregateDevices({ date = null } = {}) {
    try {
      const dateStr = date ?? this._localDate(this._daysAgo(1));

      const [insertResult] = await db.pool.query(`
        INSERT INTO device_daily_usage (
          device_id, date, usage_kwh,
          avg_power, max_power, avg_voltage,
          sample_count, source, last_update
        )
        SELECT
          device_id,
          date(timestamp)                        AS date,
          CASE
            WHEN MAX(energy_today) IS NOT NULL
              THEN MAX(energy_today)
            ELSE MAX(energy_total) - MIN(energy_total)
          END                                    AS usage_kwh,
          AVG(power)                             AS avg_power,
          MAX(power)                             AS max_power,
          AVG(voltage)                           AS avg_voltage,
          COUNT(*)                               AS sample_count,
          source,
          ?                                      AS last_update
        FROM device_measurements
        WHERE date(timestamp) = ?
        GROUP BY device_id, date(timestamp), source
        ON CONFLICT(device_id, date) DO UPDATE SET
          usage_kwh    = excluded.usage_kwh,
          avg_power    = excluded.avg_power,
          max_power    = excluded.max_power,
          avg_voltage  = excluded.avg_voltage,
          sample_count = excluded.sample_count,
          last_update  = excluded.last_update
      `, [this._localSecond(), dateStr]);

      // Purge raw measurements older than 7 days (local boundary)
      const [purgeResult] = await db.pool.query(
        `DELETE FROM device_measurements WHERE timestamp < ?`,
        [this._localSecond(this._daysAgo(7))]
      );

      if (insertResult.affectedRows > 0 || purgeResult.affectedRows > 0)
        console.log(
          `\x1b[37m   • ${PREFIX} - devices: aggregated ${dateStr}` +
          `, purged ${purgeResult.affectedRows} rows >7d`
        );
    } catch (error) {
      console.error(`\x1b[91m   • ${PREFIX} - Device aggregation failed:`, error.message, '\x1b[37m');
    }
  }

  // ── Forecast accuracy ───────────────────────────────────────────────────────

  async compareForecastWithActual() {
    const modulePrefix = padName('Solar Forecast');
    const dateStr = this._localDate(this._daysAgo(1));   // was toISOString() — UTC

    try {
      const [daily] = await db.pool.query(
        'SELECT pv_generation_kwh FROM energy_daily WHERE date = ?',
        [dateStr]
      );

      if (!daily[0]) {
        console.log(`\x1b[37m   • ${modulePrefix} - No energy_daily row for ${dateStr}, skipping`);
        return;
      }

      const actualKwh = parseFloat(daily[0].pv_generation_kwh) || 0;

      const [forecast] = await db.pool.query(
        'SELECT expected_kwh FROM solar_forecasts WHERE date = ?',
        [dateStr]
      );

      if (!forecast[0]) {
        console.log(`\x1b[37m   • ${modulePrefix} - No forecast row for ${dateStr}, skipping`);
        return;
      }

      const expectedKwh = parseFloat(forecast[0].expected_kwh) || 0;
      const accuracyPct = expectedKwh > 0
        ? Math.round((actualKwh / expectedKwh) * 100 * 10) / 10
        : 0;

      await db.pool.query(
        `UPDATE solar_forecasts
            SET actual_kwh          = ?,
                accuracy_percentage = ?
          WHERE date = ?`,
        [actualKwh, accuracyPct, dateStr]
      );

      console.log(
        `\x1b[37m   • ${modulePrefix} - Accuracy ${dateStr}: ${actualKwh} kWh actual / ${expectedKwh} kWh forecast = ${accuracyPct}%`
      );

    } catch (error) {
      console.error(`\x1b[91m   • ${modulePrefix} - comparison failed:`, error.message, '\x1b[37m');
    }
  }

  // ── Nightly profile ─────────────────────────────────────────────────────────
  //
  // This is the strategy-facing consumer of load_power_avg. While load was NULL
  // the `load_power_avg > 0` filter matched zero rows, so hourlyLoadProfile was
  // 24 zeros and morningKwhNeeded was 0 — SmartEco planned every night believing
  // the house needed no morning energy. Fixing the load chain fixes this.

  async calculateNightlyProfile() {
    const modulePrefix = padName('Nightly Profile');
    console.log(`\x1b[37m   • ${modulePrefix} - Calculating morning energy profile...`);

    try {
      const today       = this._localDate();
      const fourteenAgo = this._localDate(this._daysAgo(14));

      // 1. Average hourly load profile over the last 14 days
      const [hourlyRows] = await db.pool.query(`
        SELECT
          CAST(strftime('%H', timestamp) AS INTEGER) AS hour_of_day,
          AVG(load_power_avg)                        AS avg_load_w,
          COUNT(*)                                   AS sample_count
        FROM energy_hours
        WHERE timestamp >= ?
          AND timestamp <  ?
          AND load_power_avg IS NOT NULL
          AND load_power_avg > 0
        GROUP BY hour_of_day
        ORDER BY hour_of_day
      `, [fourteenAgo, today]);

      const hourlyLoadProfile = Array(24).fill(0);
      for (const row of hourlyRows) {
        hourlyLoadProfile[row.hour_of_day] = Math.round(row.avg_load_w);
      }

      if (hourlyRows.length === 0) {
        console.warn(
          `\x1b[93m   • ${modulePrefix} - No hourly load data in the last 14 days; ` +
          `profile will be all zeros and SmartEco will under-plan morning energy.\x1b[37m`
        );
      }

      // 2. Average daily consumption (14 days)
      const [dailyRows] = await db.pool.query(`
        SELECT AVG(load_consumption_kwh) AS avg_load_kwh
        FROM energy_daily
        WHERE date >= ?
          AND date <  ?
          AND load_consumption_kwh > 0
      `, [fourteenAgo, today]);
      const dailyAvgLoadKwh = parseFloat(dailyRows[0]?.avg_load_kwh) || 5.0;

      // 3. Tomorrow's solar forecast
      const tomorrowStr = this._localDate(this._daysAgo(-1));   // was toISOString() — UTC

      const [forecastRows] = await db.pool.query(`
        SELECT CAST(strftime('%H', slot_datetime) AS INTEGER) AS hour_of_day,
               hourly_wh
        FROM solar_forecast_hourly
        WHERE date = ?
        ORDER BY hour_of_day
      `, [tomorrowStr]);

      const SOLAR_START_THRESHOLD_WH = 200;
      let solarStartHour = 9;
      let solarTotalKwh  = 0;

      for (const row of forecastRows) {
        solarTotalKwh += (row.hourly_wh / 1000);
        if (row.hourly_wh >= SOLAR_START_THRESHOLD_WH && row.hour_of_day < solarStartHour) {
          solarStartHour = row.hour_of_day;
        }
      }

      if (forecastRows.length === 0) {
        const [todayForecast] = await db.pool.query(
          'SELECT expected_kwh FROM solar_forecasts WHERE date = ?',
          [today]
        );
        solarTotalKwh = parseFloat(todayForecast[0]?.expected_kwh) || 0;
      }

      // 4. Morning kWh (midnight → solar_start_hour)
      let morningKwhNeeded = 0;
      for (let h = 0; h < solarStartHour; h++) {
        morningKwhNeeded += hourlyLoadProfile[h] / 1000;
      }
      morningKwhNeeded = Math.round(morningKwhNeeded * 100) / 100;

      // 5. Forecast accuracy factor (last 14 days)
      const [accuracyRows] = await db.pool.query(`
        SELECT AVG(accuracy_percentage) AS avg_accuracy
        FROM solar_forecasts
        WHERE date >= ?
          AND date <  ?
          AND actual_kwh  IS NOT NULL
          AND actual_kwh   > 0
          AND expected_kwh > 0
      `, [fourteenAgo, today]);
      const rawAccuracy            = parseFloat(accuracyRows[0]?.avg_accuracy);
      const forecastAccuracyFactor = isNaN(rawAccuracy)
        ? 0.7
        : Math.min(1.0, rawAccuracy / 100);

      // 6. Build profile
      const profile = {
        calculatedAt:            this._localSecond(),
        dailyAvgLoadKwh:         Math.round(dailyAvgLoadKwh * 100) / 100,
        morningKwhNeeded,
        solarStartHour,
        solarTotalKwh:           Math.round(solarTotalKwh * 100) / 100,
        forecastAccuracyFactor:  Math.round(forecastAccuracyFactor * 1000) / 1000,
        hourlyLoadProfile,
      };

      // 7. Persist into strategy_config (read → merge in JS → write back;
      //    SQLite has no JSON_MERGE_PATCH, and other keys must survive)
      const [existing] = await db.pool.query(
        'SELECT config FROM strategy_config WHERE strategy_id = ?',
        ['smart-eco']
      );

      const currentConfig = existing[0]?.config
        ? JSON.parse(existing[0].config)
        : {};

      const mergedConfig = { ...currentConfig, nightlyProfile: profile };

      await db.pool.query(`
        INSERT INTO strategy_config (strategy_id, config)
        VALUES (?, ?)
        ON CONFLICT(strategy_id) DO UPDATE SET
          config = excluded.config
      `, ['smart-eco', JSON.stringify(mergedConfig)]);

      console.log(
        `\x1b[37m   • ${modulePrefix} - Done: morning=${morningKwhNeeded} kWh, ` +
        `solarStart=h${solarStartHour}, solarForecast=${solarTotalKwh} kWh, ` +
        `accuracy=${Math.round(forecastAccuracyFactor * 100)}%`
      );

    } catch (error) {
      console.error(`\x1b[91m   • ${modulePrefix} - Failed:`, error.message, '\x1b[37m');
    }
  }
}

export default new AggregatorService();