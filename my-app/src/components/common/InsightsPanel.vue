<!--
  InsightsPanel.vue — self-sufficiency strip + system insights list.

  Spans the full page width, below both columns. The strip acts as the
  divider: everything above it is now, everything below it is what happened.

  The insights list renders an empty state rather than sample rows. If the
  Events view already has an event table behind it, feed it here.
-->

<template>
  <div class="insights-panel">

    <section class="ip-card bg-secondary-50">
      <header class="ip-header flex justify-between items-center px-3.5 py-3">
        <h2 class="text-sm font-semibold">{{ t('dashboard.systemInsights') }}</h2>
        <button
          type="button"
          class="text-xs hover:underline"
          @click="$emit('viewHistory')"
        >
          {{ t('dashboard.viewHistory') }}
        </button>
      </header>

      <ul v-if="events.length" class="ip-list">
        <li
          v-for="ev in events"
          :key="ev.id"
          class="flex gap-3 px-3.5 py-2.5 items-baseline"
        >
          <span class="text-xs text-secondary-400 font-mono min-w-[38px]">{{ ev.time }}</span>
          <span class="text-[13px] flex-1">{{ ev.message }}</span>
          <span class="text-[11px] text-secondary-400">{{ ev.category }}</span>
        </li>
      </ul>

      <p v-else class="px-3.5 py-6 text-[13px] text-secondary-400">
        {{ t('dashboard.insightsEmpty') }}
      </p>
    </section>

  </div>
</template>

<script setup>
import { useLocale } from '../../composables/useLocale';

const { t } = useLocale();

defineProps({
  /** [{ id, time, message, category }] */
  events: { type: Array, default: () => [] },
});

defineEmits(['viewHistory']);
</script>

<style scoped>
.ip-card {border-radius: var(--border-radius);border: 1px solid var(--border-color);background-color: var(--card-bg-color);}
.ip-list > li + li {
  border-top: 1px solid var(--border-color);
}
</style>