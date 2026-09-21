<template>

  <div class="flow-diagram">
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      class="flow-svg"
      xmlns="http://www.w3.org/2000/svg"
    >

      <!-- ══════════════════════════════════════════════════════════
           PATHS — unchanged from original
      ══════════════════════════════════════════════════════════ -->

      <path id="p-grid"
        :d="`M ${POS.grid.x} ${POS.grid.y + NR} L ${CX} ${CY - 38}`"
        class="flow-line-base" :class="gridLineClass"
      />
      <path id="p-solar"
        :d="`M ${POS.solar.x} ${POS.solar.y + NR}
             L ${POS.solar.x} ${CY - 14 - R}
             Q ${POS.solar.x} ${CY - 14} ${POS.solar.x + R} ${CY - 14}
             L ${CX - 34} ${CY - 14}`"
        class="flow-line-base"
        :class="solarActive ? 'flow-line--active' : 'flow-line--inactive'"
      />
      <path id="p-wind"
        :d="`M ${POS.wind.x} ${POS.wind.y + NR}
             L ${POS.wind.x} ${CY - 14 - R}
             Q ${POS.wind.x} ${CY - 14} ${POS.wind.x - R} ${CY - 14}
             L ${CX + 34} ${CY - 14}`"
        class="flow-line-base flow-line--inactive"
      />
      <path id="p-home"
        :d="`M ${CX - 34} ${CY + 14} L ${POS.home.x + R} ${CY + 14} Q ${POS.home.x} ${CY + 14} ${POS.home.x} ${CY + 14 + R} L ${POS.home.x} ${POS.home.y - NR}`"
        class="flow-line-base"
        :class="homeActive ? 'flow-line--active' : 'flow-line--inactive'"
      />
      <path id="p-boiler"
        :d="`M ${CX} ${CY + 38} L ${POS.boiler.x} ${POS.boiler.y - NR}`"
        class="flow-line-base flow-line--inactive"
      />
      <path id="p-ev"
        :d="`M ${CX + 34} ${CY + 14} L ${POS.ev.x - R} ${CY + 14} Q ${POS.ev.x} ${CY + 14} ${POS.ev.x} ${CY + 14 + R} L ${POS.ev.x} ${POS.ev.y - NR}`"
        class="flow-line-base flow-line--inactive"
      />
      <path id="p-battery"
        :d="`M ${CX + 38 } ${CY} L ${POS.battery.x - NR - 2} ${CY}`"
        class="flow-line-base" :class="batteryLineClass"
      />
      <!-- p-smart: home → smart (unchanged — smart node never moves) -->
      <path id="p-smart"
        :d="`M ${POS.home.x + NR} ${POS.home.y} L ${POS.smart.x - R} ${POS.home.y} Q ${POS.smart.x} ${POS.home.y} ${POS.smart.x} ${POS.home.y + R} L ${POS.smart.x} ${POS.smart.y - NR}`"
        class="flow-line-base"
        :class="smartActive ? 'flow-line--active' : 'flow-line--inactive'"
      />

      <!-- ── Moving dots ────────────────────────────────────────── -->
      <circle v-if="solarActive && solarW > 20" r="3" class="flow-dot flow-dot--solar">
        <animateMotion :dur="`${dotSpeed(solarW)}s`" repeatCount="indefinite" rotate="auto"><mpath href="#p-solar"/></animateMotion>
      </circle>
      <circle v-if="gridActive && !upsMode && Math.abs(gridW) > 20" r="3" class="flow-dot" :class="gridW > 0 ? 'flow-dot--import' : 'flow-dot--export'">
        <animateMotion :dur="`${dotSpeed(Math.abs(gridW))}s`" repeatCount="indefinite" rotate="auto" :keyPoints="gridW > 0 ? '0;1' : '1;0'" keyTimes="0;1" calcMode="linear"><mpath href="#p-grid"/></animateMotion>
      </circle>
      <circle v-if="homeActive && homeW > 10" r="3" class="flow-dot flow-dot--green">
        <animateMotion :dur="`${dotSpeed(homeW)}s`" repeatCount="indefinite" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="linear"><mpath href="#p-home"/></animateMotion>
      </circle>
      <circle v-if="batteryActive && Math.abs(battW) > 50" r="3" class="flow-dot flow-dot--green">
        <animateMotion :dur="`${dotSpeed(Math.abs(battW))}s`" repeatCount="indefinite" rotate="auto" :keyPoints="battW < -50 ? '0;1' : '1;0'" keyTimes="0;1" calcMode="linear"><mpath href="#p-battery"/></animateMotion>
      </circle>

      <!-- Smart: home → smart direction (same as home dot: hub→leaf = 0;1) -->
      <circle v-if="smartActive && smartW > 10" r="3" class="flow-dot flow-dot--green">
        <animateMotion :dur="`${dotSpeed(smartW)}s`" repeatCount="indefinite" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
          <mpath href="#p-smart"/>
        </animateMotion>
      </circle>

      <!-- ── Hub ───────────────────────────────────────────────── -->
      <circle v-if="upsMode" :cx="CX" :cy="CY" r="50" class="hub-ups-ring"/>
      <circle :cx="CX" :cy="CY" r="40" :class="['hub-circle', upsMode ? 'hub-circle--ups' : '']"/>
      <text :x="CX" :y="CY - 4"  class="hub-text hub-title">WOLFFIE</text>
      <text :x="CX" :y="CY + 10" class="hub-text hub-sub">ENERGY</text>

      <!-- ── Battery node ───────────────────────────────────────── -->
      <g :transform="`translate(${POS.battery.x}, ${POS.battery.y})`">
        <circle :r="NR + 2" fill="none" stroke="var(--color-secondary-100,#f3f4f6)" stroke-width="0"/>
        <circle :r="NR+1" fill="batteryArcColor" :stroke="batteryArcColor" stroke-width="6" stroke-linecap="-round" :stroke-dasharray="batteryArcDash" transform="rotate(-90 0 0)" class="hub-soc-arc"/>
        <circle :r="NR" class="node-circle node-circle--active"/>
        <foreignObject :x="-NR * 0.5" :y="-NR * 0.5" :width="NR" :height="NR">
          <div xmlns="http://www.w3.org/1999/xhtml" class="node-icon-wrap">
            <i class="ph-light ph-battery-charging" style="font-size:16px;line-height:1;color:var(--color-light);"></i>
          </div>
        </foreignObject>
        <text y="34" class="node-label node-label--active" text-anchor="middle">Battery</text>
        <text y="46" class="node-value" text-anchor="middle">{{ battStatusLabel }}</text>
        <text v-if="Math.abs(battW) > 50" y="58" class="node-value" text-anchor="middle">{{ fmtW(battW) }}</text>
      </g>

      <!-- ── Regular nodes (smart excluded) ─────────────────────── -->
      <g v-for="node in nodeList" :key="node.id" :transform="`translate(${node.x}, ${node.y})`">
        <circle :r="NR" :class="['node-circle', node.active ? 'node-circle--active' : 'node-circle--inactive', node.id === 'grid' && upsMode ? 'node-circle--ups' : '']"/>
        <foreignObject :x="-NR * 0.5" :y="-NR * 0.5" :width="NR" :height="NR">
          <div xmlns="http://www.w3.org/1999/xhtml" class="node-icon-wrap">
            <i :class="`ph-light ${node.icon}`" :style="{ fontSize: '16px', lineHeight: '1', color: node.id === 'grid' && upsMode ? '#ef4444' : node.active ? 'var(--color-primary)' : 'var(--color-secondary-400)' }"></i>
          </div>
        </foreignObject>
        <template v-if="node.top">
          <text y="-38" class="node-label" :class="[node.active ? 'node-label--active' : 'node-label--inactive', node.id === 'grid' && upsMode ? 'node-label--ups' : '']" text-anchor="middle">{{ node.label }}</text>
          <text v-if="node.active && node.value" y="-26" class="node-value" text-anchor="middle">{{ node.value }}</text>
        </template>
        <template v-else>
          <text y="32" class="node-label" :class="[node.active ? 'node-label--active' : 'node-label--inactive', node.id === 'grid' && upsMode ? 'node-label--ups' : '']" text-anchor="middle">{{ node.label }}</text>
          <text v-if="node.active && node.value" y="44" class="node-value" text-anchor="middle">{{ node.value }}</text>
        </template>
      </g>

      <!-- ════════════════════════════════════════════════════════
           SMART HUB + DEVICE GRID

           Smart node sits at its original position (103, 290) and
           never moves. When expanded, ALL devices — active and idle —
           appear in a 3-column grid directly below smart.

           Active devices: full white circle, green label + wattage.
           Idle devices:   muted grey circle, grey label only.

           Paths use the same H/V + rounded-corner language as the
           rest of the diagram (no diagonals):
             DOWN from smart bottom → horizontal trunk → corner → DOWN to device top.

           Three SVG layers keep z-order correct:
             1. Paths  (behind everything)
             2. Device circles + labels
             3. Smart hub (always on top)
      ════════════════════════════════════════════════════════ -->

      <!-- Layer 1: device connector paths -->
      <template v-if="smartExpanded">
        <template v-for="dev in deviceHaloData" :key="`path-${dev.device_id}`">
          <path
            :id="`p-dev-${safeId(dev.device_id)}`"
            :d="dev.pathD"
            class="flow-line-base"
            :class="dev.active ? 'flow-line--active' : 'flow-line--inactive'"
          />
          <circle v-if="dev.active && dev.power > 5" r="2.5" class="flow-dot flow-dot--green">
            <animateMotion :dur="`${dotSpeed(dev.power)}s`" repeatCount="indefinite" rotate="auto">
              <mpath :href="`#p-dev-${safeId(dev.device_id)}`"/>
            </animateMotion>
          </circle>
        </template>
      </template>

      <!-- Layer 2: device node circles + labels -->
      <template v-if="smartExpanded">
        <g v-for="dev in deviceHaloData" :key="`dev-${dev.device_id}`"
           :transform="`translate(${dev.x}, ${dev.y})`">
          <circle :r="NR" :class="['node-circle', dev.active ? 'node-circle--active' : 'node-circle--inactive']"/>
          <foreignObject :x="-NR * 0.5" :y="-NR * 0.5" :width="NR" :height="NR">
            <div xmlns="http://www.w3.org/1999/xhtml" class="node-icon-wrap">
              <i class="ph-light ph-plug"
                 :style="{ fontSize: '11px', lineHeight: '1', color: dev.active ? 'var(--color-primary)' : 'var(--color-secondary-400)' }">
              </i>
            </div>
          </foreignObject>
          <!-- Label below circle — same convention as home / boiler / ev -->
          <text y="32" text-anchor="middle" class="node-label" :class="dev.active ? 'node-label--active' : 'node-label--inactive'">{{ truncName(dev.name) }}</text>
          <text v-if="dev.active" y="44" text-anchor="middle" class="node-value">{{ fmtW(dev.power) }}</text>
        </g>
      </template>

      <!-- Layer 3: smart hub (always rendered on top) -->
      <g :transform="`translate(${POS.smart.x}, ${POS.smart.y})`"
         @click="smartActive && (smartExpanded = !smartExpanded)">
        <circle :r="NR + 8" fill="transparent" :style="{ cursor: smartActive ? 'pointer' : 'default' }"/>
        <circle :r="NR" :class="['node-circle', smartActive ? 'node-circle--active' : 'node-circle--inactive']"/>
        <foreignObject :x="-NR * 0.5" :y="-NR * 0.5" :width="NR" :height="NR">
          <div xmlns="http://www.w3.org/1999/xhtml" class="node-icon-wrap">
            <i class="ph-light ph-plug"
               :style="{ fontSize: '12px', lineHeight: '1', color: smartActive ? 'var(--color-primary)' : 'var(--color-secondary-400)' }">
            </i>
          </div>
        </foreignObject>
        <!-- Badge: active device count (collapsed only) -->
        <g v-if="!smartExpanded && smartActiveCount > 0">
          <circle cx="13" cy="-13" r="8" fill="var(--color-secondary-300)"/>
          <text x="13" y="-10" text-anchor="middle" class="badge-text">{{ smartActiveCount }}</text>
        </g>
        <text x="32"   class="node-label" :class="smartActive ? 'node-label--active' : 'node-label--inactive'" text-anchor="middle">smart</text>
        <text v-if="smartActive && smartW > 0" x="32" y="12" class="node-value" text-anchor="middle">{{ fmtW(smartW) }}</text>
        <text v-if="smartActive" y="28" text-anchor="middle" class="chevron-hint ">{{ smartExpanded ? '▴' : '▾' }}</text>
      </g>

    </svg>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRealtimeStore } from '@/stores/realtime';
import { useDevicesStore } from '@/stores/devices';

const realtimeStore = useRealtimeStore();
const devicesStore  = useDevicesStore();

onMounted(() => {
  if (!devicesStore.autoRefreshEnabled) {
    devicesStore.initialize();
  } else {
    devicesStore.fetchDevices();
  }
});

// ── Canvas ────────────────────────────────────────────────────────────────────

const W = 300;

// H grows automatically to fit however many device rows are needed.
// Collapsed: fixed 370px. Expanded: smart.y + (rows × STEP_Y) + bottom margin.
const H = computed(() => {
  if (!smartExpanded.value || devicesStore.devices.length === 0) return POS.smart.y + 46; // 316
  const rows = Math.ceil(devicesStore.devices.length / COLS);
  return POS.smart.y + STEP_Y * rows + NR + 50; // NR for last circle, 50 for label + margin
});

// ── Node geometry ─────────────────────────────────────────────────────────────

const NR = 16; // node radius
const R  = 10; // path corner radius
const CX = 118;
const CY = 120;

const POS = {
  grid:    { x: CX,       y: 40       },
  solar:   { x: CX - 70,  y: 40       },
  wind:    { x: CX + 70,  y: 40       },
  battery: { x: CX + 118, y: CY       },
  home:    { x: CX - 70,  y: CY + 80  },
  boiler:  { x: CX,       y: CY + 80  },
  ev:      { x: CX + 70,  y: CY + 80  },
  smart:   { x: CX - 40,  y: CY + 150 }, // (103, 290)
};

// ── Device grid constants ─────────────────────────────────────────────────────
//
// COLS:     devices per row. 3 fits cleanly in 320px canvas with 80px step.
// STEP_X:   horizontal distance between device centers (80px).
//           Label budget: truncated to 9 chars × ~7px = ~63px; STEP_X − 63 = 17px gap. ✓
// STEP_Y:   vertical distance between device rows (80px).
//           Bottom of circle + label (32px) to top of next circle: 80 − 32 = 48px gap. ✓
// GRID_CX:  horizontal center of the device grid. Set to CX (148) so the grid is
//           centred in the canvas. Smart is at x=103 — paths branch naturally left/right.
//
// Adjust these three constants if the live layout needs tuning.

const COLS    = 3;
const STEP_X  = 80;
const STEP_Y  = 80;
const GRID_CX = CX; // 148

// ── Smart expand / collapse ───────────────────────────────────────────────────

const smartExpanded = ref(false);

// ── Active states ─────────────────────────────────────────────────────────────

const solarActive = computed(() => {
  const s = realtimeStore.realtimeData?.components?.solar;
  return !!s && (s.currentOut || 0) > 5;
});
const batteryActive = computed(() => !!realtimeStore.realtimeData?.components?.battery_1);
const gridActive    = computed(() => !!realtimeStore.realtimeData?.components?.grid);
const homeActive    = computed(() => !!realtimeStore.realtimeData?.components?.home_usage);
const smartActive   = computed(() => devicesStore.devices.length > 0);
const smartW        = computed(() => devicesStore.totalPower);

// Badge count — devices with any measurable power draw
const smartActiveCount = computed(() =>
  devicesStore.devices.filter(d => (parseFloat(d.power) || 0) > 0).length
);

// ── Live power values ─────────────────────────────────────────────────────────

const solarW = computed(() => realtimeStore.realtimeData?.components?.solar?.currentOut || 0);
const battW  = computed(() => {
  const b = realtimeStore.realtimeData?.components?.battery_1;
  return b ? (b.currentIn || 0) - (b.currentOut || 0) : 0;
});
const gridW = computed(() => {
  const g = realtimeStore.realtimeData?.components?.grid;
  return g ? (g.currentIn || 0) - (g.currentOut || 0) : 0;
});
const homeW = computed(() => realtimeStore.realtimeData?.components?.home_usage?.currentIn || 0);

const gridConnected = computed(() => realtimeStore.gridConnected ?? true);
const upsMode       = computed(() => gridActive.value && !gridConnected.value);

// ── Dot speed ─────────────────────────────────────────────────────────────────

function dotSpeed(watts) {
  const clamped = Math.max(100, Math.min(5000, Math.abs(watts)));
  return +((3.0 - ((clamped - 100) / 4900) * 2.5)).toFixed(2);
}

// ── Battery arc ───────────────────────────────────────────────────────────────

const battSoc        = computed(() => Math.round(realtimeStore.realtimeData?.batterySOC || 0));
const SOC_CIRC       = 2 * Math.PI * (NR + 2);
const batteryArcDash = computed(() => {
  const filled = SOC_CIRC * (battSoc.value / 100);
  return `${filled} ${SOC_CIRC - filled}`;
});
const batteryArcColor = computed(() => {
  if (battW.value < -50) return 'var(--chart-battery)';
  if (battW.value >  50) return 'var(--chart-battery)';
  if (battSoc.value <= 20) return 'var(--chart-battery)';
  return 'var(--chart-battery)';
});
const battStatusLabel = computed(() => {
  if (battW.value < -50) return 'charging';
  if (battW.value >  50) return 'discharging';
  return 'idle';
});

// ── Line classes ──────────────────────────────────────────────────────────────

const gridLineClass = computed(() => {
  if (upsMode.value)              return 'flow-line--ups';
  if (!gridActive.value)          return 'flow-line--inactive';
  if (Math.abs(gridW.value) > 20) return 'flow-line--active';
  return 'flow-line--inactive';
});

const batteryLineClass = computed(() => {
  if (!batteryActive.value)       return 'flow-line--inactive';
  if (Math.abs(battW.value) > 50) return 'flow-line--active';
  return 'flow-line--inactive';
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtW(watts) {
  const abs = Math.abs(watts);
  return abs >= 1000 ? `${(abs / 1000).toFixed(1)} kW` : `${Math.round(abs)} W`;
}

function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Truncate and clean device names for compact grid labels.
// 9 chars × ~7px ≈ 63px label — fits within 80px column step.
function truncName(name, max = 9) {
  if (!name) return '';
  const s = String(name).replace(/_/g, ' ');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// ── Node list (smart excluded) ────────────────────────────────────────────────

const nodeList = computed(() => [
  { id: 'grid',   label: upsMode.value ? 'NO GRID' : 'Grid', icon: 'ph-circuitry', active: gridActive.value,  value: gridActive.value  ? fmtW(gridW.value)  : null, top: true,  ...POS.grid   },
  { id: 'solar',  label: 'Solar',  icon: 'ph-sun',            active: solarActive.value, value: solarActive.value ? fmtW(solarW.value) : null, top: true,  ...POS.solar  },
  { id: 'wind',   label: 'Wind',   icon: 'ph-wind',           active: false,             value: null,                                           top: true,  ...POS.wind   },
  { id: 'home',   label: 'Home',   icon: 'ph-house',          active: homeActive.value,  value: homeActive.value  ? fmtW(homeW.value)  : null, top: false, ...POS.home   },
  { id: 'boiler', label: 'Boiler', icon: 'ph-drop',           active: false,             value: null,                                           top: false, ...POS.boiler },
  { id: 'ev',     label: 'EV',     icon: 'ph-car',            active: false,             value: null,                                           top: false, ...POS.ev     },
]);

// ── Device halo ───────────────────────────────────────────────────────────────
//
// All devices are sorted and laid out in a 3-column grid BELOW smart.
// Active devices (power > 0) sort first by power descending; idle devices
// follow, sorted alphabetically. Both groups use the same grid positions —
// only their visual style (active vs inactive node class) differs.
//
// Path shape (H/V, matching existing diagram language):
//   M smart_bottom → L cx trunk_y → L cornerX trunk_y → Q dev_x trunk_y → dev_top
//
//   • trunk_y = dev_top − R  ensures the Q bezier ends exactly at dev_top.
//   • All device paths share the vertical segment from smart_bottom down to
//     each row's trunk_y, visually forming a branching trunk tree.
//   • Middle-column devices (dev_x ≈ smart.x) use a straight vertical path.

const allDevicesSorted = computed(() => {
  const active = devicesStore.devices
    .filter(d => (parseFloat(d.power) || 0) > 0)
    .sort((a, b) => parseFloat(b.power) - parseFloat(a.power));
  const idle = devicesStore.devices
    .filter(d => (parseFloat(d.power) || 0) <= 0)
    .sort((a, b) => {
      const na = String(a.device_name || a.device_id).toLowerCase();
      const nb = String(b.device_name || b.device_id).toLowerCase();
      return na.localeCompare(nb);
    });
  return [...active, ...idle];
});

function makeDevicePath(dev_x, dev_y) {
  const cx           = POS.smart.x;        // 103
  const smart_bottom = POS.smart.y + NR;   // 306 (smart never moves)
  const dev_top      = dev_y - NR;
  const trunk_y      = dev_top - R;        // Q bezier will end exactly at dev_top

  // Straight vertical for centre-column devices (dev_x on same x as smart)
  if (Math.abs(dev_x - cx) < 2) {
    return `M ${cx} ${smart_bottom} L ${dev_x} ${dev_top}`;
  }
  const goRight = dev_x > cx;
  const cornerX = goRight ? dev_x - R : dev_x + R;
  return `M ${cx} ${smart_bottom} L ${cx} ${trunk_y} L ${cornerX} ${trunk_y} Q ${dev_x} ${trunk_y} ${dev_x} ${dev_top}`;
}

const deviceHaloData = computed(() => {
  const devices = allDevicesSorted.value;
  const result  = [];

  // Split into rows of COLS, centring each row independently around GRID_CX.
  for (let rowIdx = 0; rowIdx * COLS < devices.length; rowIdx++) {
    const rowDevices = devices.slice(rowIdx * COLS, (rowIdx + 1) * COLS);
    const n          = rowDevices.length;
    const halfSpan   = (n - 1) * STEP_X / 2;
    const startX     = GRID_CX - halfSpan;
    const y          = POS.smart.y + STEP_Y + rowIdx * STEP_Y;

    rowDevices.forEach((device, colIdx) => {
      const x     = startX + colIdx * STEP_X;
      const power = parseFloat(device.power) || 0;
      result.push({
        device_id: device.device_id,
        name:      device.device_name || device.device_id || '',
        power,
        active:    power > 0,
        x,
        y,
        pathD:     makeDevicePath(x, y),
      });
    });
  }

  return result;
});
</script>

<style scoped>
.flow-diagram         { display: flex; justify-content: center; align-items: flex-start; padding: 0.75rem 0.5rem 0;  }
.flow-svg             { overflow: visible; width: 100%; max-width: 100%; }

.hub-circle           { fill: var(--color-secondary-300); filter: drop-shadow(0 2px 8px rgba(0,0,0,.20)); }
.hub-circle--ups      { fill: var(--color-secondary-400); }
.hub-ups-ring         { fill: none; stroke: #ef4444; stroke-width: 2; animation: ups-pulse 1.2s ease-in-out infinite; }
.hub-text             { fill: var(--color-primary); text-anchor: middle; font-family: 'Rubik', sans-serif; }
.hub-title            { font-size: 7px; font-weight: 700; letter-spacing: 0.1em; }
.hub-sub              { font-size: 6px; font-weight: 400; opacity: 0.6; }
.hub-soc-arc          { transition: stroke-dasharray .6s ease; }

.node-circle           { transition: fill .3s; }
.node-circle--active   { fill: var(--card-bg-color); stroke: var(--color-secondary-500); stroke-width: 1;/*filter: drop-shadow(0 2px 2px var(--color-secondary-300));*/ }
.node-circle--inactive { fill: var(--color-secondary-100,#f3f4f6); stroke: var(--color-secondary-200,#e5e7eb); stroke-width: 1; }
.node-circle--ups      { fill: var(--color-danger-bg); stroke: var(--color-danger-border); stroke-width: 1; animation: ups-node-pulse 1.2s ease-in-out infinite; }

.node-icon-wrap       { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }

.node-label           { font-family: 'Rubik', sans-serif; font-size: 8px; font-weight: 600; text-transform: lowercase; }
.node-label--active   { fill: var(--color-primary,#111827); }
.node-label--inactive { fill: var(--color-secondary-400); font-size: 7px; font-weight: 500; text-transform: lowercase; }
.node-label--ups      { fill: #ef4444; font-weight: 700; }
.node-value           { font-family: 'Rubik', sans-serif; font-size: 7px; font-weight: 500; fill: var(--color-secondary,#6b7280); }

.flow-line-base       { fill: none; stroke-width: 1; stroke-linecap: round; }
.flow-line--inactive  { stroke: var(--color-secondary-300,#e5e7eb); stroke-dasharray: 3 6; }
.flow-line--active    { stroke: var(--color-secondary-400,#e5e7eb); }
.flow-line--ups       { stroke: #fca5a5; }

.flow-dot--solar      { fill: var(--color-green-600); filter: drop-shadow(0 0 3px var(--color-secondary-300)); }
.flow-dot--green      { fill: var(--color-secondary-500); filter: drop-shadow(0 0 3px var(--color-secondary-300)); }
.flow-dot--export     { fill: var(--color-green-600); filter: drop-shadow(0 0 3px rgba(249,115,22,.5)); }
.flow-dot--import     { fill: var(--color-red-700); filter: drop-shadow(0 0 3px rgba(249,115,22,.5)); }

.badge-text           { font-family: 'Rubik', sans-serif; font-size: 8px; font-weight: 700; fill: var(--color-primary); }
.chevron-hint         { font-family: 'Rubik', sans-serif; font-size: 8px; fill: var(--color-secondary-400); }

@keyframes ups-pulse      { 0%, 100% { opacity: 0.15; } 50% { opacity: 0.5; } }
@keyframes ups-node-pulse { 0%, 100% { stroke-opacity: 0.5; } 50% { stroke-opacity: 1; } }
</style>