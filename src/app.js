import { createHaloRenderer } from './halo.js';

const POLL_INTERVAL_MS = 150;
const SIMULATION_DURATION_MS = 420;
const SAFE_SETUP_ERROR = /^start-at-login:(permission|launch-agent|registry|unsupported|reconciliation)$/;

export const DEFAULT_APP_SETTINGS = Object.freeze({
  enabled: true,
  opacity: 1,
  offset_x: 28,
  offset_y: 140,
  curve_id: 'rose-seven',
  particle_count: 64,
  trail_span: 0.4,
  duration_ms: 420,
  pulse_duration_ms: 1200,
  rotation_duration_ms: 4200,
  stroke_width: 4,
  start_at_login: false,
});

function errorCategory(error) {
  if (error?.name === 'AbortError') return 'abort';
  if (error?.code) return 'coded-error';
  if (typeof error === 'string') return 'string-error';
  return 'error';
}

export function createCommandInvoker(invoke, warn = console.warn.bind(console)) {
  return async function invokeCommand(command, args) {
    if (typeof invoke !== 'function') return null;
    try {
      return await invoke(command, args);
    } catch (error) {
      warn(`Codex Halo: ${command} failed (${errorCategory(error)})`);
      return null;
    }
  }
}

export function createSerialTaskQueue() {
  let tail = Promise.resolve();
  return function enqueue(task) {
    const next = tail.then(task, task);
    tail = next.catch(() => {});
    return next;
  };
}

export function createDisplayStatePoller(invokeCommand, applyDisplayState) {
  return createDisplayStateBridge(invokeCommand, applyDisplayState).pollDisplayState;
}

export function createDisplayStateBridge(invokeCommand, applyDisplayState, options = {}) {
  let latestGeneration = 0;
  let simulatedUntil = 0;
  const now = options.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const simulationDurationMs = options.simulationDurationMs ?? SIMULATION_DURATION_MS;

  async function requestDisplayState(command, args, supersedeSimulation = false) {
    const generation = ++latestGeneration;
    const displayState = await invokeCommand(command, args);
    if (generation === latestGeneration && (supersedeSimulation || now() >= simulatedUntil)) {
      simulatedUntil = 0;
      applyDisplayState(displayState);
    }
    return displayState;
  }

  return {
    showDisplayState(displayState) {
      latestGeneration += 1;
      simulatedUntil = 0;
      applyDisplayState(displayState);
    },
    showSimulatedDisplayState(displayState) {
      latestGeneration += 1;
      simulatedUntil = now() + simulationDurationMs;
      applyDisplayState(displayState);
    },
    pollDisplayState(options = {}) {
      return requestDisplayState('get_display_state', undefined, options.supersedeSimulation === true);
    },
  };
}

export function formatSetupError(command, error) {
  const category = typeof error === 'string' ? error.match(SAFE_SETUP_ERROR)?.[1] : null;
  return category ? `start-at-login setup failed (${category})` : `${command} failed`;
}

async function boot() {
  const canvas = document.getElementById('halo');
  const renderer = canvas ? createHaloRenderer(canvas) : null;
  const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI__?.invoke;
  const invokeCommand = createCommandInvoker(invoke);

  function applyDisplayState(displayState) {
    if (displayState?.state) renderer?.setState(displayState.state);
  }

  function applySettings(settings) {
    if (!settings) return;
    renderer?.setCurve(settings.curve_id);
    renderer?.setSettings(settings);
  }

  const displayBridge = createDisplayStateBridge(invokeCommand, applyDisplayState);
  const listen = window.__TAURI__?.event?.listen;
  if (typeof listen === 'function') {
    listen('display-state', ({ payload }) => displayBridge.showDisplayState(payload)).catch(() => {});
    listen('simulated-display-state', ({ payload }) => displayBridge.showSimulatedDisplayState(payload)).catch(() => {});
    listen('settings-changed', ({ payload }) => applySettings(payload)).catch(() => {});
  }

  if (!renderer) return;
  const settings = await invokeCommand('get_settings') ?? DEFAULT_APP_SETTINGS;
  applySettings(settings);
  renderer.start();
  await invokeCommand('set_overlay_visible', { visible: settings.enabled });
  displayBridge.pollDisplayState();
  window.setInterval(displayBridge.pollDisplayState, POLL_INTERVAL_MS);
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && document.body?.classList.contains('overlay-page')) boot();
