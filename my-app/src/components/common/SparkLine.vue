<!--
  Sparkline.vue — inline SVG micro chart for dashboard badges.

  Deliberately not Chart.js: four instances at 34px each is a lot of
  machinery for charts with no axes, no tooltips and no legend.

  Modes
    line  — measured continuous quantity (home load, grid power, SoC)
    bars  — hourly energy blocks (solar)
    steps — hourly values genuinely constant within the hour (day-ahead price)

  Missing data vs zero
    null / undefined / NaN  → GAP. The line breaks, the bar is not drawn.
    0                       → DRAWN. Solar at 02:00 and an idle battery are
                              real measurements, not absences.
    empty array             → baseline only (nothing).

  The zero line
    The horizontal rule is drawn at the data's ZERO, not at the bottom of the
    box — but only when zero is inside the domain. On an auto-scaled series
    that never reaches zero (state of charge) there is no zero to draw, so no
    rule appears and the chart shows shape only. A rule pinned to the bottom
    edge would claim the low point of the day was zero.

  This mirrors the NULL-over-zero rule used in the database: a zero that
  wasn't measured pollutes everything downstream. A price step drawn at 0 for
  unpublished hours would read as free electricity.

  Colours are passed as literal strings and applied inline. Tailwind v4 does
  not generate classes from runtime-constructed names, so a `color` prop must
  never be interpolated into a class.
-->

<template>
  <svg
    :viewBox="`0 0 ${W} ${H}`"
    class="w-full"
    :style="{ height: height + 'px' }"
    preserveAspectRatio="none"
    role="img"
    :aria-label="ariaLabel"
  >
    <!--
      Gradient fill. Each instance gets its own id: four sparklines sharing
      one gradient id all resolve to whichever <defs> rendered last.
    -->
    <defs v-if="fill">
      <linearGradient
        :id="gradientId"
        gradientUnits="userSpaceOnUse"
        :x1="0" :y1="0" :x2="0" :y2="H"
      >
        <stop offset="0%" :style="{ stopColor: color, stopOpacity: fillOpacity }" />
        <stop offset="100%" :style="{ stopColor: color, stopOpacity: 0 }" />
      </linearGradient>
    </defs>

    <!-- filled area, drawn under the stroke -->
    <path
      v-for="(d, i) in areaPaths"
      :key="'a' + i"
      :d="d"
      :fill="`url(#${gradientId})`"
      stroke="none"
    />

    <!--
      Backdrop series. Scaled to its OWN range, not the main domain — it is
      context, not a comparable quantity. Rendered first so everything else
      sits on top of it.
    -->
    <path
      v-for="(d, i) in backgroundPaths"
      :key="'bg' + i"
      :d="d"
      :style="{ fill: backgroundColor || color, opacity: backgroundOpacity }"
      stroke="none"
    />

    <!--
      Zero rule. Positioned at scaleY(0), so on a series that straddles zero
      (grid: import above, export below) it sits mid-chart and separates the
      two. Omitted entirely when zero is outside the domain.
    -->
    <line
      v-if="zeroY !== null"
      :x1="0" :y1="zeroY" :x2="W" :y2="zeroY"
      stroke-width="0.5"
      :style="{ stroke: axisColor, opacity: 0.5 }"
      vector-effect="non-scaling-stroke"
    />

    <!-- bars: nulls are skipped, zeros draw a hairline -->
    <template v-if="mode === 'bars'">
      <rect
        v-for="bar in bars"
        :key="'b' + bar.i"
        :x="bar.x" :y="bar.y" :width="bar.w" :height="bar.h"
        :fill="fill ? `url(#${gradientId})` : undefined"
        :style="fill ? null : { fill: color }"
        :opacity="fill ? 1 : 0.45"
      />
    </template>

    <!-- steps: one polyline per contiguous run -->
    <template v-else-if="mode === 'steps'">
      <polyline
        v-for="(run, i) in stepRuns"
        :key="'s' + i"
        :points="run"
        fill="none"
        :style="{ stroke: color }"
        stroke-width="1.5"
        vector-effect="non-scaling-stroke"
      />
    </template>

    <!-- line: one polyline per contiguous run -->
    <template v-else>
      <polyline
        v-for="(run, i) in lineRuns"
        :key="'l' + i"
        :points="run"
        fill="none"
        :style="{ stroke: color }"
        stroke-width="1.5"
        vector-effect="non-scaling-stroke"
      />
    </template>

    <!--
      Second series (e.g. forecast against measured). Drawn before the main
      line in the stacking order below, with its own colour and dash so the
      two are distinguishable without a legend.
    -->
    <polyline
      v-for="(run, i) in overlayRuns"
      :key="'o' + i"
      :points="run"
      fill="none"
      :style="{ stroke: overlayColor || color, opacity: overlayOpacity }"
      stroke-width="1.5"
      :stroke-dasharray="overlayDashed ? '3 2' : undefined"
      vector-effect="non-scaling-stroke"
    />

    <!-- projection -->
    <!--
      Projection: the planned continuation, on the SAME axis as `values`,
      not appended after it. The dashed marker is "now" — the last slot that
      actually has a measurement.
    -->
    <polyline
      v-for="(run, i) in projectionRuns"
      :key="'p' + i"
      :points="run"
      fill="none"
      :style="{ stroke: color, opacity: 0.6 }"
      stroke-width="1.5"
      stroke-dasharray="3 2"
      vector-effect="non-scaling-stroke"
    />

    <line
      v-if="projectionRuns.length && joinX !== null"
      :x1="joinX" :y1="0" :x2="joinX" :y2="H - 1"
      stroke-width="1" stroke-dasharray="2 2"
      :style="{ stroke: axisColor }"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  /** Values in time order. null / undefined / NaN render as gaps. */
  values: { type: Array, default: () => [] },
  /** Optional dashed continuation appended after `values`. */
  projection: { type: Array, default: () => [] },
  /** Optional second series on the same axes (forecast vs measured). */
  overlay: { type: Array, default: () => [] },
  /** Colour for `overlay`. Falls back to `color` when unset. */
  overlayColor: { type: String, default: '' },
  overlayDashed: { type: Boolean, default: false },
  overlayOpacity: { type: Number, default: 0.75 },
  /**
   * Context series drawn as a faint stepped area behind the main series, on
   * its own scale. For a quantity in different units (day-ahead price under
   * grid power): it conveys relative level and timing, never a value that can
   * be read against the main series.
   */
  background: { type: Array, default: () => [] },
  backgroundColor: { type: String, default: '' },
  backgroundOpacity: { type: Number, default: 0.18 },
  mode: { type: String, default: 'line' }, // line | bars | steps
  /**
   * Any CSS colour value, including a custom property:
   *   color="var(--chart-solar)"
   * Applied through :style, never as an SVG presentation attribute — var()
   * is not reliably supported in those.
   */
  /**
   * Any CSS colour value. When passing a custom property, include a fallback
   * — `var(--chart-price, var(--chart-axis))`. An undefined property makes
   * the whole declaration invalid, SVG's initial stroke is `none`, and the
   * series renders invisibly with no error anywhere.
   */
  color: { type: String, default: 'var(--chart-yield, #0284C7)' },
  /** Baseline and now-marker colour. */
  axisColor: { type: String, default: 'var(--chart-axis, #64748B)' },
  height: { type: Number, default: 34 },
  /**
   * Shade the area under the line with a vertical fade of `color`.
   *
   * Only meaningful where the area is itself a quantity — power over time
   * integrates to energy. Do NOT use for state of charge or price: the area
   * under those curves represents nothing.
   */
  fill: { type: Boolean, default: false },
  /** Opacity at the top of the gradient. Lower it if the fill overpowers. */
  fillOpacity: { type: Number, default: 0.35 },
  /** Force the y-axis floor to zero rather than the series minimum. */
  zeroBased: { type: Boolean, default: true },
  /**
   * Explicit domain, overriding auto-scaling. Use it where the quantity has
   * fixed natural bounds — state of charge is 0-100 whatever today's range
   * happened to be, and auto-scaling it turns a 7% drift into a dramatic
   * swoop that overstates what actually happened.
   */
  min: { type: Number, default: null },
  max: { type: Number, default: null },
  ariaLabel: { type: String, default: '' },
});

let uid = 0;
const gradientId = `spark-grad-${(uid = uid + 1, Date.now().toString(36))}-${Math.random().toString(36).slice(2, 8)}`;

const W = 100;
const H = 34;
const PAD = 2;

/** True for a real measurement, including 0. False for an absence. */
function present(v) {
  return v !== null && v !== undefined && Number.isFinite(v);
}

/** Combined domain so measured, overlay and projection share one scale. */
const domain = computed(() => {
  const explicitMin = props.min !== null && Number.isFinite(props.min);
  const explicitMax = props.max !== null && Number.isFinite(props.max);

  const all = [...props.values, ...props.projection, ...props.overlay].filter(present);
  if (!all.length && !(explicitMin && explicitMax)) return { min: 0, max: 1 };

  // zeroBased keeps 0 inside the domain in BOTH directions: for a series
  // that goes negative (grid export) it is what puts the zero rule mid-chart
  // rather than at the bottom.
  let min = explicitMin
    ? props.min
    : (props.zeroBased ? Math.min(0, ...all) : Math.min(...all));
  let max = explicitMax
    ? props.max
    : (props.zeroBased ? Math.max(0, ...all) : Math.max(...all));

  if (max === min) max = min + 1;
  return { min, max };
});

/** y of the data's zero, or null when zero is outside the domain. */
const zeroY = computed(() => {
  const { min, max } = domain.value;
  if (min > 0 || max < 0) return null;
  return scaleY(0);
});

/**
 * Where a filled area closes. On a series that straddles zero the fill must
 * stop at the zero rule — closing it at the bottom edge would shade the
 * export half as though it were import.
 */
const areaBase = computed(() => (zeroY.value === null ? H - PAD : zeroY.value));

/**
 * Filled area under the line: one closed path per contiguous run, so gaps
 * stay unfilled exactly as the stroke does. Closes at `areaBase` — the zero
 * rule where one exists, the bottom edge otherwise.
 */
const areaPaths = computed(() => {
  if (!props.fill || props.mode === 'steps' || !props.values.length) return [];
  const total = totalPoints.value;
  const base = areaBase.value;
  const paths = [];
  let run = [];

  const flush = () => {
    if (run.length > 1) {
      const first = run[0];
      const last = run[run.length - 1];
      paths.push(
        `M ${first.x},${base} L ` +
        run.map((pt) => `${pt.x},${pt.y}`).join(' L ') +
        ` L ${last.x},${base} Z`
      );
    }
    run = [];
  };

  props.values.forEach((v, i) => {
    if (!present(v)) { flush(); return; }
    run.push({ x: scaleX(i, total), y: scaleY(v) });
  });
  flush();

  return paths;
});

/**
 * Backdrop series as a stepped area, normalised against its OWN min/max so a
 * 0-24 ct price range fills the box the same way a 0-3000 W range would. It
 * conveys level and timing, never a value readable against the main series.
 */
const backgroundPaths = computed(() => {
  const arr = props.background;
  if (!arr.length) return [];

  const vals = arr.filter(present);
  if (!vals.length) return [];

  const min = Math.min(...vals);
  let max = Math.max(...vals);
  if (max === min) max = min + 1;

  const base = H - PAD;
  const slot = W / arr.length;
  const y = (v) => base - ((v - min) / (max - min)) * (H - PAD * 2);

  const paths = [];
  let run = [];

  const flush = () => {
    if (run.length) {
      const x0 = run[0].x0;
      const x1 = run[run.length - 1].x1;
      const top = run
        .map((seg) => `L ${seg.x0},${seg.y} L ${seg.x1},${seg.y}`)
        .join(' ');
      paths.push(`M ${x0},${base} ${top} L ${x1},${base} Z`);
    }
    run = [];
  };

  arr.forEach((v, i) => {
    if (!present(v)) { flush(); return; }
    run.push({ x0: i * slot, x1: (i + 1) * slot, y: y(v) });
  });
  flush();

  return paths;
});

function scaleY(v) {
  const { min, max } = domain.value;
  const t = (v - min) / (max - min);
  return H - PAD - t * (H - PAD * 2);
}

function scaleX(i, total) {
  if (total <= 1) return 0;
  return (i / (total - 1)) * W;
}

/**
 * Every series shares one x-axis. Scaling `overlay` by its own length would
 * stretch a 24-hour forecast across the same width as 20 elapsed hours, so
 * the two would not line up in time.
 */
/**
 * All series share one x-axis, so the axis is as long as the longest of
 * them. `projection` is an ALIGNED array — slot i means the same moment in
 * values, overlay and projection alike — not a tail appended after `values`.
 * Appending would double the axis length whenever both arrays cover the same
 * day, squashing the measured line into the left half of the chart.
 */
const totalPoints = computed(() =>
  Math.max(props.values.length, props.projection.length, props.overlay.length)
);

/**
 * Split a series into contiguous runs of present values, each as an SVG
 * points string. A single isolated point is dropped — a polyline of one
 * point draws nothing anyway.
 */
function buildRuns(arr, total) {
  const runs = [];
  let current = [];
  arr.forEach((v, i) => {
    if (!present(v)) {
      if (current.length > 1) runs.push(current.join(' '));
      current = [];
      return;
    }
    current.push(`${scaleX(i, total)},${scaleY(v)}`);
  });
  if (current.length > 1) runs.push(current.join(' '));
  return runs;
}

const lineRuns = computed(() => {
  if (props.mode !== 'line' || !props.values.length) return [];
  return buildRuns(props.values, totalPoints.value);
});

const overlayRuns = computed(() => {
  if (!props.overlay.length) return [];
  return buildRuns(props.overlay, totalPoints.value);
});

const projectionRuns = computed(() => {
  if (!props.projection.length) return [];
  return buildRuns(props.projection, totalPoints.value);
});

/** Index of the last slot carrying a real measurement — i.e. "now". */
const lastPresentIndex = computed(() => {
  for (let i = props.values.length - 1; i >= 0; i -= 1) {
    if (present(props.values[i])) return i;
  }
  return -1;
});

const joinX = computed(() =>
  lastPresentIndex.value < 0 ? null : scaleX(lastPresentIndex.value, totalPoints.value)
);

const bars = computed(() => {
  if (props.mode !== 'bars' || !props.values.length) return [];
  const n = props.values.length;
  const slot = W / n;
  const w = Math.max(slot * 0.7, 0.5);
  return props.values
    .map((v, i) => {
      if (!present(v)) return null;          // absent → no bar at all
      const y = scaleY(v);
      return {
        i,
        x: i * slot + (slot - w) / 2,
        y,
        w,
        h: Math.max(H - PAD - y, 0.5),        // zero → hairline, still drawn
      };
    })
    .filter(Boolean);
});

const stepRuns = computed(() => {
  if (props.mode !== 'steps' || !props.values.length) return [];
  const n = props.values.length;
  const slot = W / n;
  const runs = [];
  let current = [];

  props.values.forEach((v, i) => {
    if (!present(v)) {
      if (current.length) runs.push(current.join(' '));
      current = [];
      return;
    }
    const y = scaleY(v);
    current.push(`${i * slot},${y}`);
    current.push(`${(i + 1) * slot},${y}`);
  });

  if (current.length) runs.push(current.join(' '));
  return runs;
});
</script>