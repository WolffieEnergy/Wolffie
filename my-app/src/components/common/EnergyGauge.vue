<!--
  EnergyGauge.vue

  A node from EnergyFlowDiagram, scaled up and given a level arc — so the
  overview row and the flow panel read as one system rather than two.

  Geometry and styling are lifted from EnergyFlowDiagram deliberately:
    · white circle, 0.5-weight secondary-500 stroke, same drop shadow
    · arc sits just outside the circle, round cap, rotated -90
    · Phosphor Light glyph in secondary-700
  Proportions are held to the flow's own ratios (arc thickness ≈ 1/8 of the
  node diameter, glyph ≈ half of it), scaled from NR=16 up to r=24 in a
  64-unit viewBox.

  One deliberate deviation: the flow's battery node draws no track behind its
  SoC arc, because there is always an arc to see. In a row of five gauges a
  low or absent level would otherwise render as a bare circle, so a faint
  secondary-100 track is always drawn. Remove .gauge-track to match the flow
  literally.

  Props
    icon     — full Phosphor class string, e.g. 'ph-light ph-sun'
    series   — semantic channel, resolves the arc to the chart palette:
               'solar' | 'home' | 'battery' | 'grid' | 'export' | 'import'
               The component cannot infer this from the icon, so pass it.
    level    — 0..100, or null when no reference scale exists yet (track only)
    value    — already-formatted number, e.g. '1.7'
    unit     — 'kWh' | '%'
    label    — accessible name, e.g. 'solar today'
    arcColor — optional explicit CSS colour. Overrides `series` when set;
               kept so EnergyFlowDiagram can pass its own batteryArcColor.

  Resolution order: arcColor → series → neutral grey.
-->

<template>
  <div class="energy-gauge">
    <div class="gauge-dial" role="img" :aria-label="ariaLabel">
      <svg class="gauge-svg" viewBox="0 0 64 64">
        <circle class="gauge-track" cx="32" cy="32" r="26" />
        <circle
          v-if="hasLevel"
          class="gauge-arc"
          cx="32"
          cy="32"
          r="26"
          fill="none"
          :stroke="resolvedArcColor"
          :stroke-dasharray="arcDash"
          transform="rotate(-90 32 32)"
        />
        <circle class="gauge-circle" cx="32" cy="32" r="24" />
      </svg>
      <i class="gauge-icon" :class="icon" aria-hidden="true"></i>
    </div>

    <div class="gauge-value">
      {{ value }}<span class="gauge-unit">{{ unit }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

// Single source of truth for gauge → chart palette. These are the same
// tokens the history chart draws its series with, so a gauge and its line
// always carry the same hue in every theme.
const SERIES_COLORS = {
  solar:   'var(--chart-solar)',
  home:    'var(--chart-yield)',
  battery: 'var(--chart-battery)',
  grid:    'var(--chart-grid)',
  export:  'var(--chart-grid)',
  import:  'var(--chart-grid)',
};

const NEUTRAL = 'var(--chart-solar, #d1d5db)';

const props = defineProps({
  icon:     { type: String, required: true },
  series:   { type: String, default: null },
  level:    { type: Number, default: null },
  value:    { type: [String, Number], default: '' },
  unit:     { type: String, default: '' },
  label:    { type: String, default: '' },
  arcColor: { type: String, default: null },
});

const resolvedArcColor = computed(
  () => props.arcColor || SERIES_COLORS[props.series] || NEUTRAL
);

// Same dasharray technique as the flow diagram's SoC arc.
const ARC_CIRC = 2 * Math.PI * 26;

const hasLevel = computed(() => props.level !== null && props.level !== undefined);

const arcDash = computed(() => {
  const pct = Math.min(100, Math.max(0, props.level ?? 0));
  const filled = ARC_CIRC * (pct / 100);
  return `${filled} ${ARC_CIRC - filled}`;
});

const ariaLabel = computed(() => {
  const base = `${props.label} ${props.value} ${props.unit}`.trim();
  return hasLevel.value
    ? `${base}, ${Math.round(props.level)}% of reference`
    : base;
});
</script>

<style scoped>
.energy-gauge       {display: flex;flex-direction: column;align-items: center;}
.gauge-dial         {position: relative;width: 100%;max-width: 68px;aspect-ratio: 1 / 1;}
.gauge-svg          {width: 100%;height: 100%;display: block;overflow: visible;}
.gauge-track        {fill: none;stroke: transparent;stroke-width: 6;}
.gauge-arc          {stroke-width: 10;/*stroke-linecap: round */;transition: stroke-dasharray 0.6s ease;}
@media (prefers-reduced-motion: reduce) {
  .gauge-arc { transition: none; }
}

/* Mirrors .node-circle--active in EnergyFlowDiagram */
.gauge-circle     {fill: var(--color-card, #fff);stroke: var(--color-secondary-500);stroke-width: 1.5;/*filter: drop-shadow(0 2px 4px var(--color-secondary-300));*/}
.gauge-icon       {position: absolute;top: 50%;left: 50%;transform: translate(-50%, -50%);font-size: 1.75rem;line-height: 1;color: var(--color-secondary-700);}
.gauge-value      {margin-top: 0.4rem;font-size: 0.95rem;font-weight: 500;line-height: 1;color: var(--color-text-primary);}
.gauge-unit       {font-size: 0.625rem;font-weight: 400;margin-left: 0.15rem;color: var(--color-secondary-400);}
</style>