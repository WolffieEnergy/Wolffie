// scripts/rebuild-history.js
//
// Rebuilds energy_minutes → energy_hours → energy_daily → energy_monthly from
// the raw energy_snapshots table.
//
// WHY THIS EXISTS
//   Three separate defects left the derived tables wrong:
//     1. load_power_avg / load_consumption_kwh were NULL everywhere (the
//        aggregator gated load on a capability nobody registers)
//     2. every flow column in energy_hours computed to 0 as a consequence
//     3. capability drop-outs let ON CONFLICT write NULL over good minute rows
//   energy_snapshots itself was never damaged, so everything downstream is
//   reconstructible.
//
// USAGE
//   node scripts/rebuild-history.js                      # dry run, full history
//   node scripts/rebuild-history.js --apply              # write, full history
//   node scripts/rebuild-history.js --from 2026-08-23 --apply
//   node scripts/rebuild-history.js --from 2026-08-01 --to 2026-08-15 --apply
//   node scripts/rebuild-history.js --efficiency 0.93 --apply
//
// BACK UP THE DATABASE FIRST. This deletes and rewrites derived rows.
//
// SOURCE RESOLUTION
//   The live aggregator resolves each domain's authoritative module from the
//   capability registry. That registry is empty in a standalone script, so this
//   script infers sources from the data instead — the source with the most
//   non-null rows per domain — and prints them for confirmation before writing.
//   Override with --solar / --battery / --grid if the inference is wrong.

// Script lives at server/scripts/rebuild-history.js
import db from '../config/database.js';
import aggregator from '../core/system/services/aggregatorService.js';

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { apply: false, from: null, to: null, efficiency: null,
                 solar: null, battery: null, grid: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply')      { args.apply = true; continue; }
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    const key = a.replace(/^--/, '');
    if (key in args) args[key] = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv);

if (args.help) {
  console.log(`
  rebuild-history.js — rebuild derived energy tables from raw snapshots

    --apply              actually write (default is a dry run)
    --from YYYY-MM-DD    start date (default: earliest snapshot)
    --to   YYYY-MM-DD    end date   (default: today)
    --efficiency 0.95    one-way battery efficiency
    --solar/--battery/--grid <source>   override source inference
  `);
  process.exit(0);
}

const p = n => String(n).padStart(2, '0');
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;

function eachDay(fromStr, toStr) {
  const out = [];
  const cur = new Date(`${fromStr}T00:00:00`);
  const end = new Date(`${toStr}T00:00:00`);
  while (cur <= end) {
    out.push(localDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// ── Source inference ──────────────────────────────────────────────────────────

async function inferSources() {
  const [rows] = await db.pool.query(`
    SELECT source,
           SUM(solar_power   IS NOT NULL) AS solar_rows,
           SUM(battery_power IS NOT NULL) AS battery_rows,
           SUM(grid_power    IS NOT NULL) AS grid_rows,
           COUNT(*)                       AS total
    FROM energy_snapshots
    GROUP BY source
    ORDER BY total DESC
  `);

  console.log('\n  Sources present in energy_snapshots:');
  console.log('  ' + '-'.repeat(72));
  console.log(`  ${'source'.padEnd(28)}${'total'.padStart(10)}${'solar'.padStart(10)}${'battery'.padStart(11)}${'grid'.padStart(10)}`);
  for (const r of rows) {
    console.log(
      `  ${String(r.source).padEnd(28)}` +
      `${String(r.total).padStart(10)}${String(r.solar_rows).padStart(10)}` +
      `${String(r.battery_rows).padStart(11)}${String(r.grid_rows).padStart(10)}`
    );
  }

  const best = (col) =>
    rows.filter(r => r[col] > 0).sort((a, b) => b[col] - a[col])[0]?.source ?? null;

  return {
    solar:   args.solar   ?? best('solar_rows'),
    battery: args.battery ?? best('battery_rows'),
    grid:    args.grid    ?? best('grid_rows'),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const [bounds] = await db.pool.query(
    `SELECT MIN(date(timestamp)) AS first, MAX(date(timestamp)) AS last
     FROM energy_snapshots`
  );

  const from = args.from ?? bounds[0]?.first;
  const to   = args.to   ?? bounds[0]?.last ?? localDate();

  if (!from) {
    console.error('  No snapshots found — nothing to rebuild.');
    process.exit(1);
  }

  const sourceMap = await inferSources();
  const eff = args.efficiency
    ? parseFloat(args.efficiency)
    : await aggregator._batteryEfficiency();

  const days = eachDay(from, to);

  console.log('\n  Rebuild plan');
  console.log('  ' + '-'.repeat(72));
  console.log(`  range               ${from} → ${to}  (${days.length} days)`);
  console.log(`  solar source        ${sourceMap.solar   ?? '(none — pv will be NULL)'}`);
  console.log(`  battery source      ${sourceMap.battery ?? '(none — battery will be NULL)'}`);
  console.log(`  grid source         ${sourceMap.grid    ?? '(none — grid will be NULL)'}`);
  console.log(`  battery efficiency  ${eff}  (one-way; ${(eff * eff * 100).toFixed(1)}% round-trip)`);
  console.log(`  mode                ${args.apply ? 'APPLY (will write)' : 'DRY RUN (no writes)'}`);

  if (!sourceMap.solar || !sourceMap.battery || !sourceMap.grid) {
    console.warn('\n  ⚠  At least one domain has no source. Load derivation will be');
    console.warn('     incomplete for those hours. Override with --solar/--battery/--grid.');
  }

  if (!args.apply) {
    console.log('\n  Dry run complete. Re-run with --apply to write.\n');
    process.exit(0);
  }

  console.log('\n  Rebuilding. Back up the database if you have not already.\n');

  let totalMinutes = 0;
  let totalHours   = 0;

  for (let i = 0; i < days.length; i++) {
    const day  = days[i];
    const next = days[i + 1] ?? (() => {
      const d = new Date(`${day}T00:00:00`);
      d.setDate(d.getDate() + 1);
      return localDate(d);
    })();

    // Delete first, then rebuild. The live aggregator's ON CONFLICT clauses use
    // COALESCE(excluded.col, col) so a NULL can never overwrite a good value —
    // deliberate protection against capability drop-outs, but it also means an
    // existing wrong value would survive an in-place rebuild. Deleting the range
    // is what makes this a true rebuild rather than a fill-in-the-blanks pass.
    await db.pool.query(
      `DELETE FROM energy_minutes WHERE timestamp >= ? AND timestamp < ?`,
      [`${day} 00:00:00`, `${next} 00:00:00`]
    );
    await db.pool.query(
      `DELETE FROM energy_hours WHERE timestamp >= ? AND timestamp < ?`,
      [`${day} 00:00:00`, `${next} 00:00:00`]
    );

    const m = await aggregator.aggregateMinutes(sourceMap, eff, {
      from: `${day} 00:00:00`,
      to:   `${next} 00:00:00`,
    });

    const h = await aggregator.aggregateHours({
      from: `${day} 00:00:00`,
      to:   `${next} 00:00:00`,
    });

    await aggregator.aggregateDaily(sourceMap, eff, { from: day, to: day });

    totalMinutes += m;
    totalHours   += h;

    if ((i + 1) % 10 === 0 || i === days.length - 1) {
      console.log(
        `  ${String(i + 1).padStart(4)}/${days.length}  ${day}  ` +
        `minutes=${totalMinutes}  hours=${totalHours}`
      );
    }
  }

  console.log('\n  Rebuilding monthly totals...');
  await aggregator.aggregateMonthly({ rebuildAll: true });

  // ── Verification ────────────────────────────────────────────────────────────

  const [check] = await db.pool.query(`
    SELECT COUNT(*) AS hours,
           SUM(load_power_avg    IS NOT NULL) AS has_load,
           SUM(pv_power_avg      IS NOT NULL) AS has_pv,
           SUM(battery_power_avg IS NOT NULL) AS has_batt,
           SUM(grid_power_avg    IS NOT NULL) AS has_grid
    FROM energy_hours
    WHERE date(timestamp) BETWEEN ? AND ?
  `, [from, to]);

  const c = check[0];
  console.log('\n  Result — energy_hours coverage');
  console.log('  ' + '-'.repeat(72));
  console.log(`  hours     ${c.hours}`);
  console.log(`  load      ${c.has_load}  (${((c.has_load / c.hours) * 100).toFixed(1)}%)`);
  console.log(`  pv        ${c.has_pv}`);
  console.log(`  battery   ${c.has_batt}`);
  console.log(`  grid      ${c.has_grid}`);
  console.log('\n  Done.\n');

  process.exit(0);
}

main().catch(err => {
  console.error('\n  Rebuild failed:', err);
  process.exit(1);
});