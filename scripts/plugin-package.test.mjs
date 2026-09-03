import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = new URL('../plugins/codex-halo/', import.meta.url);

async function readJson(relativePath) {
  const contents = await readFile(new URL(relativePath, pluginRoot), 'utf8');
  return JSON.parse(contents);
}

test('Codex Halo plugin declares the expected identity and default hook package', async () => {
  const manifest = await readJson('.codex-plugin/plugin.json');
  const windowsLauncher = await readFile(new URL('hooks/run-helper.ps1', pluginRoot), 'utf8');

  assert.equal(manifest.name, 'codex-halo');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.skills, undefined);
  assert.equal(manifest.mcpServers, undefined);
  assert.equal(manifest.apps, undefined);
  assert.equal(manifest.hooks, undefined);
  assert.equal(manifest.interface.displayName, 'Codex Halo');
  assert.deepEqual(manifest.interface.defaultPrompt, [
    'Enable Codex Halo lifecycle hooks for this Codex environment.',
  ]);
  assert.match(windowsLauncher, /Join-Path \$home '\.codex'/);
  assert.match(windowsLauncher, /codex-halo-hook\.exe/);
});

test('Codex Halo marketplace has a unique install identity', async () => {
  const marketplace = JSON.parse(
    await readFile(new URL('../.agents/plugins/marketplace.json', import.meta.url), 'utf8'),
  );

  assert.equal(marketplace.name, 'codex-halo');
  assert.equal(marketplace.plugins[0].name, 'codex-halo');
  assert.equal(marketplace.plugins[0].source.path, './plugins/codex-halo');
});

test('default plugin hooks cover the eight synchronous Halo lifecycle events', async () => {
  const config = await readJson('hooks/hooks.json');
  const expected = {
    SessionStart: 'startup|resume|clear|compact',
    UserPromptSubmit: undefined,
    PreToolUse: '',
    PermissionRequest: '',
    PreCompact: 'manual|auto',
    PostCompact: 'manual|auto',
    Stop: undefined,
    SessionEnd: undefined,
  };

  assert.deepEqual(Object.keys(config.hooks), Object.keys(expected));
  for (const [event, matcher] of Object.entries(expected)) {
    const [group] = config.hooks[event];
    assert.equal(group.matcher, matcher, event);
    assert.equal(group.hooks.length, 1, event);
    const [handler] = group.hooks;
    assert.equal(handler.type, 'command', event);
    assert.equal(handler.async, undefined, event);
    assert.equal(handler.command, 'sh "${PLUGIN_ROOT}/hooks/run-helper.sh"');
    assert.doesNotMatch(handler.command, /codex-halo-hook/);
    assert.doesNotMatch(handler.command, /--state-dir/);
    assert.match(handler.commandWindows, /PLUGIN_ROOT/);
    assert.match(handler.commandWindows, /run-helper\.ps1/);
  }
});

test('POSIX plugin launcher delegates to the native helper in CODEX_HOME', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codex-halo-plugin-launcher-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const codexHome = join(root, 'codex-home');
  const helper = join(codexHome, 'codex-halo', 'codex-halo-hook');
  const argsFile = join(root, 'args');
  const launcher = fileURLToPath(new URL('../plugins/codex-halo/hooks/run-helper.sh', import.meta.url));

  await mkdir(join(codexHome, 'codex-halo'), { recursive: true });
  await writeFile(
    helper,
    '#!/bin/sh\nprintf \'%s\' "$*" > "$ARGS_FILE"\nprintf \'{}\\n\'\n',
    { mode: 0o700 },
  );

  const result = await new Promise((resolve, reject) => {
    const child = spawn('sh', [launcher], {
      env: { ...process.env, ARGS_FILE: argsFile, CODEX_HOME: codexHome },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end('{"session_id":"test","hook_event_name":"Stop"}');
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '{}\n');
  assert.equal(await readFile(argsFile, 'utf8'), '--codex-halo');
});

test('POSIX plugin launcher stays non-blocking before the native app installs its helper', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codex-halo-plugin-launcher-missing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const launcher = fileURLToPath(new URL('../plugins/codex-halo/hooks/run-helper.sh', import.meta.url));

  const result = await new Promise((resolve, reject) => {
    const child = spawn('sh', [launcher], {
      env: { ...process.env, CODEX_HOME: join(root, 'codex-home') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end('{}');
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '{}\n');
});
