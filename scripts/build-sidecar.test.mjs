import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sidecarFilename,
  sidecarOutputPath,
  targetTripleFromArgs,
} from './build-sidecar.mjs';

test('build script maps target triples to Tauri sidecar names', () => {
  assert.equal(sidecarFilename('aarch64-apple-darwin'), 'codex-halo-hook-aarch64-apple-darwin');
  assert.equal(sidecarFilename('x86_64-pc-windows-msvc'), 'codex-halo-hook-x86_64-pc-windows-msvc.exe');
  assert.equal(
    sidecarFilename('aarch64-apple-darwin', 'codex-halo-watch'),
    'codex-halo-watch-aarch64-apple-darwin',
  );
});

test('build script parses an explicit target and computes the release output', () => {
  const target = targetTripleFromArgs(['--target', 'x86_64-pc-windows-msvc']);
  assert.equal(target, 'x86_64-pc-windows-msvc');
  assert.equal(
    sidecarOutputPath('/repo', target),
    '/repo/src-tauri/binaries/codex-halo-hook-x86_64-pc-windows-msvc.exe',
  );
  assert.equal(
    sidecarOutputPath('/repo', 'x86_64-pc-windows-msvc', 'codex-halo-watch'),
    '/repo/src-tauri/binaries/codex-halo-watch-x86_64-pc-windows-msvc.exe',
  );
});
