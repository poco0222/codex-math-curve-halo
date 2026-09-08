import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createSettingsStore } from './settings-store.js';
import { getText } from './i18n.js';

const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');

test('transient audio frames are isolated from shared store reads and saved settings', async () => {
  let saved;
  const store = createSettingsStore({ defaults: { audio_enabled: true, audio_intensity: 0.5 }, persist: async value => { saved = value; } });
  const frame = { status: 'capturing', level: 0.6 };
  store.setUi({ audioFrame: frame });
  frame.level = 1;
  store.getUiState().audioFrame.level = 0;
  assert.equal(store.getUiState().audioFrame.level, 0.6);
  await store.save();
  assert.deepEqual(saved, { audio_enabled: true, audio_intensity: 0.5 });
});

test('audio UI reflects capture truth, retains intensity, and never disables the off switch', () => {
  const start = source.indexOf('function renderAudioState(');
  assert.notEqual(start, -1, 'audio status renderer exists');
  const end = source.indexOf('\nasync function retryAudioCapture', start);
  const nodes = new Map(['audio-status', 'audio-intensity', 'audio-level', 'audio-help', 'audio-retry', 'audio-enabled'].map(id => [id, {
    textContent: '', disabled: false, hidden: false, value: 0, setAttribute() {},
  }]));
  const store = createSettingsStore({ defaults: { audio_enabled: true, audio_intensity: 0, language: 'en' }, persist: async () => {} });
  let timestamp = 1000;
  const context = vm.createContext({ settingsStore: store, document: { getElementById: id => nodes.get(id) }, getText, Date: { now: () => timestamp } });
  vm.runInContext(source.slice(start, end), context);
  const render = () => vm.runInContext('renderAudioState()', context);
  store.setUi({ audioFrame: { status: 'capturing', timestamp_ms: 1000, level: 0.6 } });
  render();
  assert.equal(nodes.get('audio-level').value, 0.6);
  assert.equal(nodes.get('audio-intensity').disabled, false, '0% retains live capture');
  timestamp = 1501;
  render();
  assert.equal(nodes.get('audio-level').value, 0);
  assert.equal(nodes.get('audio-status').textContent, getText('en', 'settings.audio.status.stale'));
  store.setUi({ audioFrame: { status: 'permission_denied', reason: 'permission', level: 0 } });
  render();
  assert.equal(nodes.get('audio-intensity').disabled, true);
  assert.equal(nodes.get('audio-retry').hidden, false);
  assert.match(nodes.get('audio-help').textContent, /System Settings/);
  assert.equal(nodes.get('audio-enabled').disabled, false);
  context.navigator = { platform: 'Win32' };
  render();
  assert.match(nodes.get('audio-help').textContent, /Windows/);
  assert.doesNotMatch(nodes.get('audio-help').textContent, /System Settings/);
  store.setUi({ audioFrame: { status: 'paused', reason: 'reduced_motion', level: 0 } });
  store.patchSetting('language', 'zh-CN');
  render();
  assert.equal(nodes.get('audio-status').textContent, getText('zh-CN', 'settings.audio.status.paused'));
  assert.equal(nodes.get('audio-help').textContent, getText('zh-CN', 'settings.audio.help.reduced_motion'));
  store.setUi({ audioFrame: { status: 'error', reason: 'restart_required', level: 0 } });
  render();
  assert.match(nodes.get('audio-help').textContent, /重新启动/);
  assert.equal(nodes.get('audio-retry').hidden, true, 'an unsafe capture instance cannot be retried in the same process');
  store.setUi({ audioFrame: { status: 'starting', reason: 'awaiting_audio', level: 0 } });
  render();
  assert.match(nodes.get('audio-status').textContent, /等待/);
  assert.match(nodes.get('audio-help').textContent, /播放/);
  assert.equal(nodes.get('audio-retry').hidden, false, 'waiting for first playback allows an explicit retry after permission recovery');
  store.patchSetting('audio_enabled', false);
  render();
  assert.equal(nodes.get('audio-status').textContent, getText('zh-CN', 'settings.audio.status.disabled'));
  assert.equal(nodes.get('audio-retry').hidden, true);
  assert.equal(store.getSettings().audio_intensity, 0);
});

test('audio percentage input persists normalized values without rounding on remount', () => {
  const start = source.indexOf('function updateSettingsModel(');
  const end = source.indexOf('\nfunction syncSettingsModelFromControls', start);
  const store = createSettingsStore({ defaults: { audio_intensity: 0.537, audio_enabled: true, language: 'en' }, persist: async () => {} });
  const field = { name: 'audio_intensity', type: 'range', value: '54', dataset: { unit: 'percent' } };
  const context = vm.createContext({ settingsStore: store, settingKey: field => field.name, initialSettingsReady: true,
    localSettingEdits: new Set(), document: { activeElement: field } });
  vm.runInContext(source.slice(start, end), context);
  context.field = field;
  vm.runInContext('updateSettingsModel(field)', context);
  assert.equal(store.getSettings().audio_intensity, 0.537);
  vm.runInContext('updateSettingsModel(field, true)', context);
  assert.equal(store.getSettings().audio_intensity, 0.54);
  field.value = '100';
  vm.runInContext('updateSettingsModel(field, true)', context);
  assert.equal(store.getSettings().audio_intensity, 1);
});
