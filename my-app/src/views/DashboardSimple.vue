<!--
  DashboardSimple.vue — "simple" dashboard variant.

  Layout
    ≥ lg : 3 columns. Badges occupy columns 1–2 as a 2×2 grid; the strategy
           column fills column 3 at full height. Strip and insights span the
           full width below.
    < lg : badges 2×2, strategy column, strip, insights.

  No energy flow diagram here — that belongs to the advanced view. Because
  nothing else on this screen shows the present moment, each badge carries
  its own "now" line.

  Graceful degradation — every chart is optional:
    - solar bars and home/battery lines need the history series
    - battery projection needs strategy dayPlan `simSocPct`
    - grid price steps need dayPlan `priceCtKwh`; without them the badge
      falls back to a grid-power trace
-->

<template>
  <div class="dashboard-simple lg:p-6 p-3 text-primary">
    <div class="ds-shell mx-auto">

      <!-- stale banner — a dashboard of old numbers must not look live -->
      <div
        v-if="isStale"
        class="ds-stale mb-3 px-3.5 py-2 bg-amber-50 text-amber-800 text-xs flex items-center gap-2"
      >
        <i class="ph-light ph-warning-circle text-base" aria-hidden="true"></i>
        {{ t('dashboard.dataStale') }}
      </div>

      <div class="ds-layout">

        <!-- ── Columns 1–2: badges ─────────────────────────────────── -->
        <div class="ds-badges">

          <!-- Home -->
          <MetricBadge
            :label="t('dashboard.home')"
            icon="ph-light ph-house"
            :value="fmt(loadKwh)"
            unit="kWh"
            :chart-fallback="t('dashboard.noSeries')"
          >
            <template #chart>
              <Sparkline
                v-if="homeHourly.length"
                mode="line"
                :values="homeHourly"
                color="var(--chart-yield)"
                :height="46"
                fill
                :aria-label="t('dashboard.home')"
              />
            </template>
            <template #now>
              {{ t('dashboard.now') }}
              <strong class="text-primary font-semibold">{{ kw(loadPower) }}</strong>
            </template>
            <template #context>
              {{ t('dashboard.avg') }} {{ fmt(avgLoad) }}
              <span v-if="loadVsAvg !== null"> ( {{ signed(loadVsAvg) }} kWh )</span>
            </template>
          </MetricBadge>

          <!-- Solar -->
          <MetricBadge
            :label="t('dashboard.solar')"
            icon="ph-light ph-sun"
            :value="fmt(solarKwh)"
            unit="kWh"
            :chart-fallback="t('dashboard.noSeries')"
          >
            <template #chart>
              <Sparkline
                v-if="solarHourly.length"
                mode="line"
                :values="solarHourly"
                :overlay="solarForecastSeries"
                overlay-dashed
                :overlay-opacity="0.45"
                color="var(--chart-solar)"
                :height="46"
                fill
                :aria-label="t('dashboard.solar')"
              />
            </template>
            <template #now>
              {{ t('dashboard.now') }}
              <strong class="text-primary font-semibold">{{ kw(solarPower) }}</strong>
            </template>
            <template #context>
              <template v-if="solarVsForecastPct !== null">
                {{ t('dashboard.percentOfForecast', { pct: solarVsForecastPct }) }}
              </template>
              <template v-else>
                {{ t('dashboard.avg') }} {{ fmt(avgSolar) }}
              </template>
            </template>
          </MetricBadge>

          <!-- Battery -->
          <MetricBadge
            :label="t('dashboard.battery')"
            icon="ph-light ph-battery-medium"
            :value="socNow !== null ? Math.round(socNow) : null"
            unit="% SoC"
            :chart-fallback="t('dashboard.noSeries')"
          >
            <template #chart>
              <Sparkline
                v-if="socSeries.length"
                mode="line"
                :values="socSeries"
                :projection="socProjection"
                color="var(--chart-battery)"
                :height="46"
                fill
                :zero-based="true"
                :aria-label="t('dashboard.battery')"
              />
            </template>
            <template #now>
              {{ batteryStateLabel }}
              <strong class="text-primary font-semibold">{{ kw(Math.abs(batteryPower)) }}</strong>
            </template>
            <template #context>
              {{ t('dashboard.charged') }} {{ fmt(batteryChargeKwh) }} kWh ·
              {{ t('dashboard.used') }} {{ fmt(batteryDischargeKwh) }} kWh
            </template>
          </MetricBadge>

          <!-- Grid -->
          <MetricBadge
            :label="t('dashboard.grid')"
            icon="ph-light ph-plug"
            :value="signed(gridNetKwh)"
            unit="kWh"
            :chart-fallback="t('dashboard.noSeries')"
          >
            <template #chart>
              <Sparkline
                v-if="gridHourly.length"
                mode="line"
                :values="gridHourly"
                :background="hasPlan ? priceSeries : []"
                background-color="var(--chart-price, var(--chart-axis))"
                color="var(--chart-grid)"
                :height="46"
                fill
                :zero-based="true"
                :aria-label="t('dashboard.grid')"
              />
              <Sparkline
                v-else-if="hasPlan"
                mode="steps"
                :values="priceSeries"
                color="var(--chart-price, var(--chart-axis))"
                :height="46"
                :aria-label="t('dashboard.price')"
              />
            </template>
            <template #now>
              {{ gridStateLabel }}
              <strong class="text-primary font-semibold">{{ kw(Math.abs(gridPower)) }} </strong>
            </template>
            <template #context>
              <template v-if="priceNow !== null">
                {{ priceNow.toFixed(1) }} ct/kWh
                <span v-if="pricePeak !== null">
                  · {{ t('dashboard.peak') }} {{ pricePeak.toFixed(1) }}
                </span>
              </template>
              <template v-else>
                {{ t('dashboard.avgImport') }} {{ fmt(avgImport) }}
              </template>
            </template>
          </MetricBadge>
        </div>

        <!-- ── Column 3: strategy, full height ─────────────────────── -->
      </div>

      <StrategyBar
        class="ds-bar"
        :self-sufficiency14d="selfSufficiency14d"
        :self-sufficiency-today="selfSufficiencyToday"
        :strategy-name="strategyName"
        :strategy-description="strategyDescription"
        :strategy-active="strategyActive"
        :today-kwh="forecastToday"
        :tomorrow-kwh="tomorrowKwh"
        @adjust="goToStrategy"
      />

      <StatusTiles class="ds-tiles" :tiles="statusTiles" />

      <!-- full width, below all three columns -->
      <InsightsPanel
        class="ds-panel"
        :events="events"
        @view-history="goToHistory"
      />

    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useRealtimeStore } from '../stores/realtime';
import { useLocale } from '../composables/useLocale';
import { useDashboardSimple } from '../composables/useDashboardSimple';
import MetricBadge from '../components/common/MetricBadge.vue';
import Sparkline from '../components/common/Sparkline.vue';
import StrategyBar from '../components/common/StrategyBar.vue';
import StatusTiles from '../components/common/StatusTiles.vue';
import InsightsPanel from '../components/common/InsightsPanel.vue';

const router = useRouter();
const realtimeStore = useRealtimeStore();
const { t } = useLocale();

const {
  solarKwh, loadKwh, gridNetKwh,
  batteryChargeKwh, batteryDischargeKwh,
  avgLoad, avgSolar, avgImport, loadVsAvg,
  selfSufficiency14d, selfSufficiencyToday,
  strategyName, strategyDescription, strategyActive,
  lastDecision, nextAction, expectedGridImportTonight, cyclesToday,
  batteryPowerW, gridPowerW, solarPowerW, loadPowerW,
  forecastToday, tomorrowKwh, solarVsForecastPct,
  homeHourly, solarHourly, gridHourly,
  socSeries, socProjection,
  priceSeries, priceNow, pricePeak, hasPlan, solarForecastSeries,
  isStale,
} = useDashboardSimple();

// ── Live values (this view has no flow diagram, so badges carry "now") ──

const socNow = computed(() => finite(realtimeStore.batterySOC));

/*
  Power readings come from the composable in canonical sign (charging and
  import positive). The store's own batteryPower is raw AlphaESS, where
  positive means DISCHARGING — reading it directly here produced a badge
  that said "charging" while the battery was emptying.
*/
const solarPower   = solarPowerW;
const loadPower    = loadPowerW;
const gridPower    = gridPowerW;
const batteryPower = batteryPowerW;

const IDLE_W = 20; // below this, call it idle rather than a direction

const batteryStateLabel = computed(() => {
  if (Math.abs(batteryPower.value) < IDLE_W) return t('dashboard.batteryIdle');
  return batteryPower.value > 0
    ? t('dashboard.charging')
    : t('dashboard.discharging');
});

const gridStateLabel = computed(() => {
  if (Math.abs(gridPower.value) < IDLE_W) return t('dashboard.gridIdle');
  return gridPower.value > 0
    ? t('dashboard.importing')
    : t('dashboard.exporting');
});

/** Empty until the insights list has a data source. */
const events = computed(() => []);

/**
 * Four summary tiles. Two depend on /strategy/current; they render an em
 * dash rather than disappearing, so a missing endpoint stays visible.
 */
const statusTiles = computed(() => [
  {
    key: 'next',
    label: t('dashboard.nextAction'),
    value: nextAction.value
      ? `${t('dashboard.action.' + nextAction.value.action.toLowerCase())} ${nextAction.value.at}`
      : null,
    detail: nextAction.value?.watts ? kw(nextAction.value.watts) : nextAction.value?.reason,
  },
  {
    key: 'decision',
    label: t('dashboard.lastDecision'),
    value: lastDecision.value?.action
      ? t('dashboard.action.' + lastDecision.value.action.toLowerCase())
      : null,
    detail: lastDecision.value?.reason,
  },
  {
    key: 'tonight',
    label: t('dashboard.expectedTonight'),
    value: expectedGridImportTonight.value !== null
      ? `${expectedGridImportTonight.value.toFixed(1)} kWh`
      : null,
    detail: t('dashboard.fromGrid'),
  },
  {
    key: 'cycles',
    label: t('dashboard.cyclesToday'),
    value: cyclesToday.value !== null ? cyclesToday.value.toFixed(2) : null,
    detail: t('dashboard.equivalentFullCycles'),
  },
]);

// ── Formatting ──────────────────────────────────────────────────────────

function finite(v) {
  return Number.isFinite(v) ? v : null;
}

function fmt(v) {
  return Number.isFinite(v) ? v.toFixed(1) : null;
}

function signed(v) {
  if (!Number.isFinite(v)) return null;
  const s = v.toFixed(1);
  return v > 0 ? `+${s}` : s;
}

/** Watts → kW string. Sub-kilowatt values keep two decimals. */
function kw(w) {
  const v = Number.isFinite(w) ? w : 0;
  return `${(v / 1000).toFixed(v < 1000 ? 2 : 1)} kW`;
}

function goToStrategy() {
  router.push({ name: 'Control' });
}

function goToHistory() {
  router.push({ name: 'Events' });
}
</script>

<style scoped>
/*
  Layout lives here rather than in utility classes.

  Tailwind only generates classes it finds by scanning source files; a new
  directory that is not covered by the content sources silently yields no CSS,
  and the grid collapses to a single column. Plain CSS cannot fail that way.

  Utilities are still used for colour, spacing inside components, and type —
  those classes already exist elsewhere in the app.
*/

.ds-shell           { max-width: var(--max-width);}
.ds-stale           { border-radius: var(--radius-lg);}
.ds-layout          { display: grid;grid-template-columns: 1fr;gap: 1.5rem;align-items: stretch;}
.ds-badges          { display: grid;grid-template-columns: repeat(2, minmax(0, 1fr));gap: 1.5rem;}
.ds-bar,
.ds-tiles           { margin-top: 1.5rem;gap: 1.5rem}
.ds-panel           { margin-top: 1.5rem;}

/* lg — strategy moves into a third column beside the badges */
/* One row of four: a single glance, no vertical eye movement. */
@media (min-width: 900px) {
  .ds-badges {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

/* Narrow phones: a 2-up badge grid gets cramped below ~380px */
@media (max-width: 380px) {
  .ds-badges {
    grid-template-columns: 1fr;
  }
}
</style>