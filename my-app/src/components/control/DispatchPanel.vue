<!-- src/components/control/DispatchPanel.vue -->
<template>
  <div class="dispatch-panel">

    <!-- Active dispatch status bar -->
    <div v-if="status.active" class="status-bar">
      <span class="status-bar__dot" />
      <span class="status-bar__text">
        {{ status.charging ? t('control.chargingActive') : t('control.dischargingActive') }}
        &mdash; {{ status.watts }} W
        <span v-if="status.startedAt"> &mdash; {{ status.startedAt }}</span>
        <span v-if="remaining"> &mdash; {{ remaining }}</span>
      </span>
      <button
        class="btn btn--sm btn--destructive"
        :class="{ 'btn--busy': stopping }"
        @click="doStop"
      >
        {{ t('control.stop') }}
      </button>
    </div>

    <!-- Active curtailment status bar — separate from battery dispatch,
         because the two are independent and can be active at once. -->
    <div v-if="curtailStatus.active" class="status-bar" :class="{ 'status-bar--warn': curtailStatus.degraded }">
      <span class="status-bar__dot" />
      <span class="status-bar__text">
        {{ t('control.curtailActive') }}
        &mdash; {{ curtailStatus.targetWatts }} W
        <span v-if="curtailRemaining"> &mdash; {{ curtailRemaining }}</span>
        <span v-if="curtailStatus.degraded" class="status-bar__warn">
          &mdash; {{ t('control.curtailDegraded') }}
        </span>
      </span>
      <button
        class="btn btn--sm btn--destructive"
        :class="{ 'btn--busy': curtailStopping }"
        @click="doCurtailStop"
      >
        {{ t('control.stop') }}
      </button>
    </div>

    <!-- Charge / Discharge / Curtail side-by-side -->
    <div class="dispatch-grid" :class="{ 'dispatch-grid--two': !hasCurtail }">

      <!-- Charge from Grid -->
      <div class="dcard bg-secondary-100">
        <div class="dcard__header mb-8">
          <div class="dcard__title">{{ t('control.chargeFromGrid') }}</div>
          <div class="dcard__sub">{{ t('control.chargeFromGridDesc') }}</div>
        </div>

        <div class="fields">
          <SliderField
            :label="t('control.power')"
            :display="`${charge.watts} W`"
            v-model="charge.watts"
            :min="500" :max="10000" :step="100"
            hint-min="500 W" hint-max="10000 W"
          />
          <SliderField
            :label="t('control.targetSOC')"
            :display="`${charge.targetSOC}%`"
            v-model="charge.targetSOC"
            :min="20" :max="98" :step="5"
            hint-min="20%" hint-max="98%"
          />
          <SliderField
            :label="t('control.duration')"
            :display="`${charge.durationHours} ${t('control.hours')}`"
            v-model="charge.durationHours"
            :min="0.5" :max="12" :step="0.5"
            :hint-min="`0.5 ${t('control.hours')}`"
            :hint-max="`12 ${t('control.hours')}`"
          />
        </div>

        <div class="dcard__summary mb-6">
          {{ charge.watts }} W → {{ charge.targetSOC }}% &mdash; {{ charge.durationHours }} {{ t('control.hours') }}
        </div>

        <button
          class="btn btn--primary btn--full"
          :class="{ 'btn--busy': charging }"
          @click="doCharge"
        >
          {{ t('control.startCharging') }}
        </button>
      </div>

      <!-- Discharge to Grid -->
      <div class="dcard bg-secondary-100">
        <div class="dcard__header mb-8">
          <div class="dcard__title">{{ t('control.dischargeToGrid') }}</div>
          <div class="dcard__sub">{{ t('control.dischargeToGridDesc') }}</div>
        </div>

        <div class="fields">
          <SliderField
            :label="t('control.power')"
            :display="`${discharge.watts} W`"
            v-model="discharge.watts"
            :min="500" :max="10000" :step="100"
            hint-min="500 W" hint-max="10000 W"
          />
          <SliderField
            :label="t('control.minimumSOC')"
            :display="`${discharge.minimumSOC}%`"
            v-model="discharge.minimumSOC"
            :min="5" :max="95" :step="5"
            hint-min="5%" hint-max="95%"
          />
          <SliderField
            :label="t('control.duration')"
            :display="`${discharge.durationHours} ${t('control.hours')}`"
            v-model="discharge.durationHours"
            :min="0.5" :max="12" :step="0.5"
            :hint-min="`0.5 ${t('control.hours')}`"
            :hint-max="`12 ${t('control.hours')}`"
          />
        </div>

        <div class="dcard__summary mb-6">
          {{ discharge.watts }} W, min {{ discharge.minimumSOC }}% &mdash; {{ discharge.durationHours }} {{ t('control.hours') }}
        </div>

        <button
          class="btn btn--primary btn--full"
          :class="{ 'btn--busy': discharging }"
          @click="doDischarge"
        >
          {{ t('control.startDischarging') }}
        </button>
      </div>

      <!-- Curtail Solar — shown only when a solar:curtail provider is loaded.
           Deliberately provider-agnostic: this card does not know or care
           whether SolarEdge or AlphaESS is behind the capability. -->
      <div v-if="hasCurtail" class="dcard bg-secondary-100">
        <div class="dcard__header mb-8">
          <div class="dcard__title">{{ t('control.curtailSolar') }}</div>
          <div class="dcard__sub">{{ t('control.curtailSolarDesc') }}</div>
        </div>

        <div class="fields">
          <!-- Watts, not percent. A cap in watts can be compared against
               house load; a percentage of an inverter nameplate cannot.
               It also removes the "10% = reduce by 10 or limit to 10?"
               ambiguity entirely. -->
          <SliderField
            :label="t('control.curtailLimit')"
            :display="`${curtail.watts} W`"
            v-model="curtail.watts"
            :min="curtailMinW" :max="curtailMaxW" :step="100"
            :hint-min="`${curtailMinW} W`"
            :hint-max="`${curtailMaxW} W`"
          />
          <SliderField
            :label="t('control.duration')"
            :display="`${curtail.durationHours} ${t('control.hours')}`"
            v-model="curtail.durationHours"
            :min="0.5" :max="12" :step="0.5"
            :hint-min="`0.5 ${t('control.hours')}`"
            :hint-max="`12 ${t('control.hours')}`"
          />
        </div>

        <div class="dcard__summary mb-6">
          {{ t('control.curtailSummary', { watts: curtail.watts, hours: curtail.durationHours }) }}
        </div>

        <button
          class="btn btn--primary btn--full"
          :class="{ 'btn--busy': curtailing }"
          @click="doCurtail"
        >
          {{ t('control.startCurtailing') }}
        </button>
      </div>

    </div>

    <!-- Confirm modal -->
    <AppModal
      v-model:visible="confirm.visible"
      :message="confirm.message"
      @confirm="runConfirm"
    />

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import apiClient from '@/services/api';
import { useToastStore } from '@/stores/toast';
import { useLocale } from '@/composables/useLocale';

import AppModal    from '@/components/common/AppModal.vue';
import SliderField from '@/components/common/SliderField.vue';

import '@/assets/styles/control.css';

const toast = useToastStore();
const { t } = useLocale();

const charging        = ref(false);
const discharging     = ref(false);
const stopping        = ref(false);
const curtailing      = ref(false);
const curtailStopping = ref(false);

// startedAt is persisted in localStorage so it survives logout/login cycles.
// It is keyed to 'wolffie_dispatch_startedAt' and cleared as soon as the
// backend reports no active dispatch.
const STORAGE_KEY  = 'wolffie_dispatch_startedAt';
const startedAt    = ref(localStorage.getItem(STORAGE_KEY) || null);

function setStartedAt() {
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  startedAt.value = t;
  localStorage.setItem(STORAGE_KEY, t);
}

function clearStartedAt() {
  startedAt.value = null;
  localStorage.removeItem(STORAGE_KEY);
}

const status = ref({ active: false, charging: false, discharging: false, watts: 0, remainingSeconds: 0, startedAt: null });

// Curtailment state comes entirely from the backend — there is no localStorage
// equivalent of startedAt here, because the backend already reports
// requestedAt and remainingSeconds authoritatively.
const curtailStatus = ref({
  active: false, targetWatts: null, targetPct: null, verifiedPct: null,
  remainingSeconds: null, source: null, degraded: false, baseLimitW: null,
});

// Whether any module currently provides solar:curtail. Nothing is shown until
// this is confirmed — better a missing card than a button that 503s.
const hasCurtail = ref(false);

const charge    = ref({ watts: 2000, targetSOC: 100,  durationHours: 4 });
const discharge = ref({ watts: 2000, minimumSOC: 20,  durationHours: 2 });

// 400 W default ≈ household baseline draw. Above the ~30-60 W threshold at
// which a single-phase inverter drops its output relays, so the inverter
// stays online and resumes instantly rather than needing a reconnect cycle.
const curtail   = ref({ watts: 400, durationHours: 2 });

const curtailMinW = 100;
// Fall back to 3000 W until the backend reports the inverter's real base.
const curtailMaxW = computed(() => Math.round(curtailStatus.value.baseLimitW || 3000));

const confirm = ref({ visible: false, message: '', cb: null });

function fmtDuration(seconds) {
  const s = seconds || 0;
  if (!s) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}u ${m}m` : `${m}m`;
}

const remaining        = computed(() => fmtDuration(status.value.remainingSeconds));
const curtailRemaining = computed(() => fmtDuration(curtailStatus.value.remainingSeconds));

function ask(message, cb) {
  confirm.value = { visible: true, message, cb };
}

function runConfirm() {
  confirm.value.visible = false;
  confirm.value.cb?.();
}

async function doCharge() {
  const { watts, targetSOC, durationHours } = charge.value;
  ask(t('control.confirmCharge', { watts, targetSOC, durationHours }), async () => {
    charging.value = true;
    try {
      await apiClient.post('/capability/battery/charge-from-grid', { watts, targetSOC, durationHours });
      setStartedAt();
      toast.add({ severity: 'success', summary: t('control.chargingStarted'), detail: `${watts} W → ${targetSOC}%` });
      await loadStatus();
    } catch (e) {
      toast.add({ severity: 'error', summary: t('common.error'), detail: e.response?.data?.error || e.message });
    } finally {
      charging.value = false;
    }
  });
}

async function doDischarge() {
  const { watts, minimumSOC, durationHours } = discharge.value;
  ask(t('control.confirmDischarge', { watts, minimumSOC, durationHours }), async () => {
    discharging.value = true;
    try {
      await apiClient.post('/capability/battery/discharge-to-grid', { watts, minimumSOC, durationHours });
      setStartedAt();
      toast.add({ severity: 'success', summary: t('control.dischargingStarted'), detail: `${watts} W, min ${minimumSOC}%` });
      await loadStatus();
    } catch (e) {
      toast.add({ severity: 'error', summary: t('common.error'), detail: e.response?.data?.error || e.message });
    } finally {
      discharging.value = false;
    }
  });
}

async function doCurtail() {
  const { watts, durationHours } = curtail.value;
  ask(t('control.confirmCurtail', { watts, durationHours }), async () => {
    curtailing.value = true;
    try {
      await apiClient.post('/capability/solar/curtail', { watts, durationHours, source: 'manual' });
      // The provider applies this on its next collection cycle, so the limit
      // is not in force the instant this resolves. Say so rather than
      // implying it is already done.
      toast.add({
        severity: 'success',
        summary:  t('control.curtailRequested'),
        detail:   t('control.curtailApplyingShortly', { watts }),
      });
      await loadCurtailStatus();
    } catch (e) {
      toast.add({ severity: 'error', summary: t('common.error'), detail: e.response?.data?.message || e.response?.data?.error || e.message });
    } finally {
      curtailing.value = false;
    }
  });
}

async function doCurtailStop() {
  curtailStopping.value = true;
  try {
    await apiClient.post('/capability/solar/curtail/stop', { source: 'manual' });
    toast.add({ severity: 'success', summary: t('control.curtailStopped') });
    await loadCurtailStatus();
  } catch (e) {
    toast.add({ severity: 'error', summary: t('common.error'), detail: e.response?.data?.message || e.response?.data?.error || e.message });
  } finally {
    curtailStopping.value = false;
  }
}

async function doStop() {
  stopping.value = true;
  try {
    await apiClient.post('/capability/battery/stop');
    clearStartedAt();
    toast.add({ severity: 'success', summary: t('control.dispatchStopped') });
    await loadStatus();
  } catch (e) {
    toast.add({ severity: 'error', summary: t('common.error'), detail: e.response?.data?.error || e.message });
  } finally {
    stopping.value = false;
  }
}

async function loadStatus() {
  try {
    // apiClient returns the standard axios response object — it does NOT
    // unwrap. Use res.data. The `?? payload` fallback is kept only as a
    // defensive measure in case an interceptor is added later.
    const payload = await apiClient.get('/capability/battery/status');
    const d = payload?.data ?? payload;
    status.value = {
      active:           d.active      || false,
      charging:         d.charging    || false,
      discharging:      d.discharging || false,
      watts:            d.watts       || 0,
      remainingSeconds: d.remainingSeconds || 0,
      startedAt:        (d.active && startedAt.value) ? startedAt.value : null,
    };
    if (!d.active) clearStartedAt();
  } catch { /* not critical */ }
}

async function loadCurtailStatus() {
  if (!hasCurtail.value) return;
  try {
    const payload = await apiClient.get('/capability/solar/curtail/status');
    const d = payload?.data ?? payload;
    curtailStatus.value = {
      active:           d.active           || false,
      targetWatts:      d.targetWatts      ?? null,
      targetPct:        d.targetPct        ?? null,
      verifiedPct:      d.verifiedPct      ?? null,
      remainingSeconds: d.remainingSeconds ?? null,
      source:           d.source           ?? null,
      degraded:         d.degraded         || false,
      baseLimitW:       d.baseLimitW       ?? null,
    };
  } catch { /* not critical */ }
}

/**
 * Ask the backend which capabilities are currently registered, and show the
 * curtail card only if solar:curtail is among them.
 *
 * Provider-agnostic on purpose. After the DC-coupled migration the provider
 * may be AlphaESS rather than SolarEdge; this component should not have to
 * change for that.
 */
async function loadCapabilities() {
  try {
    const payload = await apiClient.get('/capability');
    const d = payload?.data ?? payload;
    const list = d?.capabilities ?? [];
    hasCurtail.value = list.some(c => c.type === 'solar:curtail');
  } catch {
    hasCurtail.value = false;
  }
}

// Poll every 30 s so remaining time and startedAt stay current after login
let pollTimer = null;

onMounted(async () => {
  await loadCapabilities();
  loadStatus();
  loadCurtailStatus();
  pollTimer = setInterval(() => {
    loadStatus();
    loadCurtailStatus();
  }, 30_000);
});

onUnmounted(() => {
  clearInterval(pollTimer);
});
</script>

<style scoped>
.dispatch-panel         { display: flex; flex-direction: column; gap: 1rem; }

/* ── Status bar ──────────────────────────────────────────────────────────── */
.status-bar             { display: flex; align-items: center; gap: 0.75rem;padding: 0.625rem 0.875rem; background: var(--color-background); border: 1px solid var(--border-color); border-radius: var(--radius-md); }
.status-bar__dot        { width: 14px; height: 14px;border-radius: 50%;background: var(--color-primary);flex-shrink: 0;animation: pulse 3s infinite;}
.status-bar--warn       { border-color: #f59e0b; background: #fffbeb; }
.status-bar--warn .status-bar__dot { background: #f59e0b; }
.status-bar__warn       { color: #b45309; font-weight: 600; }
.range::-webkit-slider-thumb
                        { border-radius: 0%!important;background-color: var(--color-primary);}
.range                  { border-radius: var(--radius-md);}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: .1; }
}

.status-bar__text       { flex: 1;font-size: 0.8125rem;color: var(--color-secondary-700);font-weight: 500;}

/* ── Card grid ────────────────────────────────────────────────────────────── */
.dispatch-grid          { display: grid;grid-template-columns: 1fr 1fr 1fr;gap: 0.75rem;}
.dispatch-grid--two     { grid-template-columns: 1fr 1fr; }

@media (max-width: 720px) {
  .dispatch-grid,
  .dispatch-grid--two { grid-template-columns: 1fr; }
}

/* ── Individual card ──────────────────────────────────────────────────────── */
.dcard                  { display: flex;flex-direction: column;gap: 1rem;padding: 1.25rem;border-radius: var(--radius-lg);background-color: var(--color-background); }

.dcard__header          { display: flex; flex-direction: column; gap: 0.25rem; }
.dcard__title           { font-size: 0.875rem; font-weight: 600; color: var(--color-primary); }
.dcard__sub             { font-size: 0.775rem; color: #6b7280; }

.fields                 { display: flex; flex-direction: column; gap: 0.875rem; }
.field__value           { font-size: 0.875rem; font-weight: 600; color: var(--color-primary)!important; }

/* ── Summary line ─────────────────────────────────────────────────────────── */
.dcard__summary         { font-size: 0.775rem;font-weight: 500;color: var(--color-secondary-700);background: var(--color-background);padding: 0.5rem 0.75rem;border-radius: 4px;}
</style>