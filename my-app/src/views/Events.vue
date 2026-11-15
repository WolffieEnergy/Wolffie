<!--
  Events.vue — the full event_log, as a table.

  Rewritten against the real schema. The previous version targeted the old
  eventService shape (category / action / user_name / status) and could not
  work: it called /system/events instead of /api/events, assigned an object
  where an array was expected, named columns that do not exist on event_log,
  and set slotMode on none of them — so every custom cell template was
  ignored, and @row-click bound to an event AppTable never emitted.

  Messages render through useEventText, the same composable the dashboard
  uses, so a row reads identically in both places.
-->

<template>
  <div class="events-view flex flex-col h-full bg-card">
    <header class="p-6  flex-shrink-0">
      <p class="text-sm text-secondary-500">{{ t('events.description') }}</p>
    </header>

    <div class="flex-1 overflow-hidden p-6 ">
      <AppTable
        :items="rows"
        :columns="columns"
        :loading="loading"
        :page-size="8"
        @row-click="openDetails"
      >
        <template #toolbar-left>
          <span class="toolbar__count">{{ total }} {{ t('events.total') }}</span>
        </template>

        <template #toolbar-right>
          <button class="btn btn--sm" :disabled="loading" @click="fetchEvents">
            <i class="ph-duotone ph-rotate mr-2" aria-hidden="true" />
            {{ t('control.devices.refresh') }}
          </button>
        </template>

        <template #severity="{ value }">
          <span :class="['status-badge', `status-badge--${value.severity}`]">
            {{ value.severity }}
          </span>
        </template>

        <template #categoryLabel="{ value }">
          <span :class="['status-badge', `status-badge--${value.category}`]">
            {{ value.categoryLabel }}
          </span>
        </template>

        <template #text="{ value }">
          <span :title="value.text">{{ value.text }}</span>
          <span v-if="value.occurrences > 1" class="ev-count">×{{ value.occurrences }}</span>
        </template>

        <template #ongoing="{ value }">
          <i
            v-if="value.ongoing"
            class="ph-fill ph-circle-dashed"
            :title="t('events.ongoing')"
            aria-hidden="true"
          />
          <i v-else class="ph-fill ph-circle-check" :title="t('events.resolved')" aria-hidden="true" />
        </template>
      </AppTable>
    </div>

    <AppDrawer v-model:visible="drawerOpen" :title="t('events.drawerTitle')">
      <div v-if="selected" class="event-details">
        <section class="drawer-meta-section">
          <h5 class="graph-label">{{ t('events.logicReason') }}</h5>
          <div class="p-4 bg-secondary-50 rounded-lg text-sm border-s-4 border-secondary-300">
            {{ selected.message || selected.text }}
          </div>
        </section>

        <section class="drawer-meta-section mt-6">
          <dl class="ev-meta">
            <dt>{{ t('events.colTime') }}</dt><dd>{{ selected.timestamp }}</dd>
            <dt>source</dt><dd>{{ selected.source }}</dd>
            <dt>event</dt><dd>{{ selected.event }}</dd>
            <dt>{{ t('events.colStatus') }}</dt>
            <dd>{{ selected.resolved_at || t('events.ongoing') }}</dd>
          </dl>
        </section>

        <section v-if="selected.metadata" class="drawer-meta-section mt-6">
          <h5 class="graph-label">{{ t('events.rawPayload') }}</h5>
          <pre class="ev-json">{{ JSON.stringify(selected.metadata, null, 2) }}</pre>
        </section>
      </div>

      <template #footer>
        <button class="btn btn--sm" @click="drawerOpen = false">{{ t('common.close') }}</button>
      </template>
    </AppDrawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import apiClient from '@/services/api';
import { useLocale } from '@/composables/useLocale';
import { useEventText } from '@/composables/useEventText';
import AppTable from '@/components/common/AppTable.vue';
import AppDrawer from '@/components/common/AppDrawer.vue';

const { t } = useLocale();
const { toView } = useEventText();

const raw       = ref([]);
const total     = ref(0);
const loading   = ref(false);
const drawerOpen = ref(false);
const selected   = ref(null);

/**
 * Rows carry BOTH the raw fields (for the drawer) and the view model (for the
 * cells), so the drawer can show metadata the table does not display.
 *
 * Every column that uses a <template #field> MUST set slotMode — AppTable
 * filters on it, so without it the template is silently ignored.
 */
const rows = computed(() => raw.value.map(r => ({ ...r, ...toView(r) })));

const columns = computed(() => [
  { field: 'timestamp',     title: t('events.colTime'),   width: '160px' },
  { field: 'ongoing',       title: t('events.colStatus'), width: '70px',  slotMode: true, sortable: false, searchable: false },
  { field: 'severity',      title: t('events.colSeverity'), width: '100px', slotMode: true },
  { field: 'categoryLabel', title: t('events.colType'),   width: '110px', slotMode: true },
  { field: 'event',         title: t('events.colAction'), width: '170px' },
  { field: 'text',          title: t('events.colMessage'), slotMode: true },
  { field: 'source',        title: t('events.colSource'), width: '190px' },
]);

async function fetchEvents() {
  loading.value = true;
  try {
    // /api/events — mounted in server.js. No scope: this view sees everything,
    // unlike the dashboard panel which asks for scope=dashboard.
    const res = await apiClient.get('/events?limit=200');
    const body = res.data;
    raw.value = Array.isArray(body) ? body
              : Array.isArray(body?.events) ? body.events
              : Array.isArray(body?.data) ? body.data
              : [];
    total.value = body?.total ?? raw.value.length;
  } catch (error) {
    console.error('Failed to fetch events:', error);
    raw.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function openDetails(row) {
  selected.value = row;
  drawerOpen.value = true;
}

onMounted(fetchEvents);
</script>

<style scoped>
.ev-count { font-size: 0.6875rem; color: var(--color-secondary-400); margin-left: 4px; }
.ev-meta  { display: grid; grid-template-columns: max-content 1fr; gap: 0.375rem 1rem; font-size: 0.8125rem; }
.ev-meta dt { color: var(--color-secondary-500); }
.ev-meta dd { font-family: var(--font-mono, monospace); word-break: break-all; }
.ev-json  { background: var(--color-secondary-100); padding: 0.75rem; border-radius: var(--radius-sm);
            font-size: 0.75rem; overflow-x: auto; }
</style>