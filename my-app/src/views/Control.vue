<template>
  <div class="lg:p-6 p-2 float-canvas">
    <div class="flex flex-col md:flex-row w-full overflow-hidden text-secondary-900 bg-secondary-100 lg:p-6 p-2 rounded-lg  inner-canvas">
      
      <aside class="w-full  bg-secondary-100 flex-shrink-0 p-4 ps-0 flex flex-col">

        <nav class="flex-1 max-w-xs overflow-y-auto  space-y-4 controlmenu">
          <button 
            v-for="item in menuItems" 
            :key="item.id"
            @click="activeSection = item.id"
            class="w-full flex items-center p-4 group text-sm "
            :class="activeSection === item.id 
              ? 'bg-card ' 
              : 'hover:bg-secondary-200 text-secondary-700'"
          >
            <span class="ms-3 font-medium">{{ item.label }}</span>
          </button>
        </nav>
      </aside>

      <main class="flex-1 flex flex-col min-w-0 overflow-hidden bg-card rounded-lg inner-canvas-2">
        
        <header class="flex-shrink-0 flex flex-col lg:flex-row lg:items-center justify-between gap-4 mt-6 px-6">
          <div>
            <h2 class="text-xl font-bold text-secondary-900">{{ activeLabel }}</h2>
            <p class="text-sm text-secondary-500 mt-1">{{ activeDescription }}</p>
          </div>
        </header>

        <div class="flex-1 overflow-y-auto p-6 mr-1">
          <div class="mx-auto">
            <transition name="fade" mode="out-in">
              <component :is="activeComponent" />
            </transition>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useSystemStore } from '@/stores/system';
import { useLocale } from '@/composables/useLocale';
import { useSchemaStore } from '@/stores/schema';

// Import sub-panels
import StrategyPanel from '@/components/control/StrategyPanel.vue';
import DispatchPanel  from '@/components/control/DispatchPanel.vue';
import DevicesPanel   from '@/components/control/DevicesPanel.vue';

const store = useSystemStore();
const { t } = useLocale();
const schemaStore = useSchemaStore();

const activeSection = ref('strategy');


// Menu structure matching the pattern in Settings.vue
const menuItems = [
  { id: 'strategy', label: t('control.sectionStrategy'), icon: 'ph-duotone ph-castle-turret', description: t('control.sectionStrategyDesc') },
  { id: 'dispatch', label: t('control.sectionDispatch'), icon: 'ph-duotone ph-bolt-lightning', description: t('control.sectionDispatchDesc') },
  { id: 'devices', label: t('control.sectionDevices'), icon: 'ph-duotone ph-devices', description: t('control.sectionDevicesDesc') },
];

const activeComponent = computed(() => {
  if (activeSection.value === 'dispatch') return DispatchPanel;
  if (activeSection.value === 'devices') return DevicesPanel;
  return StrategyPanel;
});

const activeLabel = computed(() => menuItems.find(i => i.id === activeSection.value)?.label);
const activeDescription = computed(() => menuItems.find(i => i.id === activeSection.value)?.description);

// System status data
const connected    = computed(() => store.isConnected);
const soc          = computed(() => store.status?.battery?.soc   ?? 0);
const pvPower      = computed(() => store.status?.pv?.power      ?? 0);
const batteryPower = computed(() => store.status?.battery?.power ?? 0);

function fmtW(w) {
  if (w == null || isNaN(w)) return '—';
  const abs = Math.abs(w);
  return abs >= 1000 ? `${(abs / 1000).toFixed(1)} kW` : `${Math.round(abs)} W`;
}
onMounted(async () => {
  // Load schemas for active modules immediately when entering Control area
  await schemaStore.initialize();
});


</script>

<style scoped>
/* Standard fade transition for content area */
.fade-enter-active, .fade-leave-active 
                        { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to 
                        { opacity: 0; }
.controlmenu            { padding-right: 0px!important;}
.inner-canvas           { height: calc(100vh - 7rem)}

</style>