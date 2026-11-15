<template>
  <div class="users-panel">
    <AppTable
      :items="users"
      :columns="columns"
      :loading="loading"
      :empty-text="t('settings.users.empty')"
    >
      <template #toolbar-left>
        <!-- <span class="toolbar__count">{{ users.length }} {{ t('settings.users.userCount', users.length) }}</span> -->
      </template>

      <template #toolbar-right>
        <button class="btn btn--sm" :class="{ 'btn--busy': loading }" @click="fetchUsers">
          {{ t('control.devices.refresh') }}
        </button>
        <button v-if="isAdmin" class="btn btn--sm btn--primary" @click="openAdd">
          + {{ t('settings.users.addUser') }}
        </button>
      </template>

      <!-- Status dot -->
      <template #_status="{ value }">
        <i :class="value.is_active ? 'ph-fill ph-circle text-secondary-400' : 'ph-light ph-circle text-secondary-300'" />
      </template>

      <!-- Username -->
      <template #username="{ value }">
        <div class="text-sm font-medium text-primary">{{ value.username }}</div>
      </template>

      <!-- Full name -->
      <template #full_name="{ value }">
        <div class="text-sm text-secondary-400">{{ value.full_name || '—' }}</div>
      </template>

      <!-- Email -->
      <template #email="{ value }">
        <div class="text-sm text-secondary-400">{{ value.email }}</div>
      </template>

      <!-- Role badge -->
      <template #_role="{ value }">
        <span :class="['role-badge', `role-badge--${value.role?.toLowerCase()}`]">
          {{ value.role }}
        </span>
      </template>

      <!-- Last password update -->
      <template #_lastpw="{ value }">
        <div class="text-sm text-secondary-400">{{ formatDate(value.last_password_update) }}</div>
      </template>

      <!-- Actions -->
      <template #_actions="{ value }">
        <div class="row-actions" :class="{ 'row-actions--always-visible': isMobile }">
          <button class="icon-btn" :title="t('common.edit')" @click="openEdit(value)">
            <i class="ph-light ph-pencil-simple" />
          </button>
          <button class="icon-btn icon-btn--danger" :title="t('common.delete')" @click="askRemove(value)">
            <i class="ph-light ph-trash" />
          </button>
        </div>
      </template>
    </AppTable>

    <!-- ── Add / Edit Drawer ─────────────────────────────────────────────── -->
    <AppDrawer
      v-model:visible="drawer.visible"
      :title="drawer.mode === 'add' ? t('settings.users.addTitle') : t('settings.users.editTitle')"
    >
      <div v-if="activeForm">

        <!-- Edit-mode meta cards -->
        <div v-if="drawer.mode === 'edit'" class="meta-section">
          <div class="meta-grid">
            <div class="meta-card bg-secondary-100">
              <label class="meta-label text-secondary-400">{{ t('settings.users.role') }}</label>
              <div class="meta-value text-primary">{{ activeForm.role }}</div>
            </div>
            <div class="meta-card bg-secondary-100">
              <label class="meta-label text-secondary-400">{{ t('settings.users.is_active') }}</label>
              <div class="meta-value text-primary">{{ activeForm.is_active ? t('common.yes') : t('common.no') }}</div>
            </div>
            <div class="meta-card bg-secondary-100">
              <label class="meta-label text-secondary-400">{{ t('settings.users.last_password_update') }}</label>
              <div class="meta-value text-primary">{{ formatDate(activeForm.last_password_update) }}</div>
            </div>
          </div>
        </div>

        <div class="drawer-divider mb-4" />

        <!-- Account section -->
        <div class="drawer-section">
          <div class="drawer-section__title">{{ t('settings.users.sectionAccount') }}</div>

          <div class="form-field">
            <label class="form-label">{{ t('settings.users.name') }} <span class="req">*</span></label>
            <input v-model="activeForm.username" class="input" :placeholder="t('settings.users.namePlaceholder')" />
          </div>

          <div class="form-field">
            <label class="form-label">{{ t('settings.users.full_name') }}</label>
            <input v-model="activeForm.full_name" class="input" placeholder="John Doe" />
          </div>

          <div class="form-field">
            <label class="form-label">{{ t('settings.users.email') }}</label>
            <input v-model="activeForm.email" type="email" class="input" placeholder="user@example.com" />
          </div>

          <div class="form-field">
            <label class="form-label">{{ t('settings.users.role') }}</label>
            <select v-if="isAdmin" v-model="activeForm.role" class="input">
              <option value="admin">Admin</option>
              <option value="user">User</option>
              <option value="viewer">Viewer</option>
            </select>
            <div v-else class="input input--readonly mb-4">
              <span :class="['role-badge', `role-badge--${activeForm.role?.toLowerCase()}`]">{{ activeForm.role }}</span>
            </div>
          </div>

          <div class="toggle-row mb-4">
            <label class="form-label">{{ t('settings.users.is_active') }}</label>
            <button
              class="toggle"
              :class="{ 'toggle--on': activeForm.is_active }"
              @click="activeForm.is_active = !activeForm.is_active"
            >
              <span class="toggle__knob" />
            </button>
          </div>
        </div>

        <div class="drawer-divider mb-4" />

        <!-- Password section -->
        <div class="drawer-section">
          <div class="drawer-section__title">{{ t('settings.users.sectionPassword') }}</div>

          <div class="form-field">
            <label class="form-label">
              {{ t('settings.users.password') }}
              <span v-if="drawer.mode === 'add'" class="req">*</span>
              <span v-else class="field-hint">— {{ t('settings.users.passwordLeaveBlank') }}</span>
            </label>
            <input
              v-model="activeForm.password"
              type="password"
              class="input"
              :placeholder="drawer.mode === 'edit' ? '••••••••' : ''"
              autocomplete="new-password"
            />
          </div>
        </div>

      </div>

      <template #footer>
        <button class="btn btn--sm" @click="drawer.visible = false">{{ t('common.cancel') }}</button>
        <button class="btn btn--sm btn--primary" :class="{ 'btn--busy': saving }" @click="save">
          {{ drawer.mode === 'add' ? t('settings.users.addUser') : t('common.save') }}
        </button>
      </template>
    </AppDrawer>

    <!-- ── Delete confirm modal ──────────────────────────────────────────── -->
    <AppModal
      v-model:visible="removeModalVisible"
      :message="t('settings.users.confirmRemove', { name: removeTarget?.username })"
      :busy="removing"
      destructive
      @confirm="doRemove"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import apiClient from '@/services/api';
import { useToastStore } from '@/stores/toast';
import { useAuthStore } from '@/stores/auth';

import AppTable  from '@/components/common/AppTable.vue';
import AppDrawer from '@/components/common/AppDrawer.vue';
import AppModal  from '@/components/common/AppModal.vue';

import '@/assets/styles/control.css';

const { t } = useI18n();
const toast     = useToastStore();
const authStore = useAuthStore();
const isAdmin   = computed(() => authStore.isAdmin);

// ── State ─────────────────────────────────────────────────────────────────────
const users          = ref([]);
const loading        = ref(false);
const saving         = ref(false);
const removing       = ref(false);
const removeTarget   = ref(null);
const editTarget     = ref(null);
const drawer         = ref({ visible: false, mode: 'add' });
const isMobile       = ref(false);

// ── Columns ───────────────────────────────────────────────────────────────────
const desktopColumns = computed(() => [
  { field: '_status',   title: '',                                         width: '2rem',  slotMode: true },
  { field: 'username',  title: t('settings.users.name'),                                  slotMode: true },
  { field: 'full_name', title: t('settings.users.full_name'),                             slotMode: true },
  { field: 'email',     title: t('settings.users.email'),                                 slotMode: true },
  { field: '_role',     title: t('settings.users.role'),                                  slotMode: true },
  { field: '_lastpw',   title: t('settings.users.last_password_update'),                  slotMode: true },
  { field: '_actions',  title: t('common.actions'),                        width: '5rem', slotMode: true },
]);

const mobileColumns = computed(() => [
  { field: '_status',  title: '',                             width: '1rem', slotMode: true },
  { field: 'username', title: t('settings.users.name'),                     slotMode: true },
  { field: '_actions', title: '',                             width: '5rem', slotMode: true },
]);

const columns = computed(() => isMobile.value ? mobileColumns.value : desktopColumns.value);

// ── Derived ───────────────────────────────────────────────────────────────────
const activeForm = computed(() => drawer.value.mode === 'add' ? form.value : editTarget.value);
const removeModalVisible = computed({
  get: () => !!removeTarget.value,
  set: (v) => { if (!v) removeTarget.value = null; }
});

// ── Form ──────────────────────────────────────────────────────────────────────
const defaultForm = () => ({ username: '', full_name: '', email: '', role: 'user', is_active: true, password: '' });
const form = ref(defaultForm());

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Data loading ──────────────────────────────────────────────────────────────
async function fetchUsers() {
  loading.value = true;
  try {
    const response = await apiClient.get('/settings/users/list');
    users.value = response?.data?.data ?? response?.data ?? [];
  } catch (err) {
    toast.add({ severity: 'error', summary: t('common.error'), detail: err.message });
  } finally {
    loading.value = false;
  }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
function openAdd() {
  form.value = defaultForm();
  drawer.value = { visible: true, mode: 'add' };
}

function openEdit(user) {
  editTarget.value = { ...user, password: '' };
  drawer.value = { visible: true, mode: 'edit' };
}

function askRemove(user) {
  removeTarget.value = user;
}

async function save() {
  if (!activeForm.value) return;
  saving.value = true;
  try {
    const isAdd  = drawer.value.mode === 'add';
    const url    = isAdd ? '/settings/users/create' : `/settings/users/${activeForm.value.id}`;
    const payload = { ...activeForm.value };
    if (!isAdd && !payload.password) delete payload.password;
    await apiClient[isAdd ? 'post' : 'put'](url, payload);
    toast.add({ severity: 'success', summary: t('common.success'), detail: t('common.saved') });
    drawer.value.visible = false;
    await fetchUsers();
  } catch (err) {
    toast.add({ severity: 'error', summary: t('common.error'), detail: err.message });
  } finally {
    saving.value = false;
  }
}

async function doRemove() {
  removing.value = true;
  try {
    await apiClient.delete(`/settings/users/${removeTarget.value.id}`);
    toast.add({ severity: 'success', summary: t('common.success'), detail: t('settings.users.deleted') });
    removeTarget.value = null;
    await fetchUsers();
  } catch (err) {
    toast.add({ severity: 'error', summary: t('common.error'), detail: err.message });
  } finally {
    removing.value = false;
  }
}

// ── Mobile detection ──────────────────────────────────────────────────────────
let mq = null;
function onMqChange(e) { isMobile.value = e.matches; }

onMounted(async () => {
  mq = window.matchMedia('(max-width: 639px)');
  isMobile.value = mq.matches;
  mq.addEventListener('change', onMqChange);
  await fetchUsers();
});

onUnmounted(() => {
  mq?.removeEventListener('change', onMqChange);
});
</script>

<style scoped>
.users-panel            { display: flex; flex-direction: column; gap: 0.875rem; }
/* ── Role badges ─────────────────────────────────────────────────────────── */
.role-badge             { display: inline-block;padding: 0.125rem 0.5rem;font-size: 14px;font-weight: 400;letter-spacing: 0.05em;border-radius:var(--border-radius);background: var(--color-secondary-100);color: var(--color-text-secondary);}
.role-badge--admin      { background: var(--color-secondary-500); color: var(--color-secondary-100); }
.role-badge--user       { background: var(--color-secondary-400); color: var(--color-secondary-100); }
.role-badge--viewer     { background: var(--color-secondary-300); color: var(--color-secondary-500); }

/* ── Meta cards (edit-mode summary row) ──────────────────────────────────── */
.meta-section           { padding-bottom: 1.25rem; }
.meta-grid              { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; }
.meta-card              { padding: 0.5rem 0.75rem; border-radius:var(--border-radius); background-color: var(--color-secondary-50);}
.meta-label             { display: block; font-size: 0.6rem; text-transform: lowercase; font-weight: 400; margin-bottom: 0.25rem; letter-spacing: 0.05em; }
.meta-value             { font-size: 0.8rem; font-weight: 600; }
  
/* ── Field helpers ───────────────────────────────────────────────────────── */
.req                    { color: #ef4444; margin-left: 2px; }
.field-hint             { font-size: 0.7rem; font-weight: 400; color: var(--color-text-tertiary); margin-left: 4px; }
.input--readonly        { display: flex;align-items: center;background: var(--color-secondary-100);padding: 0.4rem 0.6rem;cursor: default;}

/* ── Mobile: action buttons always visible ───────────────────────────────── */
.row-actions--always-visible { opacity: 1 !important;visibility: visible !important;pointer-events: auto !important;}
</style>