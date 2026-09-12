import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as curves from './curves.js';
import * as app from './app.js';
import * as colors from './colors.js';
import * as i18n from './i18n.js';
import { createSettingsBridge } from './settings-bridge.js';
import { createSettingsStore } from './settings-store.js';
import { createAudioFrameReceiver } from './audio.js';
import { createCurvePicker, createCurveSelection } from './curve-picker.js';

const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');
const curveKeys = ['curve_id', 'curve_parameters', 'particle_count', 'trail_span', 'duration_ms', 'pulse_duration_ms', 'rotation_duration_ms', 'stroke_width'];
const pickCurve = (settings) => Object.fromEntries(curveKeys.map((key) => [key, settings[key]]));

async function fixture() {
  const saves = [];
  const events = new Map();
  const domEvents = new Map();
  const nodes = new Map(['undo-curve', 'retry-save', 'settings-save-status', 'setup-guide', 'dismiss-setup-guide', 'open-connection-guide'].map((id) => [id, {
    id, hidden: true, disabled: false, dataset: {}, listeners: new Map(),
    addEventListener(type, callback) { this.listeners.set(type, callback); },
  }]));
  const initial = { ...app.DEFAULT_APP_SETTINGS, curve_parameters: { baseRadius: 8 }, particle_count: 123, duration_ms: 4637, opacity: 0.46 };
  let failures = 0;
  let nextSaveBlock;
  const commands = [];
  const document = {
    hidden: false, activeElement: null, documentElement: {},
    getElementById: (id) => nodes.get(id) ?? null,
    querySelectorAll: () => [], querySelector: () => null,
    addEventListener: (name, callback) => domEvents.set(name, callback),
  };
  const context = vm.createContext({
    ...curves, ...app, ...colors, ...i18n, createSettingsBridge, createSettingsStore, createAudioFrameReceiver,
    createCurvePicker, createCurveSelection, createSettingsPreview: () => null,
    console: { warn() {} }, structuredClone, document,
    window: { setInterval() {}, __TAURI__: {
      event: { listen: async (name, callback) => { events.set(name, callback); } },
      core: { invoke: async (command, args) => {
        commands.push([command, args]);
        if (command === 'get_settings') return initial;
        if (command === 'get_display_state') return { state: 'idle', updated_at_ms: 0 };
        if (command === 'simulate_state') return { state: args.state, updated_at_ms: 0 };
        if (command === 'save_settings') {
          saves.push(structuredClone(args.settings));
          if (nextSaveBlock) { const blocked = nextSaveBlock; nextSaveBlock = null; await blocked; }
          if (failures-- > 0) throw new Error('injected save failure');
          return args.settings;
        }
        return null;
      } },
    } },
  });
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace('export function', 'function'), context);
  const run = (code) => vm.runInContext(code, context);
  await run('initialSettingsLoadPromise');
  return { run, nodes, saves, events, commands, document, domEvents, context, fail: () => { failures = 1; },
    blockSave() { let release; nextSaveBlock = new Promise((resolve) => { release = resolve; }); return release; },
  };
}

test('curve restoration retains eight prior values and all newer unrelated edits', async () => {
  const f = await fixture();
  const before = pickCurve(f.run('settingsStore.getSettings()'));
  await f.run("curveSelection.apply('heart-wave')");
  assert.equal(f.nodes.get('undo-curve').hidden, false, 'applying a different curve offers restoration');
  f.run("settingsStore.mergeSettings({ opacity: 0.8, thinking_color: '#123456', audio_enabled: true, offset_x: 413, language: 'zh-CN' })");
  await f.run('undoCurveChange()');
  assert.deepEqual(pickCurve(f.saves.at(-1)), before);
  assert.deepEqual([f.saves.at(-1).opacity, f.saves.at(-1).thinking_color, f.saves.at(-1).audio_enabled, f.saves.at(-1).offset_x, f.saves.at(-1).language], [0.8, '#123456', true, 413, 'zh-CN']);
  assert.equal(f.nodes.get('undo-curve').hidden, true);
  await f.events.get('settings-changed')({ payload: f.saves[0] });
  assert.equal(f.run('settingsStore.getSettings().stroke_width'), 3.9, 'a later full external restore is not mistaken for a remembered own echo');
});

test('restoration survives own echoes and rejected old values but expires on accepted external geometry or window hide', async () => {
  const f = await fixture();
  await f.run("curveSelection.apply('heart-wave')");
  await f.events.get('settings-changed')({ payload: f.saves.at(-1) });
  assert.equal(f.nodes.get('undo-curve').hidden, false);
  await f.events.get('settings-changed')({ payload: { opacity: 0.7 } });
  assert.equal(f.nodes.get('undo-curve').hidden, false);
  f.run("localSettingEdits.add('stroke_width')");
  await f.events.get('settings-changed')({ payload: { stroke_width: 7 } });
  assert.equal(f.nodes.get('undo-curve').hidden, false, 'rejected stale field must not invalidate');
  f.run('localSettingEdits.clear()');
  await f.events.get('settings-changed')({ payload: { stroke_width: 7 } });
  assert.equal(f.nodes.get('undo-curve').hidden, true);
  await f.run("curveSelection.apply('rose-two')");
  f.document.hidden = true;
  f.domEvents.get('visibilitychange')?.();
  assert.equal(f.nodes.get('undo-curve').hidden, true, 'hiding settings ends the restoration session');
});

test('failed apply and restore retries save latest values without recapturing or losing invalid color drafts', async () => {
  const f = await fixture();
  const before = pickCurve(f.run('settingsStore.getSettings()'));
  f.fail();
  await f.run("curveSelection.apply('heart-wave')");
  assert.equal(f.nodes.get('retry-save').hidden, false);
  f.run("settingsStore.patchSetting('opacity', 0.8); setInvalidColorDraft('thinking', '#12345')");
  await f.run('curveSelection.retry()');
  assert.equal(f.saves.at(-1).opacity, 0.8);
  f.fail();
  await f.run('undoCurveChange()');
  assert.deepEqual(pickCurve(f.saves.at(-1)), before, 'retry did not replace the prior snapshot');
  assert.equal(f.nodes.get('undo-curve').hidden, false, 'failed restoration remains recoverable');
  f.run("settingsStore.patchSetting('opacity', 0.9)");
  await f.nodes.get('retry-save').listeners.get('click')();
  assert.equal(f.saves.at(-1).opacity, 0.9);
  assert.equal(f.run("settingsStore.getUiState().invalidColorDrafts.thinking"), '#12345');
  assert.equal(f.nodes.get('undo-curve').hidden, true, 'successful retry completes restoration');
});

test('an older own echo received behind a newer local save cannot revert that edit or expire restoration', async () => {
  const f = await fixture();
  const release = f.blockSave();
  const first = f.run("curveSelection.apply('heart-wave')");
  await new Promise(setImmediate);
  f.run("settingsStore.patchSetting('stroke_width', 6); localSettingEdits.add('stroke_width')");
  const second = f.run('saveCurrentSettings()');
  const oldEcho = f.events.get('settings-changed')({ payload: f.saves[0] });
  release();
  await Promise.all([first, second, oldEcho]);
  assert.equal(f.saves.at(-1).stroke_width, 6);
  assert.equal(f.run('settingsStore.getSettings().stroke_width'), 6, 'late processing of an own echo must not restore the older value');
  assert.equal(f.nodes.get('undo-curve').hidden, false);
  await f.events.get('settings-changed')({ payload: { stroke_width: 7 } });
  assert.equal(f.run('settingsStore.getSettings().stroke_width'), 7, 'accepted external edits still apply');
  assert.equal(f.nodes.get('undo-curve').hidden, true);
});

test('only explicitly scoped desktop controls send simulate_state', async () => {
  const f = await fixture();
  const button = { dataset: { desktopTestState: 'completed' }, addEventListener: (_, callback) => { button.click = callback; } };
  const local = { dataset: { state: 'thinking' }, addEventListener: () => assert.fail('local preview must not bind desktop simulation') };
  f.nodes.set('desktop-test-controls', { querySelectorAll: (selector) => selector === '[data-desktop-test-state]' ? [button] : [local] });
  f.run('bindTestActions()');
  assert.equal(typeof button.click, 'function', 'desktop controls remain operable on Integration');
  await button.click();
  assert.deepEqual(f.commands.filter(([command]) => command === 'simulate_state').map(([command, args]) => [command, args.state]), [['simulate_state', 'completed']]);
});

test('retry disables immediately while queued and submits only once under repeated activation', async () => {
  const f = await fixture();
  f.fail();
  await f.run('saveCurrentSettings()');
  let release;
  f.context.blocked = new Promise((resolve) => { release = resolve; });
  const blocker = f.run('settingsStore.enqueue(() => blocked)');
  const retry = f.nodes.get('retry-save');
  f.document.activeElement = retry;
  const first = retry.listeners.get('click')();
  assert.equal(retry.disabled, true, 'lock the action before waiting for the save queue');
  assert.equal(retry.hidden, false, 'the focused action stays visible while pending');
  const second = retry.listeners.get('click')();
  f.run("settingsStore.patchSetting('opacity', 0.82)");
  release();
  await Promise.all([blocker, first, second]);
  assert.equal(f.saves.length, 2, 'one failed original save plus exactly one retry');
  assert.equal(f.saves.at(-1).opacity, 0.82);
  assert.equal(retry.disabled, false);
  assert.equal(retry.hidden, true);
});

test('dismissed setup guidance is optional storage and never writes application settings', async () => {
  const f = await fixture();
  f.context.window.localStorage = { getItem() { throw new Error('storage denied'); }, setItem() { throw new Error('storage denied'); } };
  f.run('bindSetupGuide()');
  assert.equal(f.nodes.get('setup-guide').hidden, false);
  assert.doesNotThrow(() => f.nodes.get('dismiss-setup-guide').listeners.get('click')());
  assert.equal(f.nodes.get('setup-guide').hidden, true);
  assert.equal(f.saves.length, 0);
});

test('setup guidance appears only on Appearance and retains dismissal across navigation', async () => {
  const f = await fixture();
  const guide = f.nodes.get('setup-guide');
  assert.equal(guide.hidden, false);
  f.run("settingsStore.setUi({ activeView: 'integration' }); renderLanguage()");
  assert.equal(guide.hidden, true, 'Integration already contains the full connection instructions');
  f.run("settingsStore.setUi({ activeView: 'appearance' }); renderLanguage()");
  assert.equal(guide.hidden, false);
  f.nodes.get('dismiss-setup-guide').listeners.get('click')();
  f.run("settingsStore.setUi({ activeView: 'integration' }); renderLanguage(); settingsStore.setUi({ activeView: 'appearance' }); renderLanguage()");
  assert.equal(guide.hidden, true);
});
