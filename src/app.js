import { createHaloRenderer } from './halo.js';

const POLL_INTERVAL_MS = 150;

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

export function createDisplayStatePoller(invokeCommand, applyDisplayState) {
  return createDisplayStateBridge(invokeCommand, applyDisplayState).pollDisplayState;
}

export function createDisplayStateBridge(invokeCommand, applyDisplayState) {
  let latestGeneration = 0;

  async function requestDisplayState(command, args) {
    const generation = ++latestGeneration;
    const displayState = await invokeCommand(command, args);
    if (generation === latestGeneration) applyDisplayState(displayState);
    return displayState;
  }

  return {
    showDisplayState(displayState) {
      latestGeneration += 1;
      applyDisplayState(displayState);
    },
    pollDisplayState() {
      return requestDisplayState('get_display_state');
    },
  };
}

function boot() {
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
    listen('settings-changed', ({ payload }) => applySettings(payload)).catch(() => {});
  }

  if (renderer) {
    renderer.start();
    invokeCommand('get_settings').then(applySettings);
    displayBridge.pollDisplayState();
    window.setInterval(displayBridge.pollDisplayState, POLL_INTERVAL_MS);
  }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && document.body?.classList.contains('overlay-page')) boot();
