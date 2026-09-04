import { formatFormula, getCurveProfile } from './curves.js';
import { DEFAULT_APP_SETTINGS, formatSetupError } from './app.js';
import { createSettingsBridge } from './settings-bridge.js';
import { createSettingsStore } from './settings-store.js';
import {
  COLOR_PRESET_GROUPS,
  isHexColor,
  normalizeHexColor,
  STATE_COLOR_KEYS,
} from './colors.js';
import {
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
  const tabFor = (viewId) => tabs.find((tab) => tab.dataset.viewTarget === viewId);
  const getActiveView = () => tabs.find((tab) => tab.tabIndex === 0)?.dataset.viewTarget ?? viewIds[0];

  function mountSettingsView(viewId) {
    const view = views[viewId];
    const template = view && getTemplate(view);
    if (!view || !template || !host) return false;
    beforeMount(viewId);
    host.replaceChildren(template.content.cloneNode(true));
    const tab = tabFor(viewId);
    host.setAttribute?.('aria-labelledby', tab?.id ?? `settings-tab-${viewId}`);
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
    return selectSettingsView(viewIds[0]);
  }

  return { bind, getActiveView, mountSettingsView, selectSettingsView };
}

const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI__?.invoke;
const listen = window.__TAURI__?.event?.listen;
const settingsPanelHost = document.getElementById('settings-panel-host');
const viewTabs = [...document.querySelectorAll('[data-view-target]')];
const settingsTabAnimation = document.getElementById('settings-tab-animation');
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
    labelKey: 'settings.test',
    bind: () => bindTestActions(),
  },
};
let settingsViewController;
let initialSettingsReady = false;
let pendingInitialSave = false;
let initialSettingsLoadPromise = Promise.resolve();
const localSettingEdits = new Set();

const settingsBridge = createSettingsBridge({
  invoke,
  listen,
  warn: () => {},
  onFailure: (command, error) => showSetupError(command, error),
});
const settingsStore = createSettingsStore({
  defaults: DEFAULT_APP_SETTINGS,
  uiDefaults: {
    activeView: 'appearance',
    selectedColorState: 'idle',
    saveStatus: 'ready',
    setupError: null,
    diagnosticsSnapshot: { state: 'idle', updated_at_ms: 0 },
    invalidColorDrafts: {},
    pluginStatus: 'settings.pluginReady',
    pluginOperationInFlight: false,
  },
  persist: async (settings) => {
    setSaveStatus('saving');
    const result = await settingsBridge.command('save_settings', { settings });
    if (result.ok) {
      for (const key of localSettingEdits) {
        if (Object.is(settingsStore.getSettings()[key], settings[key])) localSettingEdits.delete(key);
      }
      clearSetupError();
      setSaveStatus('saved');
      renderFormula();
    } else {
      setSaveStatus('error');
    }
    return result;
  },
});

const saveStatusKeys = {
  ready: 'settings.saveStatus.ready',
  saving: 'settings.saveStatus.saving',
  saved: 'settings.saveStatus.saved',
  error: 'settings.saveStatus.error',
};

function getCurrentLanguage() {
  return normalizeLanguage(settingsStore.getSettings().language);
}

function showSetupError(command, error) {
  settingsStore.setUi({ setupError: { command, error } });
  renderDiagnostics();
  console.warn(`Codex Halo: ${formatSetupError(command, error)}`);
}

function invokeCommand(command, args) {
  return settingsBridge.command(command, args);
}

function clearSetupError() {
  settingsStore.setUi({ setupError: null });
}

function control(key) {
  return document.getElementById(key.replaceAll('_', '-'));
}

function settingKey(field) {
  return field.dataset?.colorHex
    ? STATE_COLOR_KEYS[field.dataset.colorHex]
    : field.name || field.id.replaceAll('-', '_');
}

function updateSettingsModel(field, local = false) {
  const key = settingKey(field);
  if (!key || !Object.hasOwn(settingsStore.getSettings(), key)) return;
  settingsStore.patchSetting(key, field.type === 'checkbox'
    ? field.checked
    : field.type === 'number' || field.type === 'range'
      ? Number(field.value)
      : field.value);
  if (local && (!initialSettingsReady || document.activeElement === field)) localSettingEdits.add(key);
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
      if (key && isHexColor(field.value)) settingsStore.patchSetting(key, field.value.toUpperCase());
      continue;
    }
    updateSettingsModel(field);
  }
}

function formatRangeValue(key, value) {
  if (!Number.isFinite(value)) return '';
  if (key === 'opacity') return `${Math.round(value * 100)}%`;
  if (key === 'trail_span') return value.toFixed(2);
  if (key === 'stroke_width') return value.toFixed(1);
  if (key === 'duration_ms' || key.endsWith('_duration_ms')) return `${Math.round(value)} ms`;
  return String(Math.round(value));
}

function renderRangeValue(field) {
  if (!field || field.type !== 'range') return;
  const output = document.getElementById(`${field.id}-value`);
  if (!output) return;
  output.textContent = formatRangeValue(settingKey(field), Number(field.value));
}

function renderRangeValues() {
  for (const field of settingsPanelHost?.querySelectorAll?.('input[type="range"]') ?? []) {
    renderRangeValue(field);
  }
}

function syncControlsFromSettings(excluded) {
  const settings = settingsStore.getSettings();
  const { selectedColorState } = settingsStore.getUiState();
  const fields = [
    document.getElementById('language'),
    document.getElementById('enabled'),
    ...(settingsPanelHost?.querySelectorAll?.('input, select') ?? []),
  ];
  for (const field of fields) {
    if (!field || field === excluded || field.dataset.colorHex) continue;
    const value = settings[settingKey(field)];
    if (value === undefined) continue;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = String(value);
  }
  syncColorField(selectedColorState, settings[STATE_COLOR_KEYS[selectedColorState]]);
}

function syncColorField(state, value) {
  const key = STATE_COLOR_KEYS[state];
  const picker = control(key);
  const hex = control(`${key}_hex`);
  const preview = control(`${key}_preview`);
  const normalized = normalizeHexColor(value, DEFAULT_APP_SETTINGS[key]);
  const { invalidColorDrafts = {} } = settingsStore.getUiState();
  const invalidDraft = Object.hasOwn(invalidColorDrafts, state) ? invalidColorDrafts[state] : undefined;
  if (picker && document.activeElement !== picker) picker.value = normalized;
  if (hex && document.activeElement !== hex) {
    if (invalidDraft !== undefined) {
      hex.value = invalidDraft;
      hex.setCustomValidity?.(getText(getCurrentLanguage(), 'settings.invalidColor'));
    } else {
      hex.value = normalized;
      hex.setCustomValidity?.('');
    }
  }
  if (preview) preview.style.backgroundColor = normalized;
}

function clearInvalidColorDraft(state) {
  const { invalidColorDrafts = {} } = settingsStore.getUiState();
  if (!Object.hasOwn(invalidColorDrafts, state)) return;
  const nextDrafts = { ...invalidColorDrafts };
  delete nextDrafts[state];
  settingsStore.setUi({ invalidColorDrafts: nextDrafts });
}

function setInvalidColorDraft(state, value) {
  const { invalidColorDrafts = {} } = settingsStore.getUiState();
  settingsStore.setUi({ invalidColorDrafts: { ...invalidColorDrafts, [state]: value } });
}

function updateColorSetting(state, value, local = false) {
  const key = STATE_COLOR_KEYS[state];
  const normalized = normalizeHexColor(value, DEFAULT_APP_SETTINGS[key]);
  settingsStore.patchSetting(key, normalized);
  clearInvalidColorDraft(state);
  if (local && !initialSettingsReady) localSettingEdits.add(key);
  renderColorStateList();
  syncColorField(state, normalized);
}

function readSettings() {
  syncSettingsModelFromControls();
  return settingsStore.getSettings();
}

function renderColorPresets() {
  const colorPresets = document.getElementById('color-presets');
  if (!colorPresets || typeof document.createElement !== 'function') return;
  colorPresets.replaceChildren();
  const state = settingsStore.getUiState().selectedColorState;
  const language = getCurrentLanguage();
  for (const group of COLOR_PRESET_GROUPS) {
    const section = document.createElement('section');
    section.className = 'color-preset-group';
    const heading = document.createElement('h3');
    heading.textContent = getText(language, group.labelKey);
    const grid = document.createElement('div');
    grid.className = 'color-preset-grid';
    for (const { name, value: color } of group.colors) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'color-swatch';
      button.setAttribute('title', name);
      button.setAttribute('aria-label', name);
      const chip = document.createElement('span');
      chip.className = 'color-swatch-chip';
      chip.style.backgroundColor = color;
      const label = document.createElement('span');
      label.textContent = name;
      button.append(chip, label);
      button.addEventListener('click', () => {
        updateColorSetting(state, color, true);
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
  const settings = settingsStore.getSettings();
  const { selectedColorState } = settingsStore.getUiState();
  const language = getCurrentLanguage();
  const focusedState = [...(tabs.children ?? [])]
    .find((row) => row === document.activeElement)?.dataset?.colorState;
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
    swatch.style.backgroundColor = settings[key];
    swatch.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'color-state-row-copy';
    const label = document.createElement('strong');
    label.className = 'color-state-row-label';
    label.textContent = getStateLabel(language, state);
    const value = document.createElement('span');
    value.className = 'color-state-row-hex';
    value.textContent = normalizeHexColor(settings[key], DEFAULT_APP_SETTINGS[key]);
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
  if (focusedState) document.getElementById(`color-tab-${focusedState}`)?.focus();
}

function mountColorStateDetail(state = settingsStore.getUiState().selectedColorState) {
  const panel = document.getElementById('color-state-panel');
  const key = STATE_COLOR_KEYS[state];
  if (!panel || !key) return;
  const language = getCurrentLanguage();
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
  label.textContent = getStateLabel(language, state);
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
  reset.textContent = getText(language, 'settings.resetColor');
  editor.append(picker, hex, reset);
  panel.append(summary, editor);

  bindColorEditor(state, picker, hex, reset);
  syncColorField(state, settingsStore.getSettings()[key]);
}

function selectColorState(state, focus = false) {
  if (!STATE_COLOR_KEYS[state]) return;
  syncSettingsModelFromControls();
  settingsStore.setUi({ selectedColorState: state });
  renderColorStateList();
  mountColorStateDetail(state);
  renderColorPresets();
  if (focus) document.getElementById(`color-tab-${state}`)?.focus();
}

function renderFormula(settings = settingsStore.getSettings()) {
  const formula = document.getElementById('formula');
  if (!formula) return;
  const profile = getCurveProfile(settings.curve_id);
  formula.textContent = formatFormula(profile, settings);
}

function renderOpacity() {
  renderRangeValue(control('opacity'));
}

function setSaveStatus(status) {
  const saveStatus = saveStatusKeys[status] ? status : 'ready';
  settingsStore.setUi({ saveStatus });
  const language = getCurrentLanguage();
  for (const element of saveStatusElements) {
    element.dataset.status = saveStatus;
    element.textContent = getText(language, saveStatusKeys[saveStatus]);
  }
}

function renderPluginStatus(status) {
  const currentStatus = settingsStore.getUiState().pluginStatus;
  const nextStatus = status ?? currentStatus;
  if (status !== undefined) settingsStore.setUi({ pluginStatus: nextStatus });
  const language = getCurrentLanguage();
  const pluginStatus = document.getElementById('plugin-status');
  if (pluginStatus) pluginStatus.textContent = getText(language, nextStatus);
}

function renderDiagnostics(displayState = {}) {
  const { diagnosticsSnapshot = { state: 'idle', updated_at_ms: 0 }, setupError } = settingsStore.getUiState();
  const nextSnapshot = {
    state: displayState.state ?? diagnosticsSnapshot.state,
    updated_at_ms: displayState.updated_at_ms ?? diagnosticsSnapshot.updated_at_ms,
  };
  settingsStore.setUi({ diagnosticsSnapshot: nextSnapshot });
  const language = getCurrentLanguage();
  const state = getStateLabel(language, nextSnapshot.state);
  const updatedAt = Number(nextSnapshot.updated_at_ms);
  const timestamp = Number.isFinite(updatedAt) && updatedAt > 0
    ? new Date(updatedAt).toLocaleString(localeForLanguage(language))
    : getText(language, 'settings.diagnosticsNever');
  const detail = `${getText(language, 'settings.diagnosticsState')}: ${state} | ${getText(language, 'settings.diagnosticsLastEvent')}: ${timestamp}`;
  const diagnostics = document.getElementById('diagnostics');
  if (!diagnostics) return;
  if (!setupError) {
    diagnostics.textContent = detail;
    return;
  }
  const formattedError = formatSetupError(setupError.command, setupError.error, language);
  diagnostics.textContent = `${detail} | ${getText(language, 'settings.diagnosticsSetupError')}: ${formattedError}`;
}

function renderLanguage(language = settingsStore.getSettings().language) {
  const currentLanguage = normalizeLanguage(language);
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
  if (settingsStore.getUiState().activeView === 'colors') {
    const { selectedColorState } = settingsStore.getUiState();
    renderColorStateList();
    const label = document.querySelector?.('[data-color-state-label]');
    if (label) label.textContent = getStateLabel(currentLanguage, selectedColorState);
    syncColorField(selectedColorState, settingsStore.getSettings()[STATE_COLOR_KEYS[selectedColorState]]);
  }
  renderPluginStatus();
  renderDiagnostics();
  setSaveStatus(settingsStore.getUiState().saveStatus);
  renderColorPresets();
}

function applySettings(settings, { preserveLocalEdits = false } = {}) {
  if (!settings) return;
  const activeField = document.activeElement;
  const activeKey = activeField && settingKey(activeField);
  const preserveActiveField = localSettingEdits.has(activeKey);
  const incoming = {
    ...settings,
    language: normalizeLanguage(settings.language ?? settingsStore.getSettings().language),
  };
  if (preserveActiveField && activeKey && Object.hasOwn(settingsStore.getSettings(), activeKey)) {
    delete incoming[activeKey];
  }
  if (preserveLocalEdits || localSettingEdits.size > 0) {
    for (const key of localSettingEdits) delete incoming[key];
  }
  const nextSettings = settingsStore.mergeSettings(incoming);
  const { selectedColorState } = settingsStore.getUiState();
  syncControlsFromSettings(preserveActiveField ? activeField : undefined);
  renderLanguage(nextSettings.language);
  renderRangeValues();
  renderFormula(nextSettings);
  syncColorField(selectedColorState, nextSettings[STATE_COLOR_KEYS[selectedColorState]]);
}

async function refreshDiagnostics() {
  if (typeof invoke !== 'function') return;
  const result = await invokeCommand('get_display_state');
  if (result.ok) renderDiagnostics(result.value);
}

async function loadSettings() {
  const result = await settingsStore.enqueue(async () => {
    const settings = await invokeCommand('get_settings');
    applySettings(settings.ok ? settings.value : DEFAULT_APP_SETTINGS, { preserveLocalEdits: true });
    initialSettingsReady = true;
    return settings;
  });
  try {
    if (pendingInitialSave) {
      pendingInitialSave = false;
      await settingsStore.saveLatest();
    }
  } finally {
    localSettingEdits.clear();
  }
  await refreshDiagnostics();
  return result;
}

const settingsChangedSubscription = settingsBridge.subscribe(
  'settings-changed',
  ({ payload }) => settingsStore.enqueue(() => applySettings(payload)),
);
settingsChangedSubscription?.catch?.(() => {});
const pluginOperationSubscription = settingsBridge.subscribe('plugin-operation', ({ payload }) => {
  const status = pluginOperationStatuses[payload];
  if (status) renderPluginStatus(status);
});
pluginOperationSubscription?.catch?.(() => {});

function saveCurrentSettings() {
  readSettings();
  if (!initialSettingsReady) {
    pendingInitialSave = true;
    return initialSettingsLoadPromise;
  }
  return settingsStore.save();
}

async function runPluginAction(command, successStatus) {
  if (settingsStore.getUiState().pluginOperationInFlight) return;
  settingsStore.setUi({ pluginOperationInFlight: true });
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
    settingsStore.setUi({ pluginOperationInFlight: false });
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
      updateSettingsModel(field, true);
      if (field.id === 'curve-id') renderFormula();
      renderRangeValue(field);
      if (field.id === 'language') renderLanguage(field.value);
      void saveCurrentSettings();
    });
  }
}

function bindColorEditor(state, picker, hex, reset) {
  const key = STATE_COLOR_KEYS[state];
  const language = getCurrentLanguage();
  const label = getStateLabel(language, state);
  picker.setAttribute('aria-label', `${label} ${getText(language, 'settings.colorPicker')}`);
  hex.setAttribute('aria-label', `${label} ${getText(language, 'settings.colorHex')}`);
  reset.setAttribute('aria-label', `${getText(language, 'settings.resetColor')} ${label}`);
  picker.addEventListener('input', () => {
    updateColorSetting(state, picker.value, true);
    void saveCurrentSettings();
  });
  hex.addEventListener('input', () => {
    const value = hex.value.trim();
    if (isHexColor(value)) clearInvalidColorDraft(state);
    else setInvalidColorDraft(state, hex.value);
    hex.setCustomValidity('');
  });
  hex.addEventListener('change', () => {
    const value = hex.value.trim();
    if (!isHexColor(value)) {
      setInvalidColorDraft(state, hex.value);
      hex.setCustomValidity(getText(getCurrentLanguage(), 'settings.invalidColor'));
      hex.reportValidity?.();
      return;
    }
    updateColorSetting(state, value.toUpperCase(), true);
    hex.setCustomValidity('');
    void saveCurrentSettings();
  });
  reset.addEventListener('click', () => {
    updateColorSetting(state, DEFAULT_APP_SETTINGS[key], true);
    void saveCurrentSettings();
  });
}

function bindIntegrationActions() {
  document.getElementById('install-plugin')?.addEventListener('click', () => runPluginAction('install_plugin', 'settings.pluginInstalled'));
  document.getElementById('uninstall-plugin')?.addEventListener('click', () => runPluginAction('uninstall_plugin', 'settings.pluginUninstalled'));
  setPluginButtonsDisabled(settingsStore.getUiState().pluginOperationInFlight);
  document.getElementById('export-diagnostics')?.addEventListener('click', () => {
    const { diagnosticsSnapshot } = settingsStore.getUiState();
    const payload = {
      state: diagnosticsSnapshot.state,
      updated_at_ms: diagnosticsSnapshot.updated_at_ms,
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
    await settingsStore.enqueue(async () => {
      const result = await invokeCommand('reset_position');
      if (!result.ok) return result;
      clearSetupError();
      applySettings(result.value);
      return result;
    });
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

settingsTabAnimation?.addEventListener('click', () => selectSettingsView('appearance', true));

bindSettingsFields(document);
settingsViewController = createSettingsViewController({
  views: SETTINGS_VIEWS,
  host: settingsPanelHost,
  tabs: viewTabs,
  getTemplate: (view) => document.querySelector?.(`[data-view-template="${view.template}"]`),
  beforeMount: syncSettingsModelFromControls,
  afterMount: (viewId) => {
    settingsStore.setUi({ activeView: viewId });
    syncControlsFromSettings();
    renderLanguage();
    renderRangeValues();
    renderFormula();
    renderPluginStatus();
    renderDiagnostics();
    setPluginButtonsDisabled(settingsStore.getUiState().pluginOperationInFlight);
  },
});
settingsViewController.bind();
initialSettingsLoadPromise = loadSettings();
window.setInterval(refreshDiagnostics, 500);
