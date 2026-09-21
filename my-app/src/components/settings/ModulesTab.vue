<template>
  <div class="modules-panel">

    <AppTable
      :items="mergedRows"
      :columns="columns"
      :loading="loadingModules || loadingCollectors"
      :empty-text="t('modulesTab.empty')"
    >
      <template #toolbar-left>
         <span
          class="manager-badge"
          :class="managerRunning ? 'manager-badge--ok' : 'manager-badge--err'"
          :title="t('collectors.manager')"
        >
          <span class="manager-dot" />
          {{ managerRunning ? t('collectors.running') : t('collectors.stopped') }}
          <span class="last-refresh">{{ lastRefreshLabel }}</span>
        </span>
        
      </template>

      <template #toolbar-right>
       
        <button class="btn btn--sm" :class="{ 'btn--busy': loadingModules || loadingCollectors }" @click="refreshAll">
          {{ t('common.refresh') }}
        </button>
        <button class="btn btn--sm btn--primary" @click="openUpload">
          <i class="ph-light ph-cloud-arrow-up mr-1" />
          {{ t('modulesTab.install_btn') }}
        </button>
      </template>

      <!-- ── Status dot ────────────────────────────────────────────────── -->
      <template #_status="{ value }">
        <span
          class="status-dot"
          :class="collectorDotClass(value)"
          :title="collectorDotLabel(value)"
        />
      </template>

      <!-- ── Name + description ────────────────────────────────────────── -->
      <template #name="{ value }">
        <div class="text-sm font-medium text-secondary-900">{{ value.name }}</div>
        <div class="text-xs text-secondary-400 mt-0.5">{{ value.description }}</div>
      </template>

      <!-- ── Version ───────────────────────────────────────────────────── -->
      <template #version="{ value }">
        <span class="font-mono text-xs text-secondary-600">
          {{ value.version ? 'v' + value.version : '—' }}
        </span>
      </template>

      <!-- ── Type badge ────────────────────────────────────────────────── -->
      <template #_type="{ value }">
        <span class="type-badge">{{ value.type }}</span>
      </template>

      <!-- ── Last collected ────────────────────────────────────────────── -->
      <template #_lastRun="{ value }">
        <template v-if="value._collector">
          <span class="meta-value" :class="{ stale: isStale(value._collector) }">
            {{ formatLastRun(value._collector) }}
          </span>
        </template>
        <span v-else class="text-xs text-secondary-300">—</span>
      </template>

      <!-- ── Next run ──────────────────────────────────────────────────── -->
      <template #_nextRun="{ value }">
        <template v-if="value._collector">
          <span class="meta-value">{{ formatNextRun(value._collector) }}</span>
        </template>
        <span v-else class="text-xs text-secondary-300">—</span>
      </template>

      <!-- ── Interval ──────────────────────────────────────────────────── -->
      <template #_interval="{ value }">
        <span class="font-mono text-xs text-secondary-500">
          {{ value.collector ? formatInterval(value.collector.interval) : '—' }}
        </span>
      </template>

      <!-- ── Errors ────────────────────────────────────────────────────── -->
      <template #_errors="{ value }">
        <template v-if="value._collector?.consecutiveErrors > 0">
          <span class="error-count" :title="value._collector.lastError ?? ''">
            <i class="ph-fill ph-circle-exclamation" />
            {{ value._collector.consecutiveErrors }}
          </span>
        </template>
        <span v-else class="text-xs text-secondary-300">—</span>
      </template>

      <!-- ── Actions ───────────────────────────────────────────────────── -->
      <template #_actions="{ value }">
        <div class="row-actions" :class="{ 'row-actions--always-visible': isMobile }">
          <!-- Restart — only when collector is paused/disabled -->
          <button
            v-if="value._collector && (value._collector.paused || !isEnabled(value._collector))"
            class="icon-btn"
            :title="t('collectors.restart')"
            :disabled="restarting === value.id"
            @click="restart(value.id)"
          >
            <i v-if="restarting === value.id" class="ph-duotone ph-spinner-third ph-spin" />
            <i v-else class="ph-light ph-play" />
          </button>
          <!-- Edit settings — only when module has a schema -->
          <button
            v-if="value.has_schema"
            class="icon-btn"
            :title="t('modulesTab.edit_settings')"
            @click="openSettings(value)"
          >
            <i class="ph-light ph-sliders" />
          </button>
          <button class="icon-btn" :title="t('modulesTab.manifest_view')" @click="openManifest(value)">
            <i class="ph-light ph-file-code" />
          </button>
          <button class="icon-btn" :title="t('modulesTab.update_btn')" @click="openUpdate(value)">
            <i class="ph-light ph-arrow-line-up" />
          </button>
          <button class="icon-btn icon-btn--danger" :title="t('modulesTab.uninstall')" @click="askRemove(value)">
            <i class="ph-light ph-trash" />
          </button>
        </div>
      </template>
    </AppTable>

    <!-- Error banner for collector errors -->
    <div v-if="collectorError" class="error-banner">
      <i class="ph-fill ph-triangle-exclamation" /> {{ collectorError }}
    </div>

    <!-- ── Settings drawer ───────────────────────────────────────────── -->
    <AppDrawer
      v-model:visible="settingsDrawer.visible"
      :title="settingsDrawer.module?.name ?? ''"
    >
      <div class="drawer-settings-wrap">
        <UniversalSettingsPanel
          v-if="settingsDrawer.module"
          :key="settingsDrawer.module.id"
          :module-id="settingsDrawer.module.id"
          :drawer-mode="true"
          @saved="settingsDrawer.visible = false; refreshAll()"
          @cancelled="settingsDrawer.visible = false; refreshAll()"
        />
      </div>

      <template #footer>
        <button class="btn btn--sm" @click="settingsDrawer.visible = false; refreshAll()">
          {{ t('common.close') }}
        </button>
      </template>
    </AppDrawer>

    <!-- ── Install / Update drawer ───────────────────────────────────── -->
    <AppDrawer
      v-model:visible="uploadDrawer.visible"
      :title="uploadDrawer.targetModule
        ? t('modulesTab.update_title', { name: uploadDrawer.targetModule.name })
        : t('modulesTab.install_title')"
    >
      <div class="drawer-section">
        <p class="text-xs text-secondary-400 mb-4">{{ t('modulesTab.install_desc') }}</p>

        <div
          class="drop-zone"
          :class="{
            'drop-zone--drag':     isDragging,
            'drop-zone--error':    uploadResult?.success === false,
            'drop-zone--has-file': !!pendingFile,
          }"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="onDrop"
          @click="fileInput.click()"
        >
          <input ref="fileInput" type="file" accept=".zip" class="hidden" @change="onFileSelected" />
          <i class="ph-light ph-cloud-arrow-up text-2xl text-secondary-400" />
          <div class="text-center">
            <p class="text-sm text-secondary-600">
              {{ t('modulesTab.drop') }}
              <span class="underline cursor-pointer">{{ t('modulesTab.browse') }}</span>
            </p>
            <p class="text-xs text-secondary-400 mt-0.5">{{ t('modulesTab.zip_hint') }}</p>
          </div>
        </div>

        <div v-if="pendingFile" class="mt-3 space-y-2">
          <div class="flex items-center gap-2 p-4 bg-secondary-100 border border-secondary-200 rounded text-sm text-secondary-700 w-fit">
            <i class="ph-light ph-file-zipper text-secondary-400" />
            <span>{{ pendingFile.name }}</span>
            <button class="ml-1 text-secondary-400 hover:text-secondary-600" @click.stop="clearPending">
              <i class="ph-fill ph-xmark text-xs" />
            </button>
          </div>
          <div v-if="pendingManifest" class="flex items-center gap-2">
            <div v-if="pendingIsUpdate" class="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded text-amber-700 text-xs font-medium">
              <i class="ph-fill ph-arrow-line-up" />
              {{ t('modulesTab.update_detected') }}:
              <span class="font-mono">{{ installedVersion(pendingManifest.id) }}</span>
              <i class="ph-fill ph-arrow-right text-[9px]" />
              <span class="font-mono">{{ pendingManifest.version }}</span>
            </div>
            <div v-else class="flex items-center gap-1.5 px-2.5 py-1.5 bg-green-50 border border-green-200 rounded text-green-700 text-xs font-medium">
              <i class="ph-fill ph-sparkles" />
              {{ t('modulesTab.new') }}: <span class="font-semibold ml-1">{{ pendingManifest.name }}</span>
            </div>
          </div>
          <div v-else-if="readingManifest" class="flex items-center gap-1.5 text-xs text-secondary-400">
            <i class="ph-duotone ph-spinner-third ph-spin" />
            {{ t('modulesTab.reading') }}
          </div>
        </div>

        <div class="drawer-divider mt-4" />

        <div class="form-field mt-4">
          <label class="form-label">
            {{ t('modulesTab.checksum') }}
            <span class="field-hint">— {{ t('common.optional') }}</span>
          </label>
          <input
            v-model="expectedChecksum"
            type="text"
            class="input font-mono text-xs"
            :placeholder="t('modulesTab.checksum_placeholder')"
          />
        </div>

        <div
          v-if="uploadResult"
          class="mt-4 flex items-start gap-3 p-4 rounded border text-xs"
          :class="uploadResult.success ? 'bg-green-100 border-green-200 text-green-800' : 'bg-red-100 border-red-200 text-red-800'"
        >
          <i class="mt-0.5 ph-fill flex-shrink-0"
             :class="uploadResult.success ? 'ph-circle-check' : 'ph-triangle-exclamation'" />
          <div class="flex-1 min-w-0">
            <p class="font-semibold">
              {{ uploadResult.success
                ? (uploadResult.wasUpdate ? t('modulesTab.updated') : t('modulesTab.installed'))
                : t('modulesTab.install_failed') }}
            </p>
            <p class="mt-0.5 opacity-80">{{ uploadResult.message }}</p>
            <p v-if="uploadResult.checksum" class="mt-1 font-mono opacity-60 break-all">SHA-256: {{ uploadResult.checksum }}</p>
            <p v-if="uploadResult.success && !uploadResult.hotLoaded" class="mt-1 font-medium">
              <i class="ph-fill ph-triangle-exclamation mr-1" />
              {{ t('modulesTab.restart_required') }}
            </p>
          </div>
          <button class="opacity-40 hover:opacity-80" @click="uploadResult = null">
            <i class="ph-fill ph-xmark" />
          </button>
        </div>
      </div>

      <template #footer>
        <button class="btn btn--sm" @click="uploadDrawer.visible = false">{{ t('common.cancel') }}</button>
        <button
          class="btn btn--sm btn--secondary"
          :class="{ 'btn--busy': uploading }"
          :disabled="!pendingFile || uploading"
          @click="installPending"
        >
          <i v-if="!uploading" :class="pendingIsUpdate ? 'ph-light ph-arrow-line-up' : 'ph-light ph-download'" class="mr-1" />
          {{ pendingIsUpdate ? t('modulesTab.update_btn') : t('modulesTab.install_btn') }}
        </button>
      </template>
    </AppDrawer>

    <!-- ── Manifest viewer drawer ────────────────────────────────────── -->
    <AppDrawer
      v-model:visible="manifestDrawer.visible"
      :title="t('modulesTab.manifest_view') + (manifestDrawer.module ? ': ' + manifestDrawer.module.name : '')"
    >
      <div v-if="manifestDrawer.module" class="drawer-section space-y-4">

        <!-- ── Identity ─────────────────────────────────────────────────── -->
        <div class="meta-grid">
          <div class="meta-card">
            <label>ID</label>
            <div class="meta-value font-mono">{{ manifestDrawer.module.id }}</div>
          </div>
          <div class="meta-card">
            <label>{{ t('modulesTab.col_version') }}</label>
            <div class="meta-value font-mono">v{{ manifestDrawer.module.version }}</div>
          </div>
          <div class="meta-card">
            <label>{{ t('modulesTab.col_type') }}</label>
            <div class="meta-value">{{ manifestDrawer.module.type }}</div>
          </div>
          <div class="meta-card">
            <label>{{ t('common.status') }}</label>
            <div class="meta-value flex items-center gap-1">
              <i :class="isEnabled(manifestDrawer.module._collector ?? manifestDrawer.module) ? 'ph-fill ph-circle text-green-500' : 'ph-fill ph-circle text-secondary-300'" style="font-size:8px" />
              {{ isEnabled(manifestDrawer.module._collector ?? manifestDrawer.module) ? (te('common.enabled') ? t('common.enabled') : 'Enabled') : (te('common.disabled') ? t('common.disabled') : 'Disabled') }}
            </div>
          </div>
          <div class="meta-card">
            <label>{{ t('modulesTab.col_author') }}</label>
            <div class="meta-value">{{ manifestDrawer.module.author || '—' }}</div>
          </div>
          <div v-if="manifestDrawer.module._lock?.installedAt || manifestDrawer.module.installed_at" class="meta-card">
            <label>{{ te('modulesTab.installed_at') ? t('modulesTab.installed_at') : 'Installed' }}</label>
            <div class="meta-value">{{ formatDate(manifestDrawer.module._lock?.installedAt ?? manifestDrawer.module.installed_at) }}</div>
          </div>
          <div v-if="manifestDrawer.module.last_seen_at" class="meta-card">
            <label>{{ te('modulesTab.last_seen') ? t('modulesTab.last_seen') : 'Last seen' }}</label>
            <div class="meta-value">{{ formatDate(manifestDrawer.module.last_seen_at) }}</div>
          </div>
          <div v-if="manifestDrawer.module._collector" class="meta-card">
            <label>{{ te('collectors.lastCollected') ? t('collectors.lastCollected') : 'Last collected' }}</label>
            <div class="meta-value">{{ formatLastRun(manifestDrawer.module._collector) }}</div>
          </div>
          <div v-if="manifestDrawer.module._lock?.checksumVerified !== undefined" class="meta-card">
            <label>{{ t('modulesTab.verified') }}</label>
            <div class="meta-value">{{ manifestDrawer.module._lock.checksumVerified ? '✓' : '—' }}</div>
          </div>
        </div>

        <!-- ── Capabilities ──────────────────────────────────────────────── -->
        <div v-if="manifestDrawer.module._manifest?.capabilities" class="space-y-1">
          <div class="manifest-section__title">{{ t('modulesTab.capabilities') }}</div>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="(val, cap) in manifestDrawer.module._manifest.capabilities" :key="cap"
              class="capability-pill" :class="val ? 'capability-pill--on' : 'capability-pill--off'"
            >
              <i :class="val ? 'ph-fill ph-check text-[9px]' : 'ph-fill ph-xmark text-[9px]'" />
              {{ cap }}
            </span>
          </div>
        </div>

        <!-- ── Collector ─────────────────────────────────────────────────── -->
        <div v-if="manifestDrawer.module._manifest?.collector" class="manifest-section">
          <div class="manifest-section__title">{{ t('modulesTab.manifest_collector') }}</div>
          <div v-if="manifestDrawer.module._manifest.collector.interval" class="manifest-row">
            <span>{{ t('modulesTab.manifest_interval') }}</span>
            <span class="font-mono">{{ formatInterval(manifestDrawer.module._manifest.collector.interval) }}</span>
          </div>
          <div v-if="manifestDrawer.module._manifest.collector.priority !== undefined" class="manifest-row">
            <span>{{ t('modulesTab.manifest_priority') }}</span>
            <span class="font-mono">{{ manifestDrawer.module._manifest.collector.priority }}</span>
          </div>
        </div>

        <!-- ── Services ──────────────────────────────────────────────────── -->
        <div v-if="manifestDrawer.module._manifest?.services?.length" class="manifest-section">
          <div class="manifest-section__title">Services</div>
          <div v-for="svc in manifestDrawer.module._manifest.services" :key="svc.type" class="manifest-row">
            <span class="font-mono text-xs">{{ svc.type }}</span>
            <span class="font-mono text-secondary-400 text-xs">priority {{ svc.priority }}</span>
          </div>
        </div>

        <!-- ── Routes ────────────────────────────────────────────────────── -->
        <div v-if="manifestDrawer.module._manifest?.routes" class="manifest-section">
          <div class="manifest-section__title">{{ t('modulesTab.manifest_routes') }}</div>
          <div v-if="manifestDrawer.module._manifest.routes.prefix" class="manifest-row">
            <span>{{ t('modulesTab.manifest_prefix') }}</span>
            <span class="font-mono text-secondary-600">{{ manifestDrawer.module._manifest.routes.prefix }}</span>
          </div>
        </div>

        <!-- ── Dependencies ──────────────────────────────────────────────── -->
        <div v-if="manifestDrawer.module._manifest?.dependencies" class="manifest-section">
          <div class="manifest-section__title">{{ t('modulesTab.manifest_dependencies') }}</div>
          <div v-for="(ver, dep) in manifestDrawer.module._manifest.dependencies" :key="dep" class="manifest-row">
            <span class="font-mono">{{ dep }}</span>
            <span class="font-mono text-secondary-500">{{ ver }}</span>
          </div>
        </div>

        <!-- ── Changelog ─────────────────────────────────────────────────── -->
        <div v-if="manifestDrawer.module._manifest?.changelog?.length" class="manifest-section">
          <div class="manifest-section__title">Changelog</div>
          <div v-for="entry in manifestDrawer.module._manifest.changelog" :key="entry.version" class="mt-3">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-mono text-xs font-semibold text-[var(--color-primary)]">v{{ entry.version }}</span>
              <span class="text-[10px] text-[var(--color-text-tertiary)]">{{ entry.date }}</span>
              <span v-if="entry.author" class="text-[10px] text-[var(--color-text-tertiary)]">— {{ entry.author }}</span>
            </div>
            <ul class="space-y-0.5 pl-3">
              <li v-for="(change, i) in entry.changes" :key="i"
                  class="text-[11px] text-[var(--color-text-secondary)] flex items-start gap-1.5">
                <i class="ph-light ph-circle-small text-[var(--color-primary)] mt-0.5 flex-shrink-0" style="font-size:8px"></i>
                {{ change }}
              </li>
            </ul>
          </div>
        </div>

        <!-- ── Checksum ──────────────────────────────────────────────────── -->
        <div v-if="manifestDrawer.module._lock?.checksum" class="manifest-section">
          <div class="manifest-section__title">SHA-256</div>
          <p class="font-mono text-[10px] text-secondary-400 break-all mt-1">{{ manifestDrawer.module._lock.checksum }}</p>
        </div>

      </div>

      <template #footer>
        <button class="btn btn--sm" @click="openUpdate(manifestDrawer.module); manifestDrawer.visible = false">
          <i class="ph-light ph-arrow-line-up mr-1" />{{ t('modulesTab.update_btn') }}
        </button>
        <button class="btn btn--sm btn--danger" @click="askRemove(manifestDrawer.module); manifestDrawer.visible = false">
          <i class="ph-light ph-trash mr-1" />{{ t('modulesTab.uninstall') }}
        </button>
      </template>
    </AppDrawer>

    <!-- ── Uninstall confirm modal ────────────────────────────────────── -->
    <AppModal
      v-model:visible="removeModalVisible"
      :message="t('modulesTab.uninstall_confirm', { name: removeTarget?.name })"
      :busy="removing"
      destructive
      @confirm="doRemove"
    />

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import apiClient from '@/services/api';
import { useToastStore } from '@/stores/toast';

import AppTable  from '@/components/common/AppTable.vue';
import AppDrawer from '@/components/common/AppDrawer.vue';
import AppModal  from '@/components/common/AppModal.vue';
import UniversalSettingsPanel from '@/components/settings/UniversalSettingsPanel.vue';

import '@/assets/styles/control.css';

const { t, te } = useI18n();
const toast = useToastStore();

const COLLECTOR_POLL_MS = 15_000;

// ── State ──────────────────────────────────────────────────────────────────
const modules           = ref([]);
const loadingModules    = ref(false);
const collectors        = ref([]);
const managerRunning    = ref(false);
const loadingCollectors = ref(false);
const collectorError    = ref(null);
const lastRefresh       = ref(null);
const restarting        = ref(null);
const isMobile          = ref(false);
let   pollTimer         = null;

// Upload drawer
const uploadDrawer     = ref({ visible: false, targetModule: null });
const fileInput        = ref(null);
const isDragging       = ref(false);
const pendingFile      = ref(null);
const pendingManifest  = ref(null);
const readingManifest  = ref(false);
const expectedChecksum = ref('');
const uploading        = ref(false);
const uploadResult     = ref(null);

// Manifest viewer drawer
const manifestDrawer = ref({ visible: false, module: null });

// Settings drawer
const settingsDrawer = ref({ visible: false, module: null });

// Remove modal
const removeTarget       = ref(null);
const removing           = ref(false);
const removeModalVisible = computed({
  get: () => !!removeTarget.value,
  set: (v) => { if (!v) removeTarget.value = null; },
});

// ── Merged rows — each module enriched with its live collector data ────────
const mergedRows = computed(() =>
  modules.value.map(m => ({
    ...m,
    // Attach live collector data if a matching collector exists (joined on id)
    _collector: collectors.value.find(c => c.id === m.id) ?? null,
  }))
);

// ── Columns ────────────────────────────────────────────────────────────────
const desktopColumns = computed(() => [
  { field: '_status',   title: '',                            slotMode: true, width: '1rem'  },
  { field: 'name',      title: t('modulesTab.col_name'),      slotMode: true ,width: '40rem' },
  { field: '_type',     title: t('modulesTab.col_type'),      slotMode: true, width: '8rem'  },
  { field: '_lastRun',  title: t('collectors.lastCollected'), slotMode: true, width: '2rem'  },
  { field: '_errors',   title: t('collectors.errors'),        slotMode: true  },
  { field: '_actions',  title: t('common.actions'),           slotMode: true  },
]);

const mobileColumns = computed(() => [
  { field: '_status',  title: '',                       slotMode: true },
  { field: 'name',     title: t('modulesTab.col_name'), slotMode: true },
  { field: '_actions', title: '',                       slotMode: true, width: '5rem' },
]);

const columns = computed(() => isMobile.value ? mobileColumns.value : desktopColumns.value);

// ── Computed helpers ───────────────────────────────────────────────────────
const pendingIsUpdate  = computed(() =>
  !!pendingManifest.value && modules.value.some(m => m.id === pendingManifest.value.id)
);
const installedVersion = (id) => modules.value.find(m => m.id === id)?.version ?? '?';
const lastRefreshLabel = computed(() =>
  lastRefresh.value
    ? lastRefresh.value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—'
);

// ── Status dot — combines module enabled flag + live collector health ───────
function collectorDotClass(row) {
  const c = row._collector;
  // Use collector's own enabled state (from system_settings via collectors/status)
  // Fall back to registry enabled only when no collector data available yet
  const enabled = c ? isEnabled(c) : !!row.enabled;
  if (!enabled)              return 'dot--disabled';
  if (!c)                    return 'dot--disabled';
  if (c.paused)              return 'dot--paused';
  if (c.consecutiveErrors)   return 'dot--error';
  if (isStale(c))            return 'dot--stale';
  return 'dot--ok';
}

function collectorDotLabel(row) {
  const c = row._collector;
  const enabled = c ? isEnabled(c) : !!row.enabled;
  if (!enabled)              return te('common.disabled') ? t('common.disabled') : 'Disabled';
  if (!c)                    return t('collectors.statusDisabled');
  if (c.paused)              return t('collectors.statusPaused',  { n: c.consecutiveErrors });
  if (c.consecutiveErrors)   return t('collectors.statusErrors',  { n: c.consecutiveErrors });
  if (isStale(c))            return t('collectors.statusStale');
  return t('collectors.statusHealthy');
}

// ── Load modules (registry) ────────────────────────────────────────────────
async function loadModules() {
  loadingModules.value = true;
  try {
    const response = await apiClient.get('/modules');
    const raw = response.data?.modules ?? response.data?.data ?? response.data ?? [];
    modules.value = raw.map(m => ({
      id:           m.module_id,
      name:         m.module_name,
      version:      m.module_version  ?? '',
      description:  m.description     ?? '',
      type:         m.module_type      ?? '',
      author:       m.author           ?? '',
      enabled:      !!m.enabled,
      has_schema:   !!m.has_schema,
      _lock:        m._lock            ?? null,
      capabilities: { dataCollection: !!m.has_collector, api: !!m.has_api, ui: !!m.has_ui },
      collector:    m.collector_interval ? { interval: m.collector_interval, priority: m.collector_priority } : null,
      routes:       m.api_prefix ? { prefix: m.api_prefix } : null,
      settings:     m.settings_component ? { component: m.settings_component } : null,
      installed_at: m.installed_at,
      last_seen_at: m.last_seen_at,
      dependencies: null,
      config:       null,
    }));
  } catch (err) {
    console.error('[ModulesTab] loadModules failed:', err);
    toast.add({ severity: 'error', summary: t('common.error'), detail: t('modulesTab.load_error') });
  } finally {
    loadingModules.value = false;
  }
}

// ── Load collector runtime status ──────────────────────────────────────────
async function loadCollectors() {
  loadingCollectors.value = true;
  collectorError.value = null;
  try {
    const response = await apiClient.get('/collectors/status');
    const data = response?.data?.data ?? response?.data ?? {};
    collectors.value    = data.collectors ?? [];
    managerRunning.value = data.running   ?? false;
    lastRefresh.value   = new Date();
  } catch (e) {
    collectorError.value = e?.response?.data?.error ?? e.message ?? t('collectors.loadError');
  } finally {
    loadingCollectors.value = false;
  }
}

async function refreshAll() {
  await Promise.all([loadModules(), loadCollectors()]);
}

// ── Collector restart ──────────────────────────────────────────────────────
async function restart(id) {
  restarting.value = id;
  try {
    await apiClient.post(`/collectors/${id}/restart`);
    await loadCollectors();
  } catch (e) {
    collectorError.value = `${t('collectors.restartError')}: ${e?.response?.data?.error ?? e.message}`;
  } finally {
    restarting.value = null;
  }
}

// ── Drawer helpers ─────────────────────────────────────────────────────────
function openUpload()      { uploadDrawer.value = { visible: true, targetModule: null }; clearPending(); }
function openUpdate(mod)   { uploadDrawer.value = { visible: true, targetModule: mod  }; clearPending(); }
async function openManifest(mod) {
  // Open drawer immediately with registry data, _manifest loads async
  manifestDrawer.value = { visible: true, module: { ...mod, _manifest: null } };
  try {
    const { data } = await apiClient.get(`/modules/${mod.id}/manifest`);
    if (data.success) {
      manifestDrawer.value.module = { ...manifestDrawer.value.module, _manifest: data };
    }
  } catch {
    // manifest not available — sections simply won't render
  }
}
function openSettings(mod) { settingsDrawer.value = { visible: true, module: mod }; }

// ── File / ZIP handling ────────────────────────────────────────────────────
const onFileSelected = (e) => { const f = e.target.files?.[0]; if (f) setPending(f); e.target.value = ''; };
const onDrop = (e) => { isDragging.value = false; const f = e.dataTransfer.files?.[0]; if (f) setPending(f); };

const setPending = (file) => {
  if (!file.name.endsWith('.zip')) {
    toast.add({ severity: 'warn', summary: t('common.warning'), detail: t('modulesTab.zip_only') });
    return;
  }
  pendingFile.value = file; uploadResult.value = null;
  readManifestFromZip(file);
};

const clearPending = () => {
  pendingFile.value = null; pendingManifest.value = null;
  expectedChecksum.value = ''; uploadResult.value = null;
};

async function readManifestFromZip(file) {
  readingManifest.value = true; pendingManifest.value = null;
  try { pendingManifest.value = await extractManifestFromZipBuffer(await file.arrayBuffer()); }
  catch { /* silent */ }
  finally { readingManifest.value = false; }
}

async function extractManifestFromZipBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  const view  = new DataView(buffer);
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('Not a valid ZIP');
  const cdOffset  = view.getUint32(eocdOffset + 16, true);
  const cdEntries = view.getUint16(eocdOffset + 8,  true);
  let pos = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const compMethod  = view.getUint16(pos + 10, true);
    const compSize    = view.getUint32(pos + 20, true);
    const uncompSize  = view.getUint32(pos + 24, true);
    const fnLen       = view.getUint16(pos + 28, true);
    const extraLen    = view.getUint16(pos + 30, true);
    const commentLen  = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const filename    = new TextDecoder().decode(bytes.slice(pos + 46, pos + 46 + fnLen));
    if (/^([^/]+\/)?manifest\.json$/.test(filename)) {
      const lhExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart  = localOffset + 30 + fnLen + lhExtraLen;
      const compData   = bytes.slice(dataStart, dataStart + compSize);
      let jsonBytes;
      if (compMethod === 0) { jsonBytes = compData; }
      else if (compMethod === 8) {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter(); const reader = ds.readable.getReader();
        writer.write(compData); writer.close();
        const chunks = [];
        while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
        const out = new Uint8Array(uncompSize); let off = 0;
        for (const chunk of chunks) { out.set(chunk, off); off += chunk.length; }
        jsonBytes = out;
      } else throw new Error(`Unsupported compression: ${compMethod}`);
      return JSON.parse(new TextDecoder().decode(jsonBytes));
    }
    pos += 46 + fnLen + extraLen + commentLen;
  }
  throw new Error('manifest.json not found');
}

// ── Install / Update ───────────────────────────────────────────────────────
async function installPending() {
  if (!pendingFile.value) return;
  const wasUpdate = pendingIsUpdate.value;
  uploading.value = true; uploadResult.value = null;
  try {
    const form = new FormData();
    form.append('module', pendingFile.value);
    if (expectedChecksum.value.trim())
      form.append('checksum', new Blob([expectedChecksum.value.trim()], { type: 'text/plain' }), 'expected.sha256');
    const url = wasUpdate ? '/modules/upload?overwrite=true' : '/modules/upload';
    const response = await apiClient.post(url, form, { headers: { 'Content-Type': 'multipart/form-data' } });
    const data = response.data;
    uploadResult.value = { success: true, wasUpdate, message: data.message, checksum: data.checksum, hotLoaded: data.hotLoaded };
    clearPending();
    await refreshAll();
    toast.add({ severity: 'success', summary: t('common.done'), detail: data.message });
  } catch (err) {
    const detail = err.response?.data?.message || err.response?.data?.error || err.message;
    uploadResult.value = { success: false, message: detail };
    toast.add({ severity: 'error', summary: t('common.error'), detail });
  } finally {
    uploading.value = false;
  }
}

// ── Remove ─────────────────────────────────────────────────────────────────
function askRemove(mod) { removeTarget.value = mod; }
async function doRemove() {
  removing.value = true;
  try {
    await apiClient.delete(`/modules/${removeTarget.value.id}`);
    toast.add({ severity: 'success', summary: t('common.done'), detail: t('modulesTab.uninstalled', { name: removeTarget.value.name }) });
    removeTarget.value = null;
    await refreshAll();
  } catch (err) {
    toast.add({ severity: 'error', summary: t('common.error'), detail: err.response?.data?.error || err.message });
  } finally {
    removing.value = false;
  }
}

// ── Collector helpers ──────────────────────────────────────────────────────
function isEnabled(c) { return c.enabled === true || c.enabled === 'true' || c.enabled === 1 || c.enabled === '1'; }
function isStale(c)   { return c?.lastRun && c?.intervalMs && (Date.now() - new Date(c.lastRun)) > c.intervalMs * 3; }

function formatLastRun(c) {
  if (!c?.lastRun) return t('collectors.never');
  const ago = Math.round((Date.now() - new Date(c.lastRun)) / 1000);
  if (ago < 60)   return `${ago}s ago`;
  if (ago < 3600) return `${Math.round(ago / 60)}m ago`;
  return new Date(c.lastRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatNextRun(c) {
  if (!c || !isEnabled(c) || c.paused || !c.nextRun) return '—';
  const ms = new Date(c.nextRun) - Date.now();
  if (ms <= 0)     return t('collectors.now');
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function formatInterval(ms) {
  if (!ms) return '—';
  if (ms < 60_000) return `${ms / 1000}s`;
  return `${ms / 60_000}m`;
}

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

// ── Mobile + lifecycle ─────────────────────────────────────────────────────
let mq = null;
function onMqChange(e) { isMobile.value = e.matches; }

onMounted(async () => {
  mq = window.matchMedia('(max-width: 639px)');
  isMobile.value = mq.matches;
  mq.addEventListener('change', onMqChange);
  await refreshAll();
  pollTimer = setInterval(loadCollectors, COLLECTOR_POLL_MS);
});

onUnmounted(() => {
  mq?.removeEventListener('change', onMqChange);
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<style scoped>
.modules-panel            { display: flex; flex-direction: column; gap: 0.875rem; }
/* Manager badge */
.manager-badge            { display: inline-flex; align-items: center; gap: 0.375rem;font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.04em;text-transform: uppercase; padding: 0.2rem 0.55rem; border-radius: 20px;}
.manager-badge--ok        { background: var(--color-background); color: #16a34a; }
.manager-badge--err       { background: var(--color-background); color: #dc2626; }
.manager-dot              { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }

.last-refresh             { font-size: 0.75rem; color: #94a3b8; }

/* Status dots */
.status-dot               { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot--ok                  { background: #22c55e; width: 12px; height: 12px;}
.dot--error               { background: #ef4444; width: 12px; height: 12px;}
.dot--paused              { background: #f59e0b; }
.dot--stale               { background: #94a3b8; }
.dot--disabled            { background: #cbd5e1; }

/* Type badge */
.type-badge               { display: inline-block; padding: 0.125rem 0.5rem;font-size: 0.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;border-radius: var(--radius-sm); background-color: var(--color-secondary-200); color: var(--color-primary);}
/* Runtime values */
.meta-value               { font-size: 0.8125rem; color: var(--color-secondary-300); font-weight: 500; }
.meta-value.stale         { color: #94a3b8; }
.meta-grid                { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; }
.meta-card                { background: var(--color-secondary-50); padding: 0.5rem; border-radius: var(--radius-md); }
.meta-card label          { display: block; font-size: 0.7rem; text-transform: lowercase; color: var(--color-secondary-400); font-weight: 400; }
.meta-value               { font-size: 0.75rem; font-weight: 600; color: var(--color-primary); margin-top: 0.125rem; }
.error-count              { font-size: 0.75rem; color: #ef4444; font-weight: 500;display: inline-flex; align-items: center; gap: 0.25rem;}
/* Error banner */
.error-banner             { padding: 0.75rem 1.25rem; font-size: 0.8125rem;color: #b91c1c; background: #fef2f2;border: 1px solid #fecaca; border-radius:var(--radius-md)}

/* Drop zone */
.drop-zone                { border: 2px dashed #d1d5db; border-radius: 4px; padding: 2rem;display: flex; flex-direction: column; align-items: center; gap: 0.75rem;cursor: pointer; transition: border-color 0.15s, background 0.15s; background: #f9fafb;}
.drop-zone:hover, .drop-zone--drag 
                          { border-color: #9ca3af; background: #f3f4f6; }
.drop-zone--error         { border-color: #fca5a5; background: #fff5f5; }
.drop-zone--has-file      { border-color: #6b7280; }

/* Manifest drawer */
.manifest-section         { border-top: 1px solid #f3f4f6; padding-top: 0.75rem; }
.manifest-section__title  { font-size: 0.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-primary); margin-bottom: 0.5rem; }
.manifest-row             { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; padding: 0.25rem; background-color: var(--color-secondary-50);border:1px solid var(--color-secondary-100);font-size: 0.8rem; color: var(--color-primary); border-bottom: 1px solid #f9fafb; }
.manifest-row:last-child  { border-bottom: none; }
.manifest-row > span:first-child 
                          { color: #6b7280; flex-shrink: 0; }

.capability-pill          { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.75rem; font-weight: 500; text-transform: lowercase; letter-spacing: 0.05em; padding: 0.15rem 0.5rem; border-radius: 2px; }
.capability-pill--on      { background: #f0fdf4; color: #166534; }
.capability-pill--off     { background: #f3f4f6; color: #9ca3af; }

.field-hint               { font-size: 0.7rem; font-weight: 400; color: #9ca3af; margin-left: 4px; }
.row-actions--always-visible 
                          { opacity: 1 !important; visibility: visible !important; pointer-events: auto !important; }
</style>