<template>
  <div class="p-6 float-canvas">
    <div class="flex flex-col md:flex-row hero-card ">
      <aside class="w-full flex-shrink-0 flex flex-col md:w-64  ">

        <nav class="flex-1 overflow-y-auto p-6 lg:space-y-4 settingsmenu">
          <p class="hidden lg:content p-4 text-xs font-normal text-secondary-500 lowercase border-b border-secondary-200 tracking-wider mb-2">{{ t('settings.system') }}</p>
          
          <button v-for="item in staticMenu" :key="item.id"
            @click="activeModuleId = item.id"
            class="w-full flex items-center p-2  group text-sm"
            :class="activeModuleId === item.id ? 'bg-card' : 'hover:bg-secondary-200 text-secondary-900'">
    <!--       <i :class="[item.icon, 'w-6 text-lg', activeModuleId === item.id ? 'text-white' : 'text-secondary-500 group-hover:text-secondary-900']"></i>-->
            <span class="p-2 font-medium text-secondary-700">{{ item.label }}</span>
          </button>
        </nav>
      </aside>

      <main class="flex-1  lg:p-6 ">
        <div class="mx-auto p-6 bg-card rounded-lg overflow-y-auto h-full">
          <div class="flex justify-between items-end">
            <div>
              <h4 class="font-bold text-xl text-secondary-900 tracking-tight">{{ activeLabel }}</h4>
            </div>
          </div>
          <div class="me-4">
            <div class="">
              <div v-if="activeModuleId === 'modules'">
                <ModulesTab />
              </div>
              <div v-else-if="activeModuleId === 'core'">
                <CoreSettings />
              </div>
              <div v-else-if="activeModuleId === 'notifications'">
                <NotificationSettings />
              </div>
              <div v-else-if="activeModuleId === 'users'">
                <UserSettings />
              </div>
              <div v-else-if="activeModuleId === 'logging'">
                <LoggingTab />
              </div>
  <!--           <div v-else>
                <UniversalSettingsPanel :key="activeModuleId" :module-id="activeModuleId" />
              </div>-->
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import apiClient from '@/services/api';
import { useI18n } from 'vue-i18n';
import UniversalSettingsPanel from '@/components/settings/UniversalSettingsPanel.vue';
import CoreSettings from '@/components/settings/CoreSettings.vue';
import UserSettings from '@/components/settings/UserSettings.vue';
import ModulesTab from '@/components/settings/ModulesTab.vue';
import NotificationSettings from '@/components/settings/NotificationSettings.vue';
import LoggingTab from '@/components/settings/LoggingTab.vue';
import '@/assets/styles/control.css';

const { t } = useI18n();

const activeModuleId = ref('modules');
const settingsModules = ref([]);

const staticMenu = [
  { id: 'modules', label: t('modulesTab.install'), icon: 'ph-light ph-puzzle-piece' },
  { id: 'core', label: t('settings.general'), icon: 'ph-light ph-server' },
  { id: 'notifications', label: t('settings.notifications.title'), icon: 'ph-light ph-bell' },
  { id: 'users', label: t('settings.usermanagement'), icon: 'ph-light ph-users-gear' },
  { id: 'logging', label: t('settings.logging'), icon: 'ph-light ph-scroll' }

];

const activeLabel = computed(() => {
  const combined = [...staticMenu, ...settingsModules.value.map(m => ({ id: m.module_id, label: m.module_name }))];
  return combined.find(i => i.id === activeModuleId.value)?.label || t('settings.title');
});

function getModuleIcon(mod) {
  // Map module IDs to FontAwesome Pro icons
  const icons = {
    'homewizard': 'ph-light ph-devices',
    'alphaess-cloud': 'ph-light ph-cloud-sun',
    'solaredge': 'ph-light ph-solar-panel'
  };
  return icons[mod.module_id] || 'ph-light ph-box-open';
}

async function loadConfigurableModules() {
  try {
    const { data } = await apiClient.get('/settings/modules');
    // Filter to show only dynamic modules in this section
    settingsModules.value = data.modules.filter(m => 
      m.has_schema && m.module_id !== 'core' && m.module_id !== 'users'
    );
  } catch (err) { console.error('Failed to load modules', err); }
}

onMounted(loadConfigurableModules);
</script>
<style scoped>
.settingsmenu         {padding-right: 0px!important;;}
</style>