<!--
  DashboardHost.vue — resolves and switches the dashboard variant.

  One route, two views. The URL never changes when the variant does, so
  bookmarks, the nav and the router guards stay valid.

  Resolution order
    1. ?view=simple | ?view=advanced   — override, for side-by-side testing
    2. settings: dashboard.view_variant
    3. localStorage                    — fallback when settings are unreachable
    4. 'simple'                        — default for fresh installs

  The toggle lives here rather than inside either view: a control inside
  DashboardSimple only would let you switch away from it and never back,
  because Dashboard.vue has no such control.
-->

<template>
  <div class="dashboard-host">
    <div v-if="resolved" class="dh-toolbar">
      <div class="dh-toggle" role="group" :aria-label="t('dashboard.viewVariant')">
        <button
          v-for="opt in options"
          :key="opt.value"
          type="button"
          class="dh-toggle-btn"
          :class="{ 'is-active': variant === opt.value }"
          :aria-pressed="variant === opt.value"
          @click="select(opt.value)"
        >
          <i :class="opt.icon" aria-hidden="true"></i>
          <span>{{ t(opt.labelKey) }}</span>
        </button>
      </div>
    </div>

    <component :is="resolved" v-if="resolved" />

    <div v-else class="dh-skeleton" aria-hidden="true">
      <div class="dh-skeleton-grid">
        <div v-for="n in 4" :key="n" class="dh-skeleton-badge"></div>
      </div>
      <div class="dh-skeleton-side"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, shallowRef, defineAsyncComponent, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import apiClient from '../services/api';
import { useLocale } from '../composables/useLocale';
/*
  Async, not static. A static import of both variants ships two dashboards to
  every visitor to render one — and the combined bundle is what pushed the
  main chunk past the 2 MiB precache limit. Each variant is now its own chunk,
  fetched only when selected.
*/
const DashboardSimple = defineAsyncComponent(() => import('./DashboardSimple.vue'));
const Dashboard = defineAsyncComponent(() => import('./Dashboard.vue'));

const route = useRoute();
const { t } = useLocale();

const VARIANTS = { simple: DashboardSimple, advanced: Dashboard };
const DEFAULT_VARIANT = 'simple';
const STORAGE_KEY = 'wolffie.dashboard.view_variant';

const options = [
  { value: 'simple',   labelKey: 'dashboard.viewSimple',   icon: 'ph-light ph-squares-four' },
  { value: 'advanced', labelKey: 'dashboard.viewAdvanced', icon: 'ph-light ph-graph' },
];

const resolved = shallowRef(null);
const variant = ref(null);

function apply(name) {
  variant.value = VARIANTS[name] ? name : DEFAULT_VARIANT;
  resolved.value = VARIANTS[variant.value];
}

function readLocal() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLocal(name) {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    /* private mode or storage disabled — the settings row is the real store */
  }
}

async function resolve() {
  // 1. query override wins and skips the settings call entirely
  const q = String(route.query.view || '').toLowerCase();
  if (VARIANTS[q]) {
    apply(q);
    return;
  }

  // 2. stored preference
  try {
    const res = await apiClient.get('/settings/dashboard');
    const stored = res.data?.view_variant;
    if (VARIANTS[stored]) {
      apply(stored);
      writeLocal(stored);
      return;
    }
  } catch {
    /* settings unreachable — fall through */
  }

  // 3. last known choice on this device, else 4. the default
  apply(readLocal() || DEFAULT_VARIANT);
}

/**
 * Switch immediately, then persist. The UI never waits on the write: if the
 * settings call fails the choice still survives on this device.
 */
async function select(name) {
  if (!VARIANTS[name] || name === variant.value) return;
  apply(name);
  writeLocal(name);
  try {
    await apiClient.put('/settings/dashboard', { view_variant: name });
  } catch {
    /* local copy already holds it */
  }
}

onMounted(resolve);
watch(() => route.query.view, resolve);
</script>

<style scoped>
.dashboard-host           { position: relative;}
.dh-toolbar               { max-width: var(--max-width);margin: 0 auto;padding: 0.75rem 1.5rem 0;display: flex;justify-content: flex-end;}
.dh-toggle                { display: inline-flex;gap: 4px;padding: 4px;border-radius: 50%;background: var(--color-background);}
.dh-toggle-btn            { display: inline-flex;align-items: center;gap: 0.375rem;padding: 0.25rem 0.625rem;font-size: 12px;color: var(--color-secondary-400);line-height: 1.4;border-radius: var(--radius-sm);background: transparent;cursor: pointer;}
.dh-toggle-btn.is-active  { background: var(--card-bg-color);font-weight: 600;border-radius: var(--radius-xl);border:1px solid var(--border-color);color: var(--color-primary);}
.dh-skeleton              { max-width: var(--max-width);margin: 0 auto;padding: 1.5rem;display: grid;grid-template-columns: 1fr;gap: 0.625rem;animation: dh-pulse 1.6s ease-in-out infinite;}
.dh-skeleton-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.625rem;
}

.dh-skeleton-badge {
  height: 150px;
  border-radius: var(--border-radius);
  background: var(--color-secondary-100);
}

.dh-skeleton-side {
  display: none;
  border-radius: var(--border-radius);
  background: var(--color-secondary-100);
}

@media (min-width: 1024px) {
  .dh-skeleton {
    grid-template-columns: 2fr 1fr;
  }
  .dh-skeleton-side {
    display: block;
  }
}

@keyframes dh-pulse {
  50% { opacity: 0.6; }
}
</style>