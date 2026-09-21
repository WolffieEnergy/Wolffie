<!-- src/components/settings/LoggingTab.vue
     Raw server log viewer — Option A design (see chat history):
       - Fetches one larger fixed batch from GET /api/logs (not true infinite
         scroll); AppTable's own client-side search/sort/pagination handles
         browsing within that batch.
       - Click a row's message to see the full text in AppModal.
       - AppModal's Confirm button doubles as Mark/Unmark — re-purposing the
         existing confirm/cancel shape rather than adding a view-only variant.
       - "Show marked only" switches the data source to GET /api/logs/marks
         (reads straight from the DB, no file access — works even if the
         source log file has since rotated out).
       - "Clear all marks" — DELETE /api/logs/marks, behind its own confirm.
-->
<template>
  <div class="logging-tab">
    <AppTable
      :items="entries"
      :columns="columns"
      :loading="loading"
      :page-size="25"
      :empty-text="loadError || t('logging.noEntries')"
    >
      <template #toolbar-left>
        <label class="marked-toggle">
          <input type="checkbox" v-model="showMarkedOnly" class="marked-toggle__input" />
          <span class="marked-toggle__track">
            <span class="marked-toggle__thumb"></span>
          </span>
          <span>{{ t('logging.showMarkedOnly') }}</span>
        </label>
      </template>

      <template #toolbar-right>
        <button class="btn btn--sm" :disabled="loading" @click="loadEntries">
          <i class="ph-light ph-arrows-clockwise" :class="{ 'ph-spin': loading }"></i>
          {{ t('common.refresh') }}
        </button>
        <button class="btn btn--sm" @click="clearAllModal = true">
          <i class="ph-light ph-trash"></i>
          {{ t('logging.clearAllMarks') }}
        </button>
      </template>

      <!-- Marked indicator column — narrow, icon-only -->
      <template #marked="{ value }">
        <i
          v-if="value.marked"
          class="ph-fill ph-bookmark-simple marked-icon"
          :title="t('logging.marked')"
        ></i>
      </template>

      <template #timestamp="{ value }">
        <span class="timestamp-cell">{{ formatTimestamp(value.timestamp) }}</span>
      </template>

      <template #level="{ value }">
        <span class="level-badge" :class="levelClass(value.level)">{{ value.level }}</span>
      </template>

      <template #message="{ value }">
        <div class="message-cell" @click="openDetail(value)">
          <span class="message-text">{{ firstLine(value.message) }}</span>
          <i class="ph-light ph-arrows-out message-cell__icon"></i>
        </div>
      </template>
    </AppTable>

    <!-- Detail modal — view full message, mark/unmark -->
    <AppModal
      v-model:visible="detailModal.visible"
      :confirm-label="detailModal.entry?.marked ? t('logging.unmark') : t('logging.mark')"
      :cancel-label="t('common.close')"
      :busy="detailModal.busy"
      @confirm="toggleMark(detailModal.entry)"
    >
      <div class="log-detail" v-if="detailModal.entry">
        <div class="log-detail__meta">
          <span class="level-badge" :class="levelClass(detailModal.entry.level)">
            {{ detailModal.entry.level }}
          </span>
          <span class="log-detail__time">{{ formatTimestamp(detailModal.entry.timestamp) }}</span>
        </div>
        <pre class="log-detail__message">{{ detailModal.entry.message }}</pre>
      </div>
    </AppModal>

    <!-- Clear-all confirmation — separate from the detail modal -->
    <AppModal
      v-model:visible="clearAllModal"
      :message="t('logging.clearAllConfirm')"
      destructive
      :busy="clearingAll"
      @confirm="confirmClearAll"
    />
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import apiClient from '@/services/api';
import { useToastStore } from '@/stores/toast';
import AppTable from '@/components/common/AppTable.vue';
import AppModal from '@/components/common/AppModal.vue';
import '@/assets/styles/control.css';

const { t } = useI18n();
const toast = useToastStore();

const BATCH_LIMIT = 300;

const columns = [
  { field: 'marked',    label: '',                        slotMode: true, sortable: false, searchable: false, width: '40px' },
  { field: 'timestamp', label: t('logging.columns.time'),  slotMode: true, sortable: true,  searchable: false },
  { field: 'level',     label: t('logging.columns.level'), slotMode: true, sortable: true,  searchable: true  },
  { field: 'message',   label: t('logging.columns.message'), slotMode: true, sortable: false, searchable: true },
];

const entries        = ref([]);
const loading         = ref(false);
const loadError       = ref(null);
const showMarkedOnly  = ref(false);

const detailModal = reactive({ visible: false, entry: null, busy: false });
const clearAllModal = ref(false);
const clearingAll    = ref(false);

async function loadEntries() {
  loading.value = true;
  loadError.value = null;
  try {
    if (showMarkedOnly.value) {
      const { data } = await apiClient.get('/logs/marks');
      entries.value = (data.entries || []).map(e => ({ ...e, marked: true }));
    } else {
      const { data } = await apiClient.get('/logs', { params: { limit: BATCH_LIMIT } });
      entries.value = (data.entries || []).map(e => ({ ...e, marked: !!e.marked }));
    }
  } catch (err) {
    loadError.value = err.message || t('common.loadFailed');
    entries.value = [];
  } finally {
    loading.value = false;
  }
}

function openDetail(entry) {
  detailModal.entry   = entry;
  detailModal.visible = true;
}

async function toggleMark(entry) {
  if (!entry) return;
  detailModal.busy = true;
  try {
    const { data } = await apiClient.post('/logs/marks/toggle', {
      timestamp: entry.timestamp,
      level:     entry.level,
      message:   entry.message,
    });

    if (showMarkedOnly.value && !data.marked) {
      // Unmarked while viewing the marked-only list — it no longer belongs here.
      entries.value = entries.value.filter(e => e.timestamp !== entry.timestamp);
    } else {
      entry.marked = data.marked;
    }

    detailModal.visible = false;
  } catch (err) {
    toast.add({ severity: 'error', summary: t('common.error'), detail: err.message });
  } finally {
    detailModal.busy = false;
  }
}

async function confirmClearAll() {
  clearingAll.value = true;
  try {
    await apiClient.delete('/logs/marks');
    clearAllModal.value = false;
    await loadEntries();
    toast.add({ severity: 'success', summary: t('logging.marksCleared') });
  } catch (err) {
    toast.add({ severity: 'error', summary: t('common.error'), detail: err.message });
  } finally {
    clearingAll.value = false;
  }
}

// ─── Formatters ──────────────────────────────────────────────────────────
function formatTimestamp(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString();
}

// Table cell shows only the first line — full text (including any
// multi-line stack trace) is available via the detail modal.
function firstLine(message) {
  if (!message) return '';
  const idx = message.indexOf('\n');
  return idx === -1 ? message : message.slice(0, idx) + ' …';
}

function levelClass(level) {
  const map = {
    ERROR: 'level-badge--error',
    WARN:  'level-badge--warn',
    INFO:  'level-badge--info',
    DEBUG: 'level-badge--debug',
  };
  return map[level] || 'level-badge--info';
}

watch(showMarkedOnly, loadEntries);
onMounted(loadEntries);
</script>

<style scoped>
.logging-tab                { display: flex; flex-direction: column; gap: 0.75rem; }
.marked-toggle              { display: flex; align-items: center;gap: 0.5rem;font-size: 0.8125rem;color: var(--color-text-secondary);cursor: pointer;user-select: none;}
.marked-toggle__input       { display: none; }
.marked-toggle__track       { position: relative;width: 34px;height: 18px;flex-shrink: 0;background: var(--color-border);border-radius: 999px;transition: background 0.15s;}
.marked-toggle__thumb       { position: absolute;top: 2px;left: 2px;width: 14px;height: 14px;background: var(--color-background);border-radius: 50%;box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);transition: transform 0.15s;}
.marked-toggle__input:checked + .marked-toggle__track 
                            { background: var(--color-primary);}
.marked-toggle__input:checked + .marked-toggle__track .marked-toggle__thumb 
                            { transform: translateX(16px);}
.timestamp-cell             { font-variant-numeric: tabular-nums;font-size: 0.78125rem;color: var(--color-text-secondary);white-space: nowrap;}
.level-badge                { display: inline-block;padding: 0.125rem 0.5rem;font-size: 0.6875rem;font-weight: 700;letter-spacing: 0.04em;border-radius: var(--radius-sm, 4px);}
.level-badge--info          { background: var(--color-info); color: var(--color-primary); }
.level-badge--warn          { background: var(--color-warn); color: var(--color-primary); }
.level-badge--error         { background: var(--color-error); color: var(--color-primary); }
.level-badge--debug         { background: var(--color-debug); color: var(--color-primary); }

.message-cell               { display: flex;  align-items: center;  gap: 0.5rem;  cursor: pointer;  max-width: 640px;}
.message-cell:hover .message-cell__icon 
                            { opacity: 1; }
.message-text               { overflow: hidden;text-overflow: ellipsis;white-space: nowrap;font-family: ui-monospace, SFMono-Regular, Menlo, monospace;font-size: 0.78125rem;}
.message-cell__icon         { flex-shrink: 0;opacity: 0.35;font-size: 0.8rem;transition: opacity 0.15s;}
.marked-icon                { color: var(--color-secondary);font-size: 0.95rem;}
.log-detail__meta           { display: flex;align-items: center;gap: 0.75rem;margin-bottom: 0.75rem;}
.log-detail__time           { font-size: 0.8125rem;color: var(--color-text-secondary);font-variant-numeric: tabular-nums;}
.log-detail__message        { white-space: pre-wrap;word-break: break-word;font-family: ui-monospace, SFMono-Regular, Menlo, monospace;font-size: 0.8125rem;background: var(--color-bg-secondary, #f9fafb);border: 1px solid var(--color-border);border-radius: var(--radius-sm, 4px);  padding: 0.75rem;max-height: 50vh;  overflow-y: auto;}
</style>

<style>
/* Unscoped, matching AppTable's own convention of reaching into the
   third-party datatable's DOM — colors the whole row when it contains a
   marked-icon element. AppTable exposes no row-class hook, so this avoids
   modifying the shared component just for this one view. */
.logging-tab .app-table__datatable tbody tr:has(.marked-icon) 
                            { background: var(--color-accent) !important;}
</style>