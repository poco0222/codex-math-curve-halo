import { formatFormula, getCurveAnimationSettings, getCurveParameterSettings, getCurveProfile } from './curves.js';
import { DEFAULT_APP_SETTINGS, formatSetupError } from './app.js';
import { createSettingsBridge } from './settings-bridge.js';
import { createSettingsStore } from './settings-store.js';
import { createAudioFrameReceiver } from './audio.js';
import { createCurvePicker, createCurveSelection } from './curve-picker.js';
import { createSettingsPreview } from './settings-preview.js';
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
    bind: () => {
      renderCurveParameters();
      renderColorStateList();
      mountColorStateDetail();
      bindSettingsFields(settingsPanelHost);
      document.getElementById('undo-curve')?.addEventListener('click', undoCurveChange);
      document.getElementById('audio-retry')?.addEventListener('click', retryAudioCapture);
      settingsPreview = createSettingsPreview(document.getElementById('settings-preview'));
      curvePicker = createCurvePicker({ root: settingsPanelHost, store: settingsStore, selection: curveSelection, isReady: () => initialSettingsReady, onOpenChange: (open) => settingsPreview?.setPaused(open) });
    },
  },
  integration: {
    template: 'integration',
    labelKey: 'settings.integration',
    bind: () => {
      bindSettingsFields(settingsPanelHost);
      bindIntegrationActions();
      bindTestActions();
    },
  },
};
let settingsViewController;
let curvePicker;
let settingsPreview;
let initialSettingsReady = false;
let pendingInitialSave = false;
let initialSettingsLoadPromise = Promise.resolve();
const localSettingEdits = new Set();
const curveRestoreKeys = ['curve_id', 'curve_parameters', 'particle_count', 'trail_span', 'duration_ms', 'pulse_duration_ms', 'rotation_duration_ms', 'stroke_width'];
let curveRestoreSnapshot = null;
let curveRestorePending = false;
let curveRestoreApplied = false;
let settingsRetryPending = false;
let setupGuideDismissed = false;

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
    selectedColorState: 'thinking',
    saveStatus: 'ready',
    setupError: null,
    diagnosticsSnapshot: { state: 'idle', updated_at_ms: 0 },
    invalidColorDrafts: {},
    pluginStatus: 'settings.pluginReady',
    pluginOperationInFlight: false,
    curveApplying: false,
    curveApplyError: false,
    audioFrame: null,
    audioRetryPending: false,
    audioBridgeFailed: false,
  },
  persist: async (settings) => {
    setSaveStatus('saving');
    const result = await settingsBridge.command('save_settings', { settings });
    if (result.ok) {
      settingsStore.setUi({ curveApplyError: false });
      for (const key of localSettingEdits) {
        const current = settingsStore.getSettings()[key];
        const saved = settings[key];
        const same = key === 'curve_parameters'
          ? Object.keys(current).length === Object.keys(saved).length && Object.keys(current).every((name) => Object.is(current[name], saved[name]))
          : Object.is(current, saved);
        if (same) localSettingEdits.delete(key);
      }
      clearSetupError();
      setSaveStatus('saved');
      renderFormula();
    } else {
      if (localSettingEdits.has('curve_parameters')) settingsStore.setUi({ curveApplyError: true });
      setSaveStatus('error');
    }
    return result;
  },
});

const curveSelection = createCurveSelection({
  store: settingsStore,
  changeCurve(id) {
    readSettings();
    curveRestoreSnapshot = curveSnapshot(settingsStore.getSettings());
    curveRestoreApplied = false;
    settingsStore.patchSetting('curve_id', id);
    localSettingEdits.add('curve_id');
    restoreCurveParameters();
    syncControlsFromSettings();
    restoreCurveAnimation();
    renderCurveRestore();
    curvePicker?.render();
  },
  save: () => saveCurrentSettings({ latest: true }),
  onChange: () => { curvePicker?.render(); renderCurveRestore(); },
});

function curveSnapshot(settings) {
  return Object.fromEntries(curveRestoreKeys.map((key) => [key, structuredClone(settings[key])]));
}

function renderCurveRestore() {
  const button = document.getElementById('undo-curve');
  if (!button) return;
  button.hidden = !curveRestoreSnapshot;
  button.disabled = curveRestorePending || curveSelection.pending;
}

async function undoCurveChange() {
  if (!curveRestoreSnapshot || curveRestorePending || curveSelection.pending) return;
  const snapshot = curveRestoreSnapshot;
  readSettings();
  settingsStore.mergeSettings(snapshot);
  for (const key of curveRestoreKeys) localSettingEdits.add(key);
  curveRestorePending = true;
  curveRestoreApplied = true;
  syncControlsFromSettings();
  renderLanguage();
  renderRangeValues();
  renderFormula();
  renderCurveRestore();
  const result = await saveCurrentSettings({ latest: true });
  curveRestorePending = false;
  if (result?.ok && curveRestoreSnapshot === snapshot) curveRestoreSnapshot = null;
  renderCurveRestore();
  return result;
}

function bindSetupGuide() {
  const guide = document.getElementById('setup-guide');
  if (!guide) return;
  try { setupGuideDismissed = window.localStorage?.getItem('halo-setup-guide-dismissed') === 'true'; }
  catch { setupGuideDismissed = false; }
  renderSetupGuide();
  document.getElementById('dismiss-setup-guide')?.addEventListener('click', () => {
    setupGuideDismissed = true;
    renderSetupGuide();
    try { window.localStorage?.setItem('halo-setup-guide-dismissed', 'true'); } catch { /* Storage is optional for this hint. */ }
  });
  document.getElementById('open-connection-guide')?.addEventListener('click', () => selectSettingsView('integration', true));
}

function renderSetupGuide() {
  const guide = document.getElementById('setup-guide');
  if (guide) guide.hidden = setupGuideDismissed || settingsStore.getUiState().activeView !== 'appearance';
}

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
  if (field.dataset?.curveParameter) return 'curve_parameters';
  return field.dataset?.colorHex
    ? STATE_COLOR_KEYS[field.dataset.colorHex]
    : field.name || field.id.replaceAll('-', '_');
}

function updateSettingsModel(field, local = false) {
  const key = settingKey(field);
  if (!key || !Object.hasOwn(settingsStore.getSettings(), key)) return;
  if (field.dataset.curveParameter) {
    // Mounting and unrelated saves must not round parameters through the range element.
    if (!local) return;
    const settings = settingsStore.getSettings();
    settingsStore.patchSetting('curve_parameters', getCurveParameterSettings(settings.curve_id, {
      ...settings.curve_parameters,
      [field.dataset.curveParameter]: Number(field.value),
    }));
    localSettingEdits.add('curve_parameters');
    return;
  }
  // Only user input may round legacy or preset durations to whole seconds.
  if (!local && ['seconds', 'percent'].includes(field.dataset.unit)) return;
  settingsStore.patchSetting(key, field.type === 'checkbox'
    ? field.checked
    : field.type === 'number' || field.type === 'range'
      ? field.dataset.unit === 'seconds' ? Math.round(Number(field.value) * 1000)
        : field.dataset.unit === 'percent' ? Math.max(0, Math.min(100, Number(field.value))) / 100 : Number(field.value)
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
  if (key === 'duration_ms' || key.endsWith('_duration_ms')) return `${value / 1000} s`;
  return String(Math.round(value));
}

function renderRangeValue(field) {
  if (!field || field.type !== 'range') return;
  const output = document.getElementById(`${field.id}-value`);
  if (!output) return;
  const key = settingKey(field);
  if (field.dataset.curveParameter) {
    const precision = (String(field.step).split('.')[1] ?? '').length;
    output.textContent = Number(field.value).toFixed(precision);
    field.setAttribute('aria-valuetext', output.textContent);
    return;
  }
  const seconds = field.dataset.unit === 'seconds';
  if (field.dataset.unit === 'percent') {
    output.textContent = `${Math.round(Number(field.value))}%`;
    field.setAttribute('aria-valuetext', output.textContent);
    return;
  }
  output.textContent = formatRangeValue(key, seconds ? settingsStore.getSettings()[key] : Number(field.value));
  if (seconds) field.setAttribute('aria-valuetext', output.textContent);
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
    if (!field || field === excluded || field.dataset.colorHex || field.dataset.curveParameter) continue;
    const value = settings[settingKey(field)];
    if (value === undefined) continue;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = String(field.dataset.unit === 'seconds' ? value / 1000 : field.dataset.unit === 'percent' ? value * 100 : value);
  }
  syncColorField(selectedColorState, settings[STATE_COLOR_KEYS[selectedColorState]]);
}

function renderCurveParameters() {
  const host = document.getElementById('curve-parameters');
  if (!host) return;
  const settings = settingsStore.getSettings();
  const profile = getCurveProfile(settings.curve_id);
  if (host.dataset.curveId !== profile.id) {
    host.replaceChildren(...profile.controls.map(({ key, min, max, step }) => {
      const row = document.createElement('div');
      row.className = 'range-field';
      const heading = document.createElement('div');
      heading.className = 'field-label-row';
      const label = document.createElement('label');
      const field = document.createElement('input');
      field.id = `curve-parameter-${key}`;
      field.type = 'range';
      field.dataset.curveParameter = key;
      field.min = String(min);
      field.max = String(max);
      field.step = String(step);
      label.htmlFor = field.id;
      const output = document.createElement('output');
      output.id = `${field.id}-value`;
      output.setAttribute('for', field.id);
      heading.append(label, output);
      row.append(heading, field);
      return row;
    }));
    host.dataset.curveId = profile.id;
  }
  const parameters = getCurveParameterSettings(profile.id, settings.curve_parameters);
  for (const definition of profile.controls) {
    const field = document.getElementById(`curve-parameter-${definition.key}`);
    field.previousElementSibling.querySelector('label').textContent = settings.language === 'zh-CN' ? definition.labelZh : definition.labelEn;
    field.value = String(parameters[definition.key]);
    renderRangeValue(field);
  }
}

function restoreCurveParameters() {
  settingsStore.patchSetting('curve_parameters', getCurveParameterSettings(settingsStore.getSettings().curve_id));
  localSettingEdits.add('curve_parameters');
  renderCurveParameters();
  renderFormula();
  curvePicker?.render();
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
  renderSettingsPreview();
  if (focus) document.getElementById(`color-tab-${state}`)?.focus();
}

function renderFormula(settings = settingsStore.getSettings()) {
  renderSettingsPreview();
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
  const retry = document.getElementById('retry-save');
  if (retry) {
    const hidden = saveStatus === 'saving' ? retry.hidden : saveStatus !== 'error' && !settingsRetryPending;
    if (hidden && document.activeElement === retry && saveStatusElements[0]) {
      saveStatusElements[0].tabIndex = -1;
      saveStatusElements[0].focus?.();
    }
    retry.hidden = hidden;
    retry.disabled = settingsRetryPending || saveStatus === 'saving';
  }
}

function renderSettingsPreview() {
  const settings = settingsStore.getSettings();
  const { selectedColorState, audioFrame } = settingsStore.getUiState();
  settingsPreview?.update(settings, selectedColorState);
  if (audioFrame) settingsPreview?.setAudioFrame(audioFrame);
  const label = document.getElementById('preview-state-label');
  if (label) label.textContent = getStateLabel(settings.language, selectedColorState);
}

function renderPluginStatus(status) {
  const currentStatus = settingsStore.getUiState().pluginStatus;
  const nextStatus = status ?? currentStatus;
  if (status !== undefined) settingsStore.setUi({ pluginStatus: nextStatus });
  const language = getCurrentLanguage();
  const pluginStatus = document.getElementById('plugin-status');
  if (pluginStatus) pluginStatus.textContent = typeof nextStatus === 'string'
    ? getText(language, nextStatus)
    : formatSetupError(nextStatus.command, nextStatus.error, language);
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
  // Report command failures even when the Integration view is unmounted.
  const feedback = document.getElementById('settings-feedback');
  if (feedback) {
    feedback.hidden = !setupError && settingsStore.getUiState().activeView !== 'integration';
    feedback.dataset.status = setupError ? 'error' : 'ready';
    const message = setupError ? formatSetupError(setupError.command, setupError.error, language) : detail;
    if (feedback.textContent !== message) feedback.textContent = message;
  }
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
  const activeView = settingsStore.getUiState().activeView;
  const title = document.getElementById('settings-view-title');
  const description = document.getElementById('settings-view-description');
  if (title) title.dataset.i18n = SETTINGS_VIEWS[activeView].labelKey;
  if (description) description.dataset.i18n = `settings.description.${activeView}`;
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
  if (settingsStore.getUiState().activeView === 'appearance') {
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
  renderCurveParameters();
  curvePicker?.render();
  renderAudioState();
  renderCurveRestore();
  renderSetupGuide();
}

function renderAudioState() {
  const statusElement = document.getElementById('audio-status');
  if (!statusElement) return;
  const settings = settingsStore.getSettings();
  const { audioFrame, audioRetryPending, audioBridgeFailed } = settingsStore.getUiState();
  const live = ['capturing', 'silent'].includes(audioFrame?.status);
  const stale = live && Date.now() - audioFrame.timestamp_ms > 500;
  const status = !settings.audio_enabled ? 'disabled'
    : audioBridgeFailed ? 'error'
      : stale ? 'stale'
        : audioFrame?.status === 'starting' && audioFrame.reason === 'awaiting_audio' ? 'awaiting_audio'
          : audioFrame?.status ?? 'starting';
  const text = (key) => getText(settings.language, `settings.audio.${key}`);
  const label = text(`status.${status}`);
  // The live region only changes on discrete state transitions, never on audio frames.
  if (statusElement.textContent !== label) statusElement.textContent = label;
  document.getElementById('audio-intensity').disabled = !['capturing', 'silent'].includes(status);
  document.getElementById('audio-level').value = settings.audio_enabled && live && !stale && !audioBridgeFailed ? audioFrame.level : 0;
  const help = document.getElementById('audio-help');
  const windows = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform ?? navigator.userAgent ?? '');
  const reason = status === 'permission_denied' ? windows ? 'permission_windows' : 'permission'
    : status === 'unsupported' ? 'unsupported'
      : status === 'error' ? audioFrame?.reason === 'restart_required' ? 'restart_required' : 'device'
        : status === 'paused' && ['hidden', 'reduced_motion', 'motion_pending'].includes(audioFrame?.reason) ? audioFrame.reason
          : status === 'stale' ? 'disconnected' : null;
  const helpReason = status === 'awaiting_audio' ? 'awaiting_audio' : reason;
  help.hidden = !helpReason;
  help.textContent = helpReason ? text(`help.${helpReason}`) : '';
  const retry = document.getElementById('audio-retry');
  retry.hidden = reason === 'restart_required' || !['permission_denied', 'error', 'stale', 'awaiting_audio'].includes(status);
  retry.disabled = Boolean(audioRetryPending);
  retry.textContent = text(audioRetryPending ? 'retrying' : 'retry');
}

async function retryAudioCapture() {
  if (settingsStore.getUiState().audioRetryPending || !settingsStore.getSettings().audio_enabled) return;
  settingsStore.setUi({ audioRetryPending: true });
  renderAudioState();
  try {
    const result = await settingsBridge.command('retry_audio_capture');
    settingsStore.setUi({ audioBridgeFailed: !result.ok });
    if (result.ok) acceptAudioFrame(result.value);
  } finally {
    settingsStore.setUi({ audioRetryPending: false });
    renderAudioState();
  }
}

const acceptAudioFrame = createAudioFrameReceiver((audioFrame) => {
  settingsStore.setUi({ audioFrame, audioBridgeFailed: false });
  renderAudioState();
  settingsPreview?.setAudioFrame(audioFrame);
});

// Subscribe once for this settings window; remounting Appearance only renders stored state.
const audioStateSubscription = settingsBridge.subscribe('audio-state', ({ payload }) => acceptAudioFrame(payload));
async function loadAudioState() {
  await audioStateSubscription;
  const result = await settingsBridge.command('get_audio_state');
  if (result.ok) acceptAudioFrame(result.value);
  else settingsStore.setUi({ audioBridgeFailed: true });
  renderAudioState();
}

function applySettings(settings, { preserveLocalEdits = false, receivedLocalEdits = [] } = {}) {
  if (!settings) return;
  const protectedEdits = new Set([...receivedLocalEdits, ...localSettingEdits]);
  const activeField = document.activeElement;
  const activeKey = activeField && settingKey(activeField);
  const preserveActiveField = protectedEdits.has(activeKey);
  const incoming = {
    ...settings,
    language: normalizeLanguage(settings.language ?? settingsStore.getSettings().language),
  };
  if (preserveActiveField && activeKey && Object.hasOwn(settingsStore.getSettings(), activeKey)) {
    delete incoming[activeKey];
  }
  if (preserveLocalEdits || protectedEdits.size > 0) {
    for (const key of protectedEdits) delete incoming[key];
  }
  if (incoming.curve_id && incoming.curve_id !== settingsStore.getSettings().curve_id) {
    if (protectedEdits.has('curve_parameters')) delete incoming.curve_id;
    else if (!Object.hasOwn(incoming, 'curve_parameters')) incoming.curve_parameters = {};
  }
  if (Object.hasOwn(incoming, 'curve_parameters')) {
    const current = settingsStore.getSettings();
    const sameCurve = !incoming.curve_id || incoming.curve_id === current.curve_id;
    incoming.curve_parameters = getCurveParameterSettings(incoming.curve_id ?? current.curve_id, {
      ...(sameCurve ? current.curve_parameters : {}),
      ...incoming.curve_parameters,
    });
  }
  const previousSettings = settingsStore.getSettings();
  const nextSettings = settingsStore.mergeSettings(incoming);
  // Compare accepted values only: local protection and normalization precede invalidation.
  if (curveRestoreKeys.some((key) => JSON.stringify(previousSettings[key]) !== JSON.stringify(nextSettings[key]))) {
    curveRestoreSnapshot = null;
    curveRestoreApplied = false;
  }
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
    curvePicker?.render();
    return settings;
  });
  if (pendingInitialSave) {
    pendingInitialSave = false;
    // Only a successful persist may release the local edits protected during loading.
    await settingsStore.saveLatest();
  }
  await refreshDiagnostics();
  return result;
}

const settingsChangedSubscription = settingsBridge.subscribe(
  'settings-changed',
  ({ payload }) => {
    // A queued newer save may clear edits before this event is processed.
    const receivedLocalEdits = new Set(localSettingEdits);
    return settingsStore.enqueue(() => applySettings(payload, { receivedLocalEdits }));
  },
);
settingsChangedSubscription?.catch?.(() => {});
const positionSaveFailedSubscription = settingsBridge.subscribe('position-save-failed', ({ payload }) => settingsStore.enqueue(() => {
  showSetupError('save_position', payload);
  setSaveStatus('error');
}));
positionSaveFailedSubscription?.catch?.(() => {});
const positionSavedSubscription = settingsBridge.subscribe('position-saved', () => settingsStore.enqueue(() => {
  const { setupError } = settingsStore.getUiState();
  if (setupError && setupError.command !== 'save_position') return;
  clearSetupError();
  renderDiagnostics();
  setSaveStatus('saved');
}));
positionSavedSubscription?.catch?.(() => {});
const pluginOperationSubscription = settingsBridge.subscribe('plugin-operation', ({ payload }) => {
  const status = pluginOperationStatuses[payload];
  if (status) renderPluginStatus(status);
});
pluginOperationSubscription?.catch?.(() => {});

function saveCurrentSettings({ latest = false } = {}) {
  readSettings();
  renderSettingsPreview();
  if (!initialSettingsReady) {
    pendingInitialSave = true;
    return initialSettingsLoadPromise;
  }
  return latest ? settingsStore.saveLatest() : settingsStore.save();
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
      renderDiagnostics();
      renderPluginStatus(successStatus);
    } else {
      // Keep the error translatable after a language save clears the shared setup error.
      renderPluginStatus(settingsStore.getUiState().setupError ?? 'settings.pluginOperationFailed');
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
  root.querySelector?.('#reset-animation')?.addEventListener('click', () => {
    restoreCurveAnimation();
    void saveCurrentSettings();
  });
  root.querySelector?.('#reset-curve-parameters')?.addEventListener('click', () => {
    restoreCurveParameters();
    void saveCurrentSettings();
  });
  root.querySelector?.('#curve-parameters')?.addEventListener('input', ({ target: field }) => {
    if (!field.dataset?.curveParameter) return;
    updateSettingsModel(field, true);
    renderRangeValue(field);
    renderFormula();
    curvePicker?.render();
    void saveCurrentSettings();
  });
  for (const field of root.querySelectorAll('input, select')) {
    if (field.dataset.colorInput || field.dataset.colorHex || field.dataset.curveParameter) continue;
    // Browsing controls have no persisted setting and must not trigger a save.
    if (!Object.hasOwn(settingsStore.getSettings(), settingKey(field))) continue;
    const event = field.type === 'number' || field.type === 'range' ? 'input' : 'change';
    field.addEventListener(event, () => {
      updateSettingsModel(field, true);
      if (field.id === 'curve-id') {
        restoreCurveParameters();
        restoreCurveAnimation();
      }
      renderRangeValue(field);
      if (field.id === 'language') renderLanguage(field.value);
      if (field.name === 'audio_enabled') renderAudioState();
      void saveCurrentSettings();
    });
  }
}

function restoreCurveAnimation() {
  syncSettingsModelFromControls();
  const defaults = getCurveAnimationSettings(settingsStore.getSettings().curve_id);
  for (const [key, value] of Object.entries(defaults)) {
    settingsStore.patchSetting(key, value);
    // Preserve the complete preset if an earlier load or queued save arrives later.
    localSettingEdits.add(key);
  }
  syncControlsFromSettings();
  renderRangeValues();
  renderFormula();
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
  const controls = document.getElementById('desktop-test-controls');
  for (const button of controls?.querySelectorAll('[data-desktop-test-state]') ?? []) {
    button.addEventListener('click', async () => {
      const result = await invokeCommand('simulate_state', { state: button.dataset.desktopTestState });
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
document.getElementById('retry-save')?.addEventListener('click', async () => {
  if (settingsRetryPending || settingsStore.getUiState().saveStatus === 'saving') return;
  settingsRetryPending = true;
  setSaveStatus(settingsStore.getUiState().saveStatus);
  const snapshot = curveRestoreSnapshot;
  try {
    const result = await saveCurrentSettings({ latest: true });
    if (result?.ok && curveRestoreApplied && snapshot === curveRestoreSnapshot) curveRestoreSnapshot = null;
    return result;
  } finally {
    settingsRetryPending = false;
    setSaveStatus(settingsStore.getUiState().saveStatus);
    renderCurveRestore();
  }
});
document.addEventListener?.('visibilitychange', () => {
  if (!document.hidden) return;
  curveRestoreSnapshot = null;
  curveRestoreApplied = false;
  renderCurveRestore();
});

bindSettingsFields(document);
bindSetupGuide();
settingsViewController = createSettingsViewController({
  views: SETTINGS_VIEWS,
  host: settingsPanelHost,
  tabs: viewTabs,
  getTemplate: (view) => document.querySelector?.(`[data-view-template="${view.template}"]`),
  beforeMount: () => {
    syncSettingsModelFromControls();
    curvePicker?.destroy();
    curvePicker = null;
    settingsPreview?.destroy();
    settingsPreview = null;
  },
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
void loadAudioState();
window.setInterval(renderAudioState, 250);
window.setInterval(refreshDiagnostics, 500);
