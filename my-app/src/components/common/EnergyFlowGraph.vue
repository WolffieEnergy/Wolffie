<template>
  <div class="energy-flow-graph-container">
    <!-- Stats Overview Cards (optional) -->
    <div v-if="showStats && !loading && !error && stats" class="stats-overview mb-8 ml-auto">
      <div class="stat-card solar">
        <span class="label"><span class="tt-dot"></span>Solar</span>
        <span class="value">{{ (stats.pv_generation ?? 0).toFixed(1) }} <small>kWh</small></span>
      </div>
      <div class="stat-card home">
        <span class="label"><span class="tt-dot"></span>Home</span>
        <span class="value">{{ (stats.load_consumption ?? 0).toFixed(1) }} <small>kWh</small></span>
      </div>
      <div class="stat-card grid">
        <span class="label"><span class="tt-dot"></span>Grid</span>
        <span class="value">
          {{ (stats.grid_import ?? 0).toFixed(1) }} <small>Import</small> / {{ (stats.grid_export ?? 0).toFixed(1) }} <small>export</small>
        </span>
      </div>
      <div class="stat-card battery">
        <span class="label"><span class="tt-dot"></span>Battery</span>
        <span class="value">
          {{ (stats.battery_charge ?? 0).toFixed(1) }} <small>Charge</small> / {{ (stats.battery_discharge ?? 0).toFixed(1) }} <small>Discharge</small>
        </span>
      </div>
    </div>

    <!-- Chart Area -->
    <div class="energy-flow-graph" style="position:relative;">
      <div v-if="loading" class="loading-state">
        <span>{{ t('common.loading') }}</span>
      </div>
      <div v-else-if="error" class="error-state">
        <span>{{ error }}</span>
        <button @click="loadData" class="retry-btn">{{ t('common.retry') }}</button>
      </div>
      <canvas ref="chartCanvas"></canvas>
      <!-- Custom HTML tooltip -->
      <div ref="tooltipEl" style="display:none;position:absolute;pointer-events:none;background:#ffffff;border:1px solid #e4e7ec;border-radius:10px;padding:10px 14px;box-shadow:0 4px 16px rgba(0,0,0,.08);min-width:170px;z-index:100;font-family:system-ui,sans-serif;"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import Chart from 'chart.js/auto';
import { historyService } from '@/services/history';
import { useLocale } from '@/composables/useLocale';

const { t, currentLanguage } = useLocale();

const props = defineProps({
  period: { type: String, default: 'today' },
  date: { type: String, default: () => new Date().toISOString().split('T')[0] },
  granularity: { type: Number, default: 15 },
  height: { type: String, default: '200px' },
  showStats: { type: Boolean, default: false },
  // 'line' (default, desktop) or 'bar' (mobile stacked bars + SoC line)
  mode: { type: String, default: 'line' }
});

const emit = defineEmits(['data-loaded']);

const chartCanvas = ref(null);
const tooltipEl   = ref(null);
const chartInstance = ref(null);
const loading = ref(false);
const error = ref(null);
const chartData = ref([]);
const stats = ref(null);

// Helper to calculate date range for multi-day periods
const getRangeDates = (period) => {
  const end = new Date().toISOString().split('T')[0];
  let days = 7;
  
  if (period === 'last-7-days') days = 7;
  else if (period === 'last-30-days') days = 30;
  else if (period === 'last-365-days') days = 365;
  
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  return { start, end };
};

// Collapse range rows into coarser buckets.
// - 7-day / 30-day: bucket by calendar day (source rows are hourly averages, in Watts)
// - year: bucket by ISO week (Mon–Sun); source rows are daily kWh totals
//
// Per historyController.js:getRange, every multi-day row is ONLY ever
// { timestamp, solar, home, grid, battery_power, battery_soc } — there is no
// per-row import/export or charge/discharge split; 'grid' and 'battery_power'
// are already net (export−import, discharge−charge). We approximate a visual
// import/export split by clamping the net value to +/- before summing (this
// can under-count a day that both imported and exported). Battery is kept as
// a single net bar per Peter's call.
//
// Units differ by branch: 7d/30d rows are avg Watts for that hour (pv_power_avg
// etc.), the year's day-branch rows are already kWh. Convert hourly Watts to
// that hour's kWh contribution by dividing by 1000 before summing.
const RANGE_FIELDS = ['solar', 'home', 'grid_import', 'grid_export', 'battery_net'];

const normalizeRow = (row, period) => {
  const alreadyKwh = period === 'last-365-days';
  const toKwh = (v) => alreadyKwh ? (v || 0) : (v || 0) / 1000;

  const solar = toKwh(row.solar);
  const home = toKwh(row.home);
  const gridNet = toKwh(row.grid);            // export − import
  const batteryNet = toKwh(row.battery_power); // discharge − charge

  return {
    solar,
    home,
    grid_import: Math.max(-gridNet, 0),
    grid_export: Math.max(gridNet, 0),
    battery_net: batteryNet,
  };
};

const bucketKeyDay = (d) => d.toISOString().split('T')[0];
const bucketKeyWeek = (d) => {
  const dow = d.getDay(); // 0=Sun..6=Sat
  const diffToMonday = (dow === 0 ? -6 : 1) - dow;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  return monday.toISOString().split('T')[0];
};

const aggregateRows = (rows, keyFn, period) => {
  const buckets = new Map();
  for (const row of rows) {
    const d = new Date((row.date || row.timestamp?.slice(0, 10)) + 'T00:00:00');
    const key = keyFn(d);
    if (!buckets.has(key)) {
      const bucket = { date: key };
      RANGE_FIELDS.forEach(f => { bucket[f] = 0; });
      buckets.set(key, bucket);
    }
    const norm = normalizeRow(row, period);
    const bucket = buckets.get(key);
    RANGE_FIELDS.forEach(f => { bucket[f] += norm[f]; });
  }
  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
};

const loadData = async () => {
  loading.value = true;
  error.value = null;
  
  try {
    let response;
    
    // Determine API call based on period
    if (props.period === 'today') {
      response = await historyService.getToday(props.granularity);
    } else if (props.period === 'date') {
      response = await historyService.getDateData(props.date, props.granularity);
    } else {
      // Use range endpoint for multi-day periods
      const { start, end } = getRangeDates(props.period);
      response = await historyService.getRange(start, end);
    }

    // New API structure: { stats, data }
    const { stats: apiStats, data: apiData } = response.data;
    
    // Store stats for display
    stats.value = apiStats;
    if (props.period === 'last-365-days') {
      chartData.value = aggregateRows(apiData, bucketKeyWeek, props.period);
    } else if (props.period === 'last-7-days' || props.period === 'last-30-days') {
      chartData.value = aggregateRows(apiData, bucketKeyDay, props.period);
    } else {
      chartData.value = apiData;
    }
    
    // Emit stats to parent component
    emit('data-loaded', apiStats);

    await nextTick();
    renderChart();
  } catch (err) {
    console.error('Error loading history data:', err);
    error.value = 'Kon historische data niet ophalen';
  } finally {
    loading.value = false;
  }
};

const renderChart = () => {
  if (!chartCanvas.value || chartData.value.length === 0) return;
  if (chartInstance.value) chartInstance.value.destroy();

  const ctx = chartCanvas.value.getContext('2d');
  
  // Lees de actieve CSS-variabelen van het huidige thema
  const style = getComputedStyle(document.documentElement);
  const colorSolar   = style.getPropertyValue('--chart-solar').trim()   || '#636B2F';
  const colorGrid    = style.getPropertyValue('--chart-grid').trim()    || '#4A6B82';
  const colorBattery = style.getPropertyValue('--chart-battery').trim() || '#C87D55';
  const colorYield   = style.getPropertyValue('--chart-yield').trim()   || '#D4A359';
  const colorAxis    = style.getPropertyValue('--chart-axis').trim()    || '#857A6D';

  const isRangeData = ['last-7-days', 'last-30-days', 'last-365-days'].includes(props.period);
  // Calculate min/max to align zero lines.
  // Range mode (30d / year bars) uses summed kWh fields; intraday uses instantaneous power.
  const powerValues = isRangeData ? chartData.value.flatMap(d => [
    d.solar || 0,
    d.home || 0,
    d.grid_import || 0,
    d.grid_export || 0,
    d.battery_net || 0
  ]) : chartData.value.flatMap(d => [
    d.solar || 0,
    d.home || 0,
    d.grid || 0,
    d.battery_power || 0
  ]);
  const minPower = Math.min(...powerValues, 0);
  const maxPower = Math.max(...powerValues, 0);
  
  // Calculate range for y-axis (power)
  const powerRange = Math.max(Math.abs(minPower), Math.abs(maxPower));
  // Add 15% padding above and below the power range so lines never touch the edges
  const PAD = 0.15;
  const yMax =  Math.ceil( powerRange * (1 + PAD));
  const yMin = minPower < 0 ? -Math.ceil(powerRange * (1 + PAD)) : 0;

  // SoC axis (y1) must share the same zero line as the power axis (y).
  // We extend it beyond 0–100 proportionally so 100% SoC never hits the top
  // and 0% never hits the bottom.  The ratio yMax/yMin maps power → SoC space.
  //
  // Visual chart height represents (yMax - yMin) units.
  // We want SoC 0-100 to occupy the same fraction as power 0-yMax,
  // then add the same proportional padding above 100 and below 0.
  const y1Max = Math.ceil(100 * (yMax / powerRange) * (1 + PAD));
  const y1Min = yMin === 0 ? 0 : -Math.ceil(100 * (Math.abs(yMin) / powerRange) * (1 + PAD));
  
  // Format labels: time for single-day view, date for multi-day view.
  // Intraday uses plain HH:MM (ASCII colon, zero-padded) so the tick callback
  // can reliably split on ':' regardless of locale.
  const labels = chartData.value.map(d => {
    if (props.period === 'today' || props.period === 'date') {
      // Intraday: parse timestamp normally
      const dt = new Date(d.timestamp);
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(dt.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    }
    // Multi-day: d.date is 'YYYY-MM-DD' — parse as local date to avoid UTC shift
    const [y, m, day] = (d.date || d.timestamp?.slice(0, 10) || '').split('-');
    return `${day}/${m}`;
  });

  chartInstance.value = new Chart(ctx, {
    type: (isRangeData || props.mode === 'bar') ? 'bar' : 'line',
    data: {
      labels,
      datasets: isRangeData ? [
        {
          label: 'Solar (kWh)',
          data: chartData.value.map(d => d.solar || 0),
          backgroundColor: colorSolar,
          borderRadius: 2, borderSkipped: false, yAxisID: 'y'
        },
        {
          label: 'Home (kWh)',
          data: chartData.value.map(d => d.home || 0),
          backgroundColor: colorYield,
          borderRadius: 2, borderSkipped: false, yAxisID: 'y'
        },
        {
          label: 'Grid Import (kWh)',
          data: chartData.value.map(d => d.grid_import || 0),
          backgroundColor: colorGrid,
          borderRadius: 2, borderSkipped: false, yAxisID: 'y'
        },
        {
          label: 'Grid Export (kWh)',
          data: chartData.value.map(d => d.grid_export || 0),
          backgroundColor: colorGrid,
          borderRadius: 2, borderSkipped: false, yAxisID: 'y'
        },
        {
          label: 'Battery (net kWh)',
          data: chartData.value.map(d => d.battery_net || 0),
          backgroundColor: colorBattery,
          borderRadius: 2, borderSkipped: false, yAxisID: 'y'
        }
      ] : props.mode === 'bar' ? [
        {
          label: 'Solar',
          data: chartData.value.map(d => d.solar ?? null),
          backgroundColor: colorSolar,
          stack: 'pos', yAxisID: 'y', borderRadius: 1, borderSkipped: false,
        },
        {
          label: 'Battery discharge',
          data: chartData.value.map(d => (d.battery_power > 0 ? d.battery_power : 0)),
          backgroundColor: colorBattery,
          stack: 'pos', yAxisID: 'y', borderRadius: 1, borderSkipped: false,
        },
        {
          label: 'Home',
          data: chartData.value.map(d => (d.home ? -d.home : null)),
          backgroundColor: colorYield,
          stack: 'neg', yAxisID: 'y', borderRadius: 1, borderSkipped: false,
        },
        {
          label: 'Grid',
          data: chartData.value.map(d => (d.grid ? -d.grid : null)),
          backgroundColor: colorGrid,
          stack: 'neg', yAxisID: 'y', borderRadius: 1, borderSkipped: false,
        },
        {
          label: 'Battery charge',
          data: chartData.value.map(d => (d.battery_power < 0 ? d.battery_power : 0)),
          backgroundColor: colorBattery,
          stack: 'neg', yAxisID: 'y', borderRadius: 1, borderSkipped: false,
        },
        {
          label: 'SoC',
          data: chartData.value.map(d => d.battery_soc || 0),
          type: 'line', borderColor: colorAxis, fill: false, yAxisID: 'y1',
          borderDash: [6, 3], tension: 0.4, pointRadius: 0, borderWidth: 1.5,
        },
      ] : [
        // Desktop line mode
        {
          label: 'SoC',
          data: chartData.value.map(d => d.battery_soc || 0),
          borderColor: colorAxis,
          fill: false, yAxisID: 'y1', borderDash: [10, 3], tension: 0.4, pointRadius: 0, borderWidth: 1
        },
        {
          label: 'Solar',
          data: chartData.value.map(d => d.solar || 0),
          borderColor: colorSolar,
          backgroundColor: colorSolar + '1A', // 10% opacity hex suffix
          fill: true, tension: 0.4, yAxisID: 'y', pointRadius: 0, borderWidth: 1.5
        },
        {
          label: 'Home',
          data: chartData.value.map(d => d.home || 0),
          borderColor: colorYield,
          backgroundColor: colorYield + '1A',
          fill: false, tension: 0.4, yAxisID: 'y', pointRadius: 0, borderWidth: 1.5
        },
        {
          label: 'Grid',
          data: chartData.value.map(d => d.grid || 0),
          borderColor: colorGrid,
          backgroundColor: colorGrid + '1A',
          fill: false, tension: 0.4, yAxisID: 'y', pointRadius: 0, borderWidth: 1.5
        },
        {
          label: 'Battery',
          data: chartData.value.map(d => d.battery_power || 0),
          borderColor: colorBattery,
          backgroundColor: colorBattery + '1A',
          fill: true, tension: 0.4, yAxisID: 'y', pointRadius: 0, borderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
              layout: {
            padding: 0
        },
      plugins: {
        legend: { 
          display: false
        },
        tooltip: {
          enabled: false,
          external: (context) => {
            const el = tooltipEl.value;
            if (!el) return;

            const { tooltip } = context;

            if (tooltip.opacity === 0) {
              el.style.display = 'none';
              return;
            }

            // Always show date + time in tooltip regardless of view mode
            const dp0 = tooltip.dataPoints?.[0];
            const rawIdx = dp0?.dataIndex ?? 0;
            const rawEntry = chartData.value[rawIdx];
            let title = tooltip.title?.[0] ?? '';
            if (rawEntry) {
              const ts = rawEntry.timestamp || (rawEntry.date + 'T00:00:00');
              const dt = new Date(ts);
              const dd = String(dt.getDate()).padStart(2, '0');
              const mo = String(dt.getMonth() + 1).padStart(2, '0');
              if (rawEntry.timestamp) {
                const hh = String(dt.getHours()).padStart(2, '0');
                const mm = String(dt.getMinutes()).padStart(2, '0');
                title = `${dd}/${mo} ${hh}:${mm}`;
              } else {
                // Range mode: no time component (day or week-start), skip 00:00
                title = props.period === 'last-365-days' ? `Week of ${dd}/${mo}` : `${dd}/${mo}`;
              }
            }
            const rows = tooltip.dataPoints.map(dp => {
              const ds = dp.dataset;
              const isSoC = ds.yAxisID === 'y1';
              const value = isSoC
                ? dp.parsed.y.toFixed(1) + '%'
                : isRangeData
                  ? dp.parsed.y.toFixed(1) + ' kWh'
                  : dp.parsed.y.toFixed(0) + ' W';
              const color = ds.borderColor || ds.backgroundColor;
              const isDash = Array.isArray(ds.borderDash) && ds.borderDash.length > 0;
              const icon = isDash
                ? `<span style="display:inline-block;width:14px;height:2px;border-top:2px dashed ${color};vertical-align:middle;flex-shrink:0;"></span>`
                : `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>`;
              return `
                <div style="display:flex;align-items:center;gap:8px;padding:2px 0;">
                  ${icon}
                  <span style="flex:1;font-size:13px;color:#6b7280;">${ds.label}</span>
                  <span style="font-size:13px;font-weight:600;color:#111827;font-variant-numeric:tabular-nums;">${value}</span>
                </div>`;
            }).join('');

            el.innerHTML = `
              <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">${title}</div>
              ${rows}`;
            el.style.display = 'block';

            // Position relative to chart container
            const chartEl = context.chart.canvas;
            const containerWidth = chartEl.parentElement.offsetWidth;
            let left = tooltip.caretX + 14;
            if (left + 185 > containerWidth) left = tooltip.caretX - 185 - 14;
            el.style.left = left + 'px';
            el.style.top  = Math.max(0, tooltip.caretY - (el.offsetHeight / 2)) + 'px';
          }
        }
      },
      scales: {
        y: {
          type: 'linear',
          display: true,  // Changed from false to true
          position: 'left',
          padding: { top: 40, bottom: 10 },
          min: yMin,
          max: yMax,
          title: { 
            display: false  // Hide the "Vermogen (W)" title for cleaner look
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
              return context.tick.value === 0 ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0)';
            },
            lineWidth: (context) => {
              return context.tick.value === 0 ? 2 : 0;
            },
            drawTicks: false
          },
          border: {
            display: false
          }
        },
        y1: {
          type: 'linear',
          display: false,
          padding: {top: 40, bottom: 10},
          position: 'right',
          min: y1Min,
          max: y1Max, // Add some padding above 100% for better visualization
          grid: { drawOnChartArea: true }
        },
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
              return label !== prevLabel ? 'rgba(0, 0, 0, 0.10)' : 'transparent';
            },
            drawTicks: false,
            tickLength: 0
          },
          border: {
            display: false
          }
        }
      }
    }
  });
};

watch(() => [props.period, props.date, props.granularity, props.mode], loadData);

onMounted(loadData);

onUnmounted(() => {
  if (chartInstance.value) chartInstance.value.destroy();
});
</script>

<style scoped>
.energy-flow-graph-container    {display: flex;flex-direction: column;width: 100%;overflow: hidden;}
/* ── HTML Tooltip ─────────────────────────────── */
.chart-html-tooltip             { position: absolute;pointer-events: none;background: #ffffff;border: 1px solid #e4e7ec;border-radius: 10px;padding: 10px 14px;box-shadow: 0 4px 16px rgba(0,0,0,.08);min-width: 170px;z-index: 100;}
.tt-title                       { font-size: 13px;font-weight: 600;color: #374151;margin-bottom: 8px;}
.tt-row                         { display: flex;align-items: center;gap: 8px;padding: 2px 0;}
.tt-icon                        { flex-shrink: 0;}
.tt-dot                         { display: inline-block;width: 8px; height: 8px;border-radius: 50%;margin-right:0.5rem;}
.tt-dash                        { display: inline-block;width: 14px; height: 0;border-top: 2px dashed;margin-bottom: 1px;}
.tt-label                       { flex: 1;font-size: 13px;color: #6b7280;}
.tt-value                       { font-size: 13px;font-weight: 600;color: #111827;text-align: right;font-variant-numeric: tabular-nums;}

.stat-card.solar .tt-dot        { background-color: var(--chart-solar); }
.stat-card.home .tt-dot         { background-color: var(--chart-yield); }
.stat-card.grid .tt-dot         { background-color: var(--chart-grid); }
.stat-card.battery .tt-dot      { background-color: var(--chart-battery); }
.energy-flow-graph              { width: 100%;position: relative;height: v-bind(height);}
.loading-state, .error-state    { display: flex;flex-direction: column;align-items: center;justify-content: center;height: 100%;gap: 12px;font-family: 'Rubik', sans-serif;}
.loading-state span             { color: var(--color-text-secondary, #6b7280);font-size: 14px;}
.error-state span               { color: #ef4444;font-size: 14px;text-align: center;}
.retry-btn                      { padding: 10px 20px;background: var(--color-text-primary, #111827);color: var(--color-bg-primary, #ffffff);border: none;border-radius: var(--radius-sm);cursor: pointer;font-family: 'Rubik', sans-serif;font-size: 14px;font-weight: 500;transition: all 0.2s ease;}
.retry-btn:hover                { opacity: 0.9;transform: translateY(-1px);}
.retry-btn:active               { transform: translateY(0);}

@media (max-width: 768px) {
  .stats-overview       {grid-template-columns: repeat(2, 1fr);}
  .energy-flow-graph    {padding: 12px;}
  .stat-card            {padding: 16px;}
  .stat-card .value     {font-size: 18px;}
}
</style>