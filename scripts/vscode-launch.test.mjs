import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('VS Code exposes run and package launch configurations', async () => {
  const source = await readFile(new URL('../.vscode/launch.json', import.meta.url), 'utf8');
  const config = JSON.parse(source);
  const configurations = config.configurations;

  assert.equal(config.version, '0.2.0');
  assert.deepEqual(configurations.map(({ name }) => name), [
    'Codex Halo: Run',
    'Codex Halo: Package',
    'Codex Halo: Install Plugin',
  ]);
  assert.equal(configurations[0].type, 'node-terminal');
  assert.equal(configurations[0].command, 'cargo tauri dev');
  assert.equal(configurations[1].type, 'node-terminal');
  assert.equal(configurations[1].command, 'cargo tauri build');
  assert.equal(configurations[2].type, 'node-terminal');
  assert.match(configurations[2].command, /codex plugin marketplace add/);
  assert.match(configurations[2].command, /codex plugin add codex-halo@codex-halo/);
  assert.ok(configurations.every(({ cwd }) => cwd === '${workspaceFolder}'));
});
