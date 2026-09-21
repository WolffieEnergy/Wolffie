// modules/alphaess-modbus-tcp/index.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import db from '../../core/database.js';
import settingsService from '../../core/system/services/settingsService.js';
import api from './services/api.js';
import collector from './services/collector.js';
import capabilityRegistry from '../../core/capabilityRegistry.js';
import { padName } from '../../core/utils/logger.js';
const PREFIX = padName('AlphaESS ModBus');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const manifestPath = path.join(__dirname, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const MODULE_ID = 'alphaess-modbus-tcp';
const PRIORITY  = 10;

class AlphaESSModbusTCPModule {
  constructor() {
    this.manifest    = manifest;
    this.initialized = false;
    this.connected   = false;
    this.config      = null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize() {
    if (this.initialized) return;
    try {
      console.log(`   - \x1b[93m${this.manifest.id} \x1b[37m`);
      this.config = await settingsService.getCategory(MODULE_ID);

      if (!this.config || this.config.enabled === false) return;

      console.log(`     - ModBus IP: ${this.config.host}:${this.config.port}`);

      // Store config in api so withConnection() works without parameter passing.
      api.setConfig(this.config);

      // Safety check using the API's TCP probe
      const isAlive = await api.checkStatus(this.config.host, this.config.port);

      if (isAlive) {
        this.connected = true;
        console.log('\x1b[37m     - ModBus connection established \x1b[32m✓\x1b[37m');

        // Safety reset: uses withConnection(fn, true) — connects, resets dispatch
        // registers, then closes (closeAfter=true). The first collection cycle
        // then opens its own persistent connection via withConnection(fn, false).
        await api.resetOnStartup();
      } else {
        this.connected = false;
        console.warn('\x1b[91m     - ModBus connection failed (port unreachable) — capabilities registered anyway\x1b[37m');
      }

      // Pre-load routes so routeManager can find them as module.routes
      this.routes = await this.getRoutes();

      // Inject config into collector so it can connect without re-fetching settings
      collector.config = this.config;

      this.initialized = true;

      // Always register capabilities — even when offline at startup.
      // If the inverter is unreachable the handlers throw, and the registry
      // falls back to the next provider (alphaess-cloud at priority 10).
      // reinitialize() unregisters explicitly if the host becomes permanently
      // unreachable after a settings change.
      this._registerCapabilities();

    } catch (error) {
      console.error('\x1b[91m     - Failed to initialize module:', error.message);
      throw error;
    }
  }

  async collect() {
    // Skip collection entirely if a higher-priority module has taken over
    // all capabilities this module provides. This keeps energy_snapshots clean —
    // only the winning module writes rows for its owned fields.
    const ownedCapabilities = capabilityRegistry.list()
      .filter(c => c.moduleId === MODULE_ID);

    if (ownedCapabilities.length === 0) {
      console.log(`   • ${PREFIX}: no capabilities owned, skipping collection`);
      return true;
    }

    return await collector.collect();
  }

  getStatus() {
    return {
      ...collector.getStatus(),
      connected: this.connected,
    };
  }

  async getRoutes() {
    try {
      const routesPath = path.join(__dirname, 'routes', 'index.js');
      if (fs.existsSync(routesPath)) {
        const routeModule = await import(pathToFileURL(routesPath).href);
        return routeModule.default;
      }
    } catch (error) {
      console.error(`[${PREFIX}] Route loading error:`, error.message);
    }
    return null;
  }

  async reinitialize() {
    console.log(`   - RESTART ${MODULE_ID}: reinitializing with fresh settings`);

    this.config = await settingsService.getCategory(MODULE_ID);

    // Re-inject config into api and collector
    api.setConfig(this.config);
    collector.config = this.config;

    // Re-check connection with potentially new host/port
    const isAlive = await api.checkStatus(this.config.host, this.config.port);
    this.connected = isAlive;

    console.log(`   - ${PREFIX}: connection ${isAlive ? '✓' : '✗'} (${this.config.host}:${this.config.port})`);

    // Re-register if now reachable; unregister if the new host is unreachable
    // so a lower-priority provider can take over cleanly.
    if (isAlive) {
      this._registerCapabilities();
    } else {
      capabilityRegistry.unregister(MODULE_ID);
    }
  }

  // ── Capability Registration ────────────────────────────────────────────────

  _registerCapabilities() {

    // ── Battery reads ──────────────────────────────────────────────────────

    capabilityRegistry.register(
      'battery:read',
      async () => {
        // Read from the collector's in-memory cache — no new Modbus connection,
        // no DB import needed. Data is at most one collection cycle old (~20 s).
        const d = collector.getLastSnapshot();
        if (!d) return { soc: null, power: null, charge_today: null, discharge_today: null };
        const b = d.battery;
        return {
          soc:             b.soc             ?? null,
          power:           b.power != null ? b.power * -1 : null,
          charge_today:    b.charge_today    ?? null,
          discharge_today: b.discharge_today ?? null,
        };
      },
      PRIORITY,
      MODULE_ID
    );

    capabilityRegistry.register(
      'battery:status',
      () => api.getDispatchStatus(),
      PRIORITY,
      MODULE_ID
    );

    // ── Battery control ────────────────────────────────────────────────────

    capabilityRegistry.register(
      'battery:charge-from-grid',
      async (body) => {
        const { watts, targetSOC, durationHours, origin } = body;
        await api.startCharge(watts, targetSOC, durationHours, origin || 'capability');
        return { success: true, command: { mode: 'charge-from-grid', watts, targetSOC, durationHours, origin } };
      },
      PRIORITY,
      MODULE_ID
    );

    capabilityRegistry.register(
      'battery:discharge-to-grid',
      async (body) => {
        const { watts, minimumSOC, durationHours, origin } = body;
        await api.startDischarge(watts, minimumSOC, durationHours, origin || 'capability');
        return { success: true, command: { mode: 'discharge-to-grid', watts, minimumSOC, durationHours, origin } };
      },
      PRIORITY,
      MODULE_ID
    );

    capabilityRegistry.register(
      'battery:stop',
      async () => {
        await api.stopDispatch();
        return { success: true, mode: 'Self-Consumption' };
      },
      PRIORITY,
      MODULE_ID
    );
    capabilityRegistry.register(
      'battery:set-charge-limit',
      async (body) => {
        const { percent } = body;
        await api.writeMinSoC(percent);
        return { success: true, chargeLimitPct: percent };
      },
      PRIORITY,
      MODULE_ID
    );
    // ── Solar reads ────────────────────────────────────────────────────────

    capabilityRegistry.register(
      'solar:read',
      async () => {
        const d = collector.getLastSnapshot();
        if (!d) return { power: null, energy_today: null, energy_total: null };
        const s = d.solar;
        return {
          power:        s.total_power  ?? null,
          energy_today: s.energy_today ?? null,
          energy_total: s.energy_total ?? null,
        };
      },
      PRIORITY,
      MODULE_ID
    );

    // ── Grid reads ─────────────────────────────────────────────────────────

    capabilityRegistry.register(
      'grid:read',
      async () => {
        const d = collector.getLastSnapshot();
        if (!d) return { power: null, voltage_l1: null, frequency: null, import_today: null, export_today: null };
        const g = d.grid;

        return {
          power:        g.total_active_power ?? null,
          voltage_l1:   g.l1_voltage         ?? null,
          frequency:    d.system?.inv_freq    ?? null,
          import_today: g.import_today        ?? null,
          export_today: g.export_today        ?? null,
        };
      },
      PRIORITY,
      MODULE_ID
    );

    // ── Grid status (outage detection) ────────────────────────────────────
    // Returns { gridConnected: bool, mode: string } from last collector cycle.
    // Non-throwing — returns gridConnected: true if no data yet (safe default).

    capabilityRegistry.register(
      'grid:status',
      () => {
        const d = collector.getLastSnapshot();
        if (!d?.inverterMode) return { gridConnected: true, mode: 'Unknown' };
        return {
          gridConnected: d.inverterMode.gridConnected,
          mode:          d.inverterMode.mode,
        };
      },
      PRIORITY,
      MODULE_ID
    );

    // ── Home load (derived) ────────────────────────────────────────────────
    // Priority 5 — a P1 meter module registers home:read at priority 10
    // and automatically takes over when available.

    capabilityRegistry.register(
      'home:read',        // was: grid:read
      async () => {
        // ... existing handler code unchanged ...
        return {
          power: hasPhaseData ? p_l1 + p_l2 + p_l3 : (d.active_power_w ?? null),
          import_today: importToday,
          export_today: exportToday,
        };
      },
      PRIORITY,           // 15 — wins over AlphaESS home:read at 5
      MODULE_ID
    );
    console.log(`     - Capabilities registered`);
  }
}

export default new AlphaESSModbusTCPModule();