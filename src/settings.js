import { formatFormula, getCurveProfile } from './curves.js';
import { createSerialTaskQueue, DEFAULT_APP_SETTINGS, formatSetupError } from './app.js';

const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI__?.invoke;
const hookStatus = document.getElementById('hook-status');
const diagnostics = document.getElementById('diagnostics');
const formula = document.getElementById('formula');
let setupError = '';
let currentDisplayState = { state: 'idle', updated_at_ms: 0 };
const saveSettings = createSerialTaskQueue();

const stateLabels = {
  idle: 'Idle',
  thinking: 'Thinking',
  executing: 'Executing',
  input_needed: 'Input needed',
  completed: 'Completed',
  compacting: 'Compacting',
};

const hookLabels = {
  installed: 'Installed',
  missing: 'Missing',
  invalid: 'Needs repair',
  partially_installed: 'Partially installed',
};

function showSetupError(command, error) {
  setupError = formatSetupError(command, error);
  renderDiagnostics();
  console.warn(`Codex Halo: ${setupError}`);
}

async function invokeCommand(command, args) {
  if (typeof invoke !== 'function') return { ok: false, value: null };
  try {
    const value = await invoke(command, args);
    return { ok: true, value };
  } catch (error) {
    showSetupError(command, error);
    return { ok: false, value: null };
  }
}

function clearSetupError() {
  setupError = '';
}

function control(key) {
  return document.getElementById(key.replaceAll('_', '-'));
}

function readSettings() {
  const number = (key) => Number(control(key).value);
  return {
    enabled: control('enabled').checked,
    opacity: number('opacity'),
    offset_x: number('offset_x'),
    offset_y: number('offset_y'),
    curve_id: control('curve_id').value,
    particle_count: number('particle_count'),
    trail_span: number('trail_span'),
    duration_ms: number('duration_ms'),
    pulse_duration_ms: number('pulse_duration_ms'),
    rotation_duration_ms: number('rotation_duration_ms'),
    stroke_width: number('stroke_width'),
    start_at_login: control('start_at_login').checked,
  };
}

function applySettings(settings) {
  if (!settings) return;
  for (const [key, value] of Object.entries(settings)) {
    const field = control(key);
    if (!field || document.activeElement === field) continue;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = String(value);
  }
  renderFormula(settings);
}

function renderFormula(settings = readSettings()) {
  const profile = getCurveProfile(settings.curve_id);
  formula.textContent = formatFormula(profile, settings);
}

function renderHookStatus(status) {
  hookStatus.textContent = `Hooks: ${hookLabels[status] ?? 'Unavailable'}`;
}

function renderDiagnostics(displayState = {}) {
  currentDisplayState = {
    state: displayState.state ?? currentDisplayState.state,
    updated_at_ms: displayState.updated_at_ms ?? currentDisplayState.updated_at_ms,
  };
  const state = stateLabels[currentDisplayState.state] ?? 'Idle';
  const updatedAt = Number(currentDisplayState.updated_at_ms);
  const timestamp = Number.isFinite(updatedAt) && updatedAt > 0
    ? new Date(updatedAt).toLocaleString()
    : 'never';
  const detail = `State: ${state} | Last event: ${timestamp}`;
  diagnostics.textContent = setupError ? `${detail} | Setup error: ${setupError}` : detail;
}

async function refreshHookStatus() {
  const result = await invokeCommand('get_hook_status');
  if (result.ok) renderHookStatus(result.value);
}

async function refreshDiagnostics() {
  const result = await invokeCommand('get_display_state');
  if (result.ok) renderDiagnostics(result.value);
}

async function loadSettings() {
  const [settings, status] = await Promise.all([
    invokeCommand('get_settings'),
    invokeCommand('get_hook_status'),
  ]);
  applySettings(settings.ok ? settings.value : DEFAULT_APP_SETTINGS);
  if (status.ok) renderHookStatus(status.value);
  await refreshDiagnostics();
}

const listen = window.__TAURI__?.event?.listen;
if (typeof listen === 'function') {
  listen('settings-changed', ({ payload }) => applySettings(payload)).catch(() => {});
}

async function saveCurrentSettings() {
  const settings = readSettings();
  const result = await saveSettings(() => invokeCommand('save_settings', { settings }));
  if (result.ok) {
    clearSetupError();
    renderFormula();
  }
}

document.getElementById('export-diagnostics').addEventListener('click', () => {
  const payload = {
    state: currentDisplayState.state,
    updated_at_ms: currentDisplayState.updated_at_ms,
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'codex-halo-diagnostics.json';
  link.click();
  URL.revokeObjectURL(url);
});

for (const field of document.querySelectorAll('input, select')) {
  const event = field.type === 'number' || field.type === 'range' ? 'input' : 'change';
  field.addEventListener(event, saveCurrentSettings);
  if (field.id === 'curve-id') field.addEventListener('change', () => renderFormula());
}

document.getElementById('install-hooks').addEventListener('click', async () => {
  const result = await invokeCommand('install_hooks');
  if (result.ok) {
    clearSetupError();
    await refreshHookStatus();
  }
});

document.getElementById('remove-hooks').addEventListener('click', async () => {
  const result = await invokeCommand('remove_hooks');
  if (result.ok) {
    clearSetupError();
    await refreshHookStatus();
  }
});

document.getElementById('reset-position').addEventListener('click', async () => {
  const result = await saveSettings(() => invokeCommand('reset_position'));
  if (result.ok) {
    clearSetupError();
    applySettings(result.value);
  }
});

for (const button of document.querySelectorAll('[data-state]')) {
  button.addEventListener('click', async () => {
    const result = await invokeCommand('simulate_state', { state: button.dataset.state });
    if (result.ok) {
      clearSetupError();
      renderDiagnostics(result.value);
    }
  });
}

loadSettings();
window.setInterval(refreshDiagnostics, 500);
