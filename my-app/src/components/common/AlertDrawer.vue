<!-- src/components/common/AlertDrawer.vue -->
<!--
  Alert history drawer. Triggered by a bell icon in the header.
  Two tabs: Active (unresolved) and History (resolved/dismissed).
  Uses AppDrawer for the slide-in panel.

  Action button logic for the Active tab, per alert.action:
    - 'CONFIRM_OR_DECLINE'  → Confirm/Decline pair (or a responded label once
                              answered). Used by strategyManager's held-action
                              alerts (load anomaly, UPS-mode). Calls
                              POST /alerts/:id/respond — distinct from resolve,
                              not admin-gated, answers a yes/no question rather
                              than globally clearing the alert.
    - any other truthy value → unchanged: single lightning-bolt button that
                              calls resolve() (global, admin-only).
-->
<template>

  <!-- ── Bell trigger button ───────────────────────────────────────────────── -->
  <button class="alert-bell" @click="open = true" :title="t('alerts.openDrawer')">
    <i class="ph-light ph-bell"></i>
    <span v-if="alertStore.hasAlerts" class="alert-bell__badge">
      {{ alertStore.alerts.length > 9 ? '9+' : alertStore.alerts.length }}
    </span>
  </button>

  <!-- ── Drawer ────────────────────────────────────────────────────────────── -->
  <AppDrawer v-model:visible="open" :title="t('alerts.drawerTitle')">

    <!-- Tab bar -->
    <div class="ad-tabs">
      <button
        class="ad-tab" :class="{ 'ad-tab--active': tab === 'active' }"
        @click="tab = 'active'"
      >
        <i class="ph-light ph-bell mr-1.5"></i>
        {{ t('alerts.tabActive') }}
        <span v-if="alertStore.alerts.length" class="ad-tab__count">
          {{ alertStore.alerts.length }}
        </span>
      </button>
      <button
        class="ad-tab" :class="{ 'ad-tab--active': tab === 'history' }"
        @click="onHistoryTab"
      >
        <i class="ph-light ph-clock-clockwise mr-1.5"></i>
        {{ t('alerts.tabHistory') }}
      </button>
    </div>

    <!-- ── Active tab ─────────────────────────────────────────────────────── -->
    <div v-if="tab === 'active'" class="ad-list">
      <div v-if="!alertStore.alerts.length" class="ad-empty">
        <i class="ph-light ph-check-circle text-2xl text-secondary-300 mb-2"></i>
        <span>{{ t('alerts.noActive') }}</span>
      </div>
      <div
        v-for="alert in alertStore.alerts"
        :key="alert.id"
        class="ad-item"
        :class="severityClass(alert.severity)"
      >
        <div class="ad-item__icon">
          <i class="ph-light" :class="severityIcon(alert.severity)"></i>
        </div>
        <div class="ad-item__body">
          <div class="ad-item__source">{{ alert.source }} · {{ formatDate(alert.created_at) }}</div>
          <div class="ad-item__message">{{ alert.message }}</div>
          <div v-if="alert.suggestion" class="ad-item__suggestion">{{ alert.suggestion }}</div>
        </div>
        <div class="ad-item__actions">

          <!-- ── Confirm/decline pair — held strategy actions ───────────────── -->
          <template v-if="alert.action === 'CONFIRM_OR_DECLINE'">
            <span
              v-if="alert.user_response"
              class="ad-responded"
              :class="alert.user_response === 'confirmed' ? 'ad-responded--confirmed' : 'ad-responded--declined'"
            >
              <i class="ph-light" :class="alert.user_response === 'confirmed' ? 'ph-check' : 'ph-prohibit'"></i>
              {{ alert.user_response === 'confirmed' ? t('alerts.confirmed') : t('alerts.declined') }}
            </span>
            <template v-else>
              <button
                class="ad-btn ad-btn--primary"
                :disabled="responding === alert.id"
                @click="respond(alert.id, 'confirmed')"
                :title="t('alerts.confirmAction')"
              >
                <i class="ph-light" :class="responding === alert.id ? 'ph-circle-notch ph-spin' : 'ph-check'"></i>
              </button>
              <button
                class="ad-btn ad-btn--ghost"
                :disabled="responding === alert.id"
                @click="respond(alert.id, 'declined')"
                :title="t('alerts.declineAction')"
              >
                <i class="ph-light ph-prohibit"></i>
              </button>
            </template>
          </template>

          <!-- ── Every other alert type — unchanged from before ─────────────── -->
          <button
            v-else-if="alert.action"
            class="ad-btn ad-btn--primary"
            :disabled="executing === alert.id"
            @click="resolve(alert.id)"
            :title="t('alerts.confirm')"
          >
            <i class="ph-light" :class="executing === alert.id ? 'ph-circle-notch ph-spin' : 'ph-lightning'"></i>
          </button>

          <button
            class="ad-btn ad-btn--ghost"
            @click="dismiss(alert.id)"
            :title="t('alerts.dismiss')"
          >
            <i class="ph-light ph-x"></i>
          </button>
        </div>
      </div>
    </div>

    <!-- ── History tab ────────────────────────────────────────────────────── -->
    <div v-if="tab === 'history'" class="ad-list">
      <div v-if="historyLoading" class="ad-empty">
        <i class="ph-light ph-spinner-third ph-spin text-2xl text-secondary-300"></i>
      </div>
      <div v-else-if="!history.length" class="ad-empty">
        <i class="ph-light ph-inbox text-2xl text-secondary-300 mb-2"></i>
        <span>{{ t('alerts.noHistory') }}</span>
      </div>
      <div
        v-for="alert in history"
        :key="alert.id"
        class="ad-item ad-item--resolved"
        :class="severityClass(alert.severity)"
      >
        <div class="ad-item__icon">
          <i class="ph-light" :class="severityIcon(alert.severity)"></i>
        </div>
        <div class="ad-item__body">
          <div class="ad-item__source">{{ alert.source }} · {{ formatDate(alert.created_at) }}</div>
          <div class="ad-item__message">{{ alert.message }}</div>
          <div v-if="alert.suggestion" class="ad-item__suggestion">{{ alert.suggestion }}</div>
          <div v-if="alert.user_response" class="ad-item__resolved-at">
            <i class="ph-light" :class="alert.user_response === 'confirmed' ? 'ph-check' : 'ph-prohibit'"></i>
            {{ alert.user_response === 'confirmed' ? t('alerts.confirmed') : t('alerts.declined') }}
          </div>
          <div class="ad-item__resolved-at" v-if="alert.resolved_at">
            <i class="ph-light ph-check mr-1"></i>{{ t('alerts.resolvedAt') }} {{ formatDate(alert.resolved_at) }}
          </div>
        </div>
        <div class="ad-item__actions">
          <button
            class="ad-btn ad-btn--ghost"
            @click="reResolve(alert.id)"
            :title="t('alerts.reResolve')"
          >
            <i class="ph-light ph-arrow-clockwise"></i>
          </button>
        </div>
      </div>
    </div>

  </AppDrawer>
</template>

<script setup>
import { ref, watch } from 'vue';
import { useAlertStore } from '@/stores/alerts';
import { useLocale }     from '@/composables/useLocale';
import apiClient         from '@/services/api';
import AppDrawer         from '@/components/common/AppDrawer.vue';

const alertStore = useAlertStore();
const { t }      = useLocale();

const open    = ref(false);
const tab     = ref('active');

// ── History ───────────────────────────────────────────────────────────────
const history        = ref([]);
const historyLoading = ref(false);
const historyLoaded  = ref(false);

async function fetchHistory() {
  if (historyLoaded.value) return;
  historyLoading.value = true;
  try {
    const res = await apiClient.get('/alerts/history');
    history.value = res.data?.alerts ?? [];
    historyLoaded.value = true;
  } catch (e) {
    console.error('AlertDrawer: failed to fetch history:', e.message);
  } finally {
    historyLoading.value = false;
  }
}

function onHistoryTab() {
  tab.value = 'history';
  fetchHistory();
}

// Reload history when drawer reopens on history tab
watch(open, v => { if (v && tab.value === 'history') historyLoaded.value = false; });

// ── Actions ───────────────────────────────────────────────────────────────
const executing  = ref(null);
const responding = ref(null);

async function dismiss(id) {
  await alertStore.dismissAlert(id);
}

async function resolve(id) {
  executing.value = id;
  try {
    await alertStore.resolveAlert(id);
    // Move to history list immediately
    historyLoaded.value = false;
    if (tab.value === 'history') fetchHistory();
  } finally {
    executing.value = null;
  }
}

// Confirm/decline for held strategy actions (CONFIRM_OR_DECLINE alerts).
// Bypasses the store and calls apiClient directly — same precedent as
// reResolve() below — since this answers a per-user question rather than
// changing the alert's global resolved state the store tracks.
async function respond(id, response) {
  responding.value = id;
  try {
    await apiClient.post(`/alerts/${id}/respond`, { response });
    // Optimistically reflect the response locally so the buttons swap to
    // the "responded" label immediately, without waiting for the next poll.
    const alert = alertStore.alerts.find(a => a.id === id);
    if (alert) alert.user_response = response;
  } catch (e) {
    console.error('AlertDrawer: respond failed:', e.message);
  } finally {
    responding.value = null;
  }
}

async function reResolve(id) {
  try {
    await apiClient.post(`/alerts/${id}/resolve`);
    history.value = history.value.filter(a => a.id !== id);
  } catch (e) {
    console.error('AlertDrawer: re-resolve failed:', e.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function severityClass(severity) {
  return {
    'ad-item--warning': severity === 'warning',
    'ad-item--error':   severity === 'error',
    'ad-item--info':    severity === 'info',
  };
}

function severityIcon(severity) {
  switch (severity) {
    case 'error':   return 'ph-warning-circle';
    case 'warning': return 'ph-warning';
    default:        return 'ph-info';
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  const d  = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mo} ${hh}:${mm}`;
}
</script>

<style scoped>
/* ── Bell button ───────────────────────────────────────────────────────── */
.alert-bell       { position: relative;display: flex; align-items: center; justify-content: center;width: 2rem; height: 2rem;background: none; border: none; cursor: pointer;;border-radius: var(--radius-sm);transition: color 0.12s, background 0.12s;}
.alert-bell:hover { color: var(--color-text-primary); background: var(--color-secondary-200); }
.alert-bell__badge{ position: absolute; top: 2px; right: 2px;min-width: 1rem; height: 1rem;background: #ef4444; color: #fff;font-size: 0.6rem; font-weight: 700;border-radius: 999px;display: flex; align-items: center; justify-content: center;padding: 0 3px;line-height: 1;}

/* ── Tabs ──────────────────────────────────────────────────────────────── */
.ad-tabs          { display: flex;border-bottom: 1px solid var(--color-secondary-200);margin: 0 -1.25rem;padding: 0 1.25rem;gap: 0;flex-shrink: 0;}
.ad-tab           { display: flex; align-items: center;padding: 0.625rem 0.875rem;font-size: 0.8125rem; font-weight: 500;color: var(--color-text-secondary);background: none; border: none;border-bottom: 2px solid transparent;cursor: pointer;transition: color 0.12s, border-color 0.12s;white-space: nowrap;}
.ad-tab:hover          { color: var(--color-text-primary); }
.ad-tab--active        { color: var(--color-text-primary); border-bottom-color: var(--color-primary); }
.ad-tab__count {
  margin-left: 0.375rem;
  background: var(--color-secondary-200);
  color: var(--color-text-secondary);
  font-size: 0.65rem; font-weight: 700;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
}

/* ── Alert list ────────────────────────────────────────────────────────── */
.ad-list {
  display: flex; flex-direction: column;
  gap: 0;
  overflow-y: auto;
  flex: 1;
  margin: 0 -1.25rem;
}

.ad-empty {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 3rem 1rem;
  color: var(--color-text-secondary);
  font-size: 0.8125rem;
}

/* ── Alert item ────────────────────────────────────────────────────────── */
.ad-item {
  display: flex; align-items: flex-start; gap: 0.75rem;
  padding: 0.875rem 1.25rem;
  border-bottom: 1px solid var(--color-secondary-100);
  border-left: 3px solid transparent;
  transition: background 0.1s;
}
.ad-item:hover            { background: var(--color-secondary-50); }
.ad-item--resolved        { opacity: 0.95; }
.ad-item--resolved:hover  { opacity: 1; }
.ad-item--warning         { border-left-color: #e9ac43; }
.ad-item--error           { border-left-color: #791616; }
.ad-item--info            { border-left-color: #5594f8; }

.ad-item__icon            {font-size: 0.9rem;margin-top: 0.15rem;flex-shrink: 0;}
.ad-item--warning .ad-item__icon { color: #f59e0b; }
.ad-item--error   .ad-item__icon { color: #ef4444; }
.ad-item--info    .ad-item__icon { color: #3b82f6; }

.ad-item__body       { flex: 1; min-width: 0; }
.ad-item__source     { font-size: 0.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-secondary); margin-bottom: 0.2rem; }
.ad-item__message    { font-size: 0.8125rem; font-weight: 600; color: var(--color-text-primary); line-height: 1.4; }
.ad-item__suggestion { font-size: 0.75rem; color: var(--color-text-secondary); margin-top: 0.25rem; line-height: 1.4; }
.ad-item__resolved-at { font-size: 0.7rem; color: var(--color-text-secondary); margin-top: 0.375rem; }

.ad-item__actions {
  display: flex; gap: 0.25rem;
  flex-shrink: 0;
  margin-top: 0.1rem;
}

/* ── Action buttons ────────────────────────────────────────────────────── */
.ad-btn {
  display: flex; align-items: center; justify-content: center;
  width: 1.75rem; height: 1.75rem;
  border: none; border-radius: var(--radius-sm);
  cursor: pointer; font-size: 0.8rem;
  transition: background 0.12s, opacity 0.12s;
}
.ad-btn:disabled      { opacity: 0.45; cursor: wait; }
.ad-btn--primary      { background: var(--color-primary); color: #fff; }
.ad-btn--primary:hover:not(:disabled) { opacity: 0.85; }
.ad-btn--ghost        { background: transparent; color: var(--color-text-secondary); }
.ad-btn--ghost:hover  { background: var(--color-secondary-200); color: var(--color-text-primary); }

/* ── Responded label (confirm/decline already answered) ───────────────── */
.ad-responded {
  display: flex; align-items: center; gap: 0.25rem;
  font-size: 0.7rem; font-weight: 600;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  white-space: nowrap;
}
.ad-responded--confirmed { background: #dcfce7; color: #15803d; }
.ad-responded--declined  { background: #fee2e2; color: #b91c1c; }
</style>