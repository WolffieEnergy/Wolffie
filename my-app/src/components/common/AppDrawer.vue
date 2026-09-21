<!-- src/components/common/AppDrawer.vue -->
<!--
  Reusable slide-in drawer (right side).

  Props:
    visible  (Boolean) – controls visibility, supports v-model:visible
    title    (String)  – header title

  Emits:
    update:visible  – when the user closes the drawer

  Slots:
    default  – drawer body content
    footer   – optional custom footer (falls back to a close button)

  Usage:
    <AppDrawer v-model:visible="open" title="Edit device">
      <p>Form goes here</p>
      <template #footer>
        <button @click="open = false">Cancel</button>
        <button @click="save">Save</button>
      </template>
    </AppDrawer>
-->
<template>
  <Teleport to="body">
    <Transition name="drawer-fade">
      <div
        v-if="visible"
        class="drawer-backdrop fixed inset-0 z-[9000] flex justify-end"
        @click.self="close"
      >
        <Transition name="drawer-slide" appear>
          <aside v-if="visible" class="drawer flex flex-col h-full bg-secondary-100 border-l border-secondary-200">

            <!-- Header -->
            <div class="drawer__header flex items-center justify-between shrink-0 border-b border-secondary-200">
              <span class="drawer__title text-primary font-semibold">{{ title }}</span>
              <button
                class="drawer__close flex items-center justify-center text-secondary-400 hover:text-primary hover:bg-secondary-200 transition-colors border-none bg-transparent cursor-pointer"
                :aria-label="t('common.close')"
                @click="close"
              >
                <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
                </svg>
              </button>
            </div>

            <!-- Body -->
            <div class="drawer__body flex-1 overflow-y-auto flex flex-col">
              <slot />
            </div>

            <!-- Footer -->
            <div class="drawer__footer flex items-center justify-end shrink-0 border-t border-secondary-200">
              <slot name="footer">
                <button class="btn btn--sm" @click="close">{{ t('common.close') }}</button>
              </slot>
            </div>

          </aside>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { useLocale } from '@/composables/useLocale';

const { t } = useLocale();

const props = defineProps({
  visible: { type: Boolean, required: true },
  title:   { type: String,  default: '' },
});

const emit = defineEmits(['update:visible']);

function close() {
  emit('update:visible', false);
}
</script>

<style scoped>
/* ── Backdrop ────────────────────────────────────────────────────────────── */
.drawer-backdrop            { background: rgba(17, 24, 39, 0.2); }
/* ── Drawer panel ────────────────────────────────────────────────────────── */
.drawer                     { width: 520px; max-width: 100vw;background-color: var( --color-background); margin:0;height:100%}
/* ── Header ──────────────────────────────────────────────────────────────── */
.drawer__header             { padding: 1.125rem 1.25rem; }
.drawer__title              { font-size: 0.9375rem; }
.drawer__close              { width: 26px; height: 26px; border-radius: var(--radius-sm, 4px); }
/* ── Body ────────────────────────────────────────────────────────────────── */
.drawer__body               { padding: 1.5rem; gap: 1.5rem; }
/* ── Footer ──────────────────────────────────────────────────────────────── */
.drawer__footer             { gap: 0.5rem; padding: 0.875rem 1.25rem; }
/* ── Transitions ─────────────────────────────────────────────────────────── */
.drawer-fade-enter-active,
.drawer-fade-leave-active   { transition: opacity 0.2s ease; }
.drawer-fade-enter-from,
.drawer-fade-leave-to       { opacity: 0; }
.drawer-slide-enter-active,
.drawer-slide-leave-active  { transition: transform 0.2s ease; }
.drawer-slide-enter-from,
.drawer-slide-leave-to      { transform: translateX(100%); } 

/* ── Buttons (from control.css pattern — kept self-contained) ─────────────── */
.btn                        { display: inline-flex;align-items: center;gap: 0.375rem;padding: 0.4375rem 0.875rem;background: var(--color-bg-secondary);border: 1px solid var(--color-border-dark);color: var(--color-text-primary);font-size: 0.8125rem;font-weight: 500;cursor: pointer;white-space: nowrap;transition: background 0.15s, border-color 0.15s;}
.btn:hover:not(:disabled)   { background: var(--color-secondary-100); border-color: var(--color-secondary-400); }
.btn--sm { padding: 0.3125rem 0.625rem; font-size: 0.78125rem; }
@media (max-width: 768px)   {
  .drawer                   {margin:0.5rem;height:auto;}
}

</style>