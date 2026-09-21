<!-- src/components/common/AppTable.vue -->
<!--
  Reusable data table built on @bhplugin/vue3-datatable.
  Install once: npm install @bhplugin/vue3-datatable --save

  Props:
    items        (Array)    – row data
    columns      (Array)    – column definitions:
                              { field, title, width?, sortable?, searchable?, slotMode? }
    loading      (Boolean)  – skeleton loader
    search       (String)   – bind with v-model:search for external search control
    pageSize     (Number)   – rows per page (default 10)
    emptyText    (String)   – override "no data" message
    showSearch   (Boolean)  – show built-in search box (default true)

  Slots:
    toolbar-left   – left side of toolbar (counts, badges)
    toolbar-right  – right side of toolbar (extra buttons)
    {field}        – custom cell renderer, receives { value } where value is the row object

  Usage:
    <AppTable :items="devices" :columns="cols" :loading="loading">
      <template #toolbar-right>
        <button class="btn btn--sm btn--primary" @click="openAdd">+ Add</button>
      </template>
      <template #name="{ value }">
        <span class="font-semibold">{{ value.name }}</span>
      </template>
      <template #_actions="{ value }">
        <button @click="edit(value)">Edit</button>
      </template>
    </AppTable>
-->
<template>
  <div class="app-table">

    <!-- Toolbar -->
    <div class="app-table__toolbar">
      <div class="app-table__toolbar-left">
        <slot name="toolbar-left" />
      </div>
      <div class="app-table__toolbar-right">
        <!-- Built-in search input -->
        <div v-if="showSearch" class="app-table__search">
          <svg class="app-table__search-icon" width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zm-5.242 1.656a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z"/>
          </svg>
          <input
            v-model="internalSearch"
            class="app-table__search-input"
            :placeholder="t('common.search')"
            type="search"
          />
        </div>
        <slot name="toolbar-right" />
      </div>
    </div>

    <!-- DataTable -->
    <vue3-datatable
      :rows="items"
      :columns="tableColumns"
      :loading="loading"
      :search="internalSearch"
      :sortable="true"
      :pagination="true"
      :page-size="pageSize"
      :page-size-options="[8, 10, 25, 50]"
      :show-numbers-count="5"
      :no-data-content="emptyText || t('common.noItems')"
      skin="bh-table-hover"
      class="app-table__datatable"
    >
      <!-- Forward named slots through to the datatable cell renderers -->
      <template v-for="col in slotColumns" :key="col.field" #[col.field]="data">
        <slot :name="col.field" :value="data.value" />
      </template>
    </vue3-datatable>

  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import Vue3Datatable from '@bhplugin/vue3-datatable';
import '@bhplugin/vue3-datatable/dist/style.css';
import { useLocale } from '@/composables/useLocale';

const { t } = useLocale();

const props = defineProps({
  items:      { type: Array,   default: () => [] },
  columns:    { type: Array,   default: () => [] },
  loading:    { type: Boolean, default: false },
  search:     { type: String,  default: '' },
  pageSize:   { type: Number,  default: 8 },
  emptyText:  { type: String,  default: '' },
  showSearch: { type: Boolean, default: true },
});

const emit = defineEmits(['update:search']);

// Internal search string — synced with optional external v-model:search
const internalSearch = ref(props.search);
watch(() => props.search, v => { internalSearch.value = v; });
watch(internalSearch,     v => emit('update:search', v));

// Translate our generic column format → vue3-datatable column format
const tableColumns = computed(() =>
  props.columns.map(col => ({
    field:    col.field,
    title:    col.label ?? col.title ?? '',
    width:    col.width    ?? undefined,
    sort:     col.sortable  !== false,    // sortable unless explicitly false
    search:   col.searchable !== false,   // searchable unless explicitly false
    slotMode: col.slotMode  ?? false,
  }))
);

// Columns that use a named slot for cell rendering
const slotColumns = computed(() =>
  props.columns.filter(col => col.slotMode)
);
</script>

<style>
/*
 * Override @bhplugin/vue3-datatable styles to match the Tailwind control-panel
 * design language. NOT scoped — must reach the library's rendered DOM.
 */

/* ── Wrapper ──────────────────────────────────────────────────────────────── */
.app-table                { display: flex;flex-direction: column;gap: 0.75rem;}
/* ── Toolbar ──────────────────────────────────────────────────────────────── */
.app-table__toolbar       { display: flex;align-items: center;justify-content: space-between;gap: 0.75rem;flex-wrap: wrap;}
.app-table__toolbar-left  { display: flex; align-items: center; gap: 0.5rem; flex: 1; }
.app-table__toolbar-right { display: flex; align-items: center; gap: 0.5rem; margin-left: auto; }

/* ── Search box ───────────────────────────────────────────────────────────── */
.app-table__search        { position: relative;display: flex;align-items: center;}
.app-table__search-icon   { position: absolute;left: 0.55rem;color: var(--color-secondary-400);pointer-events: none;}
.app-table__search-input      { padding: 0.3125rem 0.725rem 0.3125rem 1.5rem;border: 1px solid var(--color-secondary-300);border-radius : var(--radius-sm);font-size: 0.78125rem;color: var(--color-primary);background: var(--color-background);outline: none;width: 30px;transition: border-color 0.15s, width 0.2s;}
.app-table__search-input:focus       
                              { border-color: var(--color-secondary-200); width: 200px; }
.app-table__search-input::-webkit-search-cancel-button 
                              { display: none; }

/* ── Strip library card shadow / padding ──────────────────────────────────── */
.app-table__datatable .bh-datatable-wrapper 
                              {border: none !important;box-shadow: none !important;padding: 0 !important;border-radius: 0 !important;background: transparent !important;}
/* Hide the library's own search input (we provide ours in the toolbar) */
.app-table__datatable .bh-datatable-search { display: none !important; }

/* ── Table element ────────────────────────────────────────────────────────── */
.app-table__datatable table   {width: 100%;border-collapse: collapse;font-size: 0.8125rem;}

/* ── Header ───────────────────────────────────────────────────────────────── */
.app-table__datatable thead tr {
  border-bottom: 1px solid var(--color-secondary-300) !important;
  background: transparent !important;
}
.app-table__datatable th      {padding: 0.5rem 0.75rem !important;text-align: left !important;font-size: 0.7rem !important;font-weight: 600 !important;text-transform: lowercase !important;letter-spacing: 0.06em !important;color: #6b7280 !important;white-space: nowrap;background: transparent !important;border: none !important;user-select: none;}
/* Sort indicators */
.app-table__datatable th .bh-sort-icon         { color: var(--color-secondary-500); margin-left: 3px; }
.app-table__datatable th.asc  .bh-sort-icon,
.app-table__datatable th.desc .bh-sort-icon    { color: #374151; }

/* ── Body rows ────────────────────────────────────────────────────────────── */
.app-table__datatable tbody tr {
  border-bottom: 1px solid var(--color-secondary-300) !important;
  transition: background 0.1s;
}
.app-table__datatable tbody tr:last-child    { border-bottom: none !important; }
.app-table__datatable.bh-table-hover tbody tr:hover { background: #fafafa !important; }

/* Remove library stripe (hover only) */
.app-table__datatable.bh-table-striped tbody tr:nth-child(even) {
  background: transparent !important;
}

.app-table__datatable td {
  padding: 0.75rem 0.75rem !important;
  vertical-align: middle !important;
  border: none !important;
}
.bh-active {
  background: #2a2a2b !important;
  font-weight: 500 !important;
}

/* ── Pagination ───────────────────────────────────────────────────────────── */
.app-table__datatable .bh-pagination-wrap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 0 0 !important;
  border-top: 1px solid #f3f4f6 !important;
  font-size: 0.78rem !important;
  color: #6b7280 !important;
  flex-wrap: wrap;
  gap: 0.5rem;
}

/* Page-size selector */
.app-table__datatable .bh-page-size select {
  padding: 0.25rem 0.5rem;
  border: 1px solid #d1d5db;
 border-radius : var(--radius-sm);
  font-size: 0.78rem;
  color: #374151;
  background: #fff;
  outline: none;
  cursor: pointer;
}

/* Page buttons */
.app-table__datatable .bh-pagination li button,
.app-table__datatable .bh-pagination li span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 0.375rem;

  font-size: 0.78rem;
  color: #374151;
  background: #fff;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  margin: 0 1px;
}
.app-table__datatable .bh-pagination li button:hover:not(:disabled) {
  background: #f9fafb;
  border-color: #9ca3af;
}
.app-table__datatable .bh-pagination li.active button,
.app-table__datatable .bh-pagination li.active span 
                              { background: var(--color-background);border-color: var(--color-secondary-300);color: var(--color-primary);}
.app-table__datatable .bh-pagination li button:disabled 
                              { opacity: 0;cursor: not-allowed;}
/* ── Skeleton loader ──────────────────────────────────────────────────────── */
.app-table__datatable .bh-skeleton {
  background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%);
  background-size: 200% 100%;
  animation: bh-shimmer 1.2s infinite;
 border-radius : var(--radius-sm);
  height: 14px;
}
@keyframes bh-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ── Empty state ──────────────────────────────────────────────────────────── */
.app-table__datatable .bh-no-data 
                              { padding: 2.5rem 1rem;text-align: center;font-size: 0.875rem;color: var(--color-primary);border: 1px dashed var(--color-secondary-300)   ;border-radius : var(--radius-sm);}
.bh-page-item:hover           { background-color: #f3f4f6!important;color:#111827!important;}
.bh-text-black                { color: var(--color-primary)!important;}
.bh-pagination-info .bh-pagesize 
                              { background-color: var(--color-background)!important;color: var(--color-primary)!important;border-radius : var(--radius-sm);border: 1px solid var(--secondary-300);}                           
.bh-pagination .bh-page-item 
                              { background-color: var(--color-background)!important;color: var(--color-primary)!important;border-radius : var(--radius-sm);border: 1px solid var(--secondary-300);}
.bh-pagination-info .bh-mr-2  { min-width: 200px;} 
.btn--primary                  { background-color: var(--color-primary);color: var(--color-background);border-radius : var(--radius-sm);}
</style>