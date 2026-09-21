/**
 * useDashboardSimple.js
 *
 * Data layer for the "simple" dashboard variant.
 *
 * Sources
 *   - useRealtimeStore            → today totals, realtime, averages, forecast, health
 *   - GET /history/today?granularity=15 → elapsed intraday series
 *   - GET /strategy/current             → active strategy + dayPlan slots
 *
 * Deliberate omissions
 *   - history `stats` is NEVER read. It currently disagrees with both
 *     /system/summary and with its own `data` array (load and battery
 *     charge/discharge overstated). Totals come from the store only, so the
 *     badges cannot display a contested number.
 *
 * Sign conventions (canonical, applied once on ingest)
 *   - battery: charging = POSITIVE. The history endpoint reports raw AlphaESS
 *     sign where negative = charging, so it is inverted here.
 *   - grid:    import = POSITIVE, export = NEGATIVE.
 *
 * Missing vs zero
 *   Series values use numOrNull: a dropped read stays null and renders as a
 *   gap in Sparkline. Coercing to 0 would draw a fake measurement.
 */

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRealtimeStore } from '../stores/realtime';
import apiClient from '../services/api';

const HISTORY_REFRESH_MS = 5 * 60 * 1000;

/**
 * Strategy routes are mounted at /api/strategies (see server.js).
 * /strategies/active is what the advanced dashboard uses.
 */
const STRATEGY_ENDPOINT = '/strategies/active';

/** 15-minute slots in a day. Every series on this dashboard uses this axis. */
const SLOTS_PER_DAY = 96;

export function useDashboardSimple() {
  const realtimeStore = useRealtimeStore();

  const series      = ref([]);
  const planSlots   = ref([]);
  const strategyRaw = ref(null);
  const decisionRaw = ref(null);
  const seriesError = ref(null);
  const loading     = ref(true);

  let timer = null;

  // ── Fetch ────────────────────────────────────────────────────────────

  async function loadSeries() {
    try {
      const res = await apiClient.get('/history/today?granularity=15');
      const rows = res.data?.data || [];
      series.value = rows.map((r) => ({
        slot: parseLocalSlot(r.timestamp),
        solarW: numOrNull(r.solar),
        homeW: numOrNull(r.home),
        gridW: numOrNull(r.grid),                  // already import-positive
        batteryW: invert(numOrNull(r.battery_power)), // → charging positive
        soc: numOrNull(r.battery_soc),
      }));
      seriesError.value = null;
    } catch (err) {
      seriesError.value = err;
      series.value = [];
    }
  }

  /** Optional — badges degrade cleanly when this fails. */
  async function loadStrategy() {
    try {
      const res = await apiClient.get(STRATEGY_ENDPOINT);
      strategyRaw.value = res.data?.strategy || null;
      decisionRaw.value = res.data?.decision || null;
      planSlots.value = Array.isArray(res.data?.dayPlan) ? res.data.dayPlan : [];
    } catch {
      strategyRaw.value = null;
      decisionRaw.value = null;
      planSlots.value = [];
    }
  }

  async function refresh() {
    loading.value = true;
    await Promise.all([loadSeries(), loadStrategy()]);
    loading.value = false;
  }

  // ── Today totals (store keys are today_*) ────────────────────────────

  const today = computed(() => realtimeStore.summaryData || {});

  const solarKwh  = computed(() => num(today.value.today_pv_gen));
  const loadKwh   = computed(() => num(today.value.today_load));
  const importKwh = computed(() => num(today.value.today_grid_import));
  const exportKwh = computed(() => num(today.value.today_grid_export));
  const gridNetKwh = computed(() => importKwh.value - exportKwh.value);

  const batteryChargeKwh    = computed(() => num(today.value.today_battery_charge));
  const batteryDischargeKwh = computed(() => num(today.value.today_battery_discharge));

  // ── Averages (14d) ───────────────────────────────────────────────────

  const averages = computed(() => realtimeStore.averages || {});
  const avgLoad   = computed(() => numOrNull(averages.value.avg_load_14d));
  const avgSolar  = computed(() => numOrNull(averages.value.avg_solar_14d));
  const avgImport = computed(() => numOrNull(averages.value.avg_grid_import_14d));

  const loadVsAvg = computed(() =>
    avgLoad.value ? round1(loadKwh.value - avgLoad.value) : null
  );

  // ── Self-sufficiency ─────────────────────────────────────────────────

  const selfSufficiency14d = computed(() => {
    const load = avgLoad.value;
    const imp  = avgImport.value;
    if (!load || load <= 0 || imp === null) return null;
    return clampPct(((load - imp) / load) * 100);
  });

  const selfSufficiencyToday = computed(() => {
    const load = loadKwh.value;
    if (load <= 0) return null;
    return clampPct(((load - importKwh.value) / load) * 100);
  });

  // ── Strategy ─────────────────────────────────────────────────────────

  const strategyName        = computed(() => strategyRaw.value?.name || '');
  const strategyDescription = computed(() => strategyRaw.value?.description || '');
  const strategyActive      = computed(() => strategyRaw.value?.active === true);

  // ── Status tiles ─────────────────────────────────────────────────────

  /** Latest evaluation from the optimizer. */
  const lastDecision = computed(() => {
    const d = decisionRaw.value;
    if (!d) return null;
    return {
      action: d.action || null,
      reason: d.reason || '',
      at: slotClock(d.evaluatedAt),
    };
  });

  /**
   * The first planned slot that is not IDLE. Null when the plan is absent or
   * the optimizer intends to do nothing for the whole window.
   */
  const nextAction = computed(() => {
    const slot = planSlots.value.find((s) => s.action && s.action !== 'IDLE');
    if (!slot) return null;
    return {
      action: slot.action,
      at: slotClock(slot.datetime) || hourClock(slot.hour),
      watts: numOrNull(slot.watts),
      reason: slot.reason || '',
    };
  });

  /** Already present in /system/summary — no extra call. */
  const expectedGridImportTonight = computed(() =>
    numOrNull(realtimeStore.dayPlan?.expectedGridImportKwhTonight)
  );

  /**
   * Equivalent full cycles today: energy charged divided by usable capacity.
   * Capacity comes from the strategy config; null without it rather than a
   * guessed default, since the figure would be silently wrong.
   */
  const cyclesToday = computed(() => {
    const cap = numOrNull(strategyRaw.value?.config?.batteryCapacityKwh);
    if (!cap || cap <= 0) return null;
    return Math.round((batteryChargeKwh.value / cap) * 100) / 100;
  });

  // ── Forecast ─────────────────────────────────────────────────────────

  const forecastToday = computed(() => numOrNull(realtimeStore.forecast?.[0]?.expectedKwh));
  const tomorrowKwh   = computed(() => numOrNull(realtimeStore.forecast?.[1]?.expectedKwh));

  const solarVsForecastPct = computed(() => {
    const f = forecastToday.value;
    if (!f || f <= 0) return null;
    return Math.round((solarKwh.value / f) * 100);
  });

  // ── Chart series ─────────────────────────────────────────────────────

  /**
   * Every measured series is a fixed 96-slot day at 15-minute resolution.
   *
   * Two reasons, and the second matters more than the first.
   *
   * 1. Hourly averaging smoothed away exactly what makes these charts worth
   *    looking at. A 2 kW appliance running for one quarter-hour disappears
   *    into its hour; at 15 minutes it is a spike you can recognise.
   *
   * 2. A FIXED-LENGTH day means all four badges share one x-axis. Previously
   *    a series of 11 elapsed hours stretched across the full badge width
   *    while a 24-point forecast in the badge beside it did the same, so the
   *    same moment in time sat at different x positions in adjacent charts.
   *    Now "now" lands in the same place in every badge and the row reads as
   *    one timeline.
   *
   * Slots with no data stay null and render as gaps, never as zero.
   */
  const homeHourly  = computed(() => toDaySlots(series.value, 'homeW'));
  const solarHourly = computed(() => toDaySlots(series.value, 'solarW'));
  const gridHourly  = computed(() => toDaySlots(series.value, 'gridW'));
  const socSeries   = computed(() => toDaySlots(series.value, 'soc'));

  /**
   * Plan-derived series, mapped onto the same day axis.
   *
   * Plans arrive in two shapes:
   *   - hourly slots numbered 0-23, no date          → midnight based
   *   - quarter-hour slots with a `datetime`         → a 24h window running
   *     forward from `windowStart`, so its later half belongs to TOMORROW
   *
   * `todayOnly` is what separates context from comparison:
   *
   *   price      → false. A backdrop showing what power costs at each time
   *                of day. The exact figures come from the context line, not
   *                from reading the shape.
   *   forecast   → true. It is drawn against measured production and labelled
   *                a comparison, so plotting tomorrow's curve behind today's
   *                line would be a false claim. On a window-based plan the
   *                overlay is short or absent — that is the honest state.
   *   projection → true, and additionally clipped to the future, so a plan
   *                that wraps past midnight can never draw over this
   *                morning's measured SoC.
   */
  const priceSeries = computed(() => planToDaySlots('priceCtKwh', false));
  const solarForecastSeries = computed(() => planToDaySlots('solarForecastW', true));

  const socProjection = computed(() => {
    const arr = planToDaySlots('simSocPct', true);
    const now = currentSlot();
    for (let i = 0; i < now && i < arr.length; i += 1) arr[i] = null;
    return arr;
  });

  /**
   * @param {string} field       slot property to read
   * @param {boolean} todayOnly  drop slots dated other than today
   */
  function planToDaySlots(field, todayOnly) {
    const out = new Array(SLOTS_PER_DAY).fill(null);
    const slots = planSlots.value;
    if (!slots.length) return out;

    const today = localDateKey(new Date());

    for (const slot of slots) {
      const v = numOrNull(slot[field]);
      if (v === null) continue;

      // Hourly, dateless plan: one value spread over its four quarter-hours.
      if (!slot.datetime) {
        const base = (slot.hour ?? 0) * 4;
        for (let k = 0; k < 4; k += 1) {
          if (base + k < SLOTS_PER_DAY) out[base + k] = v;
        }
        continue;
      }

      if (todayOnly && dateKeyOf(slot.datetime) !== today) continue;

      const idx = parseLocalSlot(slot.datetime);
      if (idx >= 0 && idx < SLOTS_PER_DAY) out[idx] = v;
    }

    return out;
  }

  /**
   * Price in the slot happening right now, falling back to the most recent
   * published slot before it. Previously this took the first non-null value
   * in the array, which on a midnight-based plan reported last night's price
   * as "now".
   */
  const priceNow = computed(() => {
    const arr = priceSeries.value;
    for (let i = Math.min(currentSlot(), arr.length - 1); i >= 0; i -= 1) {
      if (arr[i] !== null && arr[i] !== undefined) return arr[i];
    }
    return null;
  });

  const pricePeak = computed(() => {
    const vals = priceSeries.value.filter((v) => v !== null);
    return vals.length ? Math.max(...vals) : null;
  });

  const hasPlan = computed(() => priceSeries.value.some((v) => v !== null));

  // ── Live power, canonical sign ───────────────────────────────────────
  //
  // The store exposes battery power in the raw AlphaESS convention, where
  // POSITIVE means discharging. Everything else here uses the canonical
  // convention (charging positive), so it is inverted once, here — the same
  // place the history series is inverted.

  const batteryPowerW = computed(() => -(realtimeStore.batteryPower || 0));
  const gridPowerW    = computed(() => realtimeStore.gridPower || 0);
  const solarPowerW   = computed(() => realtimeStore.solarPower || 0);
  const loadPowerW    = computed(() => realtimeStore.loadPower || 0);

  // ── Health ───────────────────────────────────────────────────────────

  const isStale    = computed(() => realtimeStore.healthInfo?.stale === true);
  const lastUpdate = computed(() => realtimeStore.lastUpdate || null);

  // ── Lifecycle ────────────────────────────────────────────────────────

  onMounted(() => {
    if (!realtimeStore.hasInitialized) realtimeStore.initialize();
    refresh();
    timer = setInterval(refresh, HISTORY_REFRESH_MS);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return {
    loading, seriesError, refresh,
    solarKwh, loadKwh, gridNetKwh, importKwh, exportKwh,
    batteryChargeKwh, batteryDischargeKwh,
    avgLoad, avgSolar, avgImport, loadVsAvg,
    selfSufficiency14d, selfSufficiencyToday,
    strategyName, strategyDescription, strategyActive,
    lastDecision, nextAction, expectedGridImportTonight, cyclesToday,
    forecastToday, tomorrowKwh, solarVsForecastPct,
    homeHourly, solarHourly, gridHourly,
    socSeries, socProjection,
    priceSeries, priceNow, pricePeak, hasPlan, solarForecastSeries,
    batteryPowerW, gridPowerW, solarPowerW, loadPowerW,
    isStale, lastUpdate,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Totals: absence is genuinely zero energy, so coercion is correct here. */
function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Series: absence must stay absent so the chart can draw a gap. */
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function invert(v) {
  return v === null ? null : -v;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function clampPct(v) {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * 15-minute slot index (0-95) from a local timestamp string. Parsed by regex
 * rather than `new Date(...)`: Date parsing reintroduces the UTC shift that
 * has caused wrong-day aggregation here before.
 */
function parseLocalSlot(ts) {
  const m = String(ts || '').match(/[T ](\d{2}):(\d{2})/);
  if (!m) return -1;
  return parseInt(m[1], 10) * 4 + Math.floor(parseInt(m[2], 10) / 15);
}

/** "YYYY-MM-DD" from a local timestamp string. */
function dateKeyOf(ts) {
  const m = String(ts || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** "YYYY-MM-DD" for a Date, in LOCAL components — never toISOString(). */
function localDateKey(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** The 15-minute slot happening now, in local time. */
function currentSlot() {
  const d = new Date();
  return d.getHours() * 4 + Math.floor(d.getMinutes() / 15);
}

/** "HH:00" from a bare hour index, for plans that carry no timestamp. */
function hourClock(h) {
  if (h === null || h === undefined) return null;
  return `${String(h).padStart(2, '0')}:00`;
}

/** "HH:MM" from a timestamp, by string, for the same reason as parseLocalSlot. */
function slotClock(ts) {
  if (!ts) return null;
  const m = String(ts).match(/[T ](\d{2}:\d{2})/);
  return m ? m[1] : null;
}

/**
 * Rows onto a fixed 96-slot day. Several readings in one slot are averaged;
 * an empty slot stays null so the chart draws a gap rather than a zero.
 */
function toDaySlots(rows, key) {
  const out = new Array(SLOTS_PER_DAY).fill(null);
  if (!rows.length) return out;

  const sums = new Array(SLOTS_PER_DAY).fill(0);
  const counts = new Array(SLOTS_PER_DAY).fill(0);

  for (const r of rows) {
    const i = r.slot;
    if (i === null || i === undefined || i < 0 || i >= SLOTS_PER_DAY) continue;
    if (r[key] === null || r[key] === undefined) continue;
    sums[i] += r[key];
    counts[i] += 1;
  }

  for (let i = 0; i < SLOTS_PER_DAY; i += 1) {
    if (counts[i]) out[i] = sums[i] / counts[i];
  }
  return out;
}