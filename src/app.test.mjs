import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createDisplayStateBridge,
  createSerialTaskQueue,
  DEFAULT_APP_SETTINGS,
  formatSetupError,
} from './app.js';

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
  assert.equal(formatSetupError('save_settings', 'raw path and payload'), 'save_settings failed');
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
  });
  assert.match(appSource, /const settings = await invokeCommand\('get_settings'\) \?\? DEFAULT_APP_SETTINGS/);
  assert.match(appSource, /window\.setInterval\(displayBridge\.pollDisplayState, POLL_INTERVAL_MS\)/);
  assert.match(settingsSource, /applySettings\(settings\.ok \? settings\.value : DEFAULT_APP_SETTINGS\)/);
  assert.match(mainSource, /settings_transaction: Mutex<\(\)>/);
  assert.match(mainSource, /settings_transaction[\s\S]*?\.lock\(\)/);
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
  const hooks = await readFile(new URL('../src-tauri/src/hooks.rs', import.meta.url), 'utf8');
  const protocol = await readFile(new URL('../src-tauri/src/hook_protocol.rs', import.meta.url), 'utf8');

  assert.doesNotMatch(hooks, /asynchronous: true/);
  assert.match(hooks, /asynchronous: false/);
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
