<!-- src/components/settings/CoreSettings.vue -->
<template>
  <div class="core-settings">

        <!-- Theme Preset Switcher -->
    <div class="theme-section">
      <label class="theme-label">{{ t('settings.appearance.theme') }}</label>
      <div class="preset-row">
        <button
          v-for="(preset, key) in themeStore.PRESETS"
          :key="key"
          class="preset-card"
          :class="{ 'preset-card--active': themeStore.activePreset === key }"
          @click="themeStore.applyPreset(key)"
        >
          <span class="preset-swatch">
            <span class="swatch-primary"   :style="{ background: preset.swatch[0] }"></span>
            <span class="swatch-secondary" :style="{ background: preset.swatch[1] }"></span>
          </span>
          <span class="preset-name">{{ preset.label }}</span>
        </button>
      </div>
    </div>
    <!--<div class="system-actions mt-4 p-3 border-top">
      <button class="btn-restart" @click="restartSystem">
        <i class="ph-light ph-rotate-right"></i>
        {{ t('settings.core.restart') }}
      </button>
    </div>-->
        <UniversalSettingsPanel module-id="core" @saved="onSaved" />
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import UniversalSettingsPanel from './UniversalSettingsPanel.vue';
import { useThemeStore } from '@/stores/theme';

const { t } = useI18n();
const themeStore = useThemeStore();
const router = useRouter();

function onSaved() {
  router.push('/');
}

function restartSystem() {
  // TODO: wire to API
  console.log('restart requested');
}
</script>

<style scoped>
.theme-section {
  padding: 1.25rem 0 1rem;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 1.5rem;
}

.theme-label {
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: lowercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
  margin-bottom: 0.75rem;
}

.preset-row             { display: flex;gap: 0.75rem;flex-wrap: wrap;}
.preset-card            { display: flex;align-items: center;gap: 0.5rem;padding: 0.5rem 0.875rem 0.5rem 0.5rem;border: 1px solid var(--color-border);background:var(--color-background);cursor: pointer;transition: border-color 0.15s, box-shadow 0.15s;font-size: 0.8125rem;color: var(--color-text-primary);border-radius: var(--radius-md);}
.preset-card:hover      { border-color: var(--color-border-dark);}
.preset-card--active    { border-color: var(--color-primary);box-shadow: inset 0 0 0 1px var(--color-primary);}
.preset-swatch          { display: flex;width: 28px;height: 20px;overflow: hidden;flex-shrink: 0;}

.swatch-primary,
.swatch-secondary {
  flex: 1;
  height: 100%;
}

.preset-name {
  font-weight: 500;
}

.btn-restart {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.375rem 0.75rem;
  font-size: 0.8125rem;
  color: #dc2626;
  background: transparent;
  border: 1px solid #fecaca;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.btn-restart:hover {
  background: #fef2f2;
  border-color: #fca5a5;
}
</style>