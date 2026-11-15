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
.theme-section          { padding: 1.25rem 0 1rem;border-bottom: 1px solid var(--color-border);margin-bottom: 1.5rem;}
.theme-label            { font-size: 0.75rem;font-weight: 500;text-transform: lowercase;letter-spacing: 0.05em;color: var(--color-text-secondary);margin-bottom: 0.75rem;}
.preset-row             { display: flex;gap: 0.75rem;flex-wrap: wrap;}
.preset-card            { display: flex;border-radius: var(--radius-lg);align-items: center;gap: 0.5rem;padding: 0.5rem 0.875rem 0.5rem 0.5rem;border: 2px solid var(--color-border);cursor: pointer;transition: border-color 0.15s, box-shadow 0.15s;font-size: 0.8125rem;color: var(--color-text-primary);}
.preset-card:hover      { background: var(--color-secondary-200);}
.preset-card--active    { border: 2px solid var(--color-primary);}
.preset-swatch          { display: flex;width: 28px;height: 20px;overflow: hidden;flex-shrink: 0;}
.swatch-primary         { flex: 1;height: 100%;background: var(--color-background);}
.swatch-secondary       { flex: 1;height: 100%;background: var(--color-secondary-500);}
.preset-name            { font-weight: 500;}
.btn-restart            { display: inline-flex;  align-items: center;  gap: 0.4rem;  padding: 0.375rem 0.75rem;font-size: 0.8125rem;color: var(--color-red-600);  background: transparent;  border: 1px solid var(--color-red-200);  cursor: pointer;  transition: background 0.15s, border-color 0.15s;}
.btn-restart:hover      { background: var(--color-red-100);border-color: var(--color-red-300);}
</style>