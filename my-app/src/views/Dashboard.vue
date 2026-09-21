<template>
  <div class="lg:grid lg:grid-cols-5 lg:gap-6 lg:p-6 p-2 overflow-hidden text-primary">
    <!-- ── Left: hero + chart ──────────────────────────────────────────────── -->
    <div class="hero-card lg:col-span-3  overflow-hidden " >

      <!-- Five gauges: Solar · Home · Battery | Export · Import
           Each gauge is an EnergyFlowDiagram node with a level arc, filled
           against its own reference scale (see solarLevel / homeLevel /
           exportLevel / importLevel below). The net label spans cols 4-5. -->
      <div class="mb-2 border border-secondary-100 rounded-xl p-6 bg-card">

        <!-- Row 1 — gauges -->
        <div class="grid grid-cols-5 gap-x-3">
          <EnergyGauge
            series="solar" 
            icon="ph-light ph-sun"
            :level="solarLevel"
            :value="todaySolar.toFixed(1)"
            unit="kWh"
            :label="t('control.solar')"
          />
          <EnergyGauge
            series="home"
            icon="ph-light ph-house"
            :level="homeLevel"
            :value="todayLoad.toFixed(1)"
            unit="kWh"
            :label="t('dashboard.home')"
          />
          <EnergyGauge
            series="battery"
            icon="ph-light ph-battery-charging"
            :level="currentBatterySOC"
            :value="currentBatterySOC"
            unit="%"
            :label="t('dashboard.batteryLabel')"
          />
          <EnergyGauge
            series="export"
            icon="ph-light ph-arrow-up"
            :level="exportLevel"
            :value="gridExportKwh.toFixed(1)"
            unit="kWh"
            label="export"
          />
          <EnergyGauge
            series="import"
            icon="ph-light ph-arrow-down"
            :level="importLevel"
            :value="gridImportKwh.toFixed(1)"
            unit="kWh"
            label="import"
          />
        </div>

        <!-- Row 2 — sub-labels (scale reference / status) -->
        <div class="grid grid-cols-5 mt-1">
          <div class="text-center text-sm text-secondary-400 leading-tight">
            <template v-if="solarScale !== null">{{ solarScaleLabel }} {{ solarScale.toFixed(1) }}<span v-if="solarOverAvg"> ↑+{{ solarOver.toFixed(1) }}</span></template>
            <template v-else>no forecast</template>
          </div>
          <div class="text-center text-sm text-secondary-400 leading-tight">
            <template v-if="avgLoad !== null">avg {{ avgLoad.toFixed(1) }}<span v-if="loadOverAvg"> ↑+{{ loadOver.toFixed(1) }}</span></template>
            <template v-else>no avg yet</template>
          </div>
          <div class="text-center text-sm text-secondary-400 leading-tight">{{ battStatusText }}</div>
          <div class="text-center text-sm text-secondary-400 leading-tight">
            export<template v-if="avgGridExport !== null"> · avg {{ avgGridExport.toFixed(1) }}</template>
          </div>
          <div class="text-center text-sm text-secondary-400 leading-tight">
            import<template v-if="avgGridImport !== null"> · avg {{ avgGridImport.toFixed(1) }}</template>
          </div>
        </div>

        <!-- Row 3 — net label spanning export+import columns -->
        <div class="grid grid-cols-5 mt-1">
          <div class="col-span-3"></div>
          <div class="col-span-2 text-center text-sm text-secondary-400 whitespace-nowrap">
            Net <span class="font-medium text-primary">{{ gridNetLabel }}</span> {{ gridNetDirection }}
          </div>
        </div>

      </div>
      <!-- ── Forecast + Plan ahead ──────────────────────────────────────── -->
      <div class="mt-2 border border-secondary-100 rounded-xl grid grid-cols-4 grid-locked p-6 bg-card mt-6">

        <!-- Forecast strip: today / tomorrow -->
        <div class="flex items-center gap-8 mb-6">
          <div v-for="(day, idx) in forecastDisplay" :key="day.date || idx"
               class="text-center min-w-[60px]">
            <div class="text-sm font-medium lowercase tracking-widest text-secondary-500 mb-2">
              {{ formatForecastLabel(day.date, idx) }}
            </div>
            <div class="flex justify-center mb-1">
              <i :class="forecastIconClass(day)" class="text-3xl"></i>
            </div>
            <div class="text-base font-bold tracking-tight"
                 :class="day.expectedKwh === null ? 'text-secondary-400' : ''">
              <template v-if="day.expectedKwh !== null">
                {{ Math.round(day.expectedKwh) }}<span class="text-xs font-medium text-secondary-400 ml-0.5">kWh</span>
              </template>
              <template v-else>—</template>
            </div>
          </div>
        </div>

        <!-- Plan ahead -->
        <div class="grid col-span-3 gap-4">
          <div class="text-sm leading-relaxed">
            <div class="text-sm font-medium lowercase tracking-widest text-secondary-500 mb-2">{{ t('dashboard.activeStrategy') }}</div>
            <div class="font-semibold mb-1">{{ strategyStore.activeStrategy?.name }}</div>
            <div class="text-secondary-500">{{ strategyStore.activeStrategy?.description }}</div>
            <div v-if="strategyStore.decision?.action && strategyStore.decision.action !== 'IDLE'"
                 class="mt-3 pt-3 border-t border-secondary-200 font-medium">
              {{ strategyStore.decision.reason }}
            </div>
          </div>
        </div>
      </div>

      <!-- Chart toggle — mobile only -->
      <button class="chart-toggle-text" @click="showChart = !showChart">
        <i :class="showChart ? 'ph-light ph-caret-up' : 'ph-light ph-caret-down'"></i>
        {{ showChart ? t('dashboard.hideChart') : t('dashboard.showChart') }}
      </button>

      <!-- Date nav + chart -->
      <div v-show="showChart" class="mt-2 mb-6 border border-secondary-100 rounded-xl p-6 bg-card lg:mt-6">
        <div class="date-nav mb-4">
          <button class="date-btn" @click="goToPrevDay"><i class="ph-light ph-caret-left"></i></button>
          <span class="date-label">{{ selectedDateLabel }}</span>
          <button class="date-btn" :class="{ disabled: isToday }" @click="goToNextDay"><i class="ph-light ph-caret-right"></i></button>
        </div>
        <EnergyFlowGraph
          :period="graphPeriod"
          :date="graphDate"
          :auto-update="isToday"
          :height="isMobile ? '220px' : '200px'"
          :granularity="isMobile ? 30 : 15"
          :mode="isMobile ? 'bar' : 'line'"
        />
        <!--<DashboardGraph
          :date="graphDate"
          :auto-update="isToday"
          height="200px"
        /> -->

      </div>

    </div>

    <!-- ── Right: power cards ──────────────────────────────────────────────── -->
     <div class="right-section flex flex-col lg:col-span-2 " >
       <div class="flex flex-col bg-card rounded-xl border border-secondary-100 overflow-hidden">
        <!-- Panel switcher pill -->
        <div class="panel-switcher-wrap">
          <div class="panel-switcher">
            <button
              class="switcher-btn"
              :class="{ active: panelView === 'list' }"
              @click="setPanelView('list')"
              :title="t('dashboard.viewList')"
            >
              <i class="ph-light ph-list-bullets"></i>
            </button>
            <div class="switcher-sep"></div>
            <button
              class="switcher-btn"
              :class="{ active: panelView === 'flow' }"
              @click="setPanelView('flow')"
              :title="t('dashboard.viewFlow')"
            >
              <i class="ph-light ph-graph"></i>
            </button>
          </div>
        </div>
  
        <!-- Swappable panel -->
        <div class="flex-1 overflow-y-auto">
          <transition
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="opacity-0"
            leave-active-class="transition duration-150 ease-in"
            leave-to-class="opacity-0"
            mode="out-in"
          >
            <DashboardPowerList v-if="panelView === 'list'" key="list" />
            <EnergyFlowDiagram  v-else                      key="flow" />
          </transition>
        </div>  
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useRealtimeStore } from '../stores/realtime';
import { useStrategyStore } from '@/stores/strategy';
import { useLocale } from '../composables/useLocale';
import apiClient from '@/services/api';

// Components
import EnergyFlowGraph      from '@/components/common/EnergyFlowGraph.vue';
import SmartDeviceFlowGraph from '@/components/common/SmartDeviceFlowGraph.vue';
import SmartDeviceList      from '@/components/SmartDeviceList.vue';
import DashboardGraph       from '@/components/common/DashboardGraph.vue';
import DashboardPowerList from '@/components/common/DashboardPowerList.vue';
import EnergyFlowDiagram  from '@/components/common/EnergyFlowDiagram.vue';
import EnergyGauge        from '@/components/common/EnergyGauge.vue';

const router = useRouter();
const realtimeStore = useRealtimeStore();
const strategyStore = useStrategyStore();
const { t, formatLocaleEnergy, formatLocalePower } = useLocale();

console.log('Dashboard step 1 loaded');

// ── Gauge computeds ────────────────────────────────────────────────────────
// Today's kWh totals
const todaySolar = computed(() => parseFloat(realtimeStore.summaryData.today_pv_gen) || 0);
const todayLoad  = computed(() => parseFloat(realtimeStore.summaryData.today_load)   || 0);

// Solar scale: forecast preferred → 14-day average → null
const solarForecast   = computed(() => {
  const kwh = realtimeStore.forecast?.[0]?.expectedKwh;
  return kwh !== null && kwh !== undefined ? parseFloat(kwh) : null;
});
const solarScale      = computed(() => solarForecast.value ?? realtimeStore.averages?.avg_solar_14d ?? null);
const solarScaleLabel = computed(() => solarForecast.value !== null ? 'forecast' : 'avg');
const avgLoad         = computed(() => realtimeStore.averages?.avg_load_14d ?? null);

const solarOverAvg = computed(() => solarScale.value !== null && todaySolar.value > solarScale.value);
const solarOver    = computed(() => solarOverAvg.value ? todaySolar.value - (solarScale.value ?? 0) : 0);
const loadOverAvg  = computed(() => avgLoad.value !== null && todayLoad.value > avgLoad.value);
const loadOver     = computed(() => loadOverAvg.value ? todayLoad.value - (avgLoad.value ?? 0) : 0);

// Grid today
const gridExportKwh = computed(() => parseFloat(realtimeStore.summaryData?.today_grid_export) || 0);
const gridImportKwh = computed(() => parseFloat(realtimeStore.summaryData?.today_grid_import) || 0);

const avgGridExport = computed(() => realtimeStore.averages?.avg_grid_export_14d ?? null);
const avgGridImport = computed(() => realtimeStore.averages?.avg_grid_import_14d ?? null);

// Each gauge is measured against its own reference — the same one printed in
// the caption underneath it. No reference available yet → null → only the
// track renders, rather than inventing a fraction. (The previous ring gauges
// divided solar and home by a shared mainMax, which pinned whichever was
// largest to 100% regardless of the caption.)
const pctOf = (value, scale) => {
  if (scale === null || scale === undefined || scale <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((value / scale) * 100)));
};

const solarLevel  = computed(() => pctOf(todaySolar.value,    solarScale.value));
const homeLevel   = computed(() => pctOf(todayLoad.value,     avgLoad.value));
const exportLevel = computed(() => pctOf(gridExportKwh.value, avgGridExport.value));
const importLevel = computed(() => pctOf(gridImportKwh.value, avgGridImport.value));

const gridNetKwh       = computed(() => gridExportKwh.value - gridImportKwh.value);
const gridNetLabel     = computed(() => {
  const val = Math.abs(gridNetKwh.value);
  return val >= 1 ? `${val.toFixed(1)} kWh` : `${Math.round(val * 1000)} Wh`;
});
const gridNetDirection = computed(() => gridNetKwh.value >= 0 ? 'to grid' : 'from grid');
// ── End gauge computeds ────────────────────────────────────────────────────
const strategyDecision = computed(() => realtimeStore.strategyDecision);
const decisionAge = computed(() => {
  const d = strategyDecision.value;
  if (!d?.evaluatedAt) return '';
  const evaluated = new Date(d.evaluatedAt);
  const diffMin   = Math.round((Date.now() - evaluated.getTime()) / 60000);
  if (diffMin < 2)  return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.round(diffMin / 60)}h ago`;
});

// Shorten reason to first sentence — split on '. ' not on decimal points
const strategyDecisionShort = computed(() => {
  const reason = strategyDecision.value?.reason;
  if (!reason) return '';
  // Split on '. ' followed by capital letter to avoid splitting on decimals like "6.0"
  const match = reason.match(/^(.*?\.\s)(?=[A-Z])/);
  const first = match ? match[1].trim() : reason.split('. ')[0];
  return first.length > 80 ? first.slice(0, 77) + '…' : first;
});

const battStatusText = computed(() => {
  const b     = realtimeStore.realtimeData?.components?.battery_1;
  const power = b ? (b.currentIn || 0) - (b.currentOut || 0) : 0;
  const absW  = Math.abs(power);
  const fmt   = absW >= 1000 ? `${(absW / 1000).toFixed(2)} kW` : `${Math.round(absW)} W`;
  if (power < -50) return `${t('status.charging')} · ${fmt}`;
  if (power > 50)  return `${t('status.discharging')} · ${fmt}`;
  const soc = realtimeStore.realtimeData?.batterySOC || 0;
  return soc >= 95 ? 'Full' : soc <= 5 ? 'Empty' : t('status.idle');
});

// PERIOD LOGIC: EXACTLY AS PER YOUR CODE
const periods = [
  { value: 'day',   label: t('dashboard.periodDay')   },
  { value: 'week',  label: t('dashboard.periodWeek')  },
  { value: 'month', label: t('dashboard.periodMonth') },
  { value: 'year',  label: t('dashboard.periodYear')  },
];
const activePeriod = ref('day');

// Date navigation
const selectedDate = ref(new Date());

const isToday = computed(() => {
  const today = new Date();
  const d = selectedDate.value;
  return d.getFullYear() === today.getFullYear() &&
         d.getMonth()    === today.getMonth()    &&
         d.getDate()     === today.getDate();
});

const selectedDateLabel = computed(() => {
  const d = selectedDate.value;
  const formatted = d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
  if (isToday.value) return 'Vandaag, ' + formatted;
  return d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
});

const goToPrevDay = () => {
  const d = new Date(selectedDate.value);
  d.setDate(d.getDate() - 1);
  selectedDate.value = d;
};

const goToNextDay = () => {
  if (isToday.value) return;
  const d = new Date(selectedDate.value);
  d.setDate(d.getDate() + 1);
  selectedDate.value = d;
};

console.log('Dashboard step 2 loaded');
const graphPeriod = computed(() => isToday.value ? 'today' : 'date');

// Timezone-safe date string — avoids toISOString() which returns UTC and can
// produce the wrong date after midnight CET (UTC+2).
const graphDate = computed(() => {
  const d = selectedDate.value;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});

// REAL-TIME COMPUTEDS: STRICTLY FROM YOUR DASHBOARD.VUE
const currentBatterySOC = computed(() => {
  return Math.round(realtimeStore.realtimeData?.batterySOC || 0);
});

const currentBatteryPower = computed(() => {
  const components = realtimeStore.realtimeData?.components;
  if (components?.battery_1) {
    return (components.battery_1.currentIn || 0) - (components.battery_1.currentOut || 0);
  }
  return 0;
});

const currentSolarPower = computed(() => {
  return realtimeStore.realtimeData?.components?.solar?.currentOut || 0;
});

const currentGridPower = computed(() => {
  const grid = realtimeStore.realtimeData?.components?.grid;
  if (grid) {
    return (grid.currentIn || 0) - (grid.currentOut || 0);
  }
  return 0;
});

const currentHomePower = computed(() => {
  return realtimeStore.realtimeData?.components?.home_usage?.currentIn || 0;
});

const batteryStatus = computed(() => {
  const power = currentBatteryPower.value;
  if (power > 50)  return t('status.discharging');
  if (power < -50) return t('status.charging');
  return t('status.idle');
});

// 'charging' | 'discharging' | 'idle' — drives BatteryIcon animation
const batteryStatusKey = computed(() => {
  const power = currentBatteryPower.value;
  if (power < -50) return 'charging';
  if (power > 50)  return 'discharging';
  return 'idle';
});

// Subtle color on the status label text
const batteryStatusClass = computed(() => {
  switch (batteryStatusKey.value) {
    case 'charging':    return 'text-green-600';
    case 'discharging': return 'text-orange-500';
    default:            return 'text-secondary-500';
  }
});

const gridDirection = computed(() => {
  const power = currentGridPower.value;
  if (power > 50)  return t('status.importing');
  if (power < -50) return t('status.exporting');
  return t('status.idle');
});

// 'importing' | 'exporting' | 'idle' — drives GridIcon animation
const gridStatusKey = computed(() => {
  const power = currentGridPower.value;
  if (power > 50)  return 'importing';
  if (power < -50) return 'exporting';
  return 'idle';
});

// Subtle color on the status label text
const gridStatusClass = computed(() => {
  switch (gridStatusKey.value) {
    case 'importing': return 'text-orange-500';
    case 'exporting': return 'text-green-600';
    default:          return 'text-secondary-500';
  }
});

console.log('Dashboard step 3 loaded');
// FUNCTIONS: EXACTLY AS PER YOUR CODE
const showSocketsList = ref(false);
const toggleSocketsList = () => {
  showSocketsList.value = !showSocketsList.value;
};

const onSocketSelected = (socket) => {
  console.log('Socket selected:', socket);
};

const formatPowerValue = (watts) => {
  if (Math.abs(watts) >= 1000) {
    return `${(watts / 1000).toFixed(2)} kW`;
  }
  return `${Math.round(watts)} W`;
};

console.log('Dashboard step 4 loaded');
// ── Strategy card computeds ────────────────────────────────────────────────
// Current mode label from latest decision (e.g. 'charge', 'hold', 'discharge')
const strategyCurrentMode = computed(() => strategyStore.decision?.action ?? '—');

// Next upcoming slot action from the day plan.
// slot.action is a camelCase key (e.g. 'smartEco') — resolve via i18n if possible.
const strategyNextAction = computed(() => {
  const now = new Date();
  const plan = Array.isArray(strategyStore.dayPlan) ? strategyStore.dayPlan : [];
  const next = plan.find(slot => new Date(slot.start) > now);
  if (!next?.action) return null;
  const key = `control.strategy.${next.action}.name`;
  const resolved = t(key);
  // vue-i18n returns the key itself when missing — fall back to raw action string
  return resolved !== key ? resolved : next.action;
});

// Color the mode label to match battery/grid conventions
const strategyModeClass = computed(() => {
  switch (strategyStore.decision?.action) {
    case 'charge':    return 'text-green-600';
    case 'discharge': return 'text-orange-500';
    default:          return 'text-secondary-500';
  }
});

console.log('Dashboard step 5 loaded');
console.log('Dashboard step 6 loaded');
// ── Forecast + Plan ahead ─────────────────────────────────────────────────
const forecast = computed(() => realtimeStore.forecast);
const advisory = computed(() => realtimeStore.advisory);

const forecastDisplay = computed(() => {
  const days = Array.isArray(forecast.value) ? forecast.value : [];
  const padded = [...days];
  while (padded.length < 2) {
    padded.push({ date: '', condition: 'unknown', expectedKwh: null });
  }
  return padded.slice(0, 2);
});

function formatForecastLabel(dateStr, idx) {
  if (idx === 0) return t('dashboard.forecastToday');
  if (idx === 1) return t('dashboard.forecastTomorrow');
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

function forecastIconClass(day) {
  if (day.expectedKwh === null) return 'ph-light ph-cloud text-secondary-400';
  if (day.expectedKwh >= 18)    return 'ph-light ph-sun text-amber-500';
  if (day.expectedKwh >= 10)    return 'ph-light ph-cloud-sun text-amber-400';
  return 'ph-light ph-cloud text-secondary-400';
}

const isAdvisoryStub = computed(() =>
  !advisory.value || advisory.value.id === 'idle-default' || !advisory.value.headline
);

const advisoryCalloutClass = computed(() => {
  switch (advisory.value?.tone) {
    case 'positive':  return 'bg-emerald-50 text-emerald-800';
    case 'warning':   return 'bg-amber-50 text-amber-800';
    case 'critical':  return 'bg-rose-50 text-rose-800';
    default:          return 'bg-secondary-100 text-secondary-500';
  }
});
// ── TIME & LIFECYCLE ───────────────────────────────────────────────────────
const currentTime = ref('');
const updateCurrentTime = () => {
  const now = new Date();
  currentTime.value = now.toLocaleTimeString('nl-NL', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
};

// ── Dashboard panel view preference ───────────────────────────────────────
const panelView = ref('list'); // default until setting loads

// Chart visibility — collapsed by default on mobile, always shown on desktop
const showChart = ref(false);

// Mobile detection — used for chart mode and granularity
const isMobile = ref(false);
const checkMobile = () => { isMobile.value = window.innerWidth < 1024; };

const loadPanelView = async () => {
  try {
    const res = await apiClient.get('/settings/ui/dashboard-panel-view');
    if (res.data?.value === 'flow') panelView.value = 'flow';
  } catch {
    // setting not yet in DB — stay on default 'list'
  }
};
 
const setPanelView = async (view) => {
  panelView.value = view;
  try {
    await apiClient.put('/settings/ui/dashboard-panel-view', { value: view });
  } catch (e) {
    console.warn('Could not persist panel view preference:', e.message);
  }
};

// fetchStatus polling is handled globally in App.vue — no duplicate interval here.
let timeInterval = null;

onMounted(() => {
  checkMobile();
  if (!isMobile.value) showChart.value = true;
  window.addEventListener('resize', checkMobile);
  updateCurrentTime();
  timeInterval = setInterval(updateCurrentTime, 1000);
  strategyStore.fetchActive();
  loadPanelView();
});

onUnmounted(() => {
  if (timeInterval) clearInterval(timeInterval);
  window.removeEventListener('resize', checkMobile);
  // stopPolling() removed — polling ownership belongs to App.vue
});
</script>

<style lang="css" scoped>
/* ── Chart toggle text (mobile only) ─────────────────────────────────── */
.chart-toggle-text            { display: flex;align-items: center;justify-content: center;gap: 0.3rem;width: 100%;padding: 0.4rem 0;font-size: 11px;color: var(--color-text-tertiary);background: none;border: none;cursor: pointer;letter-spacing: 0.04em; }
.chart-toggle-text:hover      { color: var(--color-text-secondary); }
@media (min-width: 1024px) { 
  .chart-toggle-text          { display: none; } 
}
@media (min-width: 769px) { 
  .grid-cols-4.grid-locked    { grid-template-columns: repeat(4, 1fr); }
  .grid-cols-3.grid-locked    { grid-template-columns: repeat(3, 1fr); }
  .grid-cols-2.grid-locked    { grid-template-columns: repeat(2, 1fr); }  
}
/* Strategy text inline to the right of the battery gauge */

@media (max-width: 768px) {
  .hero-value                 { font-size: 3rem; }
  .hero-card                  { height: auto; }
  .grid-cols-4.grid-locked    { grid-template-columns: repeat(4, 1fr); }
  .grid-cols-3.grid-locked    { grid-template-columns: repeat(3, 1fr); }
  .grid-cols-2.grid-locked    { grid-template-columns: repeat(2, 1fr); }
}
.battery-strategy-inline {gap: 0.3rem;font-size: 11px;color: var(--color-text-secondary, #6b7280);line-height: 1.45;}
/* Power card layout — shared by all 5 cards in the right column */
.power-card                   { display: flex;align-items: center;gap: 1rem;padding: 1.25rem;position: relative;border-radius: var(--radius-md);border : var(--border-width) solid var(--color-secondary-200);margin-bottom: 1rem;}
/* ── Date navigation ──────────────────────────────────────────────── */
.date-nav                     { display: inline-flex;align-items: center;background: var(--color-surface);overflow: hidden;}
.date-btn                     { width: 32px; height: 42px;display: flex; align-items: center; justify-content: center;background: none; border: none;font-size: 1rem;line-height: 1rem;color: var(--color-text-secondary);cursor: pointer; transition: background .12s;}
.date-btn:hover               { background: var(--color-secondary-subtle); }
.date-btn.disabled            { opacity: .3; cursor: default; pointer-events: none; }
.date-label                   { padding: 0 14px; height: 32px;display: flex; align-items: center;font-size: 13px; font-weight: 500;color: var(--color-text-primary);white-space: nowrap;}

/* ── Flow direction indicator ─────────────────────────────────────── */
.flow-track                   { position: relative; width: 2rem; height: 5px; background: transparent; border-radius: 999px; overflow: hidden; top: -1rem; }
.flow-track-placeholder       { width: 2rem; height: 5px; }
.flow-dot                     { position: absolute; top: 0; width: .5rem; height: 5px; border-radius: 999px; }

.flow-track.charging   .flow-dot,
.flow-track.exporting  .flow-dot  { background: #22c55e; animation: dot-ltr 1.4s ease-in-out infinite; }
.flow-track.discharging .flow-dot,
.flow-track.importing   .flow-dot { background: #f97316; animation: dot-rtl 1.4s ease-in-out infinite; }

/* ── Panel switcher pill ──────────────────────────────────────────────── */
.panel-switcher-wrap  { display: flex; justify-content: flex-end; padding: 0.75rem 1rem; }
.panel-switcher       { display: inline-flex; align-items: center; gap: 0; background: var(--color-secondary-100); border: var(--border-width) solid var(--color-secondary-200); border-radius: 999px; padding: 3px; }
.switcher-btn         { display: flex; align-items: center; justify-content: center; width: 2rem; height: 2rem; border: none; background: transparent; border-radius: 999px; color: var(--color-text-secondary); cursor: pointer; font-size: 1rem; transition: background .15s, color .15s; }
.switcher-btn:hover   { background: var(--color-secondary-400); color: var(--color-primary); }
.switcher-btn.active  { background: var(--card-bg-color); color: var(--color-secondary-800); box-shadow: 0 1px 3px rgba(0,0,0,.10); }
.switcher-sep         { width: 1px; height: 1.25rem; background: var(--color-secondary-200); margin: 0 2px; }
 

@keyframes dot-ltr {
  0%   { left: -8px;  opacity: 0; }
  15%  {               opacity: 1; }
  85%  {               opacity: 1; }
  100% { left: 100%;  opacity: 0; }
}
@keyframes dot-rtl {
  0%   { left: 100%;  opacity: 0; }
  15%  {               opacity: 1; }
  85%  {               opacity: 1; }
  100% { left: -8px;  opacity: 0; }
}
</style>