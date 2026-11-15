<template>
  <div class="min-h-screen flex items-center justify-center p-8 bg-[var(--color-bg-primary)]">

    <div class="w-full max-w-4xl p-10 bg-[var(--card-bg-color)] border border-[var(--color-border)] rounded-[var(--radius-xl)]">

      <!-- ── Header ─────────────────────────────────────────────────────────── -->
      <div class="text-center mb-10">
        <div class="flex items-center justify-center gap-3 mb-3">
          <i class="ph-light ph-bolt text-3xl text-[var(--color-primary)]"></i>
          <h1 class="text-2xl font-semibold text-[var(--color-text-primary)]">
            {{ isEditMode ? 'Edit Configuration' : 'Welcome to Wolffie' }}
          </h1>
        </div>
        <p class="text-sm text-[var(--color-text-secondary)]">
          {{ isEditMode ? 'Review and update your system configuration' : 'Let\'s set up your system in a few easy steps' }}
        </p>
      </div>

      <!-- ── Progress ───────────────────────────────────────────────────────── -->
      <div class="flex justify-between mb-10 relative">
        <div class="absolute top-5 left-[5%] right-[5%] h-px bg-[var(--color-border)]"></div>
        <div v-for="step in steps" :key="step.number"
             class="flex flex-col items-center gap-2 relative z-10">
          <div class="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all"
               :class="currentStep > step.number
                 ? 'bg-[var(--color-primary)] text-white'
                 : currentStep === step.number
                   ? 'bg-[var(--color-primary)] text-white shadow-[0_0_0_4px_var(--color-secondary-100)]'
                   : 'bg-[var(--color-secondary-100)] text-[var(--color-text-tertiary)]'">
            <i v-if="currentStep > step.number" class="ph-light ph-check text-xs"></i>
            <span v-else>{{ step.number }}</span>
          </div>
          <span class="text-xs font-medium text-[var(--color-text-secondary)]">
            {{ step.label }}
          </span>
        </div>
      </div>

      <!-- ── Step 1 — System Settings ──────────────────────────────────────── -->
      <div v-if="currentStep === 1">
        <div class="drawer-section__title mb-4">
          <i class="ph-light ph-gear"></i> System Settings
        </div>
        <div class="grid grid-cols-2 gap-4">
          <UniversalField
            :field="{ key:'system_name', label:'System Name', component:'text',
                      placeholder:'My Wolffie System', required:true }"
            v-model="systemSettings.system_name"
          />
          <UniversalField
            :field="{ key:'location', label:'Location', component:'text',
                      placeholder:'Amsterdam, Netherlands' }"
            v-model="systemSettings.location"
          />
          <div class="col-span-2">
            <UniversalField
              :field="{ key:'timezone', label:'Timezone', component:'select',
                        options: timezoneOptions }"
              v-model="systemSettings.timezone"
            />
          </div>
        </div>
      </div>

      <!-- ── Step 2 — Data Retention ───────────────────────────────────────── -->
      <div v-if="currentStep === 2">
        <div class="drawer-section__title mb-1">
          <i class="ph-light ph-database"></i> Data Retention
        </div>
        <p class="text-xs mb-5 text-[var(--color-text-tertiary)]">
          How long raw measurement data is kept before aggregation removes it.
        </p>
        <div class="grid grid-cols-3 gap-4 mb-5">
          <UniversalField
            :field="{ key:'snapshots_days', label:'Raw Snapshots (days)', component:'number',
                      placeholder:'7', validation:{ min:1, max:90 } }"
            v-model="retentionSettings.snapshots_days"
          />
          <UniversalField
            :field="{ key:'minutes_days', label:'Minute Aggregates (days)', component:'number',
                      placeholder:'30', validation:{ min:1, max:365 } }"
            v-model="retentionSettings.minutes_days"
          />
          <UniversalField
            :field="{ key:'hours_days', label:'Hour Aggregates (days)', component:'number',
                      placeholder:'365', validation:{ min:30, max:3650 } }"
            v-model="retentionSettings.hours_days"
          />
        </div>
        <div class="p-3 text-xs flex flex-col gap-1 bg-[var(--color-secondary-50)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text-secondary)]">
          <div class="flex items-center gap-2">
            <i class="ph-light ph-circle-info text-[var(--color-primary)]"></i>
            Recommended: snapshots 7d · minutes 30d · hours 365d
          </div>
        </div>
      </div>

      <!-- ── Step 3 — Energy Contract ──────────────────────────────────────── -->
      <div v-if="currentStep === 3">
        <div class="drawer-section__title mb-1">
          <i class="ph-light ph-file-contract"></i> Energy Contract
        </div>
        <p class="text-xs mb-5 text-[var(--color-text-tertiary)]">
          Configure your electricity contract so Wolffie can optimise charging and discharging.
        </p>
        <div class="grid grid-cols-2 gap-4">
          <UniversalField
            :field="{
              key: 'contract_type', label: 'Contract Type', component: 'select',
              options: [
                { label: 'Dynamic (day-ahead prices)', value: 'dynamic' },
                { label: 'Fixed price',                value: 'fixed'   },
              ]
            }"
            v-model="contractSettings.contract_type"
          />
          <UniversalField
            v-if="contractSettings.contract_type === 'fixed'"
            :field="{ key:'fixed_price_ct_kwh', label:'Fixed Price (ct/kWh)', component:'number',
                      placeholder:'25.0', validation:{ min:0, step:0.1 } }"
            v-model="contractSettings.fixed_price_ct_kwh"
          />
        </div>
        <div v-if="contractSettings.contract_type === 'dynamic'"
             class="mt-4 p-3 text-xs flex items-center gap-2 bg-[var(--color-secondary-50)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text-secondary)]">
          <i class="ph-light ph-circle-info text-[var(--color-primary)]"></i>
          Enable the <strong class="mx-1">Day-Ahead Prices</strong> module after setup to use dynamic pricing.
        </div>
      </div>

      <!-- ── Step 4 — Modules ───────────────────────────────────────────────── -->
      <div v-if="currentStep === 4">
        <div class="drawer-section__title mb-1">
          <i class="ph-light ph-puzzle-piece"></i> Install Modules
        </div>
        <p class="text-xs mb-5 text-[var(--color-text-tertiary)]">
          Upload your module zip files. You can also skip this step and install modules later via Settings.
        </p>

        <!-- Drop zone -->
        <div
          class="flex flex-col items-center justify-center gap-3 p-8 mb-5 cursor-pointer transition-all rounded-[var(--radius-md)]"
          :class="dragOver
            ? 'border-2 border-dashed border-[var(--color-primary)] bg-[var(--color-secondary-50)]'
            : 'border-2 border-dashed border-[var(--color-secondary-200)] bg-[var(--color-bg-secondary)]'"
          @click="$refs.fileInput.click()"
          @dragover.prevent="dragOver = true"
          @dragleave="dragOver = false"
          @drop.prevent="onDrop"
        >
          <i class="ph-light ph-cloud-arrow-up text-3xl"
             :class="dragOver ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-tertiary)]'"></i>
          <div class="text-sm font-medium text-[var(--color-text-primary)]">
            Drop module zip files here
          </div>
          <div class="text-xs text-[var(--color-text-tertiary)]">or click to browse</div>
          <input ref="fileInput" type="file" accept=".zip" multiple class="hidden"
                 @change="onFileSelected" />
        </div>

        <!-- Upload queue -->
        <div v-if="uploadQueue.length > 0" class="flex flex-col gap-2 mb-4">
          <div v-for="item in uploadQueue" :key="item.name"
               class="flex items-center gap-3 px-3 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)]">
            <i class="ph-light ph-file-zipper text-sm text-[var(--color-primary)]"></i>
            <span class="flex-1 text-xs font-medium text-[var(--color-text-primary)]">
              {{ item.name }}
            </span>
            <!-- Status -->
            <span v-if="item.status === 'pending'" class="text-xs text-[var(--color-text-tertiary)]">
              Pending
            </span>
            <span v-else-if="item.status === 'uploading'" class="text-xs text-[var(--color-primary)]">
              <i class="ph-light ph-spinner ph-spin mr-1"></i>Uploading...
            </span>
            <span v-else-if="item.status === 'success'" class="text-xs text-green-800">
              <i class="ph-light ph-circle-check mr-1"></i>Installed
            </span>
            <span v-else-if="item.status === 'skipped'" class="text-xs text-[var(--color-text-tertiary)]">
              <i class="ph-light ph-circle-minus mr-1"></i>Skipped
              <span v-if="item.installedVersion" class="ml-1">(v{{ item.installedVersion }} already installed)</span>
            </span>
            <span v-else-if="item.status === 'error'" class="text-xs text-red-800"
                  :title="item.error">
              <i class="ph-light ph-circle-xmark mr-1"></i>Failed
            </span>
            <!-- Remove pending -->
            <button v-if="item.status === 'pending'"
                    class="icon-btn icon-btn--danger ml-1"
                    @click.stop="removeFromQueue(item.name)">
              <i class="ph-light ph-xmark text-xs"></i>
            </button>
          </div>
        </div>

        <!-- Upload button -->
        <div v-if="pendingUploads.length > 0" class="flex items-center gap-3">
          <button class="btn btn--primary" @click="uploadAll" :disabled="uploading">
            <i class="ph-light" :class="uploading ? 'ph-spinner ph-spin' : 'ph-upload'"></i>
            Install {{ pendingUploads.length }} module{{ pendingUploads.length > 1 ? 's' : '' }}
          </button>
          <span v-if="uploading" class="text-xs text-[var(--color-text-tertiary)]">
            Installing {{ currentUploadIndex + 1 }} of {{ pendingUploads.length }}...
          </span>
        </div>

        <!-- Installed summary -->
        <div v-if="installedModules.length > 0"
             class="mt-4 p-3 flex items-center gap-2 text-xs bg-green-50 border border-green-200 rounded-[var(--radius-md)] text-green-800">
          <i class="ph-light ph-circle-check"></i>
          {{ installedModules.length }} module{{ installedModules.length > 1 ? 's' : '' }} installed successfully
        </div>
      </div>

      <!-- ── Step 5 — Review ────────────────────────────────────────────────── -->
      <div v-if="currentStep === 5">
        <div class="drawer-section__title mb-5">
          <i class="ph-light ph-circle-check"></i> Review Your Configuration
        </div>

        <div class="grid grid-cols-2 gap-4">
          <!-- System -->
          <div class="border border-secondary-100 bg-secondary-50 rounded-md overflow-hidden">
            <div class="flex items-center gap-2 px-4 py-3 bg-secondary-50">
              <i class="ph-light ph-gear text-sm text-secondary-400"></i>
              <span class="text-sm font-semibold text-primary">System</span>
            </div>
            <div class="p-4 flex flex-col gap-2">
              <div v-for="row in [
                ['Name',     systemSettings.system_name],
                ['Location', systemSettings.location || '—'],
                ['Timezone', systemSettings.timezone],
              ]" :key="row[0]" class="flex justify-between text-xs">
                <span class="text-[var(--color-text-tertiary)]">{{ row[0] }}</span>
                <span class="font-medium text-[var(--color-text-primary)]">{{ row[1] }}</span>
              </div>
            </div>
          </div>

          <!-- Retention -->
          <div class="border border-secondary-100 bg-secondary-50 rounded-md overflow-hidden">
            <div class="flex items-center gap-2 px-4 py-3 bg-secondary-50">
              <i class="ph-light ph-gear text-sm text-secondary-400"></i>
              <span class="text-sm font-semibold text-primary">Data Retention</span>
            </div>
            <div class="p-4 flex flex-col gap-2">
              <div v-for="row in [
                ['Snapshots', retentionSettings.snapshots_days + ' days'],
                ['Minutes',   retentionSettings.minutes_days   + ' days'],
                ['Hours',     retentionSettings.hours_days     + ' days'],
              ]" :key="row[0]" class="flex justify-between text-xs">
                <span class="text-[var(--color-text-tertiary)]">{{ row[0] }}</span>
                <span class="font-medium text-[var(--color-text-primary)]">{{ row[1] }}</span>
              </div>
            </div>
          </div>

          <!-- Contract -->
          <div class="border border-secondary-100 bg-secondary-50 rounded-md overflow-hidden">
            <div class="flex items-center gap-2 px-4 py-3 bg-secondary-50">
              <i class="ph-light ph-gear text-sm text-secondary-400"></i>
              <span class="text-sm font-semibold text-primary">Energy Contract</span>
            </div>
            <div class="p-4 flex flex-col gap-2">
              <div class="flex justify-between text-xs">
                <span class="text-[var(--color-text-tertiary)]">Type</span>
                <span class="font-medium text-[var(--color-text-primary)]">
                  {{ contractSettings.contract_type === 'dynamic' ? 'Dynamic (day-ahead)' : 'Fixed price' }}
                </span>
              </div>
              <div v-if="contractSettings.contract_type === 'fixed'" class="flex justify-between text-xs">
                <span class="text-[var(--color-text-tertiary)]">Price</span>
                <span class="font-medium text-[var(--color-text-primary)]">
                  {{ contractSettings.fixed_price_ct_kwh }} ct/kWh
                </span>
              </div>
            </div>
          </div>

          <!-- Modules -->
          <div class="border border-secondary-100 bg-secondary-50 rounded-md overflow-hidden">
            <div class="flex items-center gap-2 px-4 py-3 bg-secondary-50">
              <i class="ph-light ph-gear text-sm text-secondary-400"></i>
              <span class="text-sm font-semibold text-primary">Modules</span>
            </div>
            <div class="p-4">
              <div v-if="installedModules.length === 0"
                   class="text-xs text-[var(--color-text-tertiary)]">
                No modules installed — add them later via Settings
              </div>
              <div v-for="mod in installedModules" :key="mod.name"
                   class="flex items-center gap-2 text-xs py-1">
                <i class="ph-light ph-circle-check text-xs text-green-800"></i>
                <span class="text-[var(--color-text-primary)]">{{ mod.name }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Navigation ─────────────────────────────────────────────────────── -->
      <div class="flex items-center gap-3 mt-8 pt-6 border-t border-[var(--color-border)]">
        <button v-if="currentStep > 1" class="btn" @click="previousStep">
          <i class="ph-light ph-arrow-left"></i> Back
        </button>

        <div class="flex-1"></div>

        <!-- Skip modules -->
        <button v-if="currentStep === 4 && pendingUploads.length === 0 && installedModules.length === 0"
                class="btn" @click="nextStep">
          Skip — install later
        </button>

        <button v-if="currentStep < 5"
                class="btn btn--primary"
                @click="nextStep"
                :disabled="!canProceed">
          Next <i class="ph-light ph-arrow-right"></i>
        </button>

        <button v-if="currentStep === 5"
                class="btn btn--primary"
                @click="completeSetup"
                :disabled="completing">
          <i class="ph-light" :class="completing ? 'ph-spinner ph-spin' : 'ph-check'"></i>
          Complete Setup
        </button>
      </div>
    </div>

    <!-- ── Conflict dialog ───────────────────────────────────────────────────── -->
    <div v-if="showConflict"
         class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="w-full max-w-sm p-6 bg-[var(--card-bg-color)] border border-[var(--color-border)] rounded-[var(--radius-xl)]">
        <div class="flex items-center gap-2 mb-3">
          <i class="ph-light ph-triangle-exclamation text-[var(--color-warning)]"></i>
          <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Module already installed</h3>
        </div>
        <p class="text-xs mb-1 text-[var(--color-text-secondary)]">
          <strong>{{ conflictItem?.name }}</strong>
        </p>
        <div class="flex justify-between text-xs mb-4 p-3 bg-[var(--color-secondary-50)] rounded-[var(--radius-md)]">
          <div>
            <div class="text-[var(--color-text-tertiary)]">Installed</div>
            <div class="font-semibold text-[var(--color-text-primary)]">v{{ conflictItem?.installedVersion }}</div>
          </div>
          <i class="ph-light ph-arrow-right self-center text-[var(--color-text-tertiary)]"></i>
          <div class="text-right">
            <div class="text-[var(--color-text-tertiary)]">New</div>
            <div class="font-semibold text-[var(--color-primary)]">v{{ conflictItem?.newVersion }}</div>
          </div>
        </div>
        <p class="text-xs mb-5 text-[var(--color-text-secondary)]">
          Do you want to upgrade to the new version?
        </p>
        <div class="flex gap-3 justify-end">
          <button class="btn" @click="resolveConflict(false)">
            Skip
          </button>
          <button class="btn btn--primary" @click="resolveConflict(true)">
            <i class="ph-light ph-arrow-up-from-bracket"></i> Upgrade
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useToastStore } from '@/stores/toast';
import { useConfigStore } from '@/stores/config';
import { markSetupComplete } from '@/router';
import apiClient from '@/services/api';
import UniversalField from '@/components/settings/UniversalField.vue';

const router      = useRouter();
const toast       = useToastStore();
const configStore = useConfigStore();

// ── Steps ─────────────────────────────────────────────────────────────────────
const steps = [
  { number: 1, label: 'System'    },
  { number: 2, label: 'Retention' },
  { number: 3, label: 'Contract'  },
  { number: 4, label: 'Modules'   },
  { number: 5, label: 'Review'    },
];

// ── State ─────────────────────────────────────────────────────────────────────
const currentStep  = ref(1);
const isEditMode   = ref(false);
const completing   = ref(false);

// System
const systemSettings = ref({
  system_name: '',
  location:    '',
  timezone:    'Europe/Amsterdam',
});

// Retention
const retentionSettings = ref({
  snapshots_days: 7,
  minutes_days:   30,
  hours_days:     365,
});

// Contract
const contractSettings = ref({
  contract_type:      'dynamic',
  fixed_price_ct_kwh: 25,
});

// Modules
const fileInput          = ref(null);
const dragOver           = ref(false);
const uploadQueue        = ref([]);   // { name, file, status: pending|uploading|success|skipped|conflict|error, installedVersion?, newVersion?, error? }
const uploading          = ref(false);
const currentUploadIndex = ref(0);
const installedModules   = ref([]);   // { name, version }

// Conflict dialog state
const conflictItem    = ref(null);   // item dat wacht op beslissing
const showConflict    = ref(false);
let   conflictResolve = null;        // Promise resolver

// ── Timezone options ──────────────────────────────────────────────────────────
const timezoneOptions = [
  { label: 'Europe/Amsterdam (UTC+1/+2)', value: 'Europe/Amsterdam' },
  { label: 'Europe/London (UTC+0/+1)',    value: 'Europe/London'    },
  { label: 'Europe/Berlin (UTC+1/+2)',    value: 'Europe/Berlin'    },
  { label: 'Europe/Paris (UTC+1/+2)',     value: 'Europe/Paris'     },
  { label: 'Europe/Brussels (UTC+1/+2)', value: 'Europe/Brussels'  },
  { label: 'Europe/Zurich (UTC+1/+2)',   value: 'Europe/Zurich'    },
  { label: 'Europe/Rome (UTC+1/+2)',     value: 'Europe/Rome'      },
  { label: 'Europe/Madrid (UTC+1/+2)',   value: 'Europe/Madrid'    },
  { label: 'Europe/Lisbon (UTC+0/+1)',   value: 'Europe/Lisbon'    },
  { label: 'Europe/Stockholm (UTC+1/+2)',value: 'Europe/Stockholm' },
  { label: 'Europe/Oslo (UTC+1/+2)',     value: 'Europe/Oslo'      },
  { label: 'Europe/Copenhagen (UTC+1/+2)',value:'Europe/Copenhagen'},
  { label: 'Europe/Helsinki (UTC+2/+3)', value: 'Europe/Helsinki'  },
  { label: 'Europe/Warsaw (UTC+1/+2)',   value: 'Europe/Warsaw'    },
  { label: 'Europe/Vienna (UTC+1/+2)',   value: 'Europe/Vienna'    },
  { label: 'UTC',                        value: 'UTC'               },
];

// ── Computed ──────────────────────────────────────────────────────────────────
const pendingUploads = computed(() => uploadQueue.value.filter(i => i.status === 'pending'));

const canProceed = computed(() => {
  if (currentStep.value === 1) return !!systemSettings.value.system_name.trim();
  // Step 4: can proceed if no pending uploads (either skipping or all done)
  if (currentStep.value === 4) return pendingUploads.value.length === 0;
  return true;
});

// ── File handling ─────────────────────────────────────────────────────────────
const addFiles = (files) => {
  for (const file of files) {
    if (!file.name.endsWith('.zip')) continue;
    if (uploadQueue.value.find(i => i.name === file.name)) continue;
    uploadQueue.value.push({ name: file.name, file, status: 'pending' });
  }
};

const onFileSelected = (e) => {
  addFiles(Array.from(e.target.files));
  e.target.value = '';
};

const onDrop = (e) => {
  dragOver.value = false;
  addFiles(Array.from(e.dataTransfer.files));
};

const removeFromQueue = (name) => {
  uploadQueue.value = uploadQueue.value.filter(i => i.name !== name);
};

// Vraag de gebruiker of hij een conflicterende module wil overschrijven.
// Geeft true (overschrijven) of false (overslaan) terug.
const askConflict = (item) => {
  conflictItem.value = item;
  showConflict.value = true;
  return new Promise(resolve => { conflictResolve = resolve; });
};

const resolveConflict = (overwrite) => {
  showConflict.value = false;
  conflictItem.value = null;
  if (conflictResolve) { conflictResolve(overwrite); conflictResolve = null; }
};

const uploadAll = async () => {
  uploading.value = true;
  const pending   = uploadQueue.value.filter(i => i.status === 'pending');

  // Haal geïnstalleerde modules op voor versievergelijking
  let installedMap = {};
  try {
    const { data } = await apiClient.get('/modules');
    for (const m of (data || [])) {
      installedMap[m.module_id] = m.module_version;
    }
  } catch { /* versievergelijking niet beschikbaar */ }

  for (let idx = 0; idx < pending.length; idx++) {
    currentUploadIndex.value = idx;
    const item = pending[idx];

    // ── Stap 1: upload zonder overwrite om versie te detecteren ──────────────
    item.status = 'uploading';

    try {
      const formData = new FormData();
      formData.append('module', item.file);

      const { data } = await apiClient.post('/modules/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      // Succes — module was nieuw
      item.status = 'success';
      const moduleId = data.module?.id;

      // Activeer de module direct na installatie
      if (moduleId) {
        try {
          await apiClient.post(`/settings/module/${moduleId}`, { enabled: true });
        } catch { /* activatie mislukt — niet fataal */ }
      }

      installedModules.value.push({
        name:    data.module?.name    || item.name.replace('.zip', ''),
        version: data.module?.version || '—',
      });

    } catch (err) {
      const status = err.response?.status;
      const body   = err.response?.data || {};

      if (status === 409) {
        // ── Module bestaat al — versievergelijking ────────────────────────────
        // Haal module_id uit de foutmelding (format: "Module 'id' is already installed.")
        const match      = body.error?.match(/'([^']+)'/);
        const moduleId   = match?.[1];
        const installedV = moduleId ? (installedMap[moduleId] || '?') : '?';

        // Haal versie uit zip-naam als fallback (bijv. alphaess-modbus-tcp-1.0.8.zip)
        const versionMatch = item.name.match(/-(\d+\.\d+\.\d+)\.zip$/);
        const newV         = versionMatch?.[1] || '?';

        if (installedV !== '?' && newV !== '?' && installedV === newV) {
          // Zelfde versie — stil overslaan
          item.status          = 'skipped';
          item.installedVersion = installedV;
        } else {
          // Andere versie — gebruiker vragen
          item.installedVersion = installedV;
          item.newVersion       = newV;

          const overwrite = await askConflict(item);

          if (overwrite) {
            // Opnieuw uploaden met ?overwrite=true
            try {
              item.status = 'uploading';
              const formData2 = new FormData();
              formData2.append('module', item.file);
              const { data: data2 } = await apiClient.post('/modules/upload?overwrite=true', formData2, {
                headers: { 'Content-Type': 'multipart/form-data' },
              });
              item.status = 'success';
              const moduleId2 = data2.module?.id;
              if (moduleId2) {
                try {
                  await apiClient.post(`/settings/module/${moduleId2}`, { enabled: true });
                } catch { /* activatie mislukt — niet fataal */ }
              }
              installedModules.value.push({
                name:    data2.module?.name    || item.name.replace('.zip', ''),
                version: data2.module?.version || newV,
              });
            } catch (err2) {
              item.status = 'error';
              item.error  = err2.response?.data?.error || 'Overwrite failed';
            }
          } else {
            item.status = 'skipped';
          }
        }
      } else {
        // Andere fout
        item.status = 'error';
        item.error  = body.error || 'Upload failed';
      }
    }
  }

  uploading.value = false;
};

// ── Save helpers ──────────────────────────────────────────────────────────────
const saveCoreSettings = async () => {
  try {
    await apiClient.post('/settings/core', {
      ...systemSettings.value,
      ...retentionSettings.value,
      ...contractSettings.value,
    });
    return true;
  } catch {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to save system settings' });
    return false;
  }
};

// ── Navigation ────────────────────────────────────────────────────────────────
const nextStep = async () => {
  if (currentStep.value >= 5) return;
  let saved = true;
  if (currentStep.value === 3) saved = await saveCoreSettings();
  if (saved) currentStep.value++;
};

const previousStep = () => {
  if (currentStep.value > 1) currentStep.value--;
};

const completeSetup = async () => {
  completing.value = true;
  try {
    await saveCoreSettings();
    const success = await configStore.completeSetup();
    if (success) {
      markSetupComplete();
      toast.add({ severity: 'success', summary: 'Setup Complete', detail: 'Your system is configured and ready!' });
      setTimeout(() => router.push('/'), 2000);
    } else {
      throw new Error('Backend failed to mark setup as complete');
    }
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Error', detail: err.message || 'Setup failed' });
  } finally {
    completing.value = false;
  }
};

// ── Load existing config ──────────────────────────────────────────────────────
const loadExistingConfiguration = async () => {
  try {
    const { data } = await apiClient.get('/setup/status');
    if (data.setupCompleted) isEditMode.value = true;
    try {
      const { data: core } = await apiClient.get('/settings/core');
      const s = core.values ?? core;
      if (s.system_name)        systemSettings.value.system_name        = s.system_name;
      if (s.location)           systemSettings.value.location           = s.location;
      if (s.timezone)           systemSettings.value.timezone           = s.timezone;
      if (s.snapshots_days)     retentionSettings.value.snapshots_days  = Number(s.snapshots_days);
      if (s.minutes_days)       retentionSettings.value.minutes_days    = Number(s.minutes_days);
      if (s.hours_days)         retentionSettings.value.hours_days      = Number(s.hours_days);
      if (s.contract_type)      contractSettings.value.contract_type    = s.contract_type;
      if (s.fixed_price_ct_kwh) contractSettings.value.fixed_price_ct_kwh = Number(s.fixed_price_ct_kwh);
    } catch { /* geen core settings */ }
  } catch { /* silent */ }
};

onMounted(loadExistingConfiguration);
</script>