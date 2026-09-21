<!--
  StrategyBar.vue — horizontal reference row beneath the badge row.

  Three cells on one line: self-sufficiency, the active strategy, and the
  solar forecast. This replaces the full-height column, which no longer fits
  once the badges occupy all four columns.

  Everything here is reference material — either already known to the user or
  not actionable within the hour — so it sits below the live badges.
-->

<template>
  <section class="strategy-bar  p-3">
    <!-- self-sufficiency -->
    <div class="sb-cell">
      <div class="text-[10px] font-medium uppercase tracking-widest text-secondary-500 mb-1.5">
        {{ t('dashboard.selfSufficient') }}
      </div>
      <div class="flex items-baseline gap-2 mb-2">
        <span class="text-2xl font-semibold leading-none tabular-nums">
          <template v-if="selfSufficiency14d !== null">{{ selfSufficiency14d }}%</template>
          <template v-else><span class="text-secondary-400">—</span></template>
        </span>
        <span class="text-[11px] text-secondary-500">
          {{ t('dashboard.fourteenDayAverage') }}
          <template v-if="selfSufficiencyToday !== null">
            · {{ t('dashboard.todayShort') }} <strong>{{ selfSufficiencyToday }}%</strong>  
          </template>
        </span>
      </div>
      <div class="ss-track">
        <div class="ss-fill" :style="{ width: (selfSufficiency14d || 0) + '%' }"></div>
      </div>
    </div>

    <!-- strategy -->
    <div class="sb-cell">
      <div class="text-[10px] font-medium uppercase tracking-widest text-secondary-500 mb-1.5">
        {{ t('dashboard.strategy') }}
      </div>

      <!--
        A button, not a clickable span: this navigates, so it must be
        reachable by keyboard and announced as an action.
      -->
      <button
        type="button"
        class="sb-strategy-link flex items-center gap-2 max-w-full text-left"
        @click="$emit('adjust')"
      >
        <span class="text-[15px] font-semibold truncate">
          {{ strategyName || t('dashboard.noStrategy') }}
        </span>
        <span
          v-if="strategyActive"
          class="w-1.5 h-1.5 rounded-full shrink-0"
          :style="{ background: 'var(--chart-battery)' }"
          aria-hidden="true"
        ></span>
      </button>

      <!--
        Description comes in as a prop rather than from the strategy store:
        the component already receives the name that way, and a presentational
        card with two sources for one subject cannot be reused or tested
        without dragging the store along.
      -->
      <p
        v-if="strategyDescription"
        class="sb-description text-[11px] text-secondary-500 mt-0.5"
        :title="strategyDescription"
      >
        {{ strategyDescription }}
      </p>
    </div>

    <!-- forecast -->
    <div class="sb-cell sb-cell--last">
      <div class="text-[10px] font-medium uppercase tracking-widest text-secondary-500 mb-1.5">
        {{ t('dashboard.solarForecast') }}
      </div>
      <div class="flex justify-between items-baseline mb-1">
        <span class="text-xs text-secondary-500">{{ t('dashboard.todayShort') }}</span>
        <span class="text-[15px] font-semibold tabular-nums">
          <template v-if="todayKwh !== null">
            {{ todayKwh.toFixed(1) }}<span class="text-[10px] font-medium text-secondary-500"> kWh</span>
          </template>
          <template v-else><span class="text-secondary-400">—</span></template>
        </span>
      </div>
      <div class="flex justify-between items-baseline">
        <span class="text-xs text-secondary-500">{{ t('dashboard.tomorrow') }}</span>
        <span class="text-[15px] font-semibold tabular-nums text-secondary-500">
          <template v-if="tomorrowKwh !== null">
            {{ tomorrowKwh.toFixed(1) }}<span class="text-[10px] font-medium"> kWh</span>
          </template>
          <template v-else><span class="text-secondary-400">—</span></template>
        </span>
      </div>
    </div>
  </section>
</template>

<script setup>
import { useLocale } from '../../composables/useLocale';

const { t } = useLocale();

defineProps({
  selfSufficiency14d: { type: Number, default: null },
  selfSufficiencyToday: { type: Number, default: null },
  strategyName: { type: String, default: '' },
  strategyDescription: { type: String, default: '' },
  strategyActive: { type: Boolean, default: false },
  todayKwh: { type: Number, default: null },
  tomorrowKwh: { type: Number, default: null },
});

defineEmits(['adjust']);
</script>

<style scoped>
.strategy-bar         { display: grid;grid-template-columns: 1fr;gap: 1rem; border-radius: var(--border-radius); border: 1px solid var(--border-color);background-color: var(--card-bg-color);}
.sb-cell + .sb-cell   { border-top: 1px solid var(--border-color);padding-top: 0.75rem;}
.strategy-button      { border-radius: var(--radius-md);}
.ss-track             { height: 6px;border-radius: 9999px;background: var(--color-secondary-200);overflow: hidden;}
.ss-fill              { height: 100%;border-radius: 9999px;background: var(--chart-battery);transition: width 400ms ease;}

@media (min-width: 900px) {
  .strategy-bar {
    grid-template-columns: 1fr 1.2fr 1fr;
    gap: 0;
  }
  .sb-cell {
    padding: 0 0.875rem;
  }
  .sb-cell:first-child {
    padding-left: 0;
  }
  .sb-cell--last {
    padding-right: 0;
  }
  .sb-cell + .sb-cell {
    border-top: 0;
    border-left: 1px solid var(--border-color);
    padding-top: 0;
  }
}
</style>