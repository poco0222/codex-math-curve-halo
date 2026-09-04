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

export function createSettingsViewController({
  views,
  host,
  tabs,
  getTemplate,
  beforeMount = () => {},
  afterMount = () => {},
}) {
  const viewIds = Object.keys(views);
  let activeView = viewIds[0];
  const tabFor = (viewId) => tabs.find((tab) => tab.dataset.viewTarget === viewId);

  function mountSettingsView(viewId) {
    const view = views[viewId];
    const template = view && getTemplate(view);
    if (!view || !template || !host) return false;
    beforeMount(viewId);
    host.replaceChildren(template.content.cloneNode(true));
    const tab = tabFor(viewId);
    host.setAttribute?.('aria-labelledby', tab?.id ?? `settings-tab-${viewId}`);
    activeView = viewId;
    view.bind();
    afterMount(viewId);
    return true;
  }

  function selectSettingsView(viewId, focus = false) {
    if (!views[viewId]) return false;
    for (const tab of tabs) {
      const selected = tab.dataset.viewTarget === viewId;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    if (!mountSettingsView(viewId)) return false;
    if (focus) tabFor(viewId)?.focus();
    return true;
  }

  function bind() {
    for (const tab of tabs) {
      tab.addEventListener('click', () => selectSettingsView(tab.dataset.viewTarget, true));
      tab.addEventListener('keydown', (event) => {
        const index = viewIds.indexOf(tab.dataset.viewTarget);
        const next = event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? (index + 1) % viewIds.length
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? (index - 1 + viewIds.length) % viewIds.length
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? viewIds.length - 1
                : -1;
        if (next < 0) return;
        event.preventDefault();
        selectSettingsView(viewIds[next], true);
      });
    }
    return mountSettingsView(activeView);
  }

  return { bind, getActiveView: () => activeView, mountSettingsView, selectSettingsView };
}

const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI__?.invoke;
const settingsPanelHost = document.getElementById('settings-panel-host');
const viewTabs = [...document.querySelectorAll('[data-view-target]')];
const pluginOperationStatuses = {
  installed: 'settings.pluginInstalled',
  uninstalled: 'settings.pluginUninstalled',
  failed: 'settings.pluginOperationFailed',
};
const saveStatus = document.getElementById('settings-save-status');
const saveStatusElements = saveStatus ? [saveStatus] : [];
const colorFields = Object.entries(STATE_COLOR_KEYS).map(([state, key]) => ({ state, key }));
const SETTINGS_VIEWS = {
  appearance: {
    template: 'appearance',
    labelKey: 'settings.appearance',
    bind: () => bindSettingsFields(settingsPanelHost),
  },
  colors: {
    template: 'colors',
    labelKey: 'settings.colors',
    bind: () => {
      renderColorStateList();
      mountColorStateDetail();
      bindSettingsFields(settingsPanelHost);
    },
  },
  integration: {
    template: 'integration',
    labelKey: 'settings.integration',
    bind: () => {
      bindSettingsFields(settingsPanelHost);
      bindIntegrationActions();
    },
  },
  test: {
    template: 'test',
    labelKey: 'settings.simulateState',
    bind: () => bindTestActions(),
  },
};
let settingsViewController;
let selectedColorState = 'idle';
let settingsModel = { ...DEFAULT_APP_SETTINGS };
let currentLanguage = DEFAULT_LANGUAGE;
let currentPluginStatus = 'settings.pluginReady';
let pluginOperationInFlight = false;
let currentSaveStatus = 'ready';
let setupError = null;
let currentDisplayState = { state: 'idle', updated_at_ms: 0 };
const saveSettings = createSerialTaskQueue();

const saveStatusKeys = {
  ready: 'settings.saveStatus.ready',
  saving: 'settings.saveStatus.saving',
  saved: 'settings.saveStatus.saved',
  error: 'settings.saveStatus.error',
};

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

function settingKey(field) {
  return field.name || field.id.replaceAll('-', '_');
}

function updateSettingsModel(field) {
  const key = settingKey(field);
  if (!key || !Object.hasOwn(settingsModel, key)) return;
  settingsModel[key] = field.type === 'checkbox'
    ? field.checked
    : field.type === 'number' || field.type === 'range'
      ? Number(field.value)
      : field.value;
}

function syncSettingsModelFromControls() {
  const fields = [
    document.getElementById('language'),
    document.getElementById('enabled'),
    ...(settingsPanelHost?.querySelectorAll?.('input, select') ?? []),
  ];
  for (const field of fields) {
    if (!field) continue;
    if (field.dataset.colorHex) {
      const key = STATE_COLOR_KEYS[field.dataset.colorHex];
      if (key && isHexColor(field.value)) settingsModel[key] = field.value.toUpperCase();
      continue;
    }
    updateSettingsModel(field);
  }
}

function syncControlsFromSettings(excluded) {
  const fields = [
    document.getElementById('language'),
    document.getElementById('enabled'),
    ...(settingsPanelHost?.querySelectorAll?.('input, select') ?? []),
  ];
  for (const field of fields) {
    if (!field || field === excluded || field.dataset.colorHex) continue;
    const value = settingsModel[settingKey(field)];
    if (value === undefined) continue;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = String(value);
  }
  syncColorField(selectedColorState, settingsModel[STATE_COLOR_KEYS[selectedColorState]]);
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

function updateColorSetting(state, value) {
  const key = STATE_COLOR_KEYS[state];
  const normalized = normalizeHexColor(value, DEFAULT_APP_SETTINGS[key]);
  settingsModel[key] = normalized;
  syncColorField(state, normalized);
}

function readSettings() {
  syncSettingsModelFromControls();
  return { ...settingsModel };
}

function renderColorPresets() {
  const colorPresets = document.getElementById('color-presets');
  if (!colorPresets || typeof document.createElement !== 'function') return;
  colorPresets.replaceChildren();
  const state = selectedColorState;
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
        updateColorSetting(state, color);
        void saveCurrentSettings();
      });
      grid.append(button);
    }
    section.append(heading, grid);
    colorPresets.append(section);
  }
}

function renderColorStateList() {
  const tabs = document.getElementById('color-state-tabs');
  if (!tabs) return;
  tabs.replaceChildren();
  for (const { state, key } of colorFields) {
    const tab = document.createElement('button');
    tab.id = `color-tab-${state}`;
    tab.type = 'button';
    tab.className = 'color-state-tab color-state-row';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(state === selectedColorState));
    tab.setAttribute('aria-controls', 'color-state-panel');
    tab.dataset.colorState = state;
    tab.tabIndex = state === selectedColorState ? 0 : -1;
    const swatch = document.createElement('span');
    swatch.className = 'color-state-row-swatch';
    swatch.style.backgroundColor = settingsModel[key];
    swatch.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'color-state-row-copy';
    const label = document.createElement('strong');
    label.className = 'color-state-row-label';
    label.textContent = getStateLabel(currentLanguage, state);
    const value = document.createElement('span');
    value.className = 'color-state-row-hex';
    value.textContent = normalizeHexColor(settingsModel[key], DEFAULT_APP_SETTINGS[key]);
    copy.append(label, value);
    tab.append(swatch, copy);
    tab.addEventListener('click', () => selectColorState(state, true));
    tab.addEventListener('keydown', (event) => {
      const index = colorFields.findIndex((item) => item.state === state);
      const next = event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (index + 1) % colorFields.length
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (index - 1 + colorFields.length) % colorFields.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? colorFields.length - 1
              : -1;
      if (next < 0) return;
      event.preventDefault();
      selectColorState(colorFields[next].state, true);
    });
    tabs.append(tab);
  }
}

function mountColorStateDetail(state = selectedColorState) {
  const panel = document.getElementById('color-state-panel');
  const key = STATE_COLOR_KEYS[state];
  if (!panel || !key) return;
  panel.replaceChildren();
  panel.setAttribute('aria-labelledby', `color-tab-${state}`);

  const summary = document.createElement('div');
  summary.className = 'color-editor-summary';
  const preview = document.createElement('span');
  preview.id = `${key.replaceAll('_', '-')}-preview`;
  preview.className = 'state-color-preview';
  preview.setAttribute('aria-hidden', 'true');
  const label = document.createElement('strong');
  label.dataset.colorStateLabel = state;
  label.textContent = getStateLabel(currentLanguage, state);
  summary.append(preview, label);

  const editor = document.createElement('div');
  editor.className = 'color-editor';
  const picker = document.createElement('input');
  picker.id = key.replaceAll('_', '-');
  picker.name = key;
  picker.type = 'color';
  picker.dataset.colorInput = 'true';
  const hex = document.createElement('input');
  hex.id = `${key.replaceAll('_', '-')}-hex`;
  hex.name = `${key}_hex`;
  hex.type = 'text';
  hex.maxLength = 7;
  hex.pattern = '^#[0-9A-Fa-f]{6}$';
  hex.inputMode = 'text';
  hex.dataset.colorHex = state;
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.dataset.colorReset = state;
  reset.dataset.i18n = 'settings.resetColor';
  reset.textContent = getText(currentLanguage, 'settings.resetColor');
  editor.append(picker, hex, reset);
  panel.append(summary, editor);

  bindColorEditor(state, picker, hex, reset);
  syncColorField(state, settingsModel[key]);
}

function mountColorState(state = selectedColorState) {
  return mountColorStateDetail(state);
}

function selectColorState(state, focus = false) {
  if (!STATE_COLOR_KEYS[state]) return;
  syncSettingsModelFromControls();
  selectedColorState = state;
  renderColorStateList();
  mountColorStateDetail(state);
  renderColorPresets();
  if (focus) document.getElementById(`color-tab-${state}`)?.focus();
}

function renderFormula(settings = settingsModel) {
  const formula = document.getElementById('formula');
  if (!formula) return;
  const profile = getCurveProfile(settings.curve_id);
  formula.textContent = formatFormula(profile, settings);
}

function renderOpacity() {
  const opacityValue = document.getElementById('opacity-value');
  if (!opacityValue) return;
  const value = Number(control('opacity')?.value);
  if (Number.isFinite(value)) opacityValue.textContent = `${Math.round(value * 100)}%`;
}

function setSaveStatus(status) {
  currentSaveStatus = saveStatusKeys[status] ? status : 'ready';
  for (const element of saveStatusElements) {
    element.dataset.status = currentSaveStatus;
    element.textContent = getText(currentLanguage, saveStatusKeys[currentSaveStatus]);
  }
}

function renderPluginStatus(status = currentPluginStatus) {
  currentPluginStatus = status;
  const pluginStatus = document.getElementById('plugin-status');
  if (pluginStatus) pluginStatus.textContent = getText(currentLanguage, status);
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
  const diagnostics = document.getElementById('diagnostics');
  if (!diagnostics) return;
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
  for (const [viewId, view] of Object.entries(SETTINGS_VIEWS)) {
    const tab = viewTabs.find((candidate) => candidate.dataset.viewTarget === viewId);
    if (tab) tab.textContent = getText(currentLanguage, view.labelKey);
  }
  if (settingsViewController?.getActiveView() === 'colors') {
    renderColorStateList();
    const label = document.querySelector?.('[data-color-state-label]');
    if (label) label.textContent = getStateLabel(currentLanguage, selectedColorState);
  }
  renderPluginStatus();
  renderDiagnostics();
  setSaveStatus(currentSaveStatus);
  renderColorPresets();
}

function applySettings(settings) {
  if (!settings) return;
  settingsModel = {
    ...settingsModel,
    ...settings,
    language: normalizeLanguage(settings.language ?? settingsModel.language),
  };
  syncControlsFromSettings(document.activeElement);
  renderLanguage(settingsModel.language);
  renderOpacity();
  renderFormula(settingsModel);
  syncColorField(selectedColorState, settingsModel[STATE_COLOR_KEYS[selectedColorState]]);
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
  return saveSettings(async () => {
    setSaveStatus('saving');
    const result = await invokeCommand('save_settings', { settings });
    if (result.ok) {
      clearSetupError();
      setSaveStatus('saved');
      renderFormula();
      return;
    }
    setSaveStatus('error');
  });
}

async function runPluginAction(command, successStatus) {
  if (pluginOperationInFlight) return;
  pluginOperationInFlight = true;
  setPluginButtonsDisabled(true);
  renderPluginStatus('settings.pluginWorking');
  try {
    const result = await invokeCommand(command);
    if (result.ok) {
      clearSetupError();
      renderPluginStatus(successStatus);
    } else {
      renderPluginStatus('settings.pluginOperationFailed');
    }
  } finally {
    pluginOperationInFlight = false;
    setPluginButtonsDisabled(false);
  }
}

function setPluginButtonsDisabled(disabled) {
  document.getElementById('install-plugin')?.toggleAttribute('disabled', disabled);
  document.getElementById('uninstall-plugin')?.toggleAttribute('disabled', disabled);
}

function bindSettingsFields(root) {
  for (const field of root.querySelectorAll('input, select')) {
    if (field.dataset.colorInput || field.dataset.colorHex) continue;
    const event = field.type === 'number' || field.type === 'range' ? 'input' : 'change';
    field.addEventListener(event, () => {
      updateSettingsModel(field);
      if (field.id === 'curve-id') renderFormula(settingsModel);
      if (field.id === 'opacity') renderOpacity();
      if (field.id === 'language') renderLanguage(field.value);
      void saveCurrentSettings();
    });
  }
}

function bindColorEditor(state, picker, hex, reset) {
  const key = STATE_COLOR_KEYS[state];
  const label = getStateLabel(currentLanguage, state);
  picker.setAttribute('aria-label', `${label} ${getText(currentLanguage, 'settings.colorPicker')}`);
  hex.setAttribute('aria-label', `${label} ${getText(currentLanguage, 'settings.colorHex')}`);
  reset.setAttribute('aria-label', `${getText(currentLanguage, 'settings.resetColor')} ${label}`);
  picker.addEventListener('input', () => {
    updateColorSetting(state, picker.value);
    void saveCurrentSettings();
  });
  hex.addEventListener('input', () => hex.setCustomValidity(''));
  hex.addEventListener('change', () => {
    const value = hex.value.trim();
    if (!isHexColor(value)) {
      hex.value = settingsModel[key];
      hex.setCustomValidity(getText(currentLanguage, 'settings.invalidColor'));
      hex.reportValidity?.();
      return;
    }
    updateColorSetting(state, value.toUpperCase());
    hex.setCustomValidity('');
    void saveCurrentSettings();
  });
  reset.addEventListener('click', () => {
    updateColorSetting(state, DEFAULT_APP_SETTINGS[key]);
    void saveCurrentSettings();
  });
}

function bindIntegrationActions() {
  document.getElementById('install-plugin')?.addEventListener('click', () => runPluginAction('install_plugin', 'settings.pluginInstalled'));
  document.getElementById('uninstall-plugin')?.addEventListener('click', () => runPluginAction('uninstall_plugin', 'settings.pluginUninstalled'));
  setPluginButtonsDisabled(pluginOperationInFlight);
  document.getElementById('export-diagnostics')?.addEventListener('click', () => {
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
  document.getElementById('reset-position')?.addEventListener('click', async () => {
    const result = await saveSettings(() => invokeCommand('reset_position'));
    if (result.ok) {
      clearSetupError();
      applySettings(result.value);
    }
  });
}

function bindTestActions() {
  if (!settingsPanelHost) return;
  for (const button of settingsPanelHost.querySelectorAll('[data-state]')) {
    button.addEventListener('click', async () => {
      const result = await invokeCommand('simulate_state', { state: button.dataset.state });
      if (result.ok) {
        clearSetupError();
        renderDiagnostics(result.value);
      }
    });
  }
}

function mountSettingsView(viewId) {
  return settingsViewController?.mountSettingsView(viewId) ?? false;
}

function selectSettingsView(viewId, focus = false) {
  return settingsViewController?.selectSettingsView(viewId, focus) ?? false;
}

bindSettingsFields(document);
settingsViewController = createSettingsViewController({
  views: SETTINGS_VIEWS,
  host: settingsPanelHost,
  tabs: viewTabs,
  getTemplate: (view) => document.querySelector?.(`[data-view-template="${view.template}"]`),
  beforeMount: syncSettingsModelFromControls,
  afterMount: () => {
    syncControlsFromSettings();
    renderLanguage(currentLanguage);
    renderOpacity();
    renderFormula(settingsModel);
    renderPluginStatus();
    renderDiagnostics();
  },
});
settingsViewController.bind();
loadSettings();
window.setInterval(refreshDiagnostics, 500);
