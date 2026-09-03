import { formatFormula, getCurveProfile } from './curves.js';
import { createSerialTaskQueue, DEFAULT_APP_SETTINGS, formatSetupError } from './app.js';
import {
  COLOR_PRESET_GROUPS,
  isHexColor,
  normalizeHexColor,
  STATE_COLOR_KEYS,
} from './colors.js';
import {
  DEFAULT_LANGUAGE,
  getStateLabel,
  getText,
  localeForLanguage,
  normalizeLanguage,
} from './i18n.js';

const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI__?.invoke;
const pluginStatus = document.getElementById('plugin-status');
const installPluginButton = document.getElementById('install-plugin');
const uninstallPluginButton = document.getElementById('uninstall-plugin');
const pluginOperationStatuses = {
  installed: 'settings.pluginInstalled',
  uninstalled: 'settings.pluginUninstalled',
  failed: 'settings.pluginOperationFailed',
};
const diagnostics = document.getElementById('diagnostics');
const formula = document.getElementById('formula');
const colorPresets = document.getElementById('color-presets');
const colorFields = Object.entries(STATE_COLOR_KEYS).map(([state, key]) => ({ state, key }));
let selectedColorState = 'idle';
let currentLanguage = DEFAULT_LANGUAGE;
let currentPluginStatus = 'settings.pluginReady';
let setupError = null;
let currentDisplayState = { state: 'idle', updated_at_ms: 0 };
const saveSettings = createSerialTaskQueue();

function showSetupError(command, error) {
  setupError = { command, error };
  renderDiagnostics();
  console.warn(`Codex Halo: ${formatSetupError(command, error)}`);
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
  setupError = null;
}

function control(key) {
  return document.getElementById(key.replaceAll('_', '-'));
}

function selectColorState(state) {
  if (!STATE_COLOR_KEYS[state]) return;
  selectedColorState = state;
  for (const target of document.querySelectorAll('button[data-color-target]')) {
    target.setAttribute('aria-pressed', String(target.dataset.colorTarget === state));
  }
}

function syncColorField(state, value) {
  const key = STATE_COLOR_KEYS[state];
  const picker = control(key);
  const hex = control(`${key}_hex`);
  const preview = control(`${key}_preview`);
  const normalized = normalizeHexColor(value, DEFAULT_APP_SETTINGS[key]);
  if (picker && document.activeElement !== picker) picker.value = normalized;
  if (hex && document.activeElement !== hex) hex.value = normalized;
  if (preview) preview.style.backgroundColor = normalized;
  hex?.setCustomValidity?.('');
}

function renderColorPresets() {
  if (!colorPresets || typeof document.createElement !== 'function') return;
  colorPresets.textContent = '';
  for (const group of COLOR_PRESET_GROUPS) {
    const section = document.createElement('section');
    section.className = 'color-preset-group';
    const heading = document.createElement('h3');
    heading.textContent = getText(currentLanguage, group.labelKey);
    const grid = document.createElement('div');
    grid.className = 'color-preset-grid';
    for (const color of group.colors) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'color-swatch';
      button.title = color;
      button.setAttribute('aria-label', color);
      const chip = document.createElement('span');
      chip.className = 'color-swatch-chip';
      chip.style.backgroundColor = color;
      const label = document.createElement('span');
      label.textContent = color;
      button.append(chip, label);
      button.addEventListener('click', () => {
        const state = selectedColorState;
        const picker = control(STATE_COLOR_KEYS[state]);
        if (!picker) return;
        picker.value = color;
        syncColorField(state, color);
        void saveCurrentSettings();
      });
      grid.append(button);
    }
    section.append(heading, grid);
    colorPresets.append(section);
  }
}

function readSettings() {
  const number = (key) => Number(control(key).value);
  const value = (key, fallback) => control(key)?.value ?? fallback;
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
    ...Object.fromEntries(colorFields.map(({ key }) => [
      key,
      normalizeHexColor(value(key, DEFAULT_APP_SETTINGS[key]), DEFAULT_APP_SETTINGS[key]),
    ])),
    start_at_login: control('start_at_login').checked,
    follow_codex_lifecycle: control('follow_codex_lifecycle').checked,
    language: control('language').value,
  };
}

function applySettings(settings) {
  if (!settings) return;
  const language = normalizeLanguage(settings.language);
  control('language').value = language;
  for (const [key, value] of Object.entries(settings)) {
    if (key === 'language') continue;
    const field = control(key);
    if (!field || document.activeElement === field) continue;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = String(value);
  }
  for (const { state, key } of colorFields) {
    if (settings[key] !== undefined) syncColorField(state, settings[key]);
  }
  renderLanguage(language);
  renderFormula(settings);
}

function renderFormula(settings = readSettings()) {
  const profile = getCurveProfile(settings.curve_id);
  formula.textContent = formatFormula(profile, settings);
}

function renderPluginStatus(status = currentPluginStatus) {
  currentPluginStatus = status;
  pluginStatus.textContent = getText(currentLanguage, status);
}

function renderDiagnostics(displayState = {}) {
  currentDisplayState = {
    state: displayState.state ?? currentDisplayState.state,
    updated_at_ms: displayState.updated_at_ms ?? currentDisplayState.updated_at_ms,
  };
  const state = getStateLabel(currentLanguage, currentDisplayState.state);
  const updatedAt = Number(currentDisplayState.updated_at_ms);
  const timestamp = Number.isFinite(updatedAt) && updatedAt > 0
    ? new Date(updatedAt).toLocaleString(localeForLanguage(currentLanguage))
    : getText(currentLanguage, 'settings.diagnosticsNever');
  const detail = `${getText(currentLanguage, 'settings.diagnosticsState')}: ${state} | ${getText(currentLanguage, 'settings.diagnosticsLastEvent')}: ${timestamp}`;
  if (!setupError) {
    diagnostics.textContent = detail;
    return;
  }
  const formattedError = formatSetupError(setupError.command, setupError.error, currentLanguage);
  diagnostics.textContent = `${detail} | ${getText(currentLanguage, 'settings.diagnosticsSetupError')}: ${formattedError}`;
}

function renderLanguage(language) {
  currentLanguage = normalizeLanguage(language);
  document.documentElement.lang = currentLanguage;
  document.title = getText(currentLanguage, 'settings.title');
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = getText(currentLanguage, element.dataset.i18n);
  }
  for (const element of document.querySelectorAll('[data-i18n-aria-label]')) {
    element.setAttribute('aria-label', getText(currentLanguage, element.dataset.i18nAriaLabel));
  }
  for (const reset of document.querySelectorAll('button[data-color-reset]')) {
    reset.setAttribute(
      'aria-label',
      `${getText(currentLanguage, 'settings.resetColor')} ${getStateLabel(currentLanguage, reset.dataset.colorReset)}`,
    );
  }
  for (const { state, key } of colorFields) {
    const label = getStateLabel(currentLanguage, state);
    control(key)?.setAttribute('aria-label', `${label} ${getText(currentLanguage, 'settings.colorPicker')}`);
    control(`${key}_hex`)?.setAttribute('aria-label', `${label} ${getText(currentLanguage, 'settings.colorHex')}`);
  }
  renderPluginStatus();
  renderDiagnostics();
  renderColorPresets();
}

async function refreshDiagnostics() {
  const result = await invokeCommand('get_display_state');
  if (result.ok) renderDiagnostics(result.value);
}

async function loadSettings() {
  const settings = await invokeCommand('get_settings');
  applySettings(settings.ok ? settings.value : DEFAULT_APP_SETTINGS);
  await refreshDiagnostics();
}

const listen = window.__TAURI__?.event?.listen;
if (typeof listen === 'function') {
  listen('settings-changed', ({ payload }) => applySettings(payload)).catch(() => {});
  listen('plugin-operation', ({ payload }) => {
    const status = pluginOperationStatuses[payload];
    if (status) renderPluginStatus(status);
  }).catch(() => {});
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
  if (field.dataset.colorInput || field.dataset.colorHex) continue;
  const event = field.type === 'number' || field.type === 'range' ? 'input' : 'change';
  field.addEventListener(event, saveCurrentSettings);
  if (field.id === 'curve-id') field.addEventListener('change', () => renderFormula());
  if (field.id === 'language') field.addEventListener('change', () => renderLanguage(field.value));
}

for (const { state, key } of colorFields) {
  const picker = control(key);
  const hex = control(`${key}_hex`);
  picker?.addEventListener('focus', () => selectColorState(state));
  hex?.addEventListener('focus', () => selectColorState(state));
  picker?.addEventListener('input', () => {
    selectColorState(state);
    syncColorField(state, picker.value);
    void saveCurrentSettings();
  });
  hex?.addEventListener('input', () => hex.setCustomValidity(''));
  hex?.addEventListener('change', () => {
    const value = hex.value.trim();
    if (!isHexColor(value)) {
      hex.value = picker?.value ?? DEFAULT_APP_SETTINGS[key];
      hex.setCustomValidity(getText(currentLanguage, 'settings.invalidColor'));
      hex.reportValidity?.();
      return;
    }
    const normalized = value.toUpperCase();
    selectColorState(state);
    if (picker) picker.value = normalized;
    hex.value = normalized;
    syncColorField(state, normalized);
    hex.setCustomValidity('');
    void saveCurrentSettings();
  });
}

for (const target of document.querySelectorAll('button[data-color-target]')) {
  target.addEventListener('click', () => selectColorState(target.dataset.colorTarget));
}

for (const reset of document.querySelectorAll('button[data-color-reset]')) {
  reset.addEventListener('click', () => {
    const state = reset.dataset.colorReset;
    const key = STATE_COLOR_KEYS[state];
    if (!key) return;
    const value = DEFAULT_APP_SETTINGS[key];
    const picker = control(key);
    if (picker) picker.value = value;
    selectColorState(state);
    syncColorField(state, value);
    void saveCurrentSettings();
  });
}

async function runPluginAction(command, successStatus) {
  installPluginButton.disabled = true;
  uninstallPluginButton.disabled = true;
  renderPluginStatus('settings.pluginWorking');
  const result = await invokeCommand(command);
  if (result.ok) {
    clearSetupError();
    renderPluginStatus(successStatus);
  } else {
    renderPluginStatus('settings.pluginOperationFailed');
  }
  installPluginButton.disabled = false;
  uninstallPluginButton.disabled = false;
}

installPluginButton.addEventListener('click', () => runPluginAction('install_plugin', 'settings.pluginInstalled'));
uninstallPluginButton.addEventListener('click', () => runPluginAction('uninstall_plugin', 'settings.pluginUninstalled'));

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

selectColorState('idle');
renderColorPresets();
loadSettings();
window.setInterval(refreshDiagnostics, 500);
