<template>
  <div class="lg:p-6 p-1">
    <div class="history-page inner-canvas">

      <!-- Header with controls -->
      <div class="history-header">
        <div class="controls">

          <!-- Period selector -->
          <div class="period-selector">
            <button
              v-for="period in periods"
              :key="period.value"
              :class="['period-btn text-sm', { active: selectedPeriod === period.value }]"
              @click="selectPeriod(period.value)"
            >
              {{ period.label }}
            </button>
          </div>

          <!-- Date navigator — only shown for single-day view -->
          <div v-if="selectedPeriod === 'day'" class="date-nav ">
            <button class="date-btn" @click="goToPrevDay"><i class="ph-light ph-caret-left"></i></button>
            <span class="date-label">
              <span v-if="isToday" class="today-badge">{{ t('time.today') }}</span>
              {{ selectedDateLabel }}
            </span>
            <button class="date-btn" :class="{ disabled: isToday }" @click="goToNextDay"><i class="ph-light ph-caret-right"></i></button>
          </div>

        </div>
      </div>

      <!-- Main energy chart -->
      <div class="chart-wrapper p-6 ">
        <EnergyFlowGraph
          :period="graphPeriod"
          :date="selectedDate"
          :granularity="3"
          :height="chartHeight"
          :showStats="true"
          @data-loaded="updateStats"
        />
      </div>

      <!-- Smart device chart — day view only, below the energy graph -->
     <div class="device-chart-header">
        <i class="ph-light ph-devices"></i>
          {{ t('dashboard.smartDevices.title') }}
      </div>
      <div v-if="selectedPeriod === 'day'" class="device-chart-wrapper p-6  ">

        <SmartDeviceFlowGraph
          :date="selectedDate"
          :period="graphPeriod"
          :granularity="1"
          :height="deviceChartHeight"
          :show-stats="true"
        />
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import EnergyFlowGraph      from '@/components/common/EnergyFlowGraph.vue';
import SmartDeviceFlowGraph from '@/components/common/SmartDeviceFlowGraph.vue';
import { useLocale } from '@/composables/useLocale';

const { t } = useLocale();

const periods = [
  { value: 'day',           label: t('time.today'),    granularity: 1    },
  { value: 'last-7-days',   label: t('time.last7d'),   granularity: 60   },
  { value: 'last-30-days',  label: t('time.last30d'),  granularity: 360  },
  { value: 'last-365-days', label: t('time.thisYear'), granularity: 1440 },
];

const selectedPeriod = ref('day');
const selectedDate   = ref(getTodayDate());
const historyStats   = ref(null);

function updateStats(stats) {
  historyStats.value = stats;
}

// Tell EnergyFlowGraph which API to call:
// 'today' → getToday(), 'date' → getDateData(date), others → range endpoint
const graphPeriod = computed(() => {
  if (selectedPeriod.value !== 'day') return selectedPeriod.value;
  return isToday.value ? 'today' : 'date';
});

const granularity = computed(() => {
  return periods.find(p => p.value === selectedPeriod.value)?.granularity ?? 15;
});

// Energy graph takes more height when device graph is hidden
const chartHeight       = computed(() => selectedPeriod.value === 'day' ? '350px' : '400px');
const deviceChartHeight = '200px';

const isToday = computed(() => selectedDate.value === getTodayDate());

const selectedDateLabel = computed(() => {
  const d = new Date(selectedDate.value + 'T12:00:00');
  return d.toLocaleDateString('nl-NL', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric'
  });
});

function getTodayDate() {
  const d   = new Date();
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateToString(d) {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function goToPrevDay() {
  const d = new Date(selectedDate.value + 'T12:00:00'); // noon avoids DST boundary issues
  d.setDate(d.getDate() - 1);
  selectedDate.value = dateToString(d);
}

function goToNextDay() {
  if (isToday.value) return;
  const d = new Date(selectedDate.value + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  selectedDate.value = dateToString(d);
}

function selectPeriod(period) {
  selectedPeriod.value = period;
  // Reset to today when switching back to day view
  if (period === 'day') {
    selectedDate.value = getTodayDate();
  }
}
</script>

<style scoped>
.history-page           { padding: 24px; margin: 0 auto; max-width: 2400px; height: calc(100vh - 8rem); overflow-y: auto; }
.history-header         { margin-bottom: 1rem; }
.controls               { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }

/* ── Period selector ─────────────────────────────────────────────── */
.period-selector        { display: flex; gap: 8px;  }
.period-btn             { padding: 10px 20px; border: none; background: transparent; font-family: 'Rubik', sans-serif; color: var(--color-text-secondary); cursor: pointer; transition: all 0.2s ease; white-space: nowrap; border-radius: var(--border-radius);font-weight: 600; }
.period-btn:hover       { background: var(--card-bg-color); color: var(--color-text-primary); }
.period-btn.active      { background: var(--color-primary); color: var(--color-secondary-100); }

/* ── Date navigator (matches dashboard style) ────────────────────── */
.date-nav               { display: inline-flex; align-items: center; height: 3rem; background: var(--card-bg-color); overflow: hidden; border-radius: var(--border-radius); padding: 0 .5rem; }
.date-btn               { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: none; border: none; font-size: 18px; color: var(--color-text-secondary); cursor: pointer; transition: background 0.12s; }
.date-btn:hover         { background: var(--color-secondary-200);border-radius: var(--border-radius); }
.date-btn.disabled      { opacity: .3; cursor: default; pointer-events: none; }
.date-label             { display: flex; align-items: center; gap: 6px; padding: 0 14px; height: 32px; font-size: 13px; font-weight: 500; color: var(--color-text-primary); white-space: nowrap;  }
.today-badge            { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; background: var(--color-secondary-500); color: var(--color-bg-primary); padding: 1px 6px; border-radius: var(--radius-sm); }

/* ── Chart wrappers ──────────────────────────────────────────────── */
.chart-wrapper          { background-color: var(--card-bg-color);padding: 1rem;border: 1px solid var(--color-border); border-radius: var(--border-radius);margin-bottom: 1rem; }
.device-chart-wrapper   { background-color: var(--card-bg-color); border: 1px solid var(--color-border);border-radius: var(--border-radius) }
.device-chart-header    { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--color-text-secondary); letter-spacing: 0.04em; text-transform: lowercase; margin-top: 1rem; }
.device-chart-header i  { font-size: 14px; }

/* ── Responsive ──────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .history-page         { padding: 16px; }
  .controls             { flex-direction: column; align-items: stretch; }
  .period-selector      { flex-wrap: wrap; justify-content: center; }
  .period-btn           { padding: 8px 16px; font-size: 13px; }
  .device-chart-wrapper,
  .device-chart-header  { display: none; }
  .date-nav             { justify-content: center; }
}

@media (max-width: 480px) {
  .history-page         { padding: 12px; }
  .period-btn           { padding: 6px 12px; font-size: 12px; }
}
</style>