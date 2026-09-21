// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import apiClient from '../services/api';

import MainLayout  from '../layouts/MainLayout.vue';
import Dashboard   from '../views/DashboardHost.vue';
import Analytics   from '../views/Analytics.vue';
import History     from '../views/History.vue';
import Control     from '../views/Control.vue';
import Settings    from '../views/Settings.vue';
import Events      from '../views/Events.vue';
import SetupWizard from '../views/SetupWizard.vue';
import Login       from '../views/Login.vue';
import SdkView     from '@/views/SdkView.vue';

const routes = [
  { path: '/login',       name: 'Login',      component: Login,       meta: { requiresAuth: false, hideForAuth: true }},
  { path: '/setupwizard', name: 'SetupWizard',component: SetupWizard, meta: { requiresAuth: true, requiresAdmin: true }},
  { path: '/',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      { path: '',          name: 'Dashboard', component: Dashboard },
      { path: 'analytics', name: 'Analytics', component: Analytics },
      { path: 'history',   name: 'History',   component: History   },
      { path: 'control',   name: 'Control',   component: Control   },
      { path: 'sdk',       name: 'sdk',       component: SdkView   },
      { path: 'settings',  name: 'Settings',  component: Settings,  meta: { requiresAdmin: true } },
      { path: 'events',    name: 'Events',    component: Events    }
    ]
  }
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
});

// ── Setup check ───────────────────────────────────────────────────────────────
// Eenmalig gecached — voorkomt API-call bij elke navigatie.
let setupChecked   = false;
let setupCompleted = true;

async function checkSetup() {
  if (setupChecked) return setupCompleted;
  try {
    const { data } = await apiClient.get('/setup/status', { skipAuth: true });
    setupCompleted = !!data.setupCompleted;
    setupChecked   = true;
  } catch {
    // API niet bereikbaar — ga ervan uit dat setup al gedaan is
    setupCompleted = true;
    setupChecked   = true;
  }
  return setupCompleted;
}

// Exporteerbaar voor SetupWizard.vue na voltooiing
export function markSetupComplete() {
  setupCompleted = true;
  setupChecked   = true;
}

// ── Route guard ───────────────────────────────────────────────────────────────
//
// Volgorde:
//   1. Auth check — niet ingelogd → naar login
//   2. Setup check — setup niet gedaan → naar wizard (alleen voor admins)
//   3. Admin check — geen admin → naar dashboard

router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore();

  // 1. Al ingelogd en probeert login te bereiken → dashboard
  if (to.meta.hideForAuth && authStore.isAuthenticated) {
    next({ name: 'Dashboard' });
    return;
  }

  // 2. Niet ingelogd en route vereist auth → naar login
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next({ name: 'Login' });
    return;
  }

  // 3. Setup check — alleen voor ingelogde admins die niet al naar wizard gaan
  if (authStore.isAuthenticated && authStore.isAdmin && to.name !== 'SetupWizard') {
    const done = await checkSetup();
    if (!done) {
      next({ name: 'SetupWizard' });
      return;
    }
  }

  // 4. Geen admin → naar dashboard
  if (to.meta.requiresAdmin && !authStore.isAdmin) {
    next({ name: 'Dashboard' });
    return;
  }

  next();
});

export default router;