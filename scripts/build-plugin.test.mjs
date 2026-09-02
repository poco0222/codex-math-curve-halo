import assert from 'node:assert/strict';
import test from 'node:test';
import { pluginOutputPath } from './build-plugin.mjs';

test('plugin build writes the helper at the default POSIX path', () => {
  assert.equal(
    pluginOutputPath('/repo', 'aarch64-apple-darwin'),
    '/repo/plugins/codex-halo/bin/codex-halo-hook',
  );
});

test('plugin build writes the helper at the default Windows path', () => {
  assert.equal(
    pluginOutputPath('/repo', 'x86_64-pc-windows-msvc'),
    '/repo/plugins/codex-halo/bin/codex-halo-hook.exe',
  );
});

test('plugin build rejects an invalid target triple', () => {
  assert.throws(() => pluginOutputPath('/repo', 'not/a-target'), /invalid target triple/);
});
