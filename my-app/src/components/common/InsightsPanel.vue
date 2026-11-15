<!--
  InsightsPanel.vue — current conditions, as cards.

  NOT a log. Each card is one condition that is true RIGHT NOW: an unresolved
  event_log row. The chronological history lives on the Events view, which
  "View history" links to.

  Why not a log here: cards destroy chronology. Five timestamps in a grid
  cannot be scanned — the eye has no column to run down — and wrap order
  fights time order. Card height gets set by the longest message, so "Battery
  full" sits in a box sized for a collector stack trace.

  Conditions are uniform by nature: a label, a number, and how long it has
  been true. That is what makes the card shape honest here.

  Feed it `getActive()` rows, not `getHistory()`.

  Identity collapse: rows are folded by source+category+event before display.
  An unresolved row IS the current state, so two rows describing one state can
  only be a duplicate — showing both is never correct here, whatever the feed
  does. Backend dedupe in eventLogService stops them being written; this stops
  them being shown, including the ones written before dedupe existed.
-->

<template>
  <section class="ip-card">
    <header class="ip-header">
      <h2 class="ip-title">{{ t('dashboard.systemInsights') }}</h2>
      <button type="button" class="ip-link" @click="$emit('viewHistory')">
        {{ t('dashboard.viewHistory') }}
      </button>
    </header>

    <div v-if="rows.length" class="ip-grid">
      <article
        v-for="ev in rows"
        :key="ev.id"
        class="ip-tile"
        :title="ev.text"
      >
        <div class="ip-tile__head">
          <span class="ip-dot" :style="{ background: severityColor(ev.severity) }" aria-hidden="true"></span>
          <span class="ip-cat">{{ ev.categoryLabel }}</span>
        </div>

        <div class="ip-label">{{ ev.shortLabel }}</div>

        <div v-if="ev.value !== null" class="ip-value">
          {{ ev.value }}<span class="ip-unit"> {{ ev.unit }}</span>
        </div>

        <div class="ip-since">{{ t('dashboard.since', { time: ev.since }) }}</div>
      </article>
    </div>

    <p v-else class="ip-empty">{{ t('dashboard.insightsEmpty') }}</p>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { useLocale } from '../../composables/useLocale';
import { useEventText } from '../../composables/useEventText';

const { t } = useLocale();
const { toViews } = useEventText();

const props = defineProps({
  /** Unresolved event_log rows — the output of getActive(). */
  events: { type: Array, default: () => [] },
  /**
   * Cards shown. Four, matching the metric badge row above — the dashboard
   * reads as one grid rhythm rather than two competing ones. Anything beyond
   * is on the Events view.
   */
  max: { type: Number, default: 4 },
});

defineEmits(['viewHistory']);

/**
 * Most severe first, then most recent. A collector fault should not be pushed
 * off the row by three routine device switches.
 */
const RANK = { critical: 5, error: 4, warning: 3, notice: 2, info: 1, debug: 0 };

/**
 * Fold duplicates, keeping the OLDEST row of each condition — its timestamp
 * is when the condition started, which is what "since" should say — while
 * summing occurrences across the folded rows so the count is still right.
 */
function collapse(raw) {
  const byKey = new Map();

  for (const r of raw) {
    const key = `${r.source}|${r.category}|${r.event}`;
    const seen = byKey.get(key);

    if (!seen) {
      byKey.set(key, { ...r, _folded: r.metadata?.occurrences ?? 1 });
      continue;
    }

    seen._folded += r.metadata?.occurrences ?? 1;
    if (String(r.timestamp) < String(seen.timestamp)) {
      // Earlier start wins; keep the accumulated count.
      byKey.set(key, { ...r, _folded: seen._folded });
    }
  }

  return [...byKey.values()].map((r) => ({
    ...r,
    metadata: { ...(r.metadata || {}), occurrences: r._folded },
  }));
}

const rows = computed(() =>
  toViews(collapse(props.events))
    .sort((a, b) =>
      (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0) ||
      String(b.id).localeCompare(String(a.id))
    )
    .slice(0, props.max)
);

/** Colour carries severity and nothing else — only on the dot. */
function severityColor(severity) {
  if (severity === 'error' || severity === 'critical') return 'var(--chart-grid, #bd2626)';
  if (severity === 'warning') return 'var(--chart-solar, #dfc908)';
  if (severity === 'notice')  return 'var(--chart-price, var(--chart-axis))';
  return 'var(--chart-battery, #137e3a)';
}
</script>

<style scoped>
.ip-card    { border-radius: var(--border-radius); border: 1px solid var(--border-color);
              background-color: var(--card-bg-color); box-shadow: var(--shadow); padding: 0.875rem; }
.ip-header  { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
.ip-title   { font-size: 0.875rem; font-weight: 600; }
.ip-link    { font-size: 0.75rem; background: none; cursor: pointer; }
.ip-link:hover { text-decoration: underline; }

/*
  FOUR fixed columns, matching .ds-badges above — a card is always the same
  width whether there are four conditions or one. auto-fit was stretching two
  cards across the full width, so card size changed with how many faults you
  happened to have.

  Gap matches the badge grid so the two rows share a rhythm.
*/
.ip-grid      { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1.5rem; }
.ip-tile      { background:  transparent; border-radius: var(--border-radius);border: 1px solid var(--color-secondary-100); padding: 0.6875rem; min-width: 0;display: flex; flex-direction: column; min-height: 6.25rem; }
.ip-tile__head{ display: flex; align-items: center; gap: 6px; margin-bottom: 7px; }
.ip-dot       { width: 6px; height: 6px; border-radius: 9999px; flex-shrink: 0; }
.ip-cat       { font-size: 0.625rem; letter-spacing: .05em; text-transform: uppercase;color: var(--color-secondary-400); }
.ip-label     { font-size: 0.8125rem; font-weight: 500; line-height: 1.35; margin-bottom: 5px;overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ip-value     { font-size: 1rem; font-weight: 500; line-height: 1; }
.ip-unit      { font-size: 0.6875rem; color: var(--color-secondary-400); font-weight: 400; }
/* margin-top:auto pins this to the bottom, so cards with and without a
   number are still the same height. */
.ip-since     { font-size: 0.6875rem; color: var(--color-secondary-400); margin-top: auto; padding-top: 4px; }
.ip-empty     { padding: 1.5rem 0.25rem; font-size: 0.8125rem; color: var(--color-secondary-400); }

/* Below 900px the five-across row is unreadable; two is the floor. */
@media (max-width: 900px) {
  .ip-grid { grid-template-columns: repeat(1, minmax(0, 1fr)); gap: 1rem; }
}
@media (max-width: 420px) {
  .ip-grid { grid-template-columns: 1fr; }
}
</style>