import { createHaloRenderer } from './halo.js';

const POLL_INTERVAL_MS = 150;
const canvas = document.getElementById('halo');
const renderer = canvas ? createHaloRenderer(canvas) : null;
const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI__?.invoke;

async function invokeCommand(command, args) {
  if (typeof invoke !== 'function') return null;
  try {
    return await invoke(command, args);
  } catch (error) {
    console.warn(`Codex Halo: ${command} failed`, error);
    return null;
  }
}

function applyDisplayState(displayState) {
  if (displayState?.state) renderer?.setState(displayState.state);
}

async function loadSettings() {
  const settings = await invokeCommand('get_settings');
  if (!settings) return;
  renderer?.setCurve(settings.curve_id);
  renderer?.setSettings(settings);
  for (const [key, value] of Object.entries(settings)) {
    const control = document.getElementById(key.replaceAll('_', '-'));
    if (!control || document.activeElement === control) continue;
    if (control.type === 'checkbox') control.checked = Boolean(value);
    else control.value = String(value);
  }
}

async function pollDisplayState() {
  applyDisplayState(await invokeCommand('get_display_state'));
}

for (const button of document.querySelectorAll('[data-state]')) {
  button.addEventListener('click', async () => {
    const displayState = await invokeCommand('simulate_state', { state: button.dataset.state });
    applyDisplayState(displayState);
  });
}

if (renderer) {
  renderer.start();
  loadSettings();
  pollDisplayState();
  window.setInterval(pollDisplayState, POLL_INTERVAL_MS);
}
