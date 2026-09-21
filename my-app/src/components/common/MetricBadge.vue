<!--
  MetricBadge.vue — one metric tile on the simple dashboard.

  Fixed structure so the four badges read as a set:
    label + icon
    today's total (headline)
    chart
    current value ("now")
    context line, separated by a hairline

  The `now` line is present because the simple view has no energy flow
  diagram. On the advanced view the flow owns the present moment and says it
  better, with direction.
-->

<template>
  <div class="metric-badge  p-3 flex flex-col">
    <div class="flex justify-between items-center mb-1">
      <span class="text-[10px] font-medium uppercase tracking-widest text-secondary-500">
        {{ label }}
      </span>
      <i :class="icon" class="text-base text-secondary-500" aria-hidden="true"></i>
    </div>

    <div class="text-2xl font-semibold leading-tight tabular-nums">
      <template v-if="value !== null">
        {{ value }}<span class="text-xs font-medium text-secondary-500"> {{ unit }}</span>
      </template>
      <template v-else>
        <span class="text-secondary-400">—</span>
      </template>
    </div>

    <div class="my-2 min-h-[34px]">
      <slot name="chart">
        <div class="h-[34px] flex items-center">
          <span class="text-[11px] text-secondary-400">{{ chartFallback }}</span>
        </div>
      </slot>
    </div>

    <div class="text-[13px] text-secondary-500">
      <slot name="now"></slot>
    </div>

    <div
      v-if="$slots.context"
      class="badge-context text-xs text-secondary-500 mt-2 pt-2"
    >
      <slot name="context"></slot>
    </div>
  </div>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  icon: { type: String, default: 'ph-light ph-circle' },
  /** Pre-formatted headline value, or null to render an em dash. */
  value: { type: [String, Number], default: null },
  unit: { type: String, default: '' },
  /** Shown in place of the chart when no series is available. */
  chartFallback: { type: String, default: '' },
});
</script>

<style scoped>
/*
  Radius and border come from the theme tokens rather than Tailwind's scale —
  the two disagree (Tailwind rounded-2xl is 16px, --radius-2xl is 24px), so
  mapping by name would silently change the shape.
*/
.metric-badge         { border-radius: var(--border-radius);border: 1px solid var(--border-color);background-color: var(--card-bg-color);}
.badge-context        { border-top: 0px solid var(--border-color);}
</style>