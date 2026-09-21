<!-- src/components/control/StrategyPanel.vue -->
<template>
  <div class="strategy-panel">

    <!-- ── Tab bar ─────────────────────────────────────────────────────────── -->
    <div class="tab-bar mb-6">
      <button
        v-for="tab in tabs" :key="tab.id"
        class="tab-btn"
        :class="{ 'tab-btn--active': activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        <i class="ph-light mr-1.5" :class="tab.icon"></i>
        {{ tab.label }}
      </button>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════════
         TAB 1 — STRATEGY
    ══════════════════════════════════════════════════════════════════════ -->
    <div v-if="activeTab === 'strategy'" class="strategy-tab">

      <!-- ── 1. TIMELINE ────────────────────────────────────────────────────── -->
      <div class="timeline-section ">
        <div class="timeline-header">
          <span class="section-label">
            <i class="ph-light ph-calendar-day mr-1.5"></i>
            {{ t('control.todaysPlan') }}
          </span>
          <span class="text-xs text-secondary-400">
            {{ t('control.hoverForDetails') }}
          </span>
        </div>
        <!-- Strategy chart: price bars, solar area, predicted SoC line -->
        <StrategyChart @chart-area="ca => chartInset = ca" />
        <!-- Total daily solar forecast -->
        <div class="solar-forecast-total" v-if="totalSolarKwh > 0">
          <i class="ph-light ph-sun-bright mr-1.5"></i>
          {{ t('control.totalSolarForecast') }}: <strong>{{ totalSolarKwh.toFixed(1) }} kWh</strong>
        </div>
        <!-- Battery depletion warning — persistent while predicted SoC at floor -->
        <div class="battery-depletion-warning" v-if="batteryDepletionSlot">
          <i class="ph-light ph-battery-warning mr-1.5"></i>
          {{ t('control.batteryDepletionWarning', {
            time: slotToTime(batteryDepletionSlot.slot),
            pct: batteryDepletionSlot.socFloorPct ?? 20
          }) }}
        </div>
        <!-- Blocks + ruler — inset matches chart inner area so ticks align -->
        <div class="timeline-wrap">
          <div class="timeline-inset"
            :style="{
              marginLeft:  chartInset.leftPct  + '%',
              marginRight: chartInset.rightPct + '%',
            }"
          >
            <div class="timeline-blocks">

            <!-- Continuous background track — always visible -->
            <div class="timeline-track"></div>
            <!-- Full-day IDLE fallback when no plan yet -->
            <div
              v-if="allTimelineBlocks.length === 0"
              class="timeline-block block--idle-full"
              @mouseenter="hoveredBlock = idleFallbackBlock"
              @mouseleave="hoveredBlock = null"
            >
              <i class="ph-light timeline-block__icon ph-minus"></i>
              <span class="timeline-block__time">{{ slotToTime(0) }}&ndash;{{ slotToTime(totalPlanSlots) }}</span>
            </div>

            <!-- All blocks: IDLE gaps + action blocks, filling the full 24h -->
            <div
              v-for="block in allTimelineBlocks" :key="block.startSlot + '-' + block.action"
              class="timeline-block"
              :class="[blockColorClass(block.action), { 'timeline-block--past': block.isPast }]"
              :style="{
                left:  slotToPercent(block.startSlot) + '%',
                width: slotToPercent(block.endSlot - block.startSlot + 1) + '%',
              }"
              @mouseenter="hoveredBlock = block"
              @mouseleave="hoveredBlock = null"
            >
              <i class="ph-light timeline-block__icon" :class="blockIcon(block.action)"></i>
              <span class="timeline-block__time">
                {{ slotToTime(block.startSlot) }}&ndash;{{ slotToTime(block.endSlot + 1) }}
              </span>
            </div>

            <div
              v-if="currentTimePercent >= 0"
              class="timeline-needle"
              :style="{ left: currentTimePercent + '%' }"
            ></div>
          </div>
          <div class="timeline-ruler">
            <div
              v-for="tick in rulerTicks" :key="tick.pct"
              class="ruler-mark"
              :class="{ 'ruler-mark--midnight': tick.isMidnight }"
              :style="{ left: tick.pct + '%' }"
            >
              <span class="ruler-label">{{ tick.label }}</span>
              <span v-if="tick.dateLabel" class="ruler-date-label">{{ tick.dateLabel }}</span>
            </div>
          </div>
        </div><!-- end timeline-inset -->
          <div class="timeline-info-line mt-8" :class="infoLineBorderClass"             
              :style="{
                marginLeft:  chartInset.leftPct  + '%',
                marginRight: chartInset.rightPct + '%',
              }">
            <template v-if="hoveredBlock">
              <span class="decision-action-badge decision-action-badge--sm"
                :class="actionBadgeClassFor(hoveredBlock.action)">
                {{ hoveredBlock.action }}
              </span>
              <span class="timeline-info-time">
                {{ slotToTime(hoveredBlock.startSlot) }}&ndash;{{ slotToTime(hoveredBlock.endSlot + 1) }}
              </span>
              <span class="timeline-info-price" v-if="hoveredBlock.priceCtKwh != null">
                <i class="ph-light ph-bolt mr-1"></i>{{ hoveredBlock.priceCtKwh.toFixed(1) }} ct/kWh
              </span>
              <span class="timeline-info-solar" v-if="hoveredBlock.solarForecastW > 0">
                <i class="ph-light ph-sun-bright mr-1"></i>{{ (hoveredBlock.solarForecastW / 1000).toFixed(2) }} kW
              </span>
              <span class="timeline-info-soc" v-if="hoveredBlock.simSocPct != null">
                <i class="ph-light ph-battery-half mr-1"></i>{{ hoveredBlock.simSocPct }}%
              </span>
              <span class="timeline-info-reason">{{ hoveredBlock.reason }}</span>
            </template>
            <template v-else-if="strategyStore.decision">
              <span class="text-xs text-secondary-400">{{ t('control.currentDecision') }}:</span>
              <span class="decision-action-badge decision-action-badge--sm" :class="actionBadgeClass">
                {{ strategyStore.decision.action }}
              </span>
              <span class="timeline-info-reason">{{ strategyStore.decision.reason }}</span>
            </template>
            <span v-else class="text-xs text-secondary-400">{{ t('control.noPlanYet') }}</span>
          </div>

          <div class="timeline-legend mt-6"
                      :style="{
                marginLeft:  chartInset.leftPct  + '%',
                marginRight: chartInset.rightPct + '%',
              }">
            <span v-for="leg in timelineLegend" :key="leg.action" class="legend-item">
              <span class="legend-dot" :style="{ background: leg.color }"></span>
              {{ leg.label }}
            </span>
          </div>
        </div>
            </div><!-- end timeline-wrap -->

      <!-- ── 2. STRATEGY CARDS ───────────────────────────────────────────────── -->
      <div class="strategy-grid">
        <button
          v-for="s in availableStrategies" :key="s.id"
          class="strategy-card"
          :class="{
            'strategy-card--active':      strategyStore.activeId === s.id,
            'strategy-card--unavailable': !s.available,
          }"
          :disabled="strategyStore.isLoading || !s.available"
          @click="openStrategyDrawer(s)"
        >
          <div class="strategy-card__top-bar" />
          <div class="items-start justify-between w-full">
            <div>
              <div class="strategy-card__name">{{ s.name }}</div>
              <div class="strategy-card__desc">{{ s.description }}</div>
            </div>
            <div class="flex flex-col items-end gap-1 shrink-0 ml-2">
              <span v-if="strategyStore.activeId === s.id" class="strategy-card__badge">
                {{ t('control.active') }}
              </span>
              <span v-else-if="!s.available" class="strategy-card__badge strategy-card__badge--dim">
                {{ t('control.unavailable') }}
              </span>
              <i class="ph-light ph-sliders text-secondary-400 text-xs mt-1"></i>
            </div>
          </div>
        </button>
      </div>

      <!-- ── Strategy drawer ────────────────────────────────────────────────── -->
      <AppDrawer
        v-model:visible="drawerOpen"
        :title="drawerStrategy?.name ?? ''"
      >
        <!-- Config fields — smart-eco only -->
        <div v-if="drawerStrategy?.id === 'smart-eco'" class="expand-panel__config">
          <div class="flex items-center justify-between mb-3">
            <span class="text-xs font-semibold text-secondary-400 uppercase tracking-wider">
              {{ t('control.strategyConfig') }}
            </span>
            <button
              v-if="configDirty"
              class="btn btn--sm btn--primary"
              :disabled="savingConfig"
              @click="saveConfig"
            >
              <i class="ph-light mr-1"
                :class="savingConfig ? 'ph-spinner-third ph-spin' : 'ph-floppy-disk'"></i>
              {{ savingConfig ? t('common.saving') : t('common.save') }}
            </button>
          </div>

          <div class="config-grid">
            <UniversalField
              v-for="field in configFields" :key="field.key"
              :field="field"
              :modelValue="tempConfig[field.key]"
              @update:modelValue="onConfigChange(field.key, $event)"
            />
          </div>

          <!-- Nightly profile readout -->
          <div v-if="nightlyProfile" class="profile-readout mt-4">
            <div class="profile-readout__title">
              <i class="ph-light ph-moon mr-1.5"></i>
              {{ t('control.nightlyProfile') }}
              <span class="text-xs text-secondary-400 ml-2">
                {{ t('control.calculatedAt') }} {{ formatTime(nightlyProfile.calculatedAt) }}
              </span>
            </div>
            <div class="profile-stats">
              <div class="profile-stat">
                <div class="profile-stat__value">{{ nightlyProfile.morningKwhNeeded?.toFixed(1) }} kWh</div>
                <div class="profile-stat__label">{{ t('control.morningNeed') }}</div>
              </div>
              <div class="profile-stat">
                <div class="profile-stat__value">{{ t('control.hourLabel', { h: nightlyProfile.solarStartHour }) }}</div>
                <div class="profile-stat__label">{{ t('control.solarStart') }}</div>
              </div>
              <div class="profile-stat">
                <div class="profile-stat__value">{{ nightlyProfile.solarTotalKwh?.toFixed(1) }} kWh</div>
                <div class="profile-stat__label">{{ t('control.solarForecast') }}</div>
              </div>
              <div class="profile-stat">
                <div class="profile-stat__value">{{ Math.round((nightlyProfile.forecastAccuracyFactor ?? 0) * 100) }}%</div>
                <div class="profile-stat__label">{{ t('control.forecastConfidence') }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Capabilities — all other strategies -->
        <div v-else class="expand-panel__caps">
          <div v-if="drawerStrategy?.description" class="text-sm text-secondary-500 mb-4">
            {{ drawerStrategy.description }}
          </div>
          <div v-if="drawerStrategy?.requiredCapabilities?.length" class="caps-group">
            <span class="caps-group__label">{{ t('control.requires') }}</span>
            <span v-for="cap in drawerStrategy.requiredCapabilities"
              :key="cap" class="cap-badge cap-badge--required">
              <i class="ph-light ph-circle-check mr-1"></i>{{ cap }}
            </span>
          </div>
          <div v-if="drawerStrategy?.optionalCapabilities?.length" class="caps-group">
            <span class="caps-group__label">{{ t('control.optional') }}</span>
            <span v-for="cap in drawerStrategy.optionalCapabilities"
              :key="cap"
              class="cap-badge"
              :class="drawerStrategy.activeOptional?.includes(cap)
                ? 'cap-badge--active' : 'cap-badge--inactive'">
              <i class="ph-light mr-1"
                :class="drawerStrategy.activeOptional?.includes(cap)
                  ? 'ph-circle-check' : 'ph-circle-xmark'"></i>
              {{ cap }}
            </span>
          </div>
        </div>

        <!-- Drawer footer -->
        <template #footer>
          <span v-if="drawerStrategy?.id === strategyStore.activeId"
            class="text-xs text-green-600 font-semibold flex items-center gap-1 mr-auto">
            <i class="ph-light ph-circle-check"></i>
            {{ t('control.currentlyActive') }}
          </span>
          <button
            v-else
            class="btn btn--primary btn--sm mr-auto"
            :disabled="strategyStore.isLoading"
            @click="showActivateModal = true"
          >
            <i class="ph-light ph-check mr-1.5"></i>
            {{ t('control.activate') }}
          </button>
          <button class="btn btn--sm" @click="drawerOpen = false">
            {{ t('common.close') }}
          </button>
        </template>
      </AppDrawer>

      <!-- Activation confirmation modal -->
      <AppModal
        v-model:visible="showActivateModal"
        :message="`${t('control.activateConfirm')} &quot;${drawerStrategy?.name}&quot;?`"
        :confirm-label="t('control.activate')"
        :busy="strategyStore.isLoading"
        @confirm="confirmActivate"
      />



    </div>

    <!-- ══════════════════════════════════════════════════════════════════════
         TAB 2 — HISTORY
    ══════════════════════════════════════════════════════════════════════ -->
    <div v-else-if="activeTab === 'history'">
      <div class="tab-toolbar">
        <span class="text-xs text-secondary-400">{{ t('control.last48Decisions') }}</span>
        <button class="btn btn--sm" @click="loadDecisions" :disabled="decisionsLoading">
          <i class="ph-light ph-arrows-rotate" :class="{ 'ph-spin': decisionsLoading }"></i>
        </button>
      </div>

      <div v-if="decisionsLoading" class="tab-empty">
        <i class="ph-light ph-spinner-third ph-spin text-2xl text-secondary-400"></i>
      </div>

      <div v-else-if="decisions.length === 0" class="tab-empty">
        <i class="ph-light ph-inbox text-2xl text-secondary-400 mb-2"></i>
        <span class="text-sm text-secondary-400">{{ t('control.noDecisions') }}</span>
      </div>

      <div v-else class="decision-table">
        <div class="decision-row decision-row--header">
          <span>{{ t('common.time') }}</span>
          <span>{{ t('common.action') }}</span>
          <span>{{ t('common.executed') }}</span>
          <span>{{ t('common.reason') }}</span>
        </div>
        <div
          v-for="d in decisions" :key="d.evaluated_at"
          class="decision-row"
          :class="{ 'decision-row--executed': d.executed }"
        >
          <span class="text-xs text-secondary-400 whitespace-nowrap">
            {{ formatDateTime(d.evaluated_at) }}
          </span>
          <span>
            <span class="decision-action-badge decision-action-badge--sm" :class="actionBadgeClassFor(d.action)">
              {{ d.action }}
            </span>
          </span>
          <span>
            <i class="ph-light text-sm"
              :class="d.executed ? 'ph-circle-check text-green-500' : 'ph-circle-xmark text-secondary-300'">
            </i>
          </span>
          <span class="text-xs text-secondary-400 truncate" :title="d.reason">{{ d.reason }}</span>
        </div>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════════
         TAB 3 — EFFECTIVENESS
    ══════════════════════════════════════════════════════════════════════ -->
    <div v-else-if="activeTab === 'effectiveness'">

      <div class="tab-toolbar">
        <div class="flex items-center gap-2">
          <span class="text-xs text-secondary-400">{{ t('control.period') }}</span>
          <select v-model="effectivenessDays" @change="loadEffectiveness" class="period-select">
            <option :value="7">7 {{ t('common.days') }}</option>
            <option :value="14">14 {{ t('common.days') }}</option>
            <option :value="30">30 {{ t('common.days') }}</option>
          </select>
        </div>
        <button class="btn btn--sm" @click="loadEffectiveness" :disabled="effectivenessLoading">
          <i class="ph-light ph-arrows-rotate" :class="{ 'ph-spin': effectivenessLoading }"></i>
        </button>
      </div>

      <div v-if="effectivenessLoading" class="tab-empty">
        <i class="ph-light ph-spinner-third ph-spin text-2xl text-secondary-400"></i>
      </div>

      <div v-else-if="effectiveness" class="effectiveness-grid">

        <!-- Solar self-consumption -->
        <div class="eff-card">
          <div class="eff-card__icon text-amber-500"><i class="ph-light ph-sun-bright"></i></div>
          <div class="eff-card__body">
            <div class="eff-card__value">
              {{ effectiveness.solar.selfConsumptionPct != null ? effectiveness.solar.selfConsumptionPct + '%' : '—' }}
            </div>
            <div class="eff-card__label">{{ t('control.solarSelfConsumption') }}</div>
            <div class="eff-card__sub">
              {{ effectiveness.solar.totalPvKwh }} kWh {{ t('control.produced') }},
              {{ effectiveness.solar.totalExportKwh }} kWh {{ t('control.exported') }}
            </div>
          </div>
        </div>

        <!-- Grid import -->
        <div class="eff-card">
          <div class="eff-card__icon text-orange-500"><i class="ph-light ph-utility-pole"></i></div>
          <div class="eff-card__body">
            <div class="eff-card__value">{{ effectiveness.grid.totalImportKwh }} kWh</div>
            <div class="eff-card__label">{{ t('control.gridImport') }}</div>
            <div class="eff-card__sub" v-if="effectiveness.grid.gridImportDelta != null">
              <span :class="effectiveness.grid.gridImportDelta < 0 ? 'text-green-600' : 'text-red-500'">
                <i class="ph-light" :class="effectiveness.grid.gridImportDelta < 0 ? 'ph-arrow-down' : 'ph-arrow-up'"></i>
                {{ Math.abs(effectiveness.grid.gridImportDelta) }} kWh
              </span>
              {{ t('control.vsPriorPeriod') }}
            </div>
          </div>
        </div>

        <!-- Forecast accuracy -->
        <div class="eff-card">
          <div class="eff-card__icon text-blue-400"><i class="ph-light ph-cloud-sun"></i></div>
          <div class="eff-card__body">
            <div class="eff-card__value">
              {{ effectiveness.forecast.avgAccuracyPct != null ? effectiveness.forecast.avgAccuracyPct + '%' : '—' }}
            </div>
            <div class="eff-card__label">{{ t('control.forecastAccuracy') }}</div>
            <div class="eff-card__sub">{{ t('control.avgOverPeriod', { days: effectivenessDays }) }}</div>
          </div>
        </div>

        <!-- Decision accuracy -->
        <div class="eff-card">
          <div class="eff-card__icon text-purple-500"><i class="ph-light ph-brain-circuit"></i></div>
          <div class="eff-card__body">
            <div class="eff-card__value">
              {{ effectiveness.decisions.accuracyPct != null ? effectiveness.decisions.accuracyPct + '%' : '—' }}
            </div>
            <div class="eff-card__label">{{ t('control.decisionAccuracy') }}</div>
            <div class="eff-card__sub">
              {{ effectiveness.decisions.correct }}/{{ effectiveness.decisions.total }} {{ t('control.correctDecisions') }}
            </div>
          </div>
        </div>

        <!-- Battery utilisation -->
        <div class="eff-card">
          <div class="eff-card__icon text-green-600"><i class="ph-light ph-battery-bolt"></i></div>
          <div class="eff-card__body">
            <div class="eff-card__value">{{ effectiveness.battery.avgDailyCycles }}</div>
            <div class="eff-card__label">{{ t('control.avgDailyCycles') }}</div>
            <div class="eff-card__sub">
              ↑ {{ effectiveness.battery.totalChargeKwh }} kWh /
              ↓ {{ effectiveness.battery.totalDischargeKwh }} kWh
            </div>
          </div>
        </div>

        <!-- Forecast accuracy trend (sparkline table) -->
        <div class="eff-forecast-trend" v-if="effectiveness.forecast.trend?.length">
          <div class="text-xs font-semibold text-primary mb-2">{{ t('control.forecastTrend') }}</div>
          <div class="forecast-trend-bars">
            <div
              v-for="row in effectiveness.forecast.trend" :key="row.date"
              class="forecast-bar-slot"
              :title="`${row.date}: ${row.actual_kwh?.toFixed(1)} / ${row.expected_kwh?.toFixed(1)} kWh (${Math.round(row.accuracy_percentage)}%)`"
            >
              <div class="forecast-bar-wrap">
                <div
                  class="forecast-bar"
                  :class="accuracyBarClass(row.accuracy_percentage)"
                  :style="{ height: Math.min(100, row.accuracy_percentage ?? 0) + '%' }"
                ></div>
              </div>
              <div class="forecast-bar-label">{{ shortDate(row.date) }}</div>
            </div>
          </div>
        </div>

        <!-- Recent decision log -->
        <div class="eff-decision-log" v-if="effectiveness.decisions.log?.length">
          <div class="text-xs font-semibold text-primary mb-2">{{ t('control.recentDecisions') }}</div>
          <div class="decision-table">
            <div class="decision-row decision-row--header">
              <span>{{ t('common.time') }}</span>
              <span>{{ t('common.action') }}</span>
              <span>{{ t('control.priceAtDecision') }}</span>
              <span>{{ t('control.dayAvgPrice') }}</span>
              <span>{{ t('control.correct') }}</span>
            </div>
            <div
              v-for="d in effectiveness.decisions.log" :key="d.date"
              class="decision-row"
            >
              <span class="text-xs text-secondary-400 whitespace-nowrap">{{ formatDateTime(d.date) }}</span>
              <span>
                <span class="decision-action-badge decision-action-badge--sm" :class="actionBadgeClassFor(d.action)">
                  {{ d.action }}
                </span>
              </span>
              <span class="text-xs">{{ d.priceAtDecision != null ? d.priceAtDecision + ' ct' : '—' }}</span>
              <span class="text-xs">{{ d.medianPrice != null ? d.medianPrice + ' ct' : '—' }}</span>
              <span>
                <i v-if="d.correct === true"  class="ph-light ph-circle-check text-green-500 text-sm"></i>
                <i v-else-if="d.correct === false" class="ph-light ph-circle-xmark text-red-400 text-sm"></i>
                <span v-else class="text-secondary-300 text-xs">—</span>
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useStrategyStore } from '@/stores/strategy';
import { useToastStore }    from '@/stores/toast';
import { useLocale }        from '@/composables/useLocale';
import apiClient            from '@/services/api';
import StrategyChart        from '@/components/control/StrategyChart.vue';
import UniversalField       from '@/components/settings/Universalfield.vue';
import AppDrawer            from '@/components/common/AppDrawer.vue';
import AppModal             from '@/components/common/AppModal.vue';

const strategyStore = useStrategyStore();
const toast         = useToastStore();
const { t }         = useLocale();

// ── Tabs ──────────────────────────────────────────────────────────────────
const tabs = [
  { id: 'strategy',      label: t('control.tabStrategy'),      icon: 'ph-castle-turret' },
  { id: 'history',       label: t('control.tabHistory'),       icon: 'ph-clock-clockwise' },
  { id: 'effectiveness', label: t('control.tabEffectiveness'), icon: 'ph-chart-line' },
];
const activeTab = ref('strategy');

// ── Timeline ──────────────────────────────────────────────────────────────
const hoveredBlock = ref(null);

// Inset applied to timeline-wrap so ruler ticks align with chart X axis ticks.
// Populated by StrategyChart's chart-area emit.
const chartInset = ref({ leftPct: 0, rightPct: 0 });

const planWindowStart = computed(() => {
  return strategyStore.windowStart ? new Date(strategyStore.windowStart) : null;
});
const planWindowHours = computed(() => strategyStore.windowHours ?? 24);
const totalPlanSlots  = computed(() => planWindowHours.value * 4);

const dayPlanSlots = computed(() => {
  const raw = strategyStore.dayPlan;
  // Guard against null, undefined, or non-array values during initial load
  const plan = Array.isArray(raw) ? raw : [];
  if (!plan.length) return [];
  return plan.map((s, i) => ({ ...s, slot: s.slot ?? i }));
});

// Remaining solar forecast — only future slots from current position onward
const totalSolarKwh = computed(() => {
  const slots = strategyStore.dayPlan;
  if (!Array.isArray(slots) || !slots.length) return 0;
  const nowSlot = currentSlotIndex.value;
  const futureW = slots
    .filter((s, i) => (s.slot ?? i) >= nowSlot)
    .reduce((sum, s) => sum + (s.solarForecastW ?? 0), 0);
  return futureW * 0.25 / 1000;
});

// Battery depletion: first future slot where predicted SoC hits the floor
const batteryDepletionSlot = computed(() => {
  const slots = strategyStore.dayPlan;
  if (!Array.isArray(slots)) return null;
  const nowSlot = currentSlotIndex.value;
  return slots.find(s => s.isSocFloorSlot && (s.slot ?? 0) >= nowSlot) ?? null;
});

// Current slot index — used to mark past blocks as dimmed
const currentSlotIndex = computed(() => {
  const start = planWindowStart.value;
  if (!start) return 0;
  const elapsed = (Date.now() - start.getTime()) / (15 * 60 * 1000);
  return Math.max(0, Math.floor(elapsed));
});

// ── SoC chart moved to StrategyChart.vue ─────────────────────────────────────

// Merge consecutive slots of the same action into blocks.
// Returns ALL blocks including IDLE gaps — so the full 24h bar is always filled.
const allTimelineBlocks = computed(() => {
  const slots = dayPlanSlots.value;
  if (!slots.length) return [];

  const merged = [];
  let current  = null;

  for (const s of slots) {
    if (current && current.action === s.action) {
      current.endSlot     = s.slot;
      current.simSocPct   = s.simSocPct ?? current.simSocPct;  // keep last SoC
    } else {
      if (current) merged.push(current);
      current = {
        ...s,
        startSlot: s.slot,
        endSlot:   s.slot,
      };
    }
  }
  if (current) merged.push(current);

  // Mark blocks that are entirely in the past as dimmed
  const nowSlot = currentSlotIndex.value;
  return merged.map(b => ({
    ...b,
    isPast: b.endSlot < nowSlot,
  }));
});

// Keep actionBlocks as a filtered alias for any other consumers
const actionBlocks = computed(() =>
  allTimelineBlocks.value.filter(b => b.action !== 'IDLE')
);

const idleFallbackBlock = computed(() => ({
  action:         'IDLE',
  startSlot:      0,
  endSlot:        totalPlanSlots.value - 1,
  priceCtKwh:     null,
  solarForecastW: 0,
  reason:         strategyStore.decision?.reason ?? t('control.noPlanYet'),
}));

// Ruler ticks every 3h with absolute time labels.
// Ticks that land exactly on midnight get isMidnight=true and carry a short
// date label (e.g. "Mon 30/3") so the day boundary is always visible.
const rulerTicks = computed(() => {
  const start = planWindowStart.value;
  const hours = planWindowHours.value;
  const ticks = [];

  for (let h = 0; h <= hours; h += 3) {
    let label;
    let isMidnight = false;
    let dateLabel  = null;

    if (start) {
      const dt = new Date(start.getTime() + h * 3600 * 1000);
      const hh = String(dt.getHours()).padStart(2, '0');

      isMidnight = dt.getHours() === 0 && dt.getMinutes() === 0;

      if (isMidnight) {
        label     = '00:00';
        const day = dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'numeric' });
        dateLabel = day; // e.g. "Mon, 30/3"
      } else {
        label = dt.getDate() !== start.getDate() ? `${hh}:00+` : `${hh}:00`;
      }
    } else {
      isMidnight = h > 0 && h % 24 === 0;
      label      = `${String(h % 24).padStart(2, '0')}:00`;
    }

    ticks.push({ label, dateLabel, isMidnight, pct: (h / hours) * 100 });
  }
  return ticks;
});

// Needle as % of window width; -1 = outside window (hide)
const currentTimePercent = computed(() => {
  const start = planWindowStart.value;
  const hours = planWindowHours.value;
  if (!start) {
    const n = new Date();
    return ((n.getHours() * 60 + n.getMinutes()) / (24 * 60)) * 100;
  }
  const elapsed = (new Date() - start) / (1000 * 60 * 60);
  if (elapsed < 0 || elapsed > hours) return -1;
  return (elapsed / hours) * 100;
});

function slotToPercent(slotCount) {
  return (slotCount / totalPlanSlots.value) * 100;
}

function slotToTime(slotIdx) {
  const start = planWindowStart.value;
  if (start) {
    const dt = new Date(start.getTime() + slotIdx * 15 * 60 * 1000);
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    return dt.getDate() !== start.getDate() ? `${hh}:${mm}+` : `${hh}:${mm}`;
  }
  const total = slotIdx * 15;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// ── Strategy drawer / modal ───────────────────────────────────────────────
const drawerOpen        = ref(false);
const drawerStrategy    = ref(null);
const showActivateModal = ref(false);

function openStrategyDrawer(s) {
  drawerStrategy.value = s;
  drawerOpen.value     = true;
}

async function confirmActivate() {
  await selectStrategy(drawerStrategy.value.id);
  showActivateModal.value = false;
  drawerOpen.value        = false;
}

// ── Strategy select ───────────────────────────────────────────────────────
const availableStrategies = ref([]);

async function loadStrategies() {
  try {
    const res = await apiClient.get('/strategies');
    availableStrategies.value = res.data?.strategies ?? [];
  } catch (e) {
    console.error('Failed to load strategies:', e.message);
  }
}

async function selectStrategy(id) {
  try {
    await strategyStore.setStrategy(id);
    toast.add({ severity: 'success', summary: t('control.strategyUpdated'),
      detail: availableStrategies.value.find(s => s.id === id)?.name });
  } catch (e) {
    toast.add({ severity: 'error', summary: t('common.error'),
      detail: e.response?.data?.error || e.message });
  }
}

// ── Config editor ─────────────────────────────────────────────────────────
const tempConfig    = ref({});
const configDirty   = ref(false);
const savingConfig  = ref(false);

const nightlyProfile = computed(() => strategyStore.config?.nightlyProfile ?? null);

// SmartEco config field schema for UniversalField
const configFields = [
  {
    key: 'batteryCapacityKwh', label: 'Battery capacity (kWh)',
    component: 'number', placeholder: '11.2',
    validation: { min: 1, max: 30, step: 0.1 },
    description: 'Usable battery capacity of your system.',
  },
  {
    key: 'minSocPct', label: 'Minimum SoC (%)',
    component: 'number', placeholder: '20',
    validation: { min: 5, max: 50, step: 1 },
    description: 'Never discharge below this level.',
  },
  {
    key: 'chargePowerWatts', label: 'Charge power (W)',
    component: 'number', placeholder: '3000',
    validation: { min: 500, max: 10000, step: 100 },
    description: 'Grid charge rate in watts.',
  },
  {
    key: 'negativePriceThreshold', label: 'Negative price threshold (ct/kWh)',
    component: 'number', placeholder: '0',
    validation: { min: -10, max: 5, step: 0.5 },
    description: 'Prices at or below this value trigger negative-price handling.',
  },
  {
    key: 'solarSurplusThresholdKwh', label: 'Solar surplus threshold (kWh)',
    component: 'number', placeholder: '5',
    validation: { min: 1, max: 20, step: 0.5 },
    description: 'Minimum forecast kWh to consider solar "strong enough" for room-making.',
  },
  {
    key: 'dischargeFloorCt', label: 'Min discharge price (ct/kWh)',
    component: 'number', placeholder: '5',
    validation: { min: 0, max: 20, step: 0.5 },
    description: 'Never discharge to grid when price is below this value, even if top-percentile.',
  },
  {
    key: 'dischargePercentile', label: 'Discharge price percentile',
    component: 'number', placeholder: '80',
    validation: { min: 50, max: 99, step: 5 },
    description: 'Only discharge when price is above this percentile of remaining today\'s prices.',
  },
  {
    key: 'dischargeLookaheadHours', label: 'Discharge solar lookahead (h)',
    component: 'number', placeholder: '2',
    validation: { min: 1, max: 8, step: 1 },
    description: 'Only discharge when solar is forecast within this many hours.',
  },
  {
    key: 'dischargeSocMinPct', label: 'Min SoC to discharge (%)',
    component: 'number', placeholder: '80',
    validation: { min: 50, max: 100, step: 5 },
    description: 'Only discharge to make room for solar when battery is above this level.',
  },
  {
    key: 'curtailmentSocTrigger', label: 'Curtailment alert SoC trigger (%)',
    component: 'number', placeholder: '80',
    validation: { min: 50, max: 100, step: 5 },
    description: 'Alert fires when battery reaches this SoC with solar incoming and low prices.',
  },
  {
    key: 'curtailmentActionSocTrigger', label: 'Curtailment action SoC trigger (%)',
    component: 'number', placeholder: '95',
    validation: { min: 80, max: 100, step: 1 },
    description: 'Auto-curtail solar export when battery reaches this SoC (must be ≥ alert trigger). Requires 15 min without dismissal.',
  },
  {
    key: 'curtailmentPricePercentile', label: 'Curtailment price percentile',
    component: 'number', placeholder: '20',
    validation: { min: 5, max: 50, step: 5 },
    description: 'Alert only fires when current price is below this percentile of today\'s prices.',
  },
  {
    key: 'curtailmentSocStep', label: 'Re-alert SoC step (%)',
    component: 'number', placeholder: '5',
    validation: { min: 5, max: 20, step: 5 },
    description: 'Re-alert for each additional SoC increase of this size (e.g. 80%, 85%, 90%).',
  },
  {
    key: 'curtailmentLookaheadHours', label: 'Solar lookahead window (h)',
    component: 'number', placeholder: '2',
    validation: { min: 1, max: 6, step: 1 },
    description: 'How many hours ahead to check for incoming solar before alerting.',
  },
];

// Initialise tempConfig from store whenever config changes
watch(() => strategyStore.config, (cfg) => {
  tempConfig.value  = { ...cfg };
  configDirty.value = false;
}, { immediate: true, deep: true });

function onConfigChange(key, val) {
  tempConfig.value  = { ...tempConfig.value, [key]: val };
  configDirty.value = true;
}

async function saveConfig() {
  savingConfig.value = true;
  try {
    await strategyStore.saveConfig(tempConfig.value);
    configDirty.value = false;
    toast.add({ severity: 'success', summary: t('common.saved'),
      detail: t('control.configSaved') });
  } catch (e) {
    toast.add({ severity: 'error', summary: t('common.error'),
      detail: e.response?.data?.error || e.message });
  } finally {
    savingConfig.value = false;
  }
}

// ── History tab ───────────────────────────────────────────────────────────
const decisions        = ref([]);
const decisionsLoading = ref(false);

async function loadDecisions() {
  decisionsLoading.value = true;
  try {
    const res = await apiClient.get('/strategies/decisions?limit=48');
    decisions.value = res.data?.decisions ?? [];
  } catch (e) {
    console.error('Failed to load decisions:', e.message);
  } finally {
    decisionsLoading.value = false;
  }
}

watch(activeTab, (tab) => {
  if (tab === 'history'       && decisions.value.length === 0)      loadDecisions();
  if (tab === 'effectiveness' && effectiveness.value === null)       loadEffectiveness();
});

// ── Effectiveness tab ─────────────────────────────────────────────────────
const effectiveness        = ref(null);
const effectivenessLoading = ref(false);
const effectivenessDays    = ref(14);

async function loadEffectiveness() {
  effectivenessLoading.value = true;
  try {
    const res = await apiClient.get(`/strategies/effectiveness?days=${effectivenessDays.value}`);
    effectiveness.value = res.data;
  } catch (e) {
    console.error('Failed to load effectiveness:', e.message);
  } finally {
    effectivenessLoading.value = false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mo} ${hh}:${mm}`;
}

function shortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

const actionBadgeClass = computed(() => actionBadgeClassFor(strategyStore.decision?.action));

const infoLineBorderClass = computed(() => {
  const action = hoveredBlock.value?.action ?? strategyStore.decision?.action;
  switch (action) {
    case 'CHARGE_FROM_GRID':  return 'info-line--charge';
    case 'DISCHARGE_TO_GRID': return 'info-line--discharge';
    case 'SOLAR_SURPLUS':     return 'info-line--solar';
    default:                  return '';
  }
});

function actionBadgeClassFor(action) {
  switch (action) {
    case 'CHARGE_FROM_GRID':   return 'badge--charge';
    case 'DISCHARGE_TO_GRID':  return 'badge--discharge';
    case 'SOLAR_SURPLUS':      return 'badge--solar';
    default:                   return 'badge--idle';
  }
}
function blockColorClass(action) {
  switch (action) {
    case 'CHARGE_FROM_GRID':  return 'block--charge';
    case 'DISCHARGE_TO_GRID': return 'block--discharge';
    case 'SOLAR_SURPLUS':     return 'block--solar';
    default:                  return '';
  }
}

function blockIcon(action) {
  switch (action) {
    case 'CHARGE_FROM_GRID':  return 'ph-bolt-lightning';
    case 'DISCHARGE_TO_GRID': return 'ph-arrow-up-from-arc';
    case 'SOLAR_SURPLUS':     return 'ph-sun-bright';
    default:                  return 'ph-minus';
  }
}
const timelineLegend = [
  { action: 'CHARGE_FROM_GRID',  label: t('control.chargeFromGrid'),  color: '#22c55e' },
  { action: 'DISCHARGE_TO_GRID', label: t('control.dischargeToGrid'), color: '#ef4444' },
  { action: 'SOLAR_SURPLUS',     label: t('control.solarSurplus'),     color: '#eab308' },
];
function accuracyBarClass(pct) {
  if (pct == null) return 'bg-secondary-200';
  if (pct >= 70)   return 'bg-green-400';
  if (pct >= 40)   return 'bg-amber-400';
  return 'bg-red-400';
}

// ── Lifecycle ─────────────────────────────────────────────────────────────
onMounted(async () => {
  await Promise.all([loadStrategies(), strategyStore.fetchActive()]); // ← was startPolling(60_000)
});

onUnmounted(() => {
  // stopPolling() removed — do not kill the shared store poll
});
</script>

<style scoped>
.strategy-panel { display: flex; flex-direction: column; }


.strategy-tab           { display: flex; flex-direction: column; gap: 1.5rem; }
.section-label          { font-size: 0.75rem; font-weight: 600;text-transform: uppercase; letter-spacing: 0.06em;color: var(--color-text-secondary);}
.timeline-section       { display: flex; flex-direction: column; gap: 0.625rem; }
.timeline-header        { display: flex; align-items: center;justify-content: space-between;}
.timeline-wrap          { position: relative;padding-top: 0px;}
.timeline-inset         { position: relative;transition: margin 0.15s ease;}
.timeline-blocks        { position: absolute;top: 0; left: 0; right: 0;height: 48px;}
.timeline-track         { position: absolute;top: 0; left: 0; right: 0;height: 44px;background: var(--color-bg-secondary);border: 1px solid var(--color-secondary-200);border-radius: var(--radius-md, 6px);}

/* Individual action block */
.timeline-block         { position: absolute;top: 0; height: 44px;display: flex; flex-direction: column;align-items: center; justify-content: center;gap: 2px;border-radius: var(--radius-md, 6px);border-top: 3px solid transparent;background: transparent;padding: 0 6px;cursor: default;overflow: hidden;transition: background 0.1s, box-shadow 0.12s;min-width: 0;}
.timeline-block:hover   { box-shadow: 0 2px 8px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.08);z-index: 2;}

/* IDLE blocks — very subtle, just ticks off empty time */
.timeline-block:not([class*="block--charge"]):not([class*="block--discharge"]):not([class*="block--solar"]):not(.block--idle-full) 
                        { border-top-color: transparent; background: transparent;}
.timeline-block:not([class*="block--charge"]):not([class*="block--discharge"]):not([class*="block--solar"]):not(.block--idle-full):hover 
                        { background: var(--color-secondary-50);border: 1px solid var(--color-secondary-300)}

/* Block colour variants */
.block--charge          { border-top-color: #22c55e; background: #f0fdf4; }
.block--discharge       { border-top-color: #ef4444; background: #fef2f2; }
.block--solar           { border-top-color: #eab308; background: #fefce8; }

.block--charge:hover    { background: #dcfce7; }
.block--discharge:hover { background: #fee2e2; }
.block--solar:hover     { background: #fef9c3; }

/* Past blocks — dimmed to show history vs future plan */
.timeline-block--past   { opacity: 0.45; }
.timeline-block--past:hover 
                        { opacity: 0.75; }
.timeline-block__icon   { font-size: 0.7rem; color: var(--color-text-secondary); }
.block--charge    .timeline-block__icon { color: #16a34a; }
.block--discharge .timeline-block__icon { color: #dc2626; }
.block--solar     .timeline-block__icon { color: #ca8a04; }

.timeline-block__time         { font-size: 0.6rem; font-weight: 600;color: #6b7280; white-space: nowrap; overflow: hidden;text-overflow: ellipsis; max-width: 100%;}
/* Full-width IDLE fallback block (no plan yet) */
.block--idle-full             { left: 0; width: 100%;border-top-color: var(--color-secondary-300);background: var(--color-bg-secondary-50);color: var(--color-bg-secondary-500);}
.timeline-needle              { position: absolute;top: -4px; bottom: -8px;width: 2px;background: var(--color-primary);border-radius: 1px;transform: translateX(-50%);pointer-events: none;z-index: 3;}
.timeline-needle::before      { content: '';position: absolute;top: 0; left: 50%;transform: translateX(-50%);width: 6px; height: 6px;border-radius: 50%;background: var(--color-primary);}

/* Ruler */
.timeline-ruler               { position: relative;height: 24px;}
.ruler-mark                   { position: absolute;top: 0;transform: translateX(-50%);display: flex; flex-direction: column; align-items: center;display:none;}
.ruler-mark::before           { content: '';width: 1px; height: 5px;background: var(--color-secondary-300);}
.ruler-label                  { font-size: 0.6rem;color: var(--color-text-secondary);margin-top: 1px;white-space: nowrap;}

/* Midnight marker — taller tick, primary colour, date label below */
.ruler-mark--midnight::before { width: 2px;height: 10px;background: var(--color-primary);opacity: 0.5;}
.ruler-mark--midnight .ruler-label 
                              { color: var(--color-primary);font-weight: 700;opacity: 0.75;}
.ruler-date-label             { font-size: 0.55rem;color: var(--color-primary);opacity: 0.6;white-space: nowrap;margin-top: 1px;font-weight: 500;}

/* Info line */
.timeline-info-line           { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;min-height: 2.25rem; padding: 0.375rem 0.5rem;background: var(--color-secondary-200);border-left: 3px solid var(--color-secondary-300);font-size: 0.75rem;transition: border-color 0.15s;}
.info-line--charge            { border-left-color: var(--chart-grid);  }
.info-line--discharge         { border-left-color: var(--chart-battery);  }
.info-line--solar             { border-left-color: var(--chart-solar); }

.timeline-info-time           { color: var(--color-text-primary); font-weight: 600; white-space: nowrap; }
.timeline-info-price          { color: var(--color-text-secondary); white-space: nowrap; }
.timeline-info-solar          { color: var(--chart-solar); white-space: nowrap; }
.timeline-info-soc            { color: var(--chart-battery); white-space: nowrap; }
.timeline-info-reason         { color: var(--color-text-secondary); flex: 1; }

/* Legend */
.timeline-legend              { display: flex; gap: 1rem; flex-wrap: wrap; }
.legend-item                  { display: flex; align-items: center; gap: 0.375rem; font-size: 0.7rem; color: var(--color-text-secondary); }
.legend-dot                   { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }

/* ── Strategy grid ─────────────────────────────────────────────────────── */
.strategy-grid                { display: grid;grid-template-columns: repeat(2, 1fr);gap: 1.5rem;}
@media (min-width: 900px)     { .strategy-grid { grid-template-columns: repeat(4, 1fr); } }

.strategy-card                { position: relative;border-radius: var(--border-radius); display: flex; flex-direction: column;align-items: flex-start; gap: 0.375rem; padding: 1rem;cursor: pointer; text-align: left; width: 100%;background: var(--color-background);border: 1px solid var(--border-color);transition: border-color 0.15s, background 0.15s;overflow: hidden;}
.strategy-card:hover:not(:disabled)   
                              { border-color: var(--color-secondary-200);  }
.strategy-card--active        { border-color: var(--color-secondary-400);background-color: var(--color-secondary-300);}
.strategy-card--unavailable           
                              { opacity: 0.45; cursor: not-allowed; }
.strategy-card:disabled       { opacity: 0.5; cursor: not-allowed; }

.strategy-card__top-bar       { position: absolute; left: 0; right: 0; top: 0;height: 4px; background: transparent; transition: background 0.15s;}

.strategy-card__name          { font-size: 0.875rem; font-weight: 600; color: var(--color-primary); }
.strategy-card__desc          { font-size: 0.775rem; color: var(--color-secondary-500); line-height: 1.4; }
/*
.strategy-card--active .strategy-card__top-bar 
                              { background: var(--color-primary); }*/
.strategy-card__badge         { margin-top: 0.25rem; font-size: 0.65rem; font-weight: 600;text-transform: uppercase; letter-spacing: 0.07em;color: var(--color-primary); background: var(--color-secondary-300);padding: 0.15rem 0.45rem; border-radius: 3px;}
.strategy-card__badge--dim    { color: var(--color-secondary-500); background: var(--color-secondary-100)  ; }

/* Capabilities */
.expand-panel__config         { display: flex; flex-direction: column; gap: 0.875rem; padding: 1.25rem; }
.expand-panel__caps           { display: flex; flex-direction: column; gap: 0.625rem; padding: 1.25rem; }
.caps-group                   { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.caps-group__label            { font-size: 0.7rem; font-weight: 600; color: var(--color-text-secondary); min-width: 4.5rem; }
.cap-badge                    { display: inline-flex; align-items: center;padding: 0.2rem 0.5rem; border-radius: 3px;font-size: 0.7rem; font-weight: 500;}
.cap-badge--required          { background: #ede9fe; color: #5b21b6; }
.cap-badge--active            { background: #dcfce7; color: #166534; }
.cap-badge--inactive          { background: #f3f4f6; color: #9ca3af; }

/* ── Solar forecast total ───────────────────────────────────────────────── */
.solar-forecast-total         { font-size: 0.8125rem; color: var(--color-text-secondary); padding: 0.375rem 0 0; display: flex; align-items: center; gap: 0.25rem; }
.solar-forecast-total strong  { color: var(--color-text-primary); }
.battery-depletion-warning    { font-size: 0.8125rem; color: #dc2626; padding: 0.375rem 0 0; display: flex; align-items: center; gap: 0.25rem; }

/* ── Quick actions ─────────────────────────────────────────────────────── */
.quick-actions          { display: flex; align-items: center; gap: 0.75rem;flex-wrap: wrap; padding-top: 0.875rem;border-top: 1px solid #f3f4f6;}
.quick-actions__label   { font-size: 0.75rem; font-weight: 500; color: #9ca3af; white-space: nowrap; }
.quick-actions__row     { display: flex; gap: 0.5rem; flex-wrap: wrap; }

/* ── Tabs ──────────────────────────────────────────────────────────────── */
.tab-bar                { display: flex;gap: 0;border-bottom: 1px solid var(--color-secondary-200);}
.tab-btn                { padding: 0.5rem 1rem;font-size: 0.8125rem;font-weight: 500;color: var(--color-text-secondary);background: none;border: none;border-bottom: 2px solid transparent;cursor: pointer;transition: color 0.12s, border-color 0.12s;white-space: nowrap;margin-right: .5rem;}
.tab-btn:hover          { color: var(--color-text-primary); background-color: var(--color-secondary-200);    border-top-left-radius: var(--radius-md);border-top-right-radius: var(--radius-md);}
.tab-btn--active        { color: var(--color-text-primary); border-bottom-color: var(--color-primary);    background-color: var(--color-secondary-100);border-top-left-radius: var(--radius-md); border-top-right-radius: var(--radius-md);}

.tab-toolbar            { display: flex;align-items: center;justify-content: space-between;margin-bottom: 0.75rem;}
.tab-empty              { display: flex;flex-direction: column;align-items: center;padding: 3rem 0;color: var(--color-text-secondary);}

/* ── Config section ────────────────────────────────────────────────────── */
.decision-action-badge  { display: inline-block;padding: 0.2rem 0.5rem;border-radius: 3px;font-size: 0.7rem; font-weight: 700;text-transform: uppercase; letter-spacing: 0.05em;}
.decision-action-badge--sm 
                        { font-size: 0.65rem; padding: 0.15rem 0.4rem; }
.badge--charge          { background: #dbeafe; color: #1d4ed8; }
.badge--discharge       { background: #fef3c7; color: #92400e; }
.badge--solar           { background: #fef9c3; color: #854d0e; }
.badge--idle            { background: var(--color-background); color: var(--color-primary); }

/* ── Config section ────────────────────────────────────────────────────── */
.config-section         { border-top: 1px solid var(--color-secondary-200);padding-top: 1rem;display: flex; flex-direction: column; gap: 0.875rem;}
.config-section__header { display: flex; align-items: center; justify-content: space-between;}
.config-grid            { display: grid;grid-template-columns: repeat(2, 1fr);gap: 0.875rem;}

@media (min-width: 900px) { 
  .config-grid { grid-template-columns: repeat(2, 1fr); } 
}

/* ── Nightly profile readout ───────────────────────────────────────────── */
.profile-readout        { background: var(--color-bg-secondary);padding: 0.875rem 1rem;border-radius: 0.375rem;}
.profile-readout__title { font-size: 0.75rem; font-weight: 600;color: var(--color-primary); margin-bottom: 0.75rem;}
.profile-stats          { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; }
@media (max-width: 640px) {
  .profile-stats { grid-template-columns: repeat(2, 1fr); } 
}
.profile-stat__value    { font-size: 1.125rem; font-weight: 700; color: var(--color-primary); }
.profile-stat__label    { font-size: 0.7rem; color: var(--color-text-secondary); margin-top: 0.125rem; }

/* ── Decision table ────────────────────────────────────────────────────── */
.decision-table         { display: flex; flex-direction: column; }
.decision-row           { display: grid;grid-template-columns: 7rem 8rem 2.5rem 1fr;align-items: center;gap: 0.5rem;padding: 0.5rem 0.25rem;border-bottom: 1px solid var(--color-secondary-100);}
.decision-row--header   { font-size: 0.7rem; font-weight: 600; text-transform: uppercase;letter-spacing: 0.06em; color: var(--color-text-secondary);border-bottom-color: var(--color-secondary-200);}
.decision-row--executed { background: rgba(34,197,94,0.03); }

/* ── Period select ─────────────────────────────────────────────────────── */
.period-select          { font-size: 0.8125rem; padding: 0.25rem 0.5rem; border: 1px solid var(--color-secondary-200);  background: var(--color-background); color: var(--color-primary);outline: none; cursor: pointer;}
/* ── Effectiveness grid ────────────────────────────────────────────────── */
.effectiveness-grid     {display: grid;grid-template-columns: repeat(2, 1fr);gap: 0.75rem;}

@media (min-width: 900px) { 
  .effectiveness-grid { grid-template-columns: repeat(3, 1fr); } 
}
.eff-card               { display: flex; align-items: flex-start; gap: 0.875rem;padding: 1rem; background: var(--color-bg-secondary);border: 1px solid var(--color-secondary-200);border-radius: 0.375rem;}
.eff-card__icon         { font-size: 1.25rem; margin-top: 0.125rem; }
.eff-card__value        { font-size: 1.5rem; font-weight: 700; color: var(--color-primary); line-height: 1.2; }
.eff-card__label        { font-size: 0.75rem; font-weight: 600; color: var(--color-primary); margin-top: 0.125rem; }
.eff-card__sub          { font-size: 0.7rem; color: var(--color-text-secondary); margin-top: 0.25rem; }

.eff-forecast-trend,
.eff-decision-log       { grid-column: 1 / -1;padding: 1rem;background: var(--color-bg-secondary);border: 1px solid var(--color-secondary-200);border-radius: 0.375rem;}

/* ── Forecast accuracy sparkline ───────────────────────────────────────── */
.forecast-trend-bars    { display: flex; align-items: flex-end; gap: 4px; height: 80px;}
.forecast-bar-slot      { display: flex; flex-direction: column; align-items: center; flex: 1; }
.forecast-bar-wrap      { flex: 1; width: 100%; display: flex; align-items: flex-end; }
.forecast-bar           { width: 100%; min-height: 2px; border-radius: 2px 2px 0 0; transition: height 0.3s; }
.forecast-bar-label     { font-size: 0.6rem; color: var(--color-text-secondary); margin-top: 2px; white-space: nowrap; }

/* ── Buttons ───────────────────────────────────────────────────────────── */
.btn                    { display: inline-flex; align-items: center; gap: 0.375rem;padding: 0.4375rem 0.875rem;background: var(--color-secondary-200); border: 1px solid var(--color-secondary-200);color: #374151; font-size: 0.875rem; font-weight: 500;cursor: pointer; white-space: nowrap;transition: background 0.15s, border-color 0.15s;}
.btn:hover:not(:disabled) 
                        { background: var(--color-accent);color:var(--color-secondary-100); border-color: #9ca3af; }
.btn:disabled           { opacity: 0.5; cursor: not-allowed; }
.btn--sm                { padding: 0.3125rem 0.625rem; font-size: 0.78125rem; }
.btn--primary           { background: var(--color-primary); color: var(--color-secondary-100); border-color: var(--color-primary); }
.btn--primary:hover:not(:disabled) 
                        { opacity: 0.9; }
.btn--destructive       { color: var(--color-red-800); border-color: var(--color-red-300); background: var(--color-red-100); }
.btn--destructive:hover:not(:disabled) 
                        { background: #fee2e2; border-color: var(--color-red-300); }
.btn--busy              { opacity: 0.6; pointer-events: none; }
</style>