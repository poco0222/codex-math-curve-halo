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

test('state color presets preserve all supplied hexadecimal values', async () => {
  const {
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
    '#A4CAB6', '#69A794', '#5DBE8A', '#41B349', '#2C9678', '#428675', '#248067',
    '#BACCD9', '#8FB2C9', '#8ABCD1', '#10AEC2', '#158BB8', '#4E7CA1', '#2775B6',
    '#F03752', '#EE2746', '#C21F30', '#EE3F4D', '#BF3553', '#A7535A', '#82111F',
    '#FED71A', '#F9D770', '#ECCB16', '#FCC307', '#FEBA07', '#F9A633', '#DAA45A',
    '#F0C9CF', '#F0A1A8', '#E77C8E', '#EC8AA4', '#EC7696', '#EA517F', '#DE3F7C',
    '#E9CCD3', '#C08EAF', '#C06F98', '#806D9E', '#815C94', '#813C85', '#4D1018',
    '#F18F60', '#EE781F', '#E97040', '#EA5532', '#DC541B', '#EA5514', '#B55336',
    '#E7A23F', '#DE7622', '#673424', '#5C1E19', '#652B1C', '#592620', '#482522',
    '#3E3B31', '#31322C', '#39363F', '#353538', '#2D2D30', '#2E282E', '#000013',
    '#E4DFD7', '#CFCCC9', '#D4C4B7', '#BDAEAD', '#B6A476', '#9FA39A', '#847C74',
  ];

  assert.deepEqual(DEFAULT_STATE_COLORS, expectedDefaults);
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
  assert.match(source, /let settingsModel = \{ \.\.\.DEFAULT_APP_SETTINGS \}/);
  assert.match(source, /language: normalizeLanguage\(settings\.language \?\? settingsModel\.language\)/);
  assert.match(source, /settingsModel\[settingKey\(field\)\]/);
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
  assert.match(html, /<details[^>]+id="color-presets-details"/);
  assert.match(css, /\.settings-workbench\s*\{/);
  assert.match(css, /\.settings-sidebar\s*\{/);
  assert.match(css, /@media\s*\(max-width:\s*880px\)/);
  assert.match(source, /setSaveStatus\('saving'\)/);
  assert.match(source, /setSaveStatus\('saved'\)/);
  assert.match(source, /setSaveStatus\('error'\)/);
  assert.match(source, /saveSettings\(async \(\) => \{[\s\S]*setSaveStatus\('saving'\)/);
  assert.match(mainSource, /\.inner_size\(960\.0, 760\.0\)/);
});

test('settings navigation mounts one strict section at a time', async () => {
  const html = await readFile(new URL('./settings.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

  assert.match(html, /data-section-nav[^>]*role="tablist"/);
  assert.match(html, /id="settings-panel-host"[^>]*role="tabpanel"/);
  assert.equal((html.match(/data-section-template=/g) ?? []).length, 5);
  assert.doesNotMatch(css, /scroll-margin-top/);
  assert.match(css, /@media\s*\(max-width:\s*880px\)[\s\S]*\.settings-header\s*\{[\s\S]*position:\s*static/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*button,[\s\S]*input:not\(\[type="checkbox"\]\),[\s\S]*select,[\s\S]*\.settings-nav-link[\s\S]*min-height:\s*40px/);
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
  assert.match(source, /function mountColorState\(/);
  assert.match(source, /settingsModel/);
  assert.match(source, /saveCurrentSettings/);
  assert.match(css, /\.color-state-tabs\s*\{/);
  assert.match(css, /\.color-state-tab\[aria-selected="true"\]/);
});

test('settings color controls use one active editor and preserve the full color model', async () => {
  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');

  assert.match(source, /settingsModel\[key\] = normalized/);
  assert.match(source, /function mountColorState\(state = selectedColorState\)/);
  assert.match(source, /panel\.replaceChildren\(\)/);
  assert.match(source, /if \(!isHexColor\(value\)\)/);
  assert.match(source, /save_settings/);
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
