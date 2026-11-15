// server/scripts/rebuild-daily.js
//
// Recomputes energy_daily from energy_snapshots for a date range.
//
// Needed after the 2026-10-06 counter-reset fix: the inverter's *_today counters
// reset at midnight UTC (02:00 local in CEST, 01:00 in CET), so the old
// MAX(counter) per local day picked up the previous day's final value whenever it
// was the larger of the two. Every historical row is affected.
//
// Usage (from server/):
//   node scripts/rebuild-daily.js                               # all history
//   node scripts/rebuild-daily.js --from 2026-09-01
//   node scripts/rebuild-daily.js --from 2026-09-01 --to 2026-10-06
//   node scripts/rebuild-daily.js --no-backup                   # skip the backup table
//
// The six recomputed columns are copied to a backup table first, then cleared,
// then rebuilt — clearing matters because the upsert never overwrites a value
// with NULL, so a stale wrong value would otherwise survive. Other columns in
// energy_daily (battery_soc_avg and friends) are left untouched.
//
// Safe to run while the server is up.

import db from '../core/database.js';
import aggregatorService from '../core/system/services/aggregatorService.js';

const COLS = [
  'pv_generation_kwh', 'load_consumption_kwh',
  'grid_import_kwh', 'grid_export_kwh',
  'battery_charge_kwh', 'battery_discharge_kwh',
];

const args = process.argv.slice(2);
const arg  = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const flag = (name) => args.includes(`--${name}`);

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');

// Month-sized chunks: one window function over a year of snapshots is a lot of
// rows to sort at once, and a partial failure then loses only one month.
function monthChunks(from, to) {
  const chunks = [];
  let cursor = new Date(`${from}T12:00:00`);
  const end  = new Date(`${to}T12:00:00`);

  while (cursor <= end) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 12);
    const chunkEnd = monthEnd < end ? monthEnd : end;
    chunks.push([aggregatorService._localDate(cursor), aggregatorService._localDate(chunkEnd)]);
    cursor = new Date(chunkEnd.getFullYear(), chunkEnd.getMonth(), chunkEnd.getDate() + 1, 12);
  }
  return chunks;
}

async function main() {
  const [bounds] = await db.pool.query(
    `SELECT MIN(date(timestamp)) AS first, MAX(date(timestamp)) AS last FROM energy_snapshots`
  );
  const from = arg('from') ?? bounds[0]?.first;
  const to   = arg('to')   ?? bounds[0]?.last ?? aggregatorService._localDate();

  if (!isDate(from) || !isDate(to) || from > to) {
    console.error(`Invalid range: from=${from} to=${to}`);
    process.exit(1);
  }

  const eff = await aggregatorService._batteryEfficiency();
  console.log(`Rebuilding energy_daily  ${from} → ${to}   (battery efficiency ${eff})`);

  // Keep the old values so the report can show what moved, and so a bad run is
  // reversible.
  const [before] = await db.pool.query(
    `SELECT date, ${COLS.join(', ')} FROM energy_daily WHERE date BETWEEN ? AND ? ORDER BY date`,
    [from, to]
  );
  const old = new Map(before.map(r => [r.date, r]));

  if (!flag('no-backup') && before.length > 0) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const table = `energy_daily_backup_${stamp}`;
    await db.pool.query(
      `CREATE TABLE ${table} AS SELECT * FROM energy_daily WHERE date BETWEEN ? AND ?`,
      [from, to]
    );
    console.log(`Backup: ${table}  (${before.length} rows)`);
  }

  await db.pool.query(
    `UPDATE energy_daily SET ${COLS.map(c => `${c} = NULL`).join(', ')}
     WHERE date BETWEEN ? AND ?`,
    [from, to]
  );

  for (const [chunkFrom, chunkTo] of monthChunks(from, to)) {
    await aggregatorService.aggregateDaily({}, eff, { from: chunkFrom, to: chunkTo });
    console.log(`  ${chunkFrom} → ${chunkTo}`);
  }

  const [after] = await db.pool.query(
    `SELECT date, ${COLS.join(', ')} FROM energy_daily WHERE date BETWEEN ? AND ? ORDER BY date`,
    [from, to]
  );

  const n = (v) => (v === null || v === undefined ? null : Number(v));
  const f = (v) => (v === null ? '   —  ' : v.toFixed(2).padStart(6));
  let changed = 0;

  console.log('\nday           home before    after     Δ      grid imp/exp before → after');
  for (const row of after) {
    const was = old.get(row.date) ?? {};
    const h0  = n(was.load_consumption_kwh);
    const h1  = n(row.load_consumption_kwh);
    if (h0 !== null && h1 !== null && Math.abs(h1 - h0) < 0.05) continue;
    if (h0 === null && h1 === null) continue;
    changed++;
    const delta = h0 !== null && h1 !== null ? (h1 - h0) : null;
    console.log(
      `${row.date}   ${f(h0)}  ${f(h1)}  ${f(delta)}      ` +
      `${f(n(was.grid_import_kwh))}/${f(n(was.grid_export_kwh))} → ` +
      `${f(n(row.grid_import_kwh))}/${f(n(row.grid_export_kwh))}`
    );
  }

  console.log(`\n${after.length} day(s) rebuilt, ${changed} changed by more than 0.05 kWh.`);

  await aggregatorService.aggregateMonthly({ rebuildAll: true });
  console.log('Monthly totals rebuilt.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Rebuild failed:', err);
  process.exit(1);
});