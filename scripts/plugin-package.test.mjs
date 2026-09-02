import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const pluginRoot = new URL('../plugins/codex-halo/', import.meta.url);

async function readJson(relativePath) {
  const contents = await readFile(new URL(relativePath, pluginRoot), 'utf8');
  return JSON.parse(contents);
}

test('Codex Halo plugin declares the expected identity and default hook package', async () => {
  const manifest = await readJson('.codex-plugin/plugin.json');

  assert.equal(manifest.name, 'codex-halo');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.skills, undefined);
  assert.equal(manifest.mcpServers, undefined);
  assert.equal(manifest.apps, undefined);
  assert.equal(manifest.hooks, undefined);
  assert.equal(manifest.interface.displayName, 'Codex Halo');
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
    assert.match(handler.command, /\$\{PLUGIN_ROOT\}\/bin\/codex-halo-hook/);
    assert.match(handler.command, /--codex-halo/);
    assert.doesNotMatch(handler.command, /--state-dir/);
    assert.match(handler.commandWindows, /PLUGIN_ROOT/);
    assert.match(handler.commandWindows, /codex-halo-hook\.exe/);
    assert.doesNotMatch(handler.commandWindows, /--state-dir/);
  }
});
