// src/stores/theme.js
//
// The store no longer computes colours. Every token lives in
// src/assets/styles/themes.css under `html[data-theme='<key>']`.
// All this does is set the attribute and remember the choice.
//
// See themes.css for the scale contract and for how to add a preset.

import { defineStore } from 'pinia';
import apiClient from '@/services/api';
import { ref } from 'vue';

// ── Preset registry ───────────────────────────────────────────────────────────
// Display metadata for the picker ONLY. The `swatch` colours are what the
// settings UI paints on each button; they are not applied to the page.
// The real tokens are in themes.css. Keep the keys here in sync with the
// `html[data-theme='...']` blocks there.
export const THEME_PRESETS = {
  default:  { label: 'Default',       dark: false, swatch: [' #eef3f8', '#9ea1a7'] },
  wolffieLight:    { label: 'Wolffie Light',         dark: false, swatch: ['#f1f0e8', '#948d83'] },
  ocean:    { label: 'Ocean',         dark: false, swatch: ['#183e5f', '#5597d1'] },
  carbon:   { label: 'Carbon Forest', dark: false, swatch: ['#22271f', '#7a9782'] },
  solar:    { label: 'Solar Flare',   dark: false, swatch: ['#0f172a', '#f59e0b'] },
  midnight: { label: 'Midnight Rose', dark: true,  swatch: ['#17171c', '#fb7185'] },
  wolffie:  { label: 'Wolffie',       dark: true,  swatch: ['#0b2e3c', '#5492be'] },
};

const DEFAULT_PRESET = 'default';
const STORAGE_KEY     = 'wolffie_theme';

/** Read the persisted preset key, tolerating the old object-shaped payload. */
export function readStoredPreset() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRESET;

    // New format: a bare key string.
    if (raw in THEME_PRESETS) return raw;

    // Legacy format: { activePreset, primaryColor, ... }
    const parsed = JSON.parse(raw);
    const key = parsed?.activePreset;
    return (key && key in THEME_PRESETS) ? key : DEFAULT_PRESET;
  } catch {
    return DEFAULT_PRESET;
  }
}

/** Apply a preset to the document. Safe to call before Vue mounts. */
export function setDocumentTheme(key) {
  const resolved = key in THEME_PRESETS ? key : DEFAULT_PRESET;
  document.documentElement.setAttribute('data-theme', resolved);
  return resolved;
}

// ── Store ─────────────────────────────────────────────────────────────────────
export const useThemeStore = defineStore('theme', () => {
  const activePreset = ref(readStoredPreset());
  const isDark       = ref(THEME_PRESETS[activePreset.value].dark);

  // Idempotent — main.js may already have run setDocumentTheme() to avoid
  // a flash of the default theme on first paint.
  setDocumentTheme(activePreset.value);

  function applyPreset(presetKey, { persistToServer = true } = {}) {
    if (!(presetKey in THEME_PRESETS)) {
      console.warn(`[theme] unknown preset "${presetKey}", ignoring`);
      return;
    }

    activePreset.value = setDocumentTheme(presetKey);
    isDark.value       = THEME_PRESETS[presetKey].dark;
    localStorage.setItem(STORAGE_KEY, presetKey);

    if (persistToServer) {
      apiClient.post('/settings/core', { theme: presetKey })
        .catch(err => console.warn('[theme] failed to persist to server:', err));
    }
  }

  async function loadFromServer() {
    try {
      const res      = await apiClient.get('/settings/core');
      const data     = res.data;
      const settings = data.settings ?? data;
      const serverPreset = settings.theme ?? settings['system.theme'];

      if (serverPreset && serverPreset in THEME_PRESETS && serverPreset !== activePreset.value) {
        // Server is the source of truth here — don't echo it straight back.
        applyPreset(serverPreset, { persistToServer: false });
      }
    } catch (err) {
      console.warn('[theme] could not load from server, using localStorage:', err);
    }
  }

  function resetToDefaults() {
    applyPreset(DEFAULT_PRESET);
  }

  /**
   * Compatibility shim. The store used to compute a colour ramp and write
   * ~30 custom properties here; that work now lives in themes.css, selected
   * by the data-theme attribute. Re-asserting the attribute is all that's
   * left, and it's idempotent — safe to call from anywhere, any number of
   * times. Existing callers (main.js and friends) keep working unchanged.
   */
  function applyTheme() {
    setDocumentTheme(activePreset.value);
  }

  return {
    activePreset,
    isDark,
    applyTheme,
    applyPreset,
    loadFromServer,
    resetToDefaults,
    PRESETS: THEME_PRESETS,
  };
});