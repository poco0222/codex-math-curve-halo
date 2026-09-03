import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRemoteBatch,
  localArtifactName,
  sshTarget,
} from './build-windows-remote.mjs';

test('build command targets the configured Windows host and NSIS bundle', () => {
  assert.equal(sshTarget({ user: 'Lenovo', host: '192.168.10.114', port: 22 }), 'Lenovo@192.168.10.114');
  assert.equal(localArtifactName({ productName: 'Codex Halo', version: '0.1.0' }), 'Codex Halo_0.1.0_x64-setup.exe');

  const batch = buildRemoteBatch({
    remoteRoot: 'D:\\BuildWorkspace\\codex-math-curve-halo',
  });
  assert.match(batch, /git pull --ff-only/);
  assert.match(batch, /cargo tauri build --target x86_64-pc-windows-msvc --bundles nsis/);
  assert.match(batch, /VsDevCmd\.bat/);
  assert.match(batch, /EnableDelayedExpansion/);
  assert.match(batch, /codex-halo-windows-setup\.exe/);
});
