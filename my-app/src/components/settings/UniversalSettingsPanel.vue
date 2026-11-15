<template>
  <div class="universal-settings-panel text-sm">
    <div v-if="loading" class="loading-container">
      <ProgressSpinner style="width: 50px; height: 50px" strokeWidth="4" />
      <p class="text-600 mt-3">{{ t('common.loading') }}</p>
    </div>

    <div v-else-if="error" class="error-container">
      <Message severity="error" :closable="false">{{ error }}</Message>
      <Button :label="t('common.retry')" icon="pi pi-refresh" @click="loadSchema" class="mt-3" />
    </div>

    <div v-else class="settings-content">
          <div class="save-bar" :class="{ 'save-bar-visible': hasChanges }">
      <div class="save-bar-content">
        <div class="save-bar-info"></div>
        <div class="save-bar-actions">
          <button class="btn" @click="resetChanges">{{ t('common.cancel') }}</button>
          <button class="btn btn--primary" :disabled="saving" @click="saveSettings">
            <i v-if="saving" class="ph-duotone ph-spinner-third ph-spin mr-1"></i>
            {{ t('common.save') }}
          </button>
        </div>
      </div>
    </div>
      <div v-if="schema.groups" class="groups-container">
        <div v-for="(group, gIdx) in schema.groups" :key="gIdx" class="settings-group mb-3">
          <!-- <h3 class="text-md border-b border-secondary-200 font-medium mb-4">{{ resolve(group.title) }}</h3> -->
          
          <div v-for="(section, sIdx) in group.sections" :key="sIdx" class="settings-section   ">
              <div v-if="section.title" class="section-header ">
                <h4 class=" font-semibold m-0">{{ resolve(section.title) }}</h4>
                <p v-if="section.description" class="text-secondary-400 text-xs font-normal mt-1 mb-0">{{ resolve(section.description) }}</p>
              </div>
              <div v-if="section.fields?.length" class="gap-4 fields-container" :class="{ 'drawer-mode': props.drawerMode }">
                <div 
                  v-for="field in section.fields" 
                  :key="field.key" 
                  :class="getFieldColumnClass(field)"
                >
                  <UniversalField 
                    :field="resolveField(field)" 
                    v-model="values[field.key]"
                  />
                </div>
              </div>

              <UniversalTable v-else-if="section.component === 'table'" :config="section" :moduleId="moduleId" :i18nKeys="schema.i18nKeys || false" :messagesReady="messagesReady" :compact="props.drawerMode" />
              <UniversalInfoPanel v-else-if="section.component === 'info-panel'" :config="section" :moduleId="moduleId" :i18nKeys="schema.i18nKeys || false" :messagesReady="messagesReady" />
              <UniversalCardGrid v-else-if="section.component === 'card-grid'" :config="section" :moduleId="moduleId" />
            </div>
  
        </div>
      </div>

      <div v-else-if="schema.properties" class="grid">
        <div 
          v-for="(fieldConfig, key) in sortedProperties" 
          :key="key" 
          class="col-12"
          :class="getFieldColumnClass(fieldConfig)"
        >
          <UniversalField 
            :field="mapAlphaField(key, fieldConfig)" 
            v-model="values[key]"
          />
        </div>
      </div>

      <div v-if="schema.globalActions?.length" class="global-actions mt-5">
        <Divider />
        <h4 class="mb-3">{{ t('common.actions') }}</h4>
        <div class="flex flex-wrap gap-3">
          <Button 
            v-for="action in schema.globalActions" 
            :key="action.label"
            :label="action.label"
            :icon="`pi ${action.icon || 'pi-bolt'}`"
            @click="handleAction(action)"
            severity="secondary"
            outlined
          />
        </div>
      </div>

      <!-- schema.actions — module-defined action buttons -->
      <div v-if="schema.actions?.length" class="module-actions mt-4">
        <div class="flex flex-wrap gap-2">
          <button
            v-for="action in schema.actions"
            :key="action.id"
            class="btn"
            :disabled="actionLoading[action.id]"
            @click="handleSchemaAction(action)"
          >
            <i class="ph-fill mr-1" :class="actionLoading[action.id] ? 'ph-spinner ph-spin' : (action.icon || 'ph-bolt')"></i>
            {{ resolve(action.label) }}
          </button>
        </div>
        <div v-if="actionResult" class="action-result mt-2" :class="actionResult.success ? 'action-result--ok' : 'action-result--err'">
          <i class="ph-fill mr-1" :class="actionResult.success ? 'ph-circle-check' : 'ph-circle-xmark'"></i>
          {{ actionResult.message }}
        </div>
      </div>
    </div>


  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch, nextTick } from 'vue';
import '@/assets/styles/control.css';
import apiClient from '@/services/api'; //
import { useToastStore } from '@/stores/toast';
import { useI18n } from 'vue-i18n';
const toast = useToastStore();
const { t, mergeLocaleMessage } = useI18n();

// Resolve a string as an i18n key if the schema declares i18nKeys: true,
// otherwise return it as a plain display string.
function resolve(value) {
  if (!value) return value;
  return schema.value?.i18nKeys ? t(value) : value;
}

// Return a shallow copy of a field with label, placeholder, description,
// and dropdown option labels resolved when the schema uses i18n keys.
function resolveField(field) {
  if (!schema.value?.i18nKeys) return field;
  return {
    ...field,
    label:       field.label       ? t(field.label)       : field.label,
    placeholder: field.placeholder ? t(field.placeholder) : field.placeholder,
    description: field.description ? t(field.description) : field.description,
    options: field.options
      ? field.options.map(opt => ({ ...opt, label: t(opt.label) }))
      : field.options,
  };
}

// Imports
import UniversalField from './UniversalField.vue';
import UniversalTable from './UniversalTable.vue';
import UniversalInfoPanel from './UniversalInfoPanel.vue';
import UniversalCardGrid from './UniversalCardGrid.vue';

const emit = defineEmits(['saved', 'cancelled']);

const props = defineProps({
  moduleId:   { type: String,  required: true },
  drawerMode: { type: Boolean, default: false },  // forces single-column layout
});

const schema = ref({});
const values = ref({});
const originalValues = ref({});
const loading = ref(true);
const saving = ref(false);
const hasChanges = ref(false);
const error = ref(null);
// Flips to true after module messages have been merged into vue-i18n,
// used to delay child components that depend on those keys.
const messagesReady = ref(false);
const actionLoading = ref({});   // { [action.id]: bool }
const actionResult  = ref(null); // { success, message }

// Helpers
function getFieldColumnClass(field) {
  const cols = field.cols || 12;
  // In drawer mode: minimum col-span-6 to prevent fields becoming too narrow
  const effective = props.drawerMode ? Math.max(cols, 6) : cols;
  return `col-span-${effective}`;
}

function mapAlphaField(key, config) {
  return {
    key: key,
    label: config.title,
    description: config.description,
    component: config.ui?.widget || 'text',
    placeholder: config.ui?.placeholder,
    required: schema.value.required?.includes(key),
    editable: true,
    suffix: config.ui?.suffix
  };
}

const sortedProperties = computed(() => {
  if (!schema.value.properties) return {};
  return Object.entries(schema.value.properties)
    .sort(([, a], [, b]) => (a.ui?.order || 0) - (b.ui?.order || 0))
    .reduce((acc, [key, val]) => ({ ...acc, [key]: val }), {});
});

// Load logic
// Coerce values that belong to switch/boolean fields from the string
// "true"/"false" (how MySQL stores them) to actual JS booleans.
// Without this, !!modelValue treats the string "false" as truthy.
function coerceBooleans(schema, values) {
  const booleanComponents = new Set(['switch', 'boolean']);

  // Collect all keys that are switch/boolean fields
  const boolKeys = new Set();

  // groups → sections → fields layout
  if (schema.groups) {
    for (const group of schema.groups) {
      for (const section of group.sections || []) {
        for (const field of section.fields || []) {
          if (booleanComponents.has(field.component)) boolKeys.add(field.key);
        }
      }
    }
  }

  // flat properties layout
  if (schema.properties) {
    for (const [key, config] of Object.entries(schema.properties)) {
      const widget = config.ui?.widget;
      if (booleanComponents.has(widget)) boolKeys.add(key);
    }
  }

  // Apply coercion
  for (const key of boolKeys) {
    if (key in values) {
      const v = values[key];
      values[key] = v === true || v === 'true' || v === 1 || v === '1';
    }
  }

  return values;
}

async function loadSchema() {
  loading.value = true;
  try {
    // Use dedicated routes for core/users, generic module route otherwise
    const endpoint = (props.moduleId === 'core' || props.moduleId === 'users')
      ? `/settings/${props.moduleId}`
      : `/settings/module/${props.moduleId}`;

    const { data } = await apiClient.get(endpoint);
    schema.value = data.schema || {};
    values.value = coerceBooleans(schema.value, data.values || {});
    originalValues.value = JSON.parse(JSON.stringify(values.value));

    // Merge module-level translations into vue-i18n at runtime.
    // Each module ships its own locales/ folder; the backend reads them
    // and returns { messages: { en: {...}, nl: {...}, ... } }.
    // This means no frontend changes are needed when a new module is added.
    if (data.messages && typeof data.messages === 'object') {
      for (const [lang, msgs] of Object.entries(data.messages)) {
        mergeLocaleMessage(lang, msgs);
      }
    }
  } catch (err) {
    error.value = err.message;
  } finally {
    // Defer loading=false to the next tick so the template renders AFTER
    // mergeLocaleMessage has populated vue-i18n — otherwise t() calls in
    // resolve() / resolveField() evaluate before the keys are available.
    await nextTick();
    messagesReady.value = true;
    loading.value = false;
  }
}
async function saveSettings() {
  saving.value = true;
  try {
    const endpoint = ['core', 'users'].includes(props.moduleId) 
      ? `/settings/${props.moduleId}` 
      : `/settings/module/${props.moduleId}`;

    await apiClient.post(endpoint, values.value);
    originalValues.value = JSON.parse(JSON.stringify(values.value));
    hasChanges.value = false;
    toast.add({ severity: 'success', summary: t('common.saved'), detail: t('settings.savedDetail') });
    emit('saved');
  } catch (err) {
    toast.add({ severity: 'error', summary: t('common.error'), detail: err.message });
  } finally {
    saving.value = false;
  }
}

// Watch values deeply so any field change (including switch/boolean) triggers dirty check
watch(values, () => {
  hasChanges.value = JSON.stringify(values.value) !== JSON.stringify(originalValues.value);
}, { deep: true });

function resetChanges() {
  values.value = JSON.parse(JSON.stringify(originalValues.value));
  hasChanges.value = false;
  emit('cancelled');
}

async function handleAction(action) {
  try {
    const res = await apiClient({ method: action.method || 'POST', url: action.endpoint, data: values.value });
    if (res.data.success) toast.add({ severity: 'success', summary: t('common.done'), detail: action.label });
  } catch (err) {
    toast.add({ severity: 'error', summary: t('common.error'), detail: err.message });
  }
}

async function handleSchemaAction(action) {
  actionResult.value  = null;
  actionLoading.value = { ...actionLoading.value, [action.id]: true };
  try {
    const payload = action.sendValues === false ? undefined : values.value;
    const method  = (action.method || 'POST').toLowerCase();
    const res     = await apiClient[method](`/${action.endpoint.replace(/^\//, '')}`, payload);
    const ok      = res.data?.success !== false;
    actionResult.value = {
      success: ok,
      message: res.data?.message || (ok ? t('common.done') : t('common.error')),
    };
    if (ok) toast.add({ severity: 'success', summary: t('common.done'), detail: res.data?.message || resolve(action.label) });
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    actionResult.value = { success: false, message: detail };
    toast.add({ severity: 'error', summary: t('common.error'), detail });
  } finally {
    actionLoading.value = { ...actionLoading.value, [action.id]: false };
    setTimeout(() => { actionResult.value = null; }, 6000);
  }
}

onMounted(loadSchema);
</script>

<style scoped>
/* Hier komen jouw originele 400+ regels CSS, inclusief .save-bar, .loading-container, etc. */
.universal-settings-panel   {padding: 0rem; }
.group-title                {border-bottom: 2px solid #eee; padding-bottom: 0.5rem; font-weight: 600; }
.save-bar                   {z-index: 100;display:none;height:50px;}
.save-bar-visible           {transform: translateY(0);display:inherit;height:50px; }
.save-bar-content           {display: flex; align-items: center; justify-content: space-between; max-width: 1900px; margin: 0 auto; }

.universal-settings-panel   {position: relative;min-height: 400px;}

/* Loading State */
.loading-container          { display: flex;flex-direction: column;align-items: center;justify-content: center;min-height: 400px;}
/* Error State */
.error-container            { display: flex;flex-direction: column;align-items: center;justify-content: center;min-height: 400px;padding: 2rem;}
/* Module Header */
.module-header              { display: flex;align-items: flex-start;gap: 1.5rem;padding: 1.5rem;margin-bottom: 1.5rem;border-radius: 12px;border: 1px solid #e5e7eb;}
.module-icon                { width: 64px;height: 64px;display: flex;align-items: center;justify-content: center;border-radius: 12px;flex-shrink: 0;}
.module-icon i              { font-size: 2rem;}
.module-info                { flex: 1;}
.module-info h2             { margin: 0 0 0.5rem 0;font-size: 1.75rem;}
.module-info p              { margin: 0 0 0.75rem 0;color: var(--color-secondary-400);line-height: 1.5;}
.module-meta                { display: flex;align-items: center;gap: 0.75rem;}
/* Settings Accordion */
.settings-accordion         { margin-bottom: 2rem;}
.group-description          { color: var(--color-secondary-400);margin: 0 0 1.5rem 0;line-height: 1.6;}
/* Sections */
.settings-section           { margin-bottom: 1rem;}
.section-with-border        { padding-bottom: 2rem;border-bottom: 1px solid #e5e7eb;}
.section-with-border:last-child 
                            { border-bottom: none;padding-bottom: 0;}
.section-header             { margin-bottom: 1rem;border-bottom:1px solid var(--color-secondary-200);}
.section-title              { margin: 0 0 0.5rem 0;font-size: 1.1rem;color: #374151;font-weight: 500;}
.section-description        { margin: 0;color: #6b7280;font-size: 0.95rem;line-height: 1.5;}
/* Fields Container */
.fields-container           { display: grid;grid-template-columns: 1fr;gap: 1.5rem;}

@media (min-width: 768px) {
  .fields-container         { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));}
}

/* Global Actions */
.global-actions             {margin-top: 2rem;}
.global-actions h4          {margin: 1rem 0;color: #374151;}
.actions-grid               {display: flex;flex-wrap: wrap;gap: 0.75rem;}

/* Save Bar (Sticky) */
.save-bar               {position: sticky;bottom: 0;left: 0;right: 0;padding: 1rem 1.5rem;transform: translateY(100%);transition: transform 0.3s ease;z-index: 100;}
.save-bar-visible       {transform: translateY(0);}
.save-bar-content       {display: flex;align-items: center;justify-content: space-between;max-width: 1200px;margin: 0 auto;}
.save-bar-info          {display: flex;align-items: center;gap: 0.75rem;color: #92400e;font-weight: 600;}
.save-bar-info i        {font-size: 1.25rem;}
.save-bar-actions       {display: flex;gap: 0.75rem;}
.module-actions         {border-top: 1px solid var(--color-secondary-200); padding-top: 1rem;}
.action-result          {font-size: 0.85rem; padding: 0.4rem 0.75rem; border-radius: 6px;}
.action-result--ok      {color: var(--color-success); background: color-mix(in srgb, var(--color-success) 10%, transparent);}
.action-result--err     {color: var(--color-danger);  background: color-mix(in srgb, var(--color-danger)  10%, transparent);}
/* Nested Tabs */
.nested-tabs            {margin-top: 1rem;}
/* HTML Content */
.html-content           {padding: 1rem;background: #f9fafb;border-radius: 8px;border: 1px solid #e5e7eb;}
.html-content :deep(h1),
.html-content :deep(h2),
.html-content :deep(h3) {margin-top: 0;}
.group-title            {border-bottom: 1px solid #eee; padding-bottom: 0.5rem; font-weight: 600; }
/* Responsive */
@media (max-width: 768px) {
  .module-header    {flex-direction: column;text-align: center;}
  .save-bar-content {flex-direction: column;gap: 1rem;align-items: stretch;}
  .save-bar-actions {flex-direction: column;}
}
.grid                   {display:flex ;grid-template-columns: auto auto auto auto;}
/* In drawer mode: stack fields vertically, full width */
.fields-container.drawer-mode {
  display: flex !important;
  flex-direction: column !important;
  gap: 1rem;
}
.fields-container.drawer-mode > div {
  width: 100% !important;
  max-width: 100% !important;
}
.p-tabview-tablist-item-active 
                        {background-color: #f59e0b !important; color: white !important;border-color:#92400e;border-width: 3px;}
.field-label            {font-weight: 400;color: #585858;font-size: 0.9rem;}
</style>