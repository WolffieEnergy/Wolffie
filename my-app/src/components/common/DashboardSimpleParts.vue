<!--
  DashboardSimpleParts.vue

  Three small presentational pieces for the simple dashboard, kept in one
  file because none is large enough to earn its own. Split them if any grows.

    <StrategyRow>          — active strategy, one-line description, tomorrow, adjust
    <SelfSufficiencyStrip> — 14-day average as a divider between now and history
    <SystemInsights>       — event log. NO DATA SOURCE YET: renders an honest
                             empty state rather than placeholder rows.

  Usage: this file exports three components via defineOptions-free SFC blocks
  is not possible; import them individually from the split files below if you
  prefer. As written, copy each <template>/<script> pair into its own .vue.
-->

<template>
  <div class="dashboard-parts">

    <!-- ── Strategy row ────────────────────────────────────────────── -->
    <section class="bg-secondary-50 rounded-2xl p-3 flex items-center gap-4">
      <div class="flex-1 min-w-0">
        <div class="text-[10px] font-medium uppercase tracking-widest text-secondary-500 mb-1">
          {{ t('dashboard.activeStrategy') }}
        </div>
        <div class="flex items-center gap-2 mb-0.5">
          <span class="text-[15px] font-semibold truncate">
            {{ strategyName || t('dashboard.noStrategy') }}
          </span>
          <span
            v-if="strategyActive"
            class="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"
            aria-hidden="true"
          ></span>
        </div>
        <p class="text-xs text-secondary-500 truncate">{{ strategyDescription }}</p>
      </div>

      <div class="text-right border-l border-secondary-200 pl-4 shrink-0">
        <div class="text-[10px] font-medium uppercase tracking-widest text-secondary-500 mb-1">
          {{ t('dashboard.tomorrow') }}
        </div>
        <div class="text-[15px] font-semibold tabular-nums">
          <template v-if="tomorrowKwh !== null">
            {{ Math.round(tomorrowKwh) }}<span class="text-xs font-medium text-secondary-500"> kWh</span>
          </template>
          <template v-else><span class="text-secondary-400">—</span></template>
        </div>
      </div>

      <button
        type="button"
        class="text-xs px-3 py-1.5 rounded-lg bg-secondary-100 hover:bg-secondary-200 whitespace-nowrap shrink-0"
        @click="$emit('adjust')"
      >
        {{ t('dashboard.adjust') }}
      </button>
    </section>

    <!-- ── Self-sufficiency strip ──────────────────────────────────── -->
    <section class="flex items-center gap-3 rounded-2xl px-3.5 py-2.5 mt-2.5 bg-secondary-100">
      <span class="text-[10px] font-medium uppercase tracking-widest text-secondary-500 whitespace-nowrap">
        {{ t('dashboard.selfSufficient') }}
      </span>
      <span class="text-lg font-semibold leading-none tabular-nums">
        <template v-if="selfSufficiency14d !== null">{{ selfSufficiency14d }}%</template>
        <template v-else><span class="text-secondary-400">—</span></template>
      </span>
      <div class="flex-1 h-1.5 rounded-full bg-secondary-200 overflow-hidden">
        <div
          class="h-full rounded-full bg-emerald-500"
          :style="{ width: (selfSufficiency14d || 0) + '%' }"
        ></div>
      </div>
      <span class="text-xs text-secondary-500 whitespace-nowrap">
        {{ t('dashboard.fourteenDayAverage') }}
      </span>
      <span
        v-if="selfSufficiencyToday !== null"
        class="text-xs text-secondary-500 whitespace-nowrap"
      >
        · {{ t('dashboard.todayShort') }} {{ selfSufficiencyToday }}%
      </span>
    </section>

    <!-- ── System insights ─────────────────────────────────────────── -->
    <section class="bg-secondary-50 rounded-2xl mt-2.5">
      <header class="flex justify-between items-center px-3.5 py-3 border-b border-secondary-200">
        <h2 class="text-sm font-semibold">{{ t('dashboard.systemInsights') }}</h2>
        <button
          type="button"
          class="text-xs text-blue-600 hover:underline"
          @click="$emit('viewHistory')"
        >
          {{ t('dashboard.viewHistory') }}
        </button>
      </header>

      <ul v-if="events.length" class="divide-y divide-secondary-200">
        <li
          v-for="ev in events"
          :key="ev.id"
          class="flex gap-3 px-3.5 py-2.5 items-baseline"
        >
          <span class="text-xs text-secondary-400 font-mono min-w-[38px]">{{ ev.time }}</span>
          <span class="text-[13px] flex-1">{{ ev.message }}</span>
          <span class="text-[11px] text-secondary-400">{{ ev.category }}</span>
        </li>
      </ul>

      <!--
        Empty state, not placeholder rows. There is no event table behind this
        list yet; inventing sample entries would make an unbuilt feature look
        shipped.
      -->
      <p v-else class="px-3.5 py-6 text-[13px] text-secondary-400">
        {{ t('dashboard.insightsEmpty') }}
      </p>
    </section>

  </div>
</template>

<script setup>
import { useLocale } from '../../composables/useLocale';

const { t } = useLocale();

defineProps({
  strategyName: { type: String, default: '' },
  strategyDescription: { type: String, default: '' },
  strategyActive: { type: Boolean, default: false },
  tomorrowKwh: { type: Number, default: null },
  selfSufficiency14d: { type: Number, default: null },
  selfSufficiencyToday: { type: Number, default: null },
  /** [{ id, time, message, category }] — empty until the event table exists. */
  events: { type: Array, default: () => [] },
});

defineEmits(['adjust', 'viewHistory']);
</script>