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

test('localized setup errors keep only safe categories', () => {
  assert.equal(
    formatLocalizedSetupError('save_settings', 'codex-lifecycle:permission', 'zh-CN'),
    'Codex 生命周期设置失败（权限）',
  );
  assert.equal(
    formatLocalizedSetupError('save_settings', 'start-at-login:permission', 'zh-CN'),
    '启动时设置失败（权限）',
  );
  assert.equal(
    formatLocalizedSetupError('save_settings', 'raw path and payload', 'zh-CN'),
    'save_settings failed',
  );
});

test('settings page exposes a persisted language selector', async () => {
  const html = await readFile(new URL('./settings.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');
  const i18n = await readFile(new URL('./i18n.js', import.meta.url), 'utf8');

  assert.match(html, /id="language"/);
  assert.match(html, /value="en"/);
  assert.match(html, /value="zh-CN"/);
  assert.match(html, /data-i18n="settings\.display"/);
  assert.match(html, /id="follow-codex-lifecycle"/);
  assert.match(html, /data-i18n="settings\.followCodexLifecycle"/);
  assert.match(source, /language: control\('language'\)\.value/);
  assert.match(source, /follow_codex_lifecycle: control\('follow_codex_lifecycle'\)\.checked/);
  assert.match(source, /document\.documentElement\.lang/);
  assert.match(i18n, /settings\.followCodexLifecycle/);
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
  const pluginCalls = [];
  const warnings = [];
  const invoke = async (command, args) => {
    if (command === 'get_settings') return { ...DEFAULT_APP_SETTINGS };
    if (command === 'get_display_state') return { state: 'idle', updated_at_ms: 0 };
    if (command === 'install_plugin' || command === 'uninstall_plugin') {
      pluginCalls.push(command);
      return null;
    }
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

    elements.get('install-plugin').dispatch('click');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(pluginStatus.textContent, 'Plugin 已安装');

    elements.get('uninstall-plugin').dispatch('click');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(pluginStatus.textContent, 'Plugin 已卸载');
    assert.deepEqual(pluginCalls, ['install_plugin', 'uninstall_plugin']);
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
    start_at_login: false,
    follow_codex_lifecycle: false,
    language: 'en',
  });
  assert.equal(DEFAULT_APP_SETTINGS.language, 'en');
  assert.match(appSource, /const settings = await invokeCommand\('get_settings'\) \?\? DEFAULT_APP_SETTINGS/);
  assert.match(appSource, /window\.setInterval\(displayBridge\.pollDisplayState, POLL_INTERVAL_MS\)/);
  assert.match(settingsSource, /applySettings\(settings\.ok \? settings\.value : DEFAULT_APP_SETTINGS\)/);
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

test('settings changes reach both overlay and settings windows', async () => {
  const mainSource = await readFile(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
  const settingsSource = await readFile(new URL('./settings.js', import.meta.url), 'utf8');

  assert.match(mainSource, /for target in \["main", "settings"\]/);
  assert.match(mainSource, /app\.emit_to\(target, "settings-changed", settings\.clone\(\)\)/);
  assert.match(settingsSource, /listen\('settings-changed', \(\{ payload \}\) => applySettings\(payload\)\)/);
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
  assert.match(source, /state: currentDisplayState\.state/);
  assert.match(source, /updated_at_ms: currentDisplayState\.updated_at_ms/);
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
