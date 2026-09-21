<template>
  <div class="devices-panel">
    <AppTable
      :items="devices"
      :columns="columns"
      :loading="loading"
      :empty-text="t('control.devices.empty')"
    >
      <template #toolbar-left>
        <span class="toolbar__count">{{ devices.length }} {{ t('control.devices.device', devices.length) }}</span>
        <span v-if="enabledCount > 0" class="toolbar__badge">{{ enabledCount }} {{ t('control.devices.active') }}</span>
      </template>

      <template #toolbar-right>
        <button class="btn btn--sm" :class="{ 'btn--busy': discovering }" @click="discover">
          {{ t('control.devices.discover') }}
        </button>
        <button class="btn btn--sm" :class="{ 'btn--busy': loading }" @click="load">
          {{ t('control.devices.refresh') }}
        </button>
        <button class="btn btn--sm btn--primary" @click="openAdd">
          + {{ t('control.devices.add') }}
        </button>
      </template>

      <template #_status="{ value }">
        <i :class="value.enabled ? 'ph-fill ph-circle text-secondary-500' : 'ph-light ph-circle text-secondary-400'" />
      </template>

      <template #name="{ value }">
        <div class="text-sm font-medium text-secondary-900">{{ value.name }}</div>
      </template>

      <template #_product="{ value }">
        <div class="text-sm font-normal text-secondary-500">{{ value.module }} - {{ value.product_type }}</div>
      </template>

      <template #ip_address="{ value }">
        <div class="text-xs font-normal text-secondary-500">{{ value.ip_address }}</div>
      </template>

      <template #_led="{ value }">
        <div class="led-cell">
          <div class="led-bar">
            <div class="led-bar__fill" :style="{ width: ((value.brightness || 0) / 100 * 100) + '%' }" />
          </div>
          <small class="text-xs text-secondary-400">{{ value.brightness || 0 }}%</small>
        </div>
      </template>

      <template #_lock="{ value }">
        <i v-if="value.switch_lock != null" :class="value.switch_lock === 1 ? 'ph-fill ph-lock text-secondary-700' : 'ph-light ph-lock-open text-secondary-400'" />
        <span v-else class="cell-secondary">—</span>
      </template>

      <template #_usage="{ value }">
        <div v-if="value.usage_today != null" class="text-xs font-semibold">{{ value.usage_today.toFixed(2) }} kWh</div>
        <span v-else class="cell-secondary">—</span>
      </template>

      <template #_actions="{ value }">
        <div class="row-actions" :class="{ 'row-actions--always-visible': isMobile }">
          <button class="icon-btn" @click="openEdit(value)"><i class="ph-light ph-pencil-simple"></i></button>
          <button class="icon-btn" @click="identify(value)"><i class="ph-light ph-lightbulb"></i></button>
          <button class="icon-btn icon-btn--danger" @click="askRemove(value)"><i class="ph-light ph-trash"></i></button>
        </div>
      </template>
    </AppTable>

    <AppDrawer
      v-model:visible="drawer.visible"
      :title="drawer.mode === 'add' ? t('control.devices.addTitle') : t('control.devices.editTitle')"
    >
      <div v-if="activeForm">
        
        <div v-if="drawer.mode === 'edit'" class="drawer-header-graph">
          <div class="graph-label">{{ t('control.devices.usage24h') }}</div>
          <DeviceUsageSparkline :data="deviceHistory" />
        </div>

        <div v-if="drawer.mode === 'edit'" class="drawer-meta-section">
          <div class="meta-grid">
            <div class="meta-card">
              <label>{{ t('control.devices.brand') }}</label>
              <div class="meta-value">{{ activeForm.module }}</div>
            </div>
            <div class="meta-card">
              <label>{{ t('control.devices.product') }}</label>
              <div class="meta-value">{{ activeForm.product_type }}</div>
            </div>
            <div class="meta-card">
              <label>{{ t('control.devices.usage_today') }}</label>
              <div class="meta-value text-secondary-600 font-bold">{{ activeForm.usage_today?.toFixed(2) }} kWh</div>
            </div>
          </div>
        </div>

        <div class="drawer-divider" />

        <div class="drawer-section">
          <div class="drawer-section__title mt-4">{{ t('control.devices.sectionRegistration') }}</div>

          <div class="form-field">
            <label class="form-label">{{ t('control.devices.name') }} <span class="req">*</span></label>
            <input v-model="activeForm.name" class="input" :placeholder="t('control.devices.namePlaceholder')" />
          </div>

          <div class="form-row">
            <div class="form-field form-field--flex">
              <label class="form-label">{{ t('control.devices.ipAddress') }} <span class="req">*</span></label>
              <input v-model="activeForm.ip_address" class="input" placeholder="192.168.1.x" />
            </div>
            <div class="form-field form-field--port">
              <label class="form-label">{{ t('control.devices.port') }}</label>
              <input v-model.number="activeForm.port" type="number" class="input" />
            </div>
          </div>

          <div class="form-field">
            <label class="form-label">{{ t('control.devices.priority') }}</label>
            <input v-model.number="activeForm.priority" type="number" class="input" min="1" max="100" />
          </div>

          <div class="toggle-row">
            <label class="form-label">{{ t('control.devices.enabled') }}</label>
            <button class="toggle" :class="{ 'toggle--on': activeForm.enabled }" @click="activeForm.enabled = !activeForm.enabled">
              <span class="toggle__knob" />
            </button>
          </div>
        </div>

        <div class="drawer-divider mt-4" />

        <div class="drawer-section" v-if="deviceSchemaFields.length">
          <div class="drawer-section__title mt-4">
            {{ t('control.devices.sectionDevice') }}
            <span class="drawer-section__note">{{ t('control.devices.immediateControl') }}</span>
          </div>

          <div v-for="field in deviceSchemaFields" :key="field.key" class="dynamic-field-wrapper mb-4">
            
            <div v-if="field.type === 'range'" class="form-field">
              <div class="field__label-row">
                <label class="form-label">{{ t(`control.fields.${field.key}`) }}</label>
                <span class="field__value">{{ activeForm[field.key] || 0 }}%</span>
              </div>
              <input 
                type="range" 
                class="range" 
                v-model.number="activeForm[field.key]" 
                :min="field.min || 0" 
                :max="field.max || 100" 
                @change="handleImmediateUpdate(field, activeForm[field.key])"
              />
              <div class="field__hints">
                <span>{{ field.min || 0 }}</span>
                <span>{{ field.max || 100 }}</span>
              </div>
            </div>

            <div v-else-if="field.type === 'boolean' || field.type === 'switch'" class="toggle-row">
              <div>
                <label class="form-label">{{ t(`control.fields.${field.key}`) }}</label>
                <p v-if="field.hint" class="toggle-hint">{{ t(`control.hints.${field.key}`) }}</p>
              </div>
              <button 
                class="toggle" 
                :class="{ 'toggle--on': !!activeForm[field.key], 'toggle--busy': immediateUpdating === field.key }" 
                @click="handleImmediateUpdate(field, activeForm[field.key] ? 0 : 1)"
              >
                <span class="toggle__knob" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <button class="btn btn--sm" @click="drawer.visible = false">{{ t('common.cancel') }}</button>
        <button class="btn btn--sm btn--primary" :class="{ 'btn--busy': saving }" @click="save">
          {{ drawer.mode === 'add' ? t('control.devices.add') : t('common.save') }}
        </button>
      </template>
    </AppDrawer>

    <AppModal 
      v-model:visible="removeModalVisible" 
      :message="t('control.devices.confirmRemove', { name: removeTarget?.name })" 
      :busy="removing" 
      destructive 
      @confirm="doRemove" 
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import apiClient from '@/services/api';
import { useToastStore } from '@/stores/toast';
import { useSchemaStore } from '@/stores/schema';
import { useLocale } from '@/composables/useLocale';

import AppTable from '@/components/common/AppTable.vue';
import AppDrawer from '@/components/common/AppDrawer.vue';
import AppModal from '@/components/common/AppModal.vue';
import DeviceUsageSparkline from '@/components/charts/DeviceUsageSparkline.vue';

import '@/assets/styles/control.css';

const toast = useToastStore();
const { t } = useLocale();
const schemaStore = useSchemaStore();

// State
const devices = ref([]);
const loading = ref(false);
const discovering = ref(false);
const saving = ref(false);
const removing = ref(false);
const removeTarget = ref(null);
const editTarget = ref(null);
const deviceHistory = ref([]);
const drawer = ref({ visible: false, mode: 'add', id: null });
const immediateUpdating = ref(null);
const isMobile = ref(false);

// Desktop: all columns. Mobile: status + name + actions only.
const desktopColumns = computed(() => [
  { field: '_status',  title: '',                                  width: '2rem',   slotMode: true },
  { field: 'name',     title: t('control.devices.name'),                            slotMode: true },
  { field: '_product', title: t('control.devices.product'),                         slotMode: true },
  { field: 'ip_address', title: t('control.devices.address'),                       slotMode: true },
  { field: '_led',     title: t('control.devices.statusLight'),                     slotMode: true },
  { field: '_lock',    title: t('control.devices.switchLock'),                      slotMode: true },
  { field: '_usage',   title: t('control.devices.usage_today'),                     slotMode: true },
  { field: '_actions', title: t('common.actions'),                width: '7.5rem', slotMode: true },
]);

const mobileColumns = computed(() => [
  { field: '_status',  title: '',                         width: '1rem',   slotMode: true },
  { field: 'name',     title: t('control.devices.name'),                   slotMode: true },
  { field: '_actions', title: '',                         width: '7rem',   slotMode: true },
]);

const columns = computed(() => isMobile.value ? mobileColumns.value : desktopColumns.value);

const enabledCount = computed(() => devices.value.filter(d => d.enabled).length);
const activeForm = computed(() => drawer.value.mode === 'add' ? form.value : editTarget.value);
const removeModalVisible = computed({ 
  get: () => !!removeTarget.value, 
  set: (v) => { if (!v) removeTarget.value = null; } 
});

/**
 * Dynamic Schema Field Mapping
 * Maps fields to UI based on device_schema.json
 */
const deviceSchemaFields = computed(() => {
  if (!activeForm.value || !activeForm.value.module) return [];
  
  const schema = schemaStore.resolveSchema(activeForm.value.module);
  if (!schema || !schema.frontend_field_mapping || !schema.frontend_field_mapping.fields) return [];

  return Object.entries(schema.frontend_field_mapping.fields)
    .filter(([_, config]) => config.storage === 'Device')
    .map(([key, config]) => ({ key, ...config }));
});

const defaultForm = () => ({ 
  name: '', ip_address: '', port: 80, enabled: true, brightness:250, switch_lock: 0, priority: 5, module: 'homewizard' 
});
const form = ref(defaultForm());


/**
 * Immediate Execution for Hardware (e.g., Switch Lock, LED, Power)
 * Now all unified under the /state endpoint for HomeWizard
 */
async function handleImmediateUpdate(field, newValue) {
  if (!activeForm.value) return;
  
  const oldValue = activeForm.value[field.key];
  activeForm.value[field.key] = newValue; // Optimistic UI update
  immediateUpdating.value = field.key;

  try {
    // 1. Parse route from schema: "PUT /homewizard/devices/:id/state"
    const [method, url] = field.route.split(' ');
    const endpoint = url.replace(':id', activeForm.value.id);
    
    // 2. Prepare payload (e.g., { "brightness": 150 } or { "power_on": true })
    // Use hw_field from schema to ensure key matches backend expectation
    const payload = { [field.hw_field]: newValue };

    // 3. Send to backend
    await apiClient[method.toLowerCase()](endpoint, payload);
    
    toast.add({ severity: 'success', summary: t('common.updated'), detail: t(`control.fields.${field.key}`) });
  } catch (e) {
    activeForm.value[field.key] = oldValue; // Rollback UI on failure
    toast.add({ severity: 'error', summary: t('common.error'), detail: e.message });
  } finally {
    immediateUpdating.value = null;
  }
}
// Standard CRUD Actions
async function load() {
  loading.value = true;
  try {
    const { data } = await apiClient.get('/system/devices-list');
    devices.value = (data.devices || []);
  } catch (e) { toast.add({ severity: 'error', summary: t('common.error'), detail: e.message }); }
  finally { loading.value = false; }
}

async function discover() {
  discovering.value = true;
  try {
    await apiClient.post(`/discover`);
    toast.add({ severity: 'success', summary: t('control.devices.discoverDone') });
    await load();
  } catch (e) { toast.add({ severity: 'error', summary: t('common.error'), detail: e.message }); }
  finally { discovering.value = false; }
}

function openAdd() {
  drawer.value = { visible: true, mode: 'add', id: null };
  form.value = defaultForm();
}

async function openEdit(device) {
  loading.value = true;
  try {
    const response = await apiClient.get(`/${device.module}/devices/${device.id}`);
    if (response.data && response.data.settings) {
      // Preserve id and module from the device row — settings alone may not
      // carry these fields, which would cause save/delete to hit /devices/undefined
      editTarget.value = {
        ...response.data.settings,
        id: device.id,
        module: device.module,
      };
      deviceHistory.value = response.data.data || [];
      drawer.value = { visible: true, mode: 'edit', id: device.id };
    }
  } catch (e) { toast.add({ severity: 'error', summary: t('common.error'), detail: e.message }); }
  finally { loading.value = false; }
}

async function save() {
  if (!activeForm.value) return;
  saving.value = true;
  try {
    const isAdd = drawer.value.mode === 'add';
    const module = activeForm.value.module;
    // Use module-prefixed endpoints — consistent with openEdit and identify()
    const endpoint = isAdd
      ? `/${module}/devices`
      : `/${module}/devices/${activeForm.value.id}`;

    const payload = { ...activeForm.value };
    delete payload.history; delete payload.data;

    await apiClient[isAdd ? 'post' : 'put'](endpoint, payload);
    toast.add({ severity: 'success', summary: t('common.saved') });
    drawer.value.visible = false;
    await load();
  } catch (e) { toast.add({ severity: 'error', summary: t('common.error'), detail: e.message }); }
  finally { saving.value = false; }
}

async function doRemove() {
  removing.value = true;
  try {
    const { id, module } = removeTarget.value;
    // Use module-prefixed endpoint — consistent with openEdit and identify()
    await apiClient.delete(`/${module}/devices/${id}`);
    toast.add({ severity: 'success', summary: t('control.devices.removed') });
    removeTarget.value = null; await load();
  } catch (e) { toast.add({ severity: 'error', summary: t('common.error'), detail: e.message }); }
  finally { removing.value = false; }
}

async function identify(d) {
  try {
    await apiClient.post(`/${d.module}/devices/${d.id}/identify`);
    toast.add({ severity: 'info', summary: t('control.devices.identifying') });
  } catch (e) { toast.add({ severity: 'error', summary: t('common.error'), detail: e.message }); }
}

let mq = null;
function onMqChange(e) { isMobile.value = e.matches; }

onMounted(async () => {
  mq = window.matchMedia('(max-width: 639px)');
  isMobile.value = mq.matches;
  mq.addEventListener('change', onMqChange);

  await schemaStore.initialize();
  await load();
});

onUnmounted(() => {
  mq?.removeEventListener('change', onMqChange);
});
</script>

<style scoped>
.devices-panel            { display: flex; flex-direction: column; gap: 0.875rem; }
.led-cell                 { display: flex; align-items: center; gap: 0.5rem; }
.led-bar                  { flex: 1; min-width: 44px; height: 3px; background: var(--color-background); border-radius: 2px; overflow: hidden; }
.led-bar__fill            { height: 100%; background: var(--color-primary); transition: width 0.3s; }
.drawer-header-graph      { margin: -1rem -1.25rem 1rem -1.25rem;  padding: 0.75rem 1.25rem;  }
.graph-label              { font-size: 0.65rem; font-weight: 600; text-transform: uppercase; color: var(--color-secondary-500); margin-bottom: 4px; }
.drawer-meta-section      { padding-bottom: 1.25rem; }
.meta-grid                { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; }
.meta-card                { background: var(--color-secondary-100); padding: 0.5rem;  }
.meta-card label          { display: block; font-size: 0.6rem; text-transform: uppercase; color: var(--color-secondary-500); font-weight: 600; }
.meta-value               { font-size: 0.75rem; font-weight: 600; color: var(--color-primary) }
.form-field--port         { width: 80px; }
.req                      { color: var(--color-error); margin-left: 2px; }
.dynamic-field-wrapper    { border-left: 2px solid var(--color-border); padding-left: 1rem; }
.toggle--busy             { opacity: 0.5; pointer-events: none; }

/* On mobile, action buttons are always visible (no hover needed on touch) */
.row-actions--always-visible {
  opacity: 1 !important;
  visibility: visible !important;
  pointer-events: auto !important;
}
</style>