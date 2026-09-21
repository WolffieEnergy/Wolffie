<template>
  <div class="dashboard-graph-container" style="position:relative;">
    <div v-if="loading" class="loading-state">
      <span>{{ t('common.loading') }}</span>
    </div>
    <div v-else-if="error" class="error-state">
      <span>{{ error }}</span>
      <button @click="loadData" class="retry-btn">{{ t('common.retry') }}</button>
    </div>

    <!-- Legend -->
    <div class="legend">
      <div class="legend-item"><span class="legend-dot" style="background:#B45309;"></span>Solar → home</div>
      <div class="legend-item"><span class="legend-dot" style="background:#059669;"></span>Battery → home</div>
      <div class="legend-item"><span class="legend-dot" style="background:#F43F5E;"></span>Grid → home</div>
      <div class="legend-item"><span class="legend-dot" style="background:#5DCAA5;opacity:.8;"></span>Solar → battery</div>
    </div>

    <!-- Chart -->
    <div :style="{ position: 'relative', height: height }">
      <canvas ref="chartCanvas"></canvas>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import Chart from 'chart.js/auto';
import apiClient from '@/services/api';
import { useLocale } from '@/composables/useLocale';

const { t } = useLocale();

const props = defineProps({
  date:       { type: String,  required: true },
  autoUpdate: { type: Boolean, default: false },
  height:     { type: String,  default: '300px' },
});

const chartCanvas   = ref(null);
const loading       = ref(false);
const error         = ref(null);
let   chartInstance = null;
let   refreshTimer  = null;

// 24 fixed hour labels in HH:00 format — matches EnergyFlowGraph's proven pattern
const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

function emptySlots() { return Array(24).fill(null); }

const datasets = {
  solarToLoad: emptySlots(),
  battToLoad:  emptySlots(),
  gridToLoad:  emptySlots(),
  solarToGrid: emptySlots(),
};

// ── Data loading ────────────────────────────────────────────────────────────

async function loadData() {
  loading.value = true;
  error.value   = null;
  try {
    const res  = await apiClient.get('/system/hourly', { params: { date: props.date } });
    const rows = res.data?.rows ?? [];

    // Determine cutoff: for today only show hours that have fully passed
    const now         = new Date();
    const isToday     = props.date === localDateStr(now);
    const cutoffHour  = isToday ? now.getHours() : 24;

    const solarToLoad = emptySlots();
    const battToLoad  = emptySlots();
    const gridToLoad  = emptySlots();
    const solarToGrid = emptySlots();

    for (const row of rows) {
      const h = parseInt(row.hour, 10);
      if (h < 0 || h > 23 || h >= cutoffHour) continue;
      const stl = parseFloat(row.solar_to_load_kwh)   || 0;
      const btl = parseFloat(row.battery_to_load_kwh) || 0;
      const gtl = parseFloat(row.grid_to_load_kwh)    || 0;
      const stg = parseFloat(row.solar_to_grid_kwh)   || 0;
      // Only write non-zero values — zero stays null so Chart.js skips the bar
      if (stl !== 0) solarToLoad[h] = stl;
      if (btl !== 0) battToLoad[h]  = btl;
      if (gtl !== 0) gridToLoad[h]  = gtl;
      if (stg !== 0) solarToGrid[h] = stg;
    }

    if (chartInstance) {
      chartInstance.data.datasets[0].data = solarToLoad;
      chartInstance.data.datasets[1].data = battToLoad;
      chartInstance.data.datasets[2].data = gridToLoad;
      chartInstance.data.datasets[3].data = solarToGrid;
      chartInstance.update('none');
    } else {
      buildChart(solarToLoad, battToLoad, gridToLoad, solarToGrid);
    }
  } catch (err) {
    console.error('[DashboardGraph] load failed:', err.message);
    error.value = 'Could not load chart data';
  } finally {
    loading.value = false;
  }
}

function localDateStr(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── Chart ───────────────────────────────────────────────────────────────────

function buildChart(solarToLoad, battToLoad, gridToLoad, solarToGrid) {
  if (!chartCanvas.value) return;
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  // Lees dynamisch de actieve thema-kleuren uit
  const style = getComputedStyle(document.documentElement);
  const colorSolar   = style.getPropertyValue('--chart-solar').trim()   || '#636B2F';
  const colorGrid    = style.getPropertyValue('--chart-grid').trim()    || '#4A6B82';
  const colorBattery = style.getPropertyValue('--chart-battery').trim() || '#C87D55';
  const colorYield   = style.getPropertyValue('--chart-yield').trim()   || '#D4A359';
  const colorAxis    = style.getPropertyValue('--chart-axis').trim()    || '#857A6D';

  let maxPos = 0;
  let maxNeg = 0;
  for (let h = 0; h < 24; h++) {
    const pos = (solarToLoad[h] || 0) + (battToLoad[h] || 0) + (gridToLoad[h] || 0);
    const neg = Math.abs(solarToGrid[h] || 0);
    if (pos > maxPos) maxPos = pos;
    if (neg > maxNeg) maxNeg = neg;
  }
  const yExtent = Math.max(maxPos, maxNeg, 0.2) * 1.15;

  chartInstance = new Chart(chartCanvas.value, {
    data: {
      labels: HOURS,
      datasets: [
        {
          type: 'bar', label: 'Solar → home',
          data: solarToLoad,
          backgroundColor: colorSolar,
          stack: 'consumption',
          borderRadius: 6, borderSkipped: false,
          barPercentage: 0.6, categoryPercentage: 0.85,
        },
        {
          type: 'bar', label: 'Battery → home',
          data: battToLoad,
          backgroundColor: colorBattery,
          stack: 'consumption',
          borderRadius: 6, borderSkipped: false,
          barPercentage: 0.6, categoryPercentage: 0.85,
        },
        {
          type: 'bar', label: 'Grid → home',
          data: gridToLoad,
          backgroundColor: colorGrid,
          stack: 'consumption',
          borderRadius: 6, borderSkipped: false,
          barPercentage: 0.6, categoryPercentage: 0.85,
        },
        {
          type: 'bar', label: 'Solar → battery',
          data: solarToGrid,
          backgroundColor: colorYield,
          stack: 'export',
          borderRadius: 6, borderSkipped: false,
          barPercentage: 0.6, categoryPercentage: 0.85,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      layout: { padding: 0 },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.parsed.y !== 0 && item.parsed.y !== null,
          callbacks: {
            title: (items) => items[0]?.label ?? '',
            label: (ctx) => ` ${ctx.dataset.label}: ${Math.abs(ctx.parsed.y).toFixed(2)} kWh`,
          },
        }
      },
      scales: {
x: {
          display: true,
          ticks: {
            font: { size: 10 },
            maxRotation: 0,
            minRotation: 0,
            autoSkip: false,
            callback: function(value, index, ticks) {
              const label = this.getLabelForValue(value);
              // Intraday: label is 'HH:MM' — show only even hours on the hour
              if (label && /^\d{2}:\d{2}$/.test(label)) {
                const [hh, mm] = label.split(':');
                return (mm === '00' && parseInt(hh, 10) % 2 === 0) ? label : '';
              }
              // Multi-day: only show label at the start of each day
              const prevLabel = index > 0 ? this.getLabelForValue(ticks[index - 1].value) : null;
              return label !== prevLabel ? label : '';
            },
            color: '#9ca3af',
            padding: 6
          },
          grid: {
            color: function(context) {
              const labels = context.chart.data.labels;
              const label  = labels[context.index];
              // Intraday: only draw on even hours
              if (label && /^\d{2}:\d{2}$/.test(label)) {
                const [hh, mm] = label.split(':');
                return (mm === '00' && parseInt(hh, 10) % 2 === 0)
                  ? 'rgba(0, 0, 0, 0.07)' : 'transparent';
              }
              // Multi-day: only draw at start of each day (when label changes)
              const prevLabel = context.index > 0 ? labels[context.index - 1] : null;
              return label !== prevLabel ? 'rgba(0, 0, 0, 0.60)' : 'transparent';
            },
            drawTicks: true,  
            dash: [3, 4],
            tickLength: 0
          },
          border: {
            display: false
          }
        },
        y: {
          stacked: true,
          display: true,
          type: 'linear',
          position: 'left',
          padding: { top: 40, bottom: 10 },
          min: -yExtent,
          max:  yExtent,
          title: { 
            display: true  // Hide the "Vermogen (W)" title for cleaner look
          },
          ticks: {
            font: { size: 11 },
            color: '#6b7280',
            // Only show the "0" label
            callback: function(value) {
              return value === 0 ? '0' : '';
            }
          },
          grid: {
            color: (context) => {
              // Make zero line more prominent, hide other grid lines
              return context.tick.value === 0 ? 'rgba(0, 0, 0, 0.1)' : 'rgba(0, 0, 0, 0.1)';
            },
            lineWidth: (context) => {
              return context.tick.value === 0 ? 1 : 0;
            },
            drawTicks: true,
            tickLength: 4,
          },
          border: {display: false}
        },
      },
    },
  });
  
}

// ── Auto-update & watchers ──────────────────────────────────────────────────

watch(() => props.date, () => loadData());

watch(() => props.autoUpdate, (enabled) => {
  if (enabled) {
    refreshTimer = setInterval(loadData, 5 * 60 * 1000);
  } else {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  }
}, { immediate: true });

// ── Lifecycle ───────────────────────────────────────────────────────────────

onMounted(loadData);

onUnmounted(() => {
  if (chartInstance) chartInstance.destroy();
  if (refreshTimer)  clearInterval(refreshTimer);
});
</script>

<style scoped>
.dashboard-graph-container  { width: 100%; }
.legend                     { display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 0.75rem; }
.legend-item                { display: flex; align-items: center; gap: 0.375rem; font-size: 12px; color: #6b7280; }
.legend-dot                 { display: inline-block; width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.loading-state,
.error-state                { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; }
.loading-state span         { color: var(--color-text-secondary, #6b7280); font-size: 14px; }
.error-state span           { color: #ef4444; font-size: 14px; text-align: center; }
.retry-btn                  { padding: 8px 16px; background: var(--color-text-primary, #111827); color: #fff; border: none; border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; }
</style>