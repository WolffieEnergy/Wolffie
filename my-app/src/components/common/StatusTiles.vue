<!--
  StatusTiles.vue — a row of up to four summary tiles above the event log.

  Summary, not history: each tile is a single current fact. The chronological
  log stays a list below, because a log's value comes from timestamps lining
  up in a column — cards break that.

  Tiles render an em dash when their source is unavailable rather than being
  hidden, so a missing endpoint is visible instead of silently shrinking
  the row.
-->

<template>
  <div class="status-tiles">
    <div v-for="tile in tiles" :key="tile.key" class="st-tile bg-secondary-50 p-3">
      <div class="text-[10px] font-medium uppercase tracking-widest text-secondary-500 mb-1.5">
        {{ tile.label }}
      </div>
      <div class="text-[15px] font-semibold leading-snug">
        <template v-if="tile.value !== null && tile.value !== ''">{{ tile.value }}</template>
        <template v-else><span class="text-secondary-400">—</span></template>
      </div>
      <p v-if="tile.detail" class="text-xs text-secondary-500 mt-1 truncate" :title="tile.detail">
        {{ tile.detail }}
      </p>
    </div>
  </div>
</template>

<script setup>
defineProps({
  /** [{ key, label, value, detail }] — max 4. */
  tiles: { type: Array, default: () => [] },
});
</script>

<style scoped>
.status-tiles           { display: grid;grid-template-columns: repeat(2, minmax(0, 1fr));gap: 1rem;}
.st-tile                { border-radius: var(--border-radius);min-height: 78px;border: 1px solid var(--border-color);background-color: var(--card-bg-color);}

@media (min-width: 900px) {
  .status-tiles {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>