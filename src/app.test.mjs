import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createDisplayStateBridge,
  createSerialTaskQueue,
  DEFAULT_APP_SETTINGS,
  formatSetupError,
} from './app.js';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  formatSetupError as formatLocalizedSetupError,
  getCurveLabel,
  getStateLabel,
  getText,
  normalizeLanguage,
} from './i18n.js';
import { createSettingsBridge } from './settings-bridge.js';
import { createSettingsStore } from './settings-store.js';

test('settings store merges partial external updates without erasing inactive values', async () => {
  const calls = [];
  const store = createSettingsStore({
    defaults: { opacity: 1, idle_color: '#A7ADB5', thinking_color: '#FF8A3D' },
    persist: (settings) => calls.push(settings),
  });

  store.replaceSettings({ opacity: 0.8, idle_color: '#111111', thinking_color: '#222222' });
  store.mergeSettings({ idle_color: '#333333' });

  assert.deepEqual(store.getSettings(), {
    opacity: 0.8,
    idle_color: '#333333',
    thinking_color: '#222222',
  });
  assert.deepEqual(calls, []);
});

test('settings bridge returns safe failure results when invoke rejects', async () => {
  const bridge = createSettingsBridge({
    invoke: async () => { throw new Error('raw detail'); },
    warn: () => {},
  });

  assert.deepEqual(await bridge.command('save_settings'), { ok: false, value: null });
});

test('settings bridge warns when invoke is unavailable', async () => {
  const warnings = [];
  const bridge = createSettingsBridge({
    warn: (...args) => warnings.push(args),
  });

  assert.deepEqual(await bridge.command('save_settings'), { ok: false, value: null });
  assert.deepEqual(warnings, [['Codex Halo: save_settings failed']]);
});

test('settings bridge reports failure when invoke is unavailable', async () => {
  const failures = [];
  const bridge = createSettingsBridge({
    warn: () => {},
    onFailure: (...args) => failures.push(args),
  });

  assert.deepEqual(await bridge.command('get_settings'), { ok: false, value: null });
  assert.deepEqual(failures, [['get_settings', undefined]]);
});

test('settings store saves call-time snapshots in queue order', async () => {
  const persisted = [];
  let releaseFirst;
  const store = createSettingsStore({
    defaults: { opacity: 1 },
    persist: async (settings) => {
      persisted.push(settings);
      if (persisted.length === 1) {
        await new Promise((resolve) => { releaseFirst = resolve; });
      }
    },
  });

  store.patchSetting('opacity', 0.2);
  const first = store.save();
  store.patchSetting('opacity', 0.8);
  const second = store.save();

  await new Promise((resolve) => setImmediate(resolve));
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(persisted, [{ opacity: 0.2 }, { opacity: 0.8 }]);
});

test('settings store keeps UI state separate and snapshots isolated', () => {
  const store = createSettingsStore({ defaults: { opacity: 1 }, persist: () => {} });

  const settings = store.getSettings();
  settings.opacity = 0;
  const uiState = store.setUi({ activeView: 'integration' });
  uiState.activeView = 'appearance';

  assert.deepEqual(store.getSettings(), { opacity: 1 });
  assert.deepEqual(store.getUiState(), { activeView: 'integration' });
});

test('settings store isolates nested UI snapshots from defaults, patches, and reads', () => {
  const uiDefaults = {
    diagnosticsSnapshot: { state: 'idle', updated_at_ms: 0 },
    invalidColorDrafts: { thinking: '#12345' },
  };
  const store = createSettingsStore({ defaults: {}, uiDefaults, persist: () => {} });

  const initial = store.getUiState();
  initial.diagnosticsSnapshot.state = 'completed';
  initial.invalidColorDrafts.thinking = '#65432';
  assert.deepEqual(store.getUiState(), uiDefaults);

  const diagnosticsSnapshot = { state: 'thinking', updated_at_ms: 1 };
  const invalidColorDrafts = { completed: '#ABCDE' };
  const updated = store.setUi({ diagnosticsSnapshot, invalidColorDrafts });
  diagnosticsSnapshot.state = 'idle';
  invalidColorDrafts.completed = '#00000';
  updated.diagnosticsSnapshot.state = 'executing';
  updated.invalidColorDrafts.completed = '#FFFFF';

  assert.deepEqual(store.getUiState(), {
    diagnosticsSnapshot: { state: 'thinking', updated_at_ms: 1 },
    invalidColorDrafts: { completed: '#ABCDE' },
  });
});

test('settings store initializes and transitions the complete UI state from uiDefaults', () => {
  const uiDefaults = {
    activeView: 'appearance',
    selectedColorState: 'idle',
    saveStatus: 'ready',
    setupError: null,
    diagnosticsSnapshot: { state: 'idle', updated_at_ms: 0 },
    pluginStatus: 'settings.pluginReady',
    pluginOperationInFlight: false,
  };
  const store = createSettingsStore({
    defaults: {},
    uiDefaults,
    persist: () => {},
  });

  assert.deepEqual(store.getUiState(), uiDefaults);

  store.setUi({ activeView: 'colors', selectedColorState: 'thinking' });

  assert.deepEqual(store.getUiState(), {
    ...uiDefaults,
    activeView: 'colors',
    selectedColorState: 'thinking',
  });
});

test('settings store replaces from defaults and patches one setting', () => {
  const store = createSettingsStore({
    defaults: { opacity: 1, curve_id: 'rose-seven' },
    persist: () => {},
  });

  store.replaceSettings({ opacity: 0.8 });
  store.patchSetting('opacity', 0.6);

  assert.deepEqual(store.getSettings(), { opacity: 0.6, curve_id: 'rose-seven' });
});

test('partial settings-changed payload keeps unmounted fields', () => {
  const store = createSettingsStore({
    defaults: { opacity: 1, idle_color: '#A7ADB5', thinking_color: '#FF8A3D' },
    persist: () => {},
  });

  store.replaceSettings({ opacity: 0.8, idle_color: '#111111', thinking_color: '#222222' });
  store.mergeSettings({ idle_color: '#333333' });

  assert.equal(store.getSettings().opacity, 0.8);
  assert.equal(store.getSettings().thinking_color, '#222222');
  assert.equal(store.getSettings().idle_color, '#333333');
});

test('plugin in-flight state survives a View change', () => {
  const store = createSettingsStore({ defaults: {}, persist: () => {} });

  store.setUi({ activeView: 'integration', pluginOperationInFlight: true });
  store.setUi({ activeView: 'appearance' });

  assert.equal(store.getUiState().activeView, 'appearance');
  assert.equal(store.getUiState().pluginOperationInFlight, true);
});

test('a settings merge does not change the locally patched active setting', () => {
  const store = createSettingsStore({
    defaults: { opacity: 1, curve_id: 'rose-seven' },
    persist: () => {},
  });

  store.patchSetting('opacity', 0.6);
  store.mergeSettings({ curve_id: 'spiral-search' });

  assert.equal(store.getSettings().opacity, 0.6);
  assert.equal(store.getSettings().curve_id, 'spiral-search');
});

test('shared settings queue runs reset after a blocked save', async () => {
  const calls = [];
  let releaseSave;
  const queue = createSerialTaskQueue();
  const store = createSettingsStore({
    defaults: { opacity: 1 },
    enqueue: queue,
    persist: async (settings) => {
      calls.push(['save-start', settings.opacity]);
      await new Promise((resolve) => { releaseSave = resolve; });
      calls.push(['save-end', settings.opacity]);
    },
  });

  store.patchSetting('opacity', 0.6);
  const save = store.save();
  await new Promise((resolve) => setImmediate(resolve));
  const reset = store.enqueue(() => {
    calls.push(['reset']);
  });

  assert.deepEqual(calls, [['save-start', 0.6]]);
  releaseSave();
  await Promise.all([save, reset]);
  assert.deepEqual(calls, [['save-start', 0.6], ['save-end', 0.6], ['reset']]);
});

test('initial settings load does not replace a focused local field', async () => {
  class FakeField {
    constructor({ id, type, value }) {
      this.id = id;
      this.type = type;
      this.value = value;
      this.checked = false;
      this.name = '';
      this.dataset = {};
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    dispatch(type) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener({ target: this, currentTarget: this });
      }
    }
  }

  const opacity = new FakeField({ id: 'opacity', type: 'range', value: '1' });
  const settingsPanelHost = {
    querySelectorAll: (selector) => selector === 'input, select' ? [opacity] : [],
  };
  const listeners = new Map();
  const saveCalls = [];
  let resolveSettings;
  const invoke = async (command, args) => {
    if (command === 'get_settings') {
      return new Promise((resolve) => { resolveSettings = resolve; });
    }
    if (command === 'get_display_state') return { state: 'idle', updated_at_ms: 0 };
    if (command === 'save_settings') {
      saveCalls.push(args);
      return { saved: true };
    }
    return null;
  };
  const fakeDocument = {
    activeElement: null,
    documentElement: { lang: 'en' },
    title: 'Codex Halo Settings',
    getElementById: (id) => id === 'settings-panel-host' ? settingsPanelHost : id === 'opacity' ? opacity : null,
    querySelectorAll: (selector) => selector === 'input, select' ? [opacity] : [],
  };
  const fakeWindow = {
    __TAURI__: {
      core: { invoke },
      event: {
        listen: (event, handler) => {
          listeners.set(event, handler);
          return Promise.resolve();
        },
      },
    },
    setInterval: () => 1,
  };
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;

  try {
    await import(`./settings.js?initial-load-protection=${Date.now()}`);
    await new Promise((resolve) => setImmediate(resolve));

    fakeDocument.activeElement = opacity;
    opacity.value = '0.6';
    opacity.dispatch('input');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(saveCalls, []);
    resolveSettings({ ...DEFAULT_APP_SETTINGS, opacity: 0.8, curve_id: 'spiral-search' });
    await new Promise((resolve) => setImmediate(resolve));

    fakeDocument.activeElement = null;
    await listeners.get('settings-changed')({ payload: { curve_id: 'spiral-search' } });
    assert.equal(opacity.value, '0.6');
    assert.equal(saveCalls.length, 1);
    assert.equal(saveCalls[0].settings.opacity, 0.6);
    assert.equal(saveCalls[0].settings.curve_id, 'spiral-search');
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('initial settings load updates a focused but untouched field', async () => {
  class FakeField {
    constructor({ id, type, value }) {
      this.id = id;
      this.type = type;
      this.value = value;
      this.checked = false;
      this.name = '';
      this.dataset = {};
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
  }

  const opacity = new FakeField({ id: 'opacity', type: 'range', value: '1' });
  const settingsPanelHost = {
    querySelectorAll: (selector) => selector === 'input, select' ? [opacity] : [],
  };
  let resolveSettings;
  const invoke = async (command) => {
    if (command === 'get_settings') {
      return new Promise((resolve) => { resolveSettings = resolve; });
    }
    if (command === 'get_display_state') return { state: 'idle', updated_at_ms: 0 };
    return null;
  };
  const fakeDocument = {
    activeElement: null,
    documentElement: { lang: 'en' },
    title: 'Codex Halo Settings',
    getElementById: (id) => id === 'settings-panel-host' ? settingsPanelHost : id === 'opacity' ? opacity : null,
    querySelectorAll: (selector) => selector === 'input, select' ? [opacity] : [],
  };
  const fakeWindow = { __TAURI__: { core: { invoke } }, setInterval: () => 1 };
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;

  try {
    await import(`./settings.js?initial-load-focus-only=${Date.now()}`);
    await new Promise((resolve) => setImmediate(resolve));

    fakeDocument.activeElement = opacity;
    resolveSettings({ ...DEFAULT_APP_SETTINGS, opacity: 0.8 });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(opacity.value, '0.8');
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('blurred local edit survives queued View and settings event before initial save flushes', async () => {
  class FakeField {
    constructor({ id, type, value }) {
      this.id = id;
      this.type = type;
      this.value = value;
      this.checked = false;
      this.name = '';
      this.dataset = {};
      this.listeners = new Map();
      this.classList = { toggle() {} };
      this.tabIndex = -1;
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    dispatch(type, event = {}) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener({ target: this, currentTarget: this, ...event });
      }
    }

    setAttribute() {}

    focus() {
      fakeDocument.activeElement = this;
    }
  }

  const opacity = new FakeField({ id: 'opacity', type: 'range', value: '1' });
  const viewTabs = ['appearance', 'colors'].map((viewId) => new FakeField({
    id: `settings-tab-${viewId}`,
    type: 'button',
    value: viewId,
  }));
  for (const [index, tab] of viewTabs.entries()) tab.dataset.viewTarget = ['appearance', 'colors'][index];
  const settingsPanelHost = {
    querySelectorAll: (selector) => selector === 'input, select' ? [opacity] : [],
    replaceChildren() {},
    setAttribute() {},
  };
  const listeners = new Map();
  const saveCalls = [];
  let resolveSettings;
  const invoke = async (command, args) => {
    if (command === 'get_settings') {
      return new Promise((resolve) => { resolveSettings = resolve; });
    }
    if (command === 'get_display_state') return { state: 'idle', updated_at_ms: 0 };
    if (command === 'save_settings') {
      saveCalls.push(args);
      return { saved: true };
    }
    return null;
  };
  const templates = new Map(['appearance', 'colors'].map((viewId) => [viewId, {
    content: { cloneNode: () => ({ tagName: '#fragment', children: [] }) },
  }]));
  const fakeDocument = {
    activeElement: null,
    documentElement: { lang: 'en' },
    title: 'Codex Halo Settings',
    getElementById: (id) => id === 'settings-panel-host' ? settingsPanelHost : id === 'opacity' ? opacity : null,
    querySelectorAll: (selector) => {
      if (selector === '[data-view-target]') return viewTabs;
      if (selector === 'input, select') return [opacity];
      return [];
    },
    querySelector: (selector) => {
      const match = selector.match(/^\[data-view-template="(.+)"\]$/);
      return match ? templates.get(match[1]) ?? null : null;
    },
  };
  const fakeWindow = {
    __TAURI__: {
      core: { invoke },
      event: {
        listen: (event, handler) => {
          listeners.set(event, handler);
          return Promise.resolve();
        },
      },
    },
    setInterval: () => 1,
  };
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;

  try {
    await import(`./settings.js?initial-load-blur-queue=${Date.now()}`);
    await new Promise((resolve) => setImmediate(resolve));

    fakeDocument.activeElement = opacity;
    opacity.value = '0.6';
    opacity.dispatch('input');
    fakeDocument.activeElement = null;
    viewTabs[1].dispatch('click');
    const event = listeners.get('settings-changed')({ payload: { opacity: 0.8 } });

    resolveSettings({ ...DEFAULT_APP_SETTINGS, opacity: 0.8 });
    await event;
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(saveCalls.length, 1);
    assert.equal(saveCalls[0].settings.opacity, 0.6);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('rejected initial settings load releases the save gate and keeps later edits saving', async () => {
  class FakeField {
    constructor({ id, type, value }) {
      this.id = id;
      this.type = type;
      this.value = value;
      this.checked = false;
      this.name = '';
      this.dataset = {};
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    dispatch(type) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener({ target: this, currentTarget: this });
      }
    }
  }

  const opacity = new FakeField({ id: 'opacity', type: 'range', value: '1' });
  const settingsPanelHost = {
    querySelectorAll: (selector) => selector === 'input, select' ? [opacity] : [],
  };
  const listeners = new Map();
  const saveCalls = [];
  let rejectSettings;
  const invoke = async (command, args) => {
    if (command === 'get_settings') {
      return new Promise((resolve, reject) => {
        rejectSettings = reject;
      });
    }
    if (command === 'get_display_state') return { state: 'idle', updated_at_ms: 0 };
    if (command === 'save_settings') {
      saveCalls.push(args);
      return { saved: true };
    }
    return null;
  };
  const fakeDocument = {
    activeElement: null,
    documentElement: { lang: 'en' },
    title: 'Codex Halo Settings',
    getElementById: (id) => id === 'settings-panel-host' ? settingsPanelHost : id === 'opacity' ? opacity : null,
    querySelectorAll: (selector) => selector === 'input, select' ? [opacity] : [],
  };
  const fakeWindow = {
    __TAURI__: {
      core: { invoke },
      event: {
        listen: (event, handler) => {
          listeners.set(event, handler);
          return Promise.resolve();
        },
      },
    },
    setInterval: () => 1,
  };
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalWarn = console.warn;
  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;
  console.warn = () => {};

  try {
    await import(`./settings.js?rejected-initial-load=${Date.now()}`);
    await new Promise((resolve) => setImmediate(resolve));

    opacity.value = '0.6';
    opacity.dispatch('input');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(saveCalls, []);

    rejectSettings(new Error('bridge unavailable'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(saveCalls.length, 1);
    assert.equal(saveCalls[0].settings.opacity, 0.6);

    opacity.value = '0.8';
    opacity.dispatch('input');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(saveCalls.length, 2);
    assert.equal(saveCalls[1].settings.opacity, 0.8);
  } finally {
    console.warn = originalWarn;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('settings event received before initial load wins over stale response', async () => {
  class FakeField {
    constructor({ id, type, value }) {
      this.id = id;
      this.type = type;
      this.value = value;
      this.checked = false;
      this.name = '';
      this.dataset = {};
      this.listeners = new Map();
      this.attributes = {};
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    dispatch(type) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener({ target: this, currentTarget: this });
      }
    }

    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
  }

  const curve = new FakeField({ id: 'curve-id', type: 'select', value: 'rose-seven' });
  const settingsPanelHost = {
    querySelectorAll: (selector) => selector === 'input, select' ? [curve] : [],
  };
  const listeners = new Map();
  let resolveSettings;
  const invoke = async (command) => {
    if (command === 'get_settings') {
      return new Promise((resolve) => { resolveSettings = resolve; });
    }
    if (command === 'get_display_state') return { state: 'idle', updated_at_ms: 0 };
    return null;
  };
  const fakeDocument = {
    activeElement: null,
    documentElement: { lang: 'en' },
    title: 'Codex Halo Settings',
    getElementById: (id) => id === 'settings-panel-host' ? settingsPanelHost : id === 'curve-id' ? curve : null,
    querySelectorAll: (selector) => selector === 'input, select' ? [curve] : [],
  };
  const fakeWindow = {
    __TAURI__: {
      core: { invoke },
      event: {
        listen: (event, handler) => {
          listeners.set(event, handler);
          return Promise.resolve();
        },
      },
    },
    setInterval: () => 1,
  };
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;

  try {
    await import(`./settings.js?event-before-load=${Date.now()}`);
    await new Promise((resolve) => setImmediate(resolve));

    const event = listeners.get('settings-changed')({ payload: { curve_id: 'spiral-search' } });
    resolveSettings({ ...DEFAULT_APP_SETTINGS, curve_id: 'rose-seven' });
    await event;
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(curve.value, 'spiral-search');
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('settings-changed waits behind a queued local save', async () => {
  const calls = [];
  let releaseSave;
  const queue = createSerialTaskQueue();
  const store = createSettingsStore({
    defaults: { opacity: 1, curve_id: 'rose-seven' },
    enqueue: queue,
    persist: async () => {
      calls.push('save-start');
      await new Promise((resolve) => { releaseSave = resolve; });
      calls.push('save-end');
    },
  });

  store.patchSetting('opacity', 0.6);
  const save = store.save();
  await new Promise((resolve) => setImmediate(resolve));
  const payload = { curve_id: 'spiral-search' };
  const event = store.enqueue(() => {
    calls.push('event');
    store.mergeSettings(payload);
  });

  assert.deepEqual(calls, ['save-start']);
  assert.equal(store.getSettings().curve_id, 'rose-seven');
  releaseSave();
  await Promise.all([save, event]);
  assert.deepEqual(calls, ['save-start', 'save-end', 'event']);
  assert.equal(store.getSettings().curve_id, 'spiral-search');

  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');
  assert.match(source, /settingsStore\.enqueue\(\(\) => applySettings\(payload\)\)/);
});

test('settings controller serializes reset after a blocked save and applies its response', async () => {
  class FakeNode {
    constructor({ tagName = 'div', id = '', type = '', value = '', checked = false, dataset = {}, children = [] } = {}) {
      this.tagName = tagName;
      this.id = id;
      this.type = type;
      this.value = value;
      this.checked = checked;
      this.name = '';
      this.dataset = { ...dataset };
      this.children = [...children];
      this.attributes = {};
      this.listeners = new Map();
      this.classList = { toggle() {} };
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    dispatch(type, event = {}) {
      return Promise.all(
        (this.listeners.get(type) ?? []).map((listener) => listener({ target: this, currentTarget: this, ...event })),
      );
    }

    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }

    toggleAttribute(name, force) {
      if (force === false) delete this.attributes[name];
      else if (force === true || !Object.hasOwn(this.attributes, name)) this.attributes[name] = '';
      this.disabled = force;
    }

    append(...children) {
      this.children.push(...children);
    }

    replaceChildren(...children) {
      this.children = children.flatMap((child) => child.tagName === '#fragment' ? child.children : [child]);
    }

    querySelectorAll(selector) {
      if (selector === 'input, select') {
        return collectNodes(this).filter((node) => node.tagName === 'input' || node.tagName === 'select');
      }
      return [];
    }

    focus() {
      fakeDocument.activeElement = this;
    }
  }

  const collectNodes = (root) => [
    ...root.children.flatMap((child) => [child, ...collectNodes(child)]),
  ];
  const make = (options) => new FakeNode(options);
  const settingsPanelHost = make({ id: 'settings-panel-host' });
  const saveStatus = make({ id: 'settings-save-status' });
  const viewTabs = ['appearance', 'colors', 'integration', 'test'].map((viewId) => make({
    tagName: 'button',
    id: `settings-tab-${viewId}`,
    dataset: { viewTarget: viewId },
  }));
  const templates = new Map();
  for (const viewId of ['appearance', 'colors', 'integration', 'test']) {
    templates.set(viewId, {
      content: {
        cloneNode() {
          if (viewId !== 'integration') {
            return { tagName: '#fragment', children: [make({ tagName: 'fieldset' })] };
          }
          const startAtLogin = make({
            tagName: 'input',
            id: 'start-at-login',
            type: 'checkbox',
            checked: true,
          });
          startAtLogin.name = 'start_at_login';
          const resetPosition = make({ tagName: 'button', id: 'reset-position', type: 'button' });
          return {
            tagName: '#fragment',
            children: [make({
              tagName: 'fieldset',
              id: 'integration-section',
              children: [startAtLogin, resetPosition],
            })],
          };
        },
      },
    });
  }

  const findById = (id) => {
    if (id === 'settings-panel-host') return settingsPanelHost;
    if (id === 'settings-save-status') return saveStatus;
    return collectNodes(settingsPanelHost).find((node) => node.id === id) ?? null;
  };
  const listeners = new Map();
  const commands = [];
  let releaseSave;
  const invoke = async (command) => {
    commands.push(command);
    if (command === 'get_settings') return { ...DEFAULT_APP_SETTINGS, start_at_login: true };
    if (command === 'get_display_state') return { state: 'idle', updated_at_ms: 0 };
    if (command === 'save_settings') {
      return new Promise((resolve) => { releaseSave = resolve; });
    }
    if (command === 'reset_position') return { ...DEFAULT_APP_SETTINGS, start_at_login: true };
    return null;
  };
  const fakeDocument = {
    activeElement: null,
    documentElement: { lang: 'en' },
    title: 'Codex Halo Settings',
    getElementById: findById,
    querySelectorAll: (selector) => selector === '[data-view-target]' ? viewTabs : [],
    querySelector: (selector) => {
      const templateMatch = selector.match(/^\[data-view-template="(.+)"\]$/);
      return templateMatch ? templates.get(templateMatch[1]) ?? null : null;
    },
  };
  const fakeWindow = {
    __TAURI__: {
      core: { invoke },
      event: {
        listen: (event, handler) => {
          listeners.set(event, handler);
          return Promise.resolve();
        },
      },
    },
    setInterval: () => 1,
  };
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;

  try {
    await import(`./settings.js?controller-reset-queue=${Date.now()}`);
    await new Promise((resolve) => setImmediate(resolve));
    await viewTabs[2].dispatch('click');

    const startAtLogin = findById('start-at-login');
    const resetPosition = findById('reset-position');
    fakeDocument.activeElement = startAtLogin;
    startAtLogin.checked = false;
    await startAtLogin.dispatch('change');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(commands.filter((command) => command === 'save_settings' || command === 'reset_position'), ['save_settings']);

    fakeDocument.activeElement = resetPosition;
    const reset = resetPosition.dispatch('click');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(commands.filter((command) => command === 'save_settings' || command === 'reset_position'), ['save_settings']);

    releaseSave();
    await reset;
    assert.deepEqual(commands.filter((command) => command === 'save_settings' || command === 'reset_position'), ['save_settings', 'reset_position']);
    assert.equal(startAtLogin.checked, true);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }

  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');
  assert.match(source, /settingsStore\.enqueue\(async \(\) => \{[\s\S]*?applySettings\(result\.value\);[\s\S]*?return result;/);
});

test('settings controller uses the shared store for merge and save behavior', async () => {
  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');

  assert.match(source, /import \{ createSettingsStore \} from '\.\/settings-store\.js';/);
  assert.match(source, /createSettingsStore\(\{[\s\S]*?defaults: DEFAULT_APP_SETTINGS,[\s\S]*?uiDefaults:/);
  assert.match(source, /invalidColorDrafts: \{\}/);
  assert.doesNotMatch(source, /settingsStore\.setUi\(\{\s*activeView:\s*'appearance'/);
  assert.doesNotMatch(source, /let activeView = viewIds\[0\]/);
  assert.match(source, /settingsStore\.getUiState\(\)\.activeView/);
  assert.match(source, /settingsStore\.mergeSettings/);
  assert.match(source, /settingsStore\.save\(\)/);
});

test('settings controller routes commands and events through the bridge', async () => {
  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');

  assert.match(source, /import \{ createSettingsBridge \} from '\.\/settings-bridge\.js';/);
  assert.match(source, /const settingsBridge = createSettingsBridge/);
  assert.match(source, /settingsBridge\.command/);
  assert.match(source, /settingsBridge\.subscribe/);
  assert.doesNotMatch(source, /await invoke\(command, args\)/);
});

test('settings controller keeps plugin busy state in UI state and reapplies it after remount', async () => {
  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');

  assert.match(source, /settingsStore\.setUi\(\{ pluginOperationInFlight: true \}\)/);
  assert.match(source, /settingsStore\.getUiState\(\)\.pluginOperationInFlight/);
  assert.match(source, /setPluginButtonsDisabled\(settingsStore\.getUiState\(\)\.pluginOperationInFlight\)/);
});

test('settings controller keeps remount-surviving UI state in the Store', async () => {
  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');

  for (const declaration of [
    /\blet selectedColorState\b/,
    /\blet currentSaveStatus\b/,
    /\blet setupError\b/,
    /\blet currentDisplayState\b/,
    /\blet currentPluginStatus\b/,
  ]) {
    assert.doesNotMatch(source, declaration);
  }
  for (const key of ['selectedColorState', 'saveStatus', 'setupError', 'diagnosticsSnapshot', 'pluginStatus']) {
    assert.match(source, new RegExp(`settingsStore\\.(?:getUiState\\(\\)\\.${key}|setUi\\(\\{[^}]*${key})`));
  }
});

test('settings bridge returns successful command values', async () => {
  const calls = [];
  const bridge = createSettingsBridge({
    invoke: async (name, args) => {
      calls.push([name, args]);
      return { saved: true };
    },
  });

  assert.deepEqual(await bridge.command('save_settings', { settings: { opacity: 0.8 } }), {
    ok: true,
    value: { saved: true },
  });
  assert.deepEqual(calls, [['save_settings', { settings: { opacity: 0.8 } }]]);
});

test('settings bridge no-ops when listen is unavailable', () => {
  const bridge = createSettingsBridge({ invoke: () => null, warn: () => {} });

  assert.equal(bridge.subscribe('settings-changed', () => {}), undefined);
});

test('settings bridge reports synchronous listen failures through the safe failure path', () => {
  const rawError = new Error('raw listen detail');
  const warnings = [];
  const failures = [];
  const bridge = createSettingsBridge({
    listen: () => { throw rawError; },
    warn: (...args) => warnings.push(args),
    onFailure: (...args) => failures.push(args),
  });

  assert.doesNotThrow(() => bridge.subscribe('settings-changed', () => {}));
  assert.deepEqual(warnings, [['Codex Halo: settings-changed failed']]);
  assert.deepEqual(failures, [['settings-changed', rawError]]);
});

test('settings bridge reports rejected listen failures without leaking raw errors', async () => {
  const rawError = new Error('raw listen detail');
  const warnings = [];
  const failures = [];
  const bridge = createSettingsBridge({
    listen: async () => { throw rawError; },
    warn: (...args) => warnings.push(args),
    onFailure: (...args) => failures.push(args),
  });

  await assert.doesNotReject(bridge.subscribe('settings-changed', () => {}));
  assert.deepEqual(warnings, [['Codex Halo: settings-changed failed']]);
  assert.deepEqual(failures, [['settings-changed', rawError]]);
});

test('an in-flight poll cannot overwrite a newer simulated display event', async () => {
  let releasePoll;
  const applied = [];
  const invokeCommand = async (command, args) => {
    if (command === 'get_display_state') {
      return new Promise((resolve) => {
        releasePoll = () => resolve({ state: 'thinking', session_count: 1, updated_at_ms: 1 });
      });
    }
    return { state: args.state, session_count: 0, updated_at_ms: 0 };
  };

  const bridge = createDisplayStateBridge(invokeCommand, (displayState) => applied.push(displayState.state));
  const poll = bridge.pollDisplayState();
  bridge.showDisplayState({ state: 'completed', session_count: 0, updated_at_ms: 0 });
  releasePoll();
  await poll;

  assert.deepEqual(applied, ['completed']);
});

test('a simulated state survives scheduled polls through the morph window', async () => {
  let now = 1_000;
  const applied = [];
  const invokeCommand = async () => ({ state: 'idle', session_count: 0, updated_at_ms: 2 });
  const bridge = createDisplayStateBridge(
    invokeCommand,
    (displayState) => applied.push(displayState.state),
    { now: () => now, simulationDurationMs: 420 },
  );

  bridge.showSimulatedDisplayState({ state: 'completed', session_count: 0, updated_at_ms: 0 });
  now += 150;
  await bridge.pollDisplayState();
  now = 1_419;
  await bridge.pollDisplayState();

  assert.deepEqual(applied, ['completed']);

  now = 1_420;
  await bridge.pollDisplayState();
  assert.deepEqual(applied, ['completed', 'idle']);
});

test('settings close requests are intercepted and hidden', async () => {
  const source = await readFile(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');

  assert.match(source, /settings_window\.on_window_event/);
  assert.match(source, /WindowEvent::CloseRequested/);
  assert.match(source, /api\.prevent_close\(\)/);
  assert.match(source, /settings_window\.hide\(\)/);
});

test('native menu refresh follows the persisted language setting', async () => {
  const source = await readFile(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');

  assert.match(source, /struct TrayMenuItems/);
  assert.match(source, /tray_menu: Mutex<Option<TrayMenuItems>>/);
  assert.match(source, /set_text\(/);
  assert.match(source, /settings_window\.set_title/);
  assert.match(source, /settings\.language/);
  assert.match(source, /打开设置/);
});

test('disabled overlay startup waits for settings before showing or polling', async () => {
  const mainSource = await readFile(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('./app.js', import.meta.url), 'utf8');

  assert.match(mainSource, /\.visible\(false\)/);
  assert.match(mainSource, /set_overlay_visible/);
  assert.ok(appSource.indexOf("invokeCommand('get_settings')") < appSource.indexOf('renderer.start()'));
  assert.ok(appSource.indexOf('renderer.start()') < appSource.indexOf('displayBridge.pollDisplayState()'));
});

test('autostart errors keep only a fixed safe category for settings UI', () => {
  assert.equal(
    formatSetupError('save_settings', 'start-at-login:permission'),
    'start-at-login setup failed (permission)',
  );
  assert.equal(
    formatSetupError('save_settings', 'codex-lifecycle:registry'),
    'Codex lifecycle setup failed (registry)',
  );
  assert.equal(formatSetupError('save_settings', 'raw path and payload'), 'save_settings failed');
});

test('localization defaults and falls back to English', () => {
  assert.equal(DEFAULT_LANGUAGE, 'en');
  assert.deepEqual(SUPPORTED_LANGUAGES, ['en', 'zh-CN']);
  assert.equal(normalizeLanguage('fr'), 'en');
  assert.equal(normalizeLanguage('zh-CN'), 'zh-CN');
  assert.equal(getText('zh-CN', 'settings.display'), '显示');
  assert.equal(getStateLabel('zh-CN', 'input_needed'), '需要输入');
  assert.equal(getCurveLabel('zh-CN', 'rose-seven'), '七瓣玫瑰');
});

test('settings navigation uses a localized Test label', async () => {
  const html = await readFile(new URL('./settings.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');

  assert.match(html, /data-view-target="test"[^>]*data-i18n="settings\.test">Test<\/button>/);
  assert.match(html, /<legend data-i18n="settings\.simulateState">Simulate state<\/legend>/);
  assert.match(source, /labelKey: 'settings\.test'/);
  assert.equal(getText('en', 'settings.test'), 'Test');
  assert.equal(getText('zh-CN', 'settings.test'), '测试');
});

test('state color presets preserve all supplied hexadecimal values', async () => {
  const {
    COLOR_PRESET_GROUPS,
    COLOR_PRESETS,
    DEFAULT_STATE_COLORS,
    isHexColor,
  } = await import('./colors.js');
  const expectedDefaults = {
    idle: '#A7ADB5',
    thinking: '#FF8A3D',
    executing: '#339CFF',
    input_needed: '#F05252',
    completed: '#35C878',
    compacting: '#A56BFF',
  };
  const expectedPresets = [
    '#FED71A', '#F9D770', '#ECCB16', '#FCCC07', '#FEBA07', '#F9A633', '#DAA45A',
    '#A4CAB6', '#69A794', '#5DBE8A', '#41B349', '#2C9678', '#428675', '#248067',
    '#E9CCD3', '#C08EAF', '#C06F98', '#806D9E', '#815C94', '#813C85', '#4D1018',
    '#F0C9CF', '#F0A1A8', '#E77C8E', '#EC8AA4', '#EC7696', '#EA517F', '#DE3F7C',
    '#E4DFD7', '#CFCCC9', '#D4C4B7', '#BDAEAD', '#B6A476', '#9FA39A', '#847C74',
    '#E7A23F', '#DE7622', '#673424', '#5C1E19', '#652B1C', '#592620', '#482522',
    '#3E3B31', '#31322C', '#39363F', '#353538', '#2D2D30', '#2E282E', '#000013',
    '#F18F60', '#EE781F', '#E97040', '#EA5532', '#DC541B', '#EA5514', '#B55336',
    '#F03752', '#EE2746', '#C21F30', '#EE3F4D', '#BF3553', '#A7535A', '#82111F',
    '#BACCD9', '#8FB2C9', '#8ABCD1', '#10AEC2', '#158BB8', '#4E7CA1', '#2775B6',
  ];
  const expectedNames = [
    ['佛手', '淡茧', '素馨', '金盏', '琥珀', '榴莺', '珐琅'],
    ['玉簪', '梧枝', '蔻梢', '玉髓', '青矾', '亚丁', '海王'],
    ['芝兰', '萝兰', '樱草', '槿紫', '蕈紫', '桔梗', '酱紫'],
    ['石蕊', '合欢', '淡茜', '报春', '淡绛', '莲瓣', '嫩菱'],
    ['珍珠', '玛瑙', '晓灰', '芦穗', '月灰', '镍灰', '夜灰'],
    ['凋叶', '鹿棕', '淡栗', '栗棕', '可可', '暗驼', '火山'],
    ['茶青', '京元', '鹰背', '烟墨', '朱墨', '石青', '青骊'],
    ['赪霞', '金红', '凌霄', '骅衣', '朱柿', '黄丹', '橘红'],
    ['海棠', '淡曙', '枫叶', '茶花', '锦葵', '满江', '殷红'],
    ['云水', '晴山', '秋波', '甸子', '鸢尾', '蝶翅', '景泰'],
  ];

  assert.deepEqual(DEFAULT_STATE_COLORS, expectedDefaults);
  assert.deepEqual(
    COLOR_PRESET_GROUPS.map(({ labelKey }) => getText('zh-CN', labelKey)),
    ['黄色系', '青绿色系', '紫色系', '粉色系', '浅中性色系', '棕色系', '黑灰色系', '橙色系', '红色系', '蓝色系'],
  );
  assert.deepEqual(COLOR_PRESET_GROUPS.map(({ colors }) => colors.map(({ name }) => name)), expectedNames);
  assert.deepEqual(COLOR_PRESETS, expectedPresets);
  assert.equal(new Set(COLOR_PRESETS).size, 70);
  assert(COLOR_PRESETS.every((color) => isHexColor(color)));
  assert.equal(isHexColor('#abcdef'), true);
  assert.equal(isHexColor('#12345'), false);
  assert.equal(isHexColor('123456'), false);
});

test('localized setup errors keep only safe categories', () => {
  assert.equal(
    formatLocalizedSetupError('save_settings', 'start-at-login:permission', 'zh-CN'),
    '启动时设置失败（权限）',
  );
  assert.equal(
    formatLocalizedSetupError('save_settings', 'codex-lifecycle:permission', 'zh-CN'),
    'Codex 生命周期设置失败（权限）',
  );
  assert.equal(
    formatLocalizedSetupError('save_settings', 'raw path and payload', 'zh-CN'),
    'save_settings failed',
  );
});

test('settings page exposes a persisted language selector', async () => {
  const html = await readFile(new URL('./settings.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
  const i18n = await readFile(new URL('./i18n.js', import.meta.url), 'utf8');

  assert.match(html, /id="language"/);
  assert.match(html, /value="en"/);
  assert.match(html, /value="zh-CN"/);
  assert.match(html, /data-i18n="settings\.display"/);
  assert.match(html, /id="follow-codex-lifecycle"/);
  assert.match(html, /data-i18n="settings\.followCodexLifecycle"/);
  assert.match(source, /const settingsStore = createSettingsStore/);
  assert.match(source, /language: normalizeLanguage\(settings\.language \?\? settingsStore\.getSettings\(\)\.language\)/);
  assert.match(source, /const settings = settingsStore\.getSettings\(\)[\s\S]*settings\[settingKey\(field\)\]/);
  assert.match(source, /document\.documentElement\.lang/);
  assert.match(i18n, /settings\.followCodexLifecycle/);
});

test('settings page uses a responsive settings workbench', async () => {
  const html = await readFile(new URL('./settings.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
  const mainSource = await readFile(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');

  assert.match(html, /class="settings-workbench"/);
  assert.match(html, /class="settings-dashboard"/);
  assert.match(html, /class="settings-panel settings-panel-wide"/);
  assert.match(css, /\.settings-dashboard\s*\{[\s\S]*margin:\s*0/);
  assert.match(css, /\.settings-panel-host\s*\{/);
  assert.match(css, /@media\s*\(max-width:\s*880px\)/);
  assert.match(mainSource, /\.inner_size\(960\.0, 760\.0\)/);
});

test('settings page uses the Halo Control Room workbench layout', async () => {
  const html = await readFile(new URL('./settings.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');
  const mainSource = await readFile(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');

  assert.match(html, /class="settings-workbench"/);
  assert.match(html, /data-section-nav/);
  assert.match(html, /id="settings-save-status"/);
  assert.match(html, /data-section="display"/);
  assert.match(html, /data-section="animation"/);
  assert.match(html, /data-section="colors"/);
  assert.match(html, /data-view-target="appearance"/);
  assert.match(html, /data-view-target="colors"/);
  assert.match(html, /data-view-target="integration"/);
  assert.match(html, /data-view-target="test"/);
  assert.match(html, /data-view-template="appearance"/);
  assert.match(html, /id="particle-count"/);
  assert.match(html, /id="color-state-list"/);
  assert.match(html, /id="display-section"[^>]*>[\s\S]*?<\/fieldset>\s*<fieldset id="animation-section"/);
  assert.doesNotMatch(html, /data-section-target=/);
  assert.match(html, /<details[^>]+id="color-presets-details"/);
  assert.match(css, /\.settings-workbench\s*\{/);
  assert.match(css, /\.settings-sidebar\s*\{/);
  assert.match(css, /@media\s*\(max-width:\s*880px\)/);
  assert.match(source, /setSaveStatus\('saving'\)/);
  assert.match(source, /setSaveStatus\('saved'\)/);
  assert.match(source, /setSaveStatus\('error'\)/);
  assert.match(source, /settingsStore\.save\(\)/);
  assert.match(source, /const SETTINGS_VIEWS = \{/);
  assert.match(source, /function mountSettingsView\(viewId\)/);
  assert.match(source, /host\.replaceChildren\(/);
  assert.doesNotMatch(source, /const sectionNames = \[/);
  assert.match(mainSource, /\.inner_size\(960\.0, 760\.0\)/);
});

test('settings navigation mounts one strict section at a time', async () => {
  const html = await readFile(new URL('./settings.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

  assert.match(html, /data-section-nav[^>]*role="tablist"/);
  assert.match(html, /id="settings-panel-host"[^>]*role="tabpanel"/);
  assert.equal((html.match(/data-view-template=/g) ?? []).length, 4);
  assert.doesNotMatch(css, /scroll-margin-top/);
  assert.match(css, /@media\s*\(max-width:\s*880px\)[\s\S]*\.settings-header\s*\{[\s\S]*position:\s*static/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*button,[\s\S]*input:not\(\[type="checkbox"\]\),[\s\S]*select,[\s\S]*\.settings-nav-link[\s\S]*min-height:\s*40px/);
});

test('settings preserves the legacy animation tab as a hidden Appearance compatibility control', async () => {
  const html = await readFile(new URL('./settings.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');

  assert.equal((html.match(/id="settings-tab-animation"/g) ?? []).length, 1);
  assert.match(html, /<button id="settings-tab-animation"[^>]*hidden[^>]*data-settings-compat-target="appearance"/);
  assert.doesNotMatch(html, /id="settings-tab-animation"[^>]*role="tab"/);
  assert.deepEqual(
    [...html.matchAll(/<button[^>]*data-view-target="([^"]+)"/g)].map((match) => match[1]),
    ['appearance', 'colors', 'integration', 'test'],
  );
  assert.match(source, /document\.getElementById\('settings-tab-animation'\)/);
  assert.match(source, /settingsTabAnimation\?\.addEventListener\('click', \(\) => selectSettingsView\('appearance', true\)\)/);
});

test('settings View controller mounts one View and roves focus through navigation', async () => {
  const tabs = [];
  let focusedTab = null;
  const makeTab = (viewId) => {
    const listeners = new Map();
    return {
      id: `settings-tab-${viewId}`,
      dataset: { viewTarget: viewId },
      classList: { toggle() {} },
      tabIndex: -1,
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      dispatch(type, event) {
        listeners.get(type)?.(event);
      },
      focus() {
        focusedTab = this;
      },
      setAttribute() {},
    };
  };
  const viewIds = ['appearance', 'colors', 'integration', 'test'];
  tabs.push(...viewIds.map(makeTab));
  const host = {
    children: [],
    querySelectorAll() {
      return [];
    },
    replaceChildren(...children) {
      this.children = children;
    },
    setAttribute() {},
  };
  const templates = new Map(viewIds.map((viewId) => [viewId, {
    content: {
      cloneNode() {
        return { viewId };
      },
    },
  }]));
  const fakeDocument = {
    body: { classList: { contains: () => false } },
    documentElement: { lang: 'en' },
    getElementById: (id) => id === 'settings-panel-host' ? host : null,
    querySelectorAll: (selector) => selector === '[data-view-target]' ? tabs : [],
    querySelector: (selector) => {
      const match = selector.match(/^\[data-view-template="(.+)"\]$/);
      return match ? templates.get(match[1]) ?? null : null;
    },
  };
  const fakeWindow = { setInterval: () => 1 };
  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;

  try {
    const settingsModule = await import(`./settings.js?view-controller-test=${Date.now()}`);
    assert.equal(typeof settingsModule.createSettingsViewController, 'function');

    const views = Object.fromEntries(viewIds.map((viewId) => [viewId, {
      template: viewId,
      labelKey: `settings.${viewId}`,
      bind() {},
    }]));
    const controller = settingsModule.createSettingsViewController({
      views,
      host,
      tabs,
      getTemplate: (view) => templates.get(view.template),
    });

    controller.bind();
    assert.equal(controller.getActiveView(), 'appearance');
    assert.deepEqual(host.children, [{ viewId: 'appearance' }]);

    let prevented = false;
    tabs[0].dispatch('keydown', {
      key: 'ArrowRight',
      preventDefault() {
        prevented = true;
      },
    });

    assert.equal(prevented, true);
    assert.equal(controller.getActiveView(), 'colors');
    assert.deepEqual(host.children, [{ viewId: 'colors' }]);
    assert.equal(host.children.length, 1);
    assert.equal(tabs[0].tabIndex, -1);
    assert.equal(tabs[1].tabIndex, 0);
    assert.equal(focusedTab, tabs[1]);
  } finally {
    delete globalThis.document;
    delete globalThis.window;
  }
});

test('settings page exposes plugin install controls and no legacy hook controls', async () => {
  const html = await readFile(new URL('./settings.html', import.meta.url), 'utf8');
  const i18n = await readFile(new URL('./i18n.js', import.meta.url), 'utf8');
  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');

  assert.match(html, /id="install-plugin"/);
  assert.match(html, /id="uninstall-plugin"/);
  assert.doesNotMatch(html, /install-hooks|remove-hooks|legacyHooks/);
  assert.match(i18n, /'settings\.installPlugin'/);
  assert.match(i18n, /'settings\.uninstallPlugin'/);
  assert.doesNotMatch(i18n, /settings\.installLegacyHooks|settings\.removeLegacyHooks/);
  assert.doesNotMatch(source, /get_hook_status|install_hooks|remove_hooks/);
});

test('native app exposes plugin install actions and bundles its marketplace', async () => {
  const mainSource = await readFile(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
  const config = await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8');

  assert.match(mainSource, /fn install_plugin/);
  assert.match(mainSource, /fn uninstall_plugin/);
  assert.match(mainSource, /plugin-operation/);
  assert.match(mainSource, /install_plugin/);
  assert.match(mainSource, /uninstall_plugin/);
  assert.doesNotMatch(mainSource, /fn install_hooks|fn remove_hooks|fn get_hook_status/);
  assert.doesNotMatch(mainSource, /helper_install_paths|legacy_state_dir/);
  assert.match(config, /codex-halo-marketplace/);
  assert.match(config, /plugins\/codex-halo/);
});

test('settings language flow saves once and redraws raw setup errors', async () => {
  class FakeElement {
    constructor({ id = '', type = 'text', value = '', checked = false, dataset = {}, children = [] } = {}) {
      this.id = id;
      this.type = type;
      this.value = value;
      this.checked = checked;
      this.disabled = false;
      this.dataset = dataset;
      this.children = children;
      this.textContent = '';
      this.attributes = {};
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    dispatch(type) {
      for (const listener of this.listeners.get(type) ?? []) listener({ target: this });
    }

    setAttribute(name, value) {
      this.attributes[name] = value;
    }

    querySelector(selector) {
      return this.children.find((child) => {
        const match = selector.match(/^\[data-i18n="(.+)"\]$/);
        return match && child.dataset.i18n === match[1];
      }) ?? null;
    }
  }

  const fields = [
    new FakeElement({ id: 'enabled', type: 'checkbox', checked: true }),
    new FakeElement({ id: 'opacity', type: 'range', value: '1' }),
    new FakeElement({ id: 'offset-x', type: 'number', value: '28' }),
    new FakeElement({ id: 'offset-y', type: 'number', value: '140' }),
    new FakeElement({ id: 'curve-id', type: 'select', value: 'rose-seven' }),
    new FakeElement({ id: 'particle-count', type: 'number', value: '64' }),
    new FakeElement({ id: 'trail-span', type: 'number', value: '0.4' }),
    new FakeElement({ id: 'duration-ms', type: 'number', value: '420' }),
    new FakeElement({ id: 'pulse-duration-ms', type: 'number', value: '1200' }),
    new FakeElement({ id: 'rotation-duration-ms', type: 'number', value: '4200' }),
    new FakeElement({ id: 'stroke-width', type: 'number', value: '4' }),
    new FakeElement({ id: 'start-at-login', type: 'checkbox', checked: false }),
    new FakeElement({ id: 'follow-codex-lifecycle', type: 'checkbox', checked: false }),
    new FakeElement({ id: 'language', type: 'select', value: 'en', dataset: { i18nAriaLabel: 'settings.language' } }),
  ];
  const pluginStatus = new FakeElement({ dataset: { i18n: 'settings.pluginReady' } });
  const diagnostics = new FakeElement({ dataset: { i18n: 'settings.diagnosticsLoading' } });
  const formula = new FakeElement({ dataset: { i18nAriaLabel: 'settings.activeFormula' } });
  const elements = new Map([
    ['plugin-status', pluginStatus],
    ['install-plugin', new FakeElement()],
    ['uninstall-plugin', new FakeElement()],
    ['diagnostics', diagnostics],
    ['formula', formula],
    ['export-diagnostics', new FakeElement()],
    ['reset-position', new FakeElement()],
    ...fields.map((field) => [field.id, field]),
  ]);
  const translated = [
    pluginStatus,
    diagnostics,
  ];
  const listeners = new Map();
  const saveCalls = [];
  const warnings = [];
  const invoke = async (command, args) => {
    if (command === 'get_settings') return { ...DEFAULT_APP_SETTINGS };
    if (command === 'get_display_state') return { state: 'idle', updated_at_ms: 0 };
    if (command === 'save_settings') {
      saveCalls.push(args);
      throw 'start-at-login:permission';
    }
    return null;
  };
  const fakeDocument = {
    activeElement: null,
    documentElement: { lang: 'en' },
    title: 'Codex Halo Settings',
    getElementById: (id) => elements.get(id) ?? null,
    querySelectorAll: (selector) => {
      if (selector === 'input, select') return fields;
      if (selector === '[data-i18n]') return translated;
      if (selector === '[data-i18n-aria-label]') return [fields.at(-1), formula];
      if (selector === '[data-state]') return [];
      return [];
    },
  };
  const fakeWindow = {
    __TAURI__: {
      core: { invoke },
      event: {
        listen: (event, callback) => {
          listeners.set(event, callback);
          return Promise.resolve();
        },
      },
    },
    setInterval: () => 1,
  };
  const originalWarn = console.warn;
  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;
  console.warn = (...args) => warnings.push(args);

  try {
    await import(`./settings.js?runtime-test=${Date.now()}`);
    await new Promise((resolve) => setImmediate(resolve));

    await listeners.get('settings-changed')({ payload: { language: 'zh-CN', curve_id: 'rose-seven' } });
    assert.equal(fields.at(-1).value, 'zh-CN');
    assert.equal(saveCalls.length, 0);

    fields.at(-1).value = 'en';
    fields.at(-1).dispatch('change');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(saveCalls.length, 1);
    assert.equal(saveCalls[0].settings.language, 'en');

    await listeners.get('settings-changed')({ payload: { language: 'zh-CN', curve_id: 'rose-seven' } });
    assert.equal(saveCalls.length, 1);
    assert.match(diagnostics.textContent, /设置错误: 启动时设置失败（权限）/);
    assert.deepEqual(warnings, [['Codex Halo: start-at-login setup failed (permission)']]);

    await listeners.get('plugin-operation')({ payload: 'installed' });
    assert.equal(pluginStatus.textContent, 'Plugin 已安装');
    assert.equal(elements.get('install-plugin').disabled, false);
    assert.equal(elements.get('uninstall-plugin').disabled, false);
  } finally {
    console.warn = originalWarn;
    delete globalThis.document;
    delete globalThis.window;
  }
});

test('autostart disable treats an absent entry as already disabled', async () => {
  const source = await readFile(new URL('../src-tauri/src/platform.rs', import.meta.url), 'utf8');

  assert.match(source, /if !enabled/);
  assert.match(source, /Ok\(false\) => return Ok\(\(\)\)/);
});

test('settings saves run in enqueue order even when later work resolves first', async () => {
  const queue = createSerialTaskQueue();
  const started = [];
  const finished = [];
  let releaseFirst;
  const first = queue(async () => {
    started.push('first');
    await new Promise((resolve) => { releaseFirst = resolve; });
    finished.push('first');
  });
  const second = queue(async () => {
    started.push('second');
    finished.push('second');
  });

  await Promise.resolve();
  assert.deepEqual(started, ['first']);
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(started, ['first', 'second']);
  assert.deepEqual(finished, ['first', 'second']);
});

test('renderer startup uses exact frontend defaults after get_settings fails', async () => {
  const appSource = await readFile(new URL('./app.js', import.meta.url), 'utf8');
  const settingsSource = await readFile(new URL('./settings.js', import.meta.url), 'utf8');
  const mainSource = await readFile(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');

  assert.deepEqual(DEFAULT_APP_SETTINGS, {
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
    idle_color: '#A7ADB5',
    thinking_color: '#FF8A3D',
    executing_color: '#339CFF',
    input_needed_color: '#F05252',
    completed_color: '#35C878',
    compacting_color: '#A56BFF',
    start_at_login: false,
    follow_codex_lifecycle: false,
    language: 'en',
  });
  assert.equal(DEFAULT_APP_SETTINGS.language, 'en');
  assert.match(appSource, /const settings = await invokeCommand\('get_settings'\) \?\? DEFAULT_APP_SETTINGS/);
  assert.match(appSource, /window\.setInterval\(displayBridge\.pollDisplayState, POLL_INTERVAL_MS\)/);
  assert.match(settingsSource, /applySettings\(settings\.ok \? settings\.value : DEFAULT_APP_SETTINGS, \{ preserveLocalEdits: true \}\)/);
  assert.match(mainSource, /settings_transaction: Mutex<\(\)>/);
  assert.match(mainSource, /settings_transaction[\s\S]*?\.lock\(\)/);
});

test('lifecycle sync is wired into startup and settings transactions', async () => {
  const mainSource = await readFile(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
  const lifecycleSource = await readFile(new URL('../src-tauri/src/lifecycle.rs', import.meta.url), 'utf8');
  const transactionSource = mainSource.slice(
    mainSource.indexOf('fn save_settings_transaction'),
    mainSource.indexOf('fn read_snapshots'),
  );

  assert.match(lifecycleSource, /pub fn write_config\(path: &Path, config: &LifecycleConfig\)/);
  assert.match(lifecycleSource, /pub fn sync_app/);
  assert.equal((mainSource.match(/lifecycle::sync_app\(/g) ?? []).length, 2);
  assert.match(mainSource, /build_windows[\s\S]*?lifecycle::sync_app/);
  assert.match(transactionSource, /follow_codex_lifecycle/);
});

test('macOS lifecycle setup has one watcher start owner', async () => {
  const lifecycleSource = await readFile(new URL('../src-tauri/src/lifecycle.rs', import.meta.url), 'utf8');
  const macStartSource = lifecycleSource.match(
    /#\[cfg\(target_os = "macos"\)\]\s*fn spawn_watcher_if_missing[\s\S]*?\n\}/,
  );
  const nonMacStartSource = lifecycleSource.match(
    /#\[cfg\(not\(target_os = "macos"\)\)\]\s*fn spawn_watcher_if_missing[\s\S]*?\n\}/,
  );

  assert(macStartSource);
  assert.doesNotMatch(macStartSource[0], /process_listing|Command::new/);
  assert(nonMacStartSource);
  assert.match(nonMacStartSource[0], /process_listing/);
  assert.match(nonMacStartSource[0], /WATCHER_PROCESS_NAMES/);
  assert.match(nonMacStartSource[0], /Command::new/);
});

test('settings page exposes state color tabs and one active editor', async () => {
  const html = await readFile(new URL('./settings.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');
  const colors = await readFile(new URL('./colors.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

  for (const state of ['idle', 'thinking', 'executing', 'input_needed', 'completed', 'compacting']) {
    assert.match(colors, new RegExp(`${state}:`));
  }
  assert.doesNotMatch(html, /id="preset-state"/);
  assert.match(html, /id="color-state-tabs"[^>]*role="tablist"/);
  assert.match(html, /id="color-state-panel"[^>]*role="tabpanel"/);
  assert.match(html, /id="color-presets"/);
  assert.match(source, /COLOR_PRESET_GROUPS/);
  assert.match(source, /selectedColorState/);
  assert.match(source, /function mountColorStateDetail\(/);
  assert.doesNotMatch(source, /function mountColorState\(/);
  assert.match(source, /settingsStore\.getSettings\(\)/);
  assert.match(source, /saveCurrentSettings/);
  assert.match(css, /\.color-state-tabs\s*\{/);
  assert.match(css, /\.color-state-tab\[aria-selected="true"\]/);
});

test('settings page exposes a master-detail state color editor', async () => {
  const html = await readFile(new URL('./settings.html', import.meta.url), 'utf8');
  const settingsSource = await readFile(new URL('./settings.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

  assert.match(html, /id="color-state-list"/);
  assert.match(html, /id="color-state-tabs"[^>]*role="tablist"[^>]*aria-orientation="vertical"/);
  assert.match(settingsSource, /renderColorStateList/);
  assert.match(settingsSource, /mountColorStateDetail/);
  assert.match(settingsSource, /STATE_COLOR_KEYS/);
  assert.match(css, /\.color-master-detail\s*\{/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*\.color-master-detail\s*\{[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.color-state-tabs\s*\{\s*grid-template-columns:\s*1fr;\s*\}[\s\S]*?\.settings-subsection/);
  assert.match(css, /\.settings-shell\s*\{[\s\S]*align-content:\s*start/);
});

test('settings color list preserves invalid Hex drafts after blur and refresh', async () => {
  class FakeNode {
    constructor({ tagName = 'div', id = '', type = '', value = '', checked = false, dataset = {}, children = [] } = {}) {
      this.tagName = tagName;
      this.id = id;
      this.type = type;
      this.value = value;
      this.checked = checked;
      this.dataset = { ...dataset };
      this.children = [...children];
      this.attributes = {};
      this.listeners = new Map();
      this.style = {};
      this.classList = { toggle() {} };
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    dispatch(type, event = {}) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener({ target: this, currentTarget: this, ...event });
      }
    }

    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }

    getAttribute(name) {
      return this.attributes[name];
    }

    toggleAttribute(name, force) {
      if (force === false) delete this.attributes[name];
      else if (force === true || !Object.hasOwn(this.attributes, name)) this.attributes[name] = '';
    }

    append(...children) {
      this.children.push(...children);
    }

    replaceChildren(...children) {
      if (this.children.includes(fakeDocument.activeElement)) fakeDocument.activeElement = null;
      this.children = children.flatMap((child) => child.tagName === '#fragment' ? child.children : [child]);
    }

    querySelectorAll(selector) {
      return collectNodes(this).filter((node) => matchesSelector(node, selector));
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }

    focus() {
      fakeDocument.activeElement = this;
    }

    setCustomValidity(message) {
      this.validationMessage = message;
    }

    reportValidity() {}
  }

  const matchesSelector = (node, selector) => {
    if (selector === 'input, select') return node.tagName === 'input' || node.tagName === 'select';
    if (selector === '[data-state]') return node.dataset?.state !== undefined;
    if (selector === '[data-i18n]') return node.dataset?.i18n !== undefined;
    if (selector === '[data-i18n-aria-label]') return node.dataset?.i18nAriaLabel !== undefined;
    if (selector === 'button[data-color-reset]') return node.tagName === 'button' && node.dataset?.colorReset !== undefined;
    const stateLabelMatch = selector.match(/^\[data-color-state-label\]$/);
    if (stateLabelMatch) return node.dataset?.colorStateLabel !== undefined;
    return false;
  };

  const collectNodes = (root) => [
    ...root.children.flatMap((child) => [child, ...collectNodes(child)]),
  ];
  const fakeDocument = {
    activeElement: null,
    documentElement: { lang: 'en' },
    title: 'Codex Halo Settings',
  };
  const make = (options) => new FakeNode(options);
  const settingsPanelHost = make({ id: 'settings-panel-host' });
  const language = make({ tagName: 'select', id: 'language', value: 'en', dataset: { i18nAriaLabel: 'settings.language' } });
  const enabled = make({ tagName: 'input', id: 'enabled', type: 'checkbox', checked: true });
  const saveStatus = make({ id: 'settings-save-status', dataset: { i18n: 'settings.saveStatus.ready' } });
  const viewTabs = ['appearance', 'colors', 'integration', 'test'].map((viewId) => make({
    tagName: 'button',
    id: `settings-tab-${viewId}`,
    dataset: { viewTarget: viewId },
  }));
  const templates = new Map();
  for (const viewId of ['appearance', 'colors', 'integration', 'test']) {
    templates.set(viewId, {
      content: {
        cloneNode() {
          if (viewId !== 'colors') return { tagName: 'fieldset', children: [] };
          const list = make({ id: 'color-state-list' });
          list.append(make({ id: 'color-state-tabs' }));
          return {
            tagName: '#fragment',
            children: [
              make({ tagName: 'fieldset', id: 'colors-section', children: [
                list,
                make({ id: 'color-state-panel' }),
                make({ tagName: 'details', id: 'color-presets-details', children: [make({ id: 'color-presets' })] }),
              ] }),
            ],
          };
        },
      },
    });
  }

  const staticElements = new Map([
    ['settings-panel-host', settingsPanelHost],
    ['language', language],
    ['enabled', enabled],
    ['settings-save-status', saveStatus],
  ]);
  const findById = (id) => {
    const staticElement = staticElements.get(id);
    if (staticElement) return staticElement;
    return collectNodes(settingsPanelHost).find((node) => node.id === id) ?? null;
  };
  fakeDocument.getElementById = (id) => findById(id);
  fakeDocument.querySelectorAll = (selector) => {
    if (selector === '[data-view-target]') return viewTabs;
    return [language, enabled, saveStatus, ...collectNodes(settingsPanelHost)].filter((node) => matchesSelector(node, selector));
  };
  fakeDocument.querySelector = (selector) => {
    const templateMatch = selector.match(/^\[data-view-template="(.+)"\]$/);
    if (templateMatch) return templates.get(templateMatch[1]) ?? null;
    return fakeDocument.querySelectorAll(selector)[0] ?? null;
  };
  fakeDocument.createElement = (tagName) => make({ tagName });

  const saveCalls = [];
  const listeners = new Map();
  const invoke = async (command, args) => {
    if (command === 'get_settings') return { ...DEFAULT_APP_SETTINGS };
    if (command === 'get_display_state') return { state: 'idle', updated_at_ms: 0 };
    if (command === 'save_settings') {
      saveCalls.push(args.settings);
      return null;
    }
    return null;
  };
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.document = fakeDocument;
  globalThis.window = {
    __TAURI__: {
      core: { invoke },
      event: {
        listen: (event, handler) => {
          listeners.set(event, handler);
          return Promise.resolve();
        },
      },
    },
    setInterval: () => 1,
  };

  try {
    const settingsModule = await import(`./settings.js?master-detail-test=${Date.now()}`);
    await new Promise((resolve) => setImmediate(resolve));
    viewTabs[1].dispatch('click');

    const stateTabs = () => findById('color-state-tabs').children;
    const stateRow = (state) => stateTabs().find((row) => row.dataset.colorState === state);
    const rowHex = (state) => stateRow(state).children[1].children[1].textContent;
    const rowSwatch = (state) => stateRow(state).children[0].style.backgroundColor;
    const mountedEditors = () => collectNodes(findById('color-state-panel'))
      .filter((node) => node.className === 'color-editor');
    assert.equal(stateTabs().length, 6);
    assert.equal(stateTabs().filter((row) => row.getAttribute('aria-selected') === 'true').length, 1);
    assert.deepEqual(stateTabs().map((row) => row.tabIndex), [0, -1, -1, -1, -1, -1]);

    let prevented = false;
    stateRow('idle').dispatch('keydown', {
      key: 'ArrowDown',
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    assert.equal(stateRow('thinking').getAttribute('aria-selected'), 'true');
    assert.deepEqual(stateTabs().map((row) => row.tabIndex), [-1, 0, -1, -1, -1, -1]);
    assert.equal(fakeDocument.activeElement.id, 'color-tab-thinking');

    stateRow('thinking').dispatch('keydown', { key: 'Home', preventDefault() {} });
    assert.equal(stateRow('idle').getAttribute('aria-selected'), 'true');
    stateRow('idle').dispatch('keydown', { key: 'End', preventDefault() {} });
    assert.equal(stateRow('compacting').getAttribute('aria-selected'), 'true');
    assert.equal(mountedEditors().length, 1);

    stateRow('thinking').dispatch('click');
    const thinkingPicker = findById('thinking-color');
    thinkingPicker.value = '#112233';
    thinkingPicker.dispatch('input');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(rowSwatch('thinking'), '#112233');
    assert.equal(rowHex('thinking'), '#112233');
    assert.equal(saveCalls.at(-1).thinking_color, '#112233');

    const thinkingHex = findById('thinking-color-hex');
    thinkingHex.value = '#C0FFEE';
    thinkingHex.dispatch('change');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(rowSwatch('thinking'), '#C0FFEE');
    assert.equal(rowHex('thinking'), '#C0FFEE');
    assert.equal(saveCalls.at(-1).thinking_color, '#C0FFEE');

    const preset = collectNodes(findById('color-presets')).find((node) => node.className === 'color-swatch');
    preset.dispatch('click');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(preset.children.at(-1).textContent, '佛手');
    assert.equal(preset.getAttribute('title'), '佛手');
    assert.equal(preset.getAttribute('aria-label'), '佛手');
    assert.equal(rowSwatch('thinking'), '#FED71A');
    assert.equal(rowHex('thinking'), '#FED71A');

    const reset = collectNodes(findById('color-state-panel'))
      .find((node) => node.dataset?.colorReset === 'thinking');
    reset.dispatch('click');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(rowSwatch('thinking'), '#FF8A3D');
    assert.equal(rowHex('thinking'), '#FF8A3D');

    thinkingHex.value = '#C0FFEE';
    thinkingHex.dispatch('change');
    await new Promise((resolve) => setImmediate(resolve));
    stateRow('completed').dispatch('click');
    const completedHex = findById('completed-color-hex');
    fakeDocument.activeElement = completedHex;
    completedHex.value = '#12345';
    completedHex.dispatch('change');
    assert.equal(completedHex.value, '#12345');
    assert.equal(completedHex.validationMessage, 'Use #RRGGBB');
    assert.equal(saveCalls.length, 5);
    fakeDocument.activeElement = null;
    await listeners.get('settings-changed')({ payload: { completed_color: '#35C878' } });
    assert.equal(completedHex.value, '#12345');
    assert.equal(completedHex.validationMessage, 'Use #RRGGBB');
    assert.equal(saveCalls.length, 5);
    language.value = 'zh-CN';
    language.dispatch('change');
    assert.equal(completedHex.value, '#12345');
    assert.equal(completedHex.validationMessage, '请输入 #RRGGBB');
    assert.equal(mountedEditors().length, 1);

    stateRow('thinking').dispatch('click');
    assert.equal(findById('thinking-color-hex').value, '#C0FFEE');
    assert.equal(mountedEditors().length, 1);

    stateRow('thinking').focus();
    await listeners.get('settings-changed')({ payload: { language: 'zh-CN' } });
    assert.equal(fakeDocument.activeElement.id, 'color-tab-thinking');
    assert.equal(typeof settingsModule.createSettingsViewController, 'function');
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('settings color controls use one active editor and preserve the full color model', async () => {
  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');

  assert.match(source, /settingsStore\.patchSetting\(key, normalized\)/);
  assert.match(source, /function mountColorStateDetail\(state = settingsStore\.getUiState\(\)\.selectedColorState\)/);
  assert.doesNotMatch(source, /function mountColorState\(/);
  assert.match(source, /panel\.replaceChildren\(\)/);
  assert.match(source, /if \(!isHexColor\(value\)\)/);
  assert.match(source, /save_settings/);
});

test('settings changes reach both overlay and settings windows', async () => {
  const mainSource = await readFile(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
  const settingsSource = await readFile(new URL('./settings.js', import.meta.url), 'utf8');

  assert.match(mainSource, /for target in \["main", "settings"\]/);
  assert.match(mainSource, /app\.emit_to\(target, "settings-changed", settings\.clone\(\)\)/);
  assert.match(settingsSource, /settingsBridge\.subscribe\(\s*'settings-changed',\s*\(\{ payload \}\) => settingsStore\.enqueue\(\(\) => applySettings\(payload\)\)/);
});

test('macOS private API is target-scoped for cross-target checks', async () => {
  const cargo = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
  const config = await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8');
  const build = await readFile(new URL('../src-tauri/build.rs', import.meta.url), 'utf8');
  const globalDependencies = cargo.split('[target.')[0];

  assert.match(cargo, /\[target\.'cfg\(target_os = "macos"\)'\.dependencies\][\s\S]*tauri = \{ version = "2", features = \["macos-private-api"\] \}/);
  assert.doesNotMatch(globalDependencies, /tauri = \{ version = "2", features = \[[^\]]*"macos-private-api"/);
  assert.match(config, /"macOSPrivateApi": false/);
  assert.match(build, /TAURI_ENV_TARGET_TRIPLE=\{target\}/);
});

test('settings exposes a content-free local diagnostic download', async () => {
  const html = await readFile(new URL('./settings.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');

  assert.match(html, /id="export-diagnostics"/);
  assert.match(source, /new Blob\(/);
  assert.match(source, /codex-halo-diagnostics\.json/);
  assert.match(source, /state: diagnosticsSnapshot\.state/);
  assert.match(source, /updated_at_ms: diagnosticsSnapshot\.updated_at_ms/);
  assert.doesNotMatch(source, /prompt|transcript|tool_input|tool_response|model|cwd/);
});

test('owned hook lifecycle commands are synchronous and compact source is handled', async () => {
  const hooks = await readFile(new URL('../plugins/codex-halo/hooks/hooks.json', import.meta.url), 'utf8');
  const protocol = await readFile(new URL('../src-tauri/src/hook_protocol.rs', import.meta.url), 'utf8');

  assert.doesNotMatch(hooks, /"async"\s*:\s*true/);
  assert.match(hooks, /SessionStart/);
  assert.match(protocol, /source: Option<String>/);
  assert.match(protocol, /source\.as_deref\(\) == Some\("compact"\)/);
});

test('Windows autostart uses the native registry path and required feature', async () => {
  const platform = await readFile(new URL('../src-tauri/src/platform.rs', import.meta.url), 'utf8');
  const cargo = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');

  assert.match(platform, /Win32::System::Registry/);
  assert.match(platform, /RegSetValueExW/);
  assert.match(platform, /quote_windows_run_path/);
  assert.match(cargo, /"Win32_System_Registry"/);
});

test('README has English and Simplified Chinese variants', async () => {
  const english = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const chinese = await readFile(new URL('../README.zh-CN.md', import.meta.url), 'utf8');

  assert.match(english, /README\.zh-CN\.md/);
  assert.match(chinese, /README\.md/);
  assert.match(chinese, /本地运行/);
  assert.match(chinese, /隐私/);
  assert.match(english, /English|language/i);
});

test('lifecycle handoff and single-instance stop use a managed PID and token', async () => {
  const lifecycle = await readFile(new URL('../src-tauri/src/lifecycle.rs', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');

  assert.match(lifecycle, /managed_pid/);
  assert.match(lifecycle, /managed_pid:\s*enabled\.then_some\(std::process::id\(\)\)/);
  assert.match(lifecycle, /managed_token/);
  assert.match(lifecycle, /adopted_token/);
  assert.match(lifecycle, /OnceLock<String>/);
  assert.match(lifecycle, /adopted_pid/);
  assert.match(lifecycle, /--lifecycle-stop/);
  assert.match(lifecycle, /\.arg\(pid\.to_string\(\)\)[\s\S]*?\.arg\(token\)/);
  assert.match(lifecycle, /Command::new\([^)]*halo_path/);
  assert.match(main, /lifecycle_stop_targets/);
  assert.match(main, /lifecycle_stop_targets\([\s\S]*?std::process::id\(\)[\s\S]*?lifecycle::current_managed_token\(\)[\s\S]*?\)/);
  assert.match(main, /app\.exit\(0\)/);
  assert.match(main, /show_settings_or_report\(app\)/);
  assert.match(main, /setup_app[\s\S]*has_lifecycle_stop_marker/);
});

test('README documents combined Codex lifecycle ownership without assigning it to Plugin hooks', async () => {
  const documents = await Promise.all([
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../README.zh-CN.md', import.meta.url), 'utf8'),
    readFile(new URL('../plugins/codex-halo/README.md', import.meta.url), 'utf8'),
  ]);
  const [english, chinese, plugin] = documents;
  const pluginOwnsAppLifecycle = [
    /(?:Plugin hooks?|hooks?)[^.!?;:\n]*(?:start|stop|launch|quit|manage|control)[^.!?;:\n]*(?:App|application|Halo)/i,
    /(?:App|application|Halo)[^.!?;:\n]*(?:start|stop|launch|quit)[^.!?;:\n]*(?:Plugin|hooks?)/i,
    /(?:插件|hooks?)[^。！？；\n]*(?:启动|关闭|退出|控制)[^。！？；\n]*(?:应用|App|Halo)/i,
    /(?:应用|App|Halo)[^。！？；\n]*(?:启动|关闭|退出|控制)[^。！？；\n]*(?:插件|hooks?)/i,
  ];

  assert.match(english, /Follow Codex lifecycle/);
  assert.match(english, /native app manage[\s\S]*codex-halo-watch/i);
  assert.match(english, /all supported\s+Codex\s+processes exit/i);
  assert.match(chinese, /随 Codex 启停/);
  assert.match(chinese, /原生 App 管理[\s\S]*codex-halo-watch/);
  assert.match(chinese, /所有\s+支持的 Codex\s+进程都退出/);
  assert.match(plugin, /codex-halo-watch/);
  assert.match(plugin, /native Tauri app manages[\s\S]*codex-halo-watch/i);
  assert.match(plugin, /only defines lifecycle hooks and writes state snapshots/i);
  for (const document of documents) {
    for (const pattern of pluginOwnsAppLifecycle) assert.doesNotMatch(document, pattern);
  }
  for (const badWording of [
    'Plugin hooks start the App.',
    'The App is stopped by Plugin hooks.',
    'Plugin hooks launch and quit the Halo App.',
    '插件负责启动和关闭应用。',
  ]) {
    assert(pluginOwnsAppLifecycle.some((pattern) => pattern.test(badWording)), badWording);
  }
});
