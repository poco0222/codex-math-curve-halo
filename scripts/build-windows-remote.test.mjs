import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import * as windowsBuild from './build-windows-remote.mjs';

const {
  buildRemoteBatch,
  localArtifactName,
  sshTarget,
} = windowsBuild;

test('build command targets the configured Windows host and NSIS bundle', () => {
  assert.equal(sshTarget({ user: 'Lenovo', host: '192.168.10.114', port: 22 }), 'Lenovo@192.168.10.114');
  assert.equal(localArtifactName({ productName: 'Codex Halo', version: '0.1.0' }), 'Codex Halo_0.1.0_x64-setup.exe');

  const batch = buildRemoteBatch({
    remoteRoot: 'D:\\BuildWorkspace\\codex-math-curve-halo',
    buildId: 'codex-halo-test123',
    artifactName: 'Codex Halo_0.1.0_x64-setup.exe',
  });
  assert.doesNotMatch(batch, /git pull/);
  assert.match(batch, /tar -xzf/);
  assert.match(batch, /mklink \/J/);
  assert.match(batch, /cargo tauri build --target x86_64-pc-windows-msvc --bundles nsis/);
  assert.match(batch, /VsDevCmd\.bat/);
  assert.match(batch, /EnableDelayedExpansion/);
  assert.match(batch, /Codex Halo_0\.1\.0_x64-setup\.exe/);
  assert.match(batch, /codex-halo-windows-setup\.exe/);
});

test('source archive contains current build inputs, including edits and new files, without local state', (t) => {
  assert.equal(typeof windowsBuild.createSourceArchive, 'function');
  const temp = mkdtempSync(join(tmpdir(), 'halo-source-test-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const project = join(temp, 'project');
  const extracted = join(temp, 'extracted');
  mkdirSync(project);
  mkdirSync(extracted);
  execFileSync('git', ['init', '--quiet', project]);
  const files = {
    '.gitignore': 'src-tauri/target/\n.env*\nsrc/*.local.json\n',
    'package.json': '{"scripts":{"build:sidecar":"node scripts/build-sidecar.mjs"}}',
    'src-tauri/Cargo.toml': '[package]\nversion = "0.1.0"\n',
    'src-tauri/tauri.conf.json': '{"version":"0.1.0"}',
    'src/deleted.js': 'old source',
    '.agents/plugins/marketplace.json': '{"plugins":[]}',
    'plugins/codex-halo/.codex-plugin/plugin.json': '{"name":"codex-halo"}',
    'scripts/build-sidecar.mjs': 'console.log("build");',
    'src-tauri/binaries/local-binary': 'local binary',
    '.superpowers/local-state': 'local tool state',
  };
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(project, file)), { recursive: true });
    writeFileSync(join(project, file), content);
  }
  execFileSync('git', ['add', '.'], { cwd: project });
  writeFileSync(join(project, 'src-tauri/Cargo.toml'), '[package]\nversion = "0.2.0"\n');
  writeFileSync(join(project, 'src-tauri/tauri.conf.json'), '{"version":"0.2.0"}');
  writeFileSync(join(project, 'src/new file.js'), 'current source');
  writeFileSync(join(project, 'src/private.local.json'), 'private settings');
  writeFileSync(join(project, 'src/.env'), 'private environment');
  mkdirSync(join(project, 'src-tauri/target'));
  writeFileSync(join(project, 'src-tauri/target/cached.exe'), 'build cache');
  rmSync(join(project, 'src/deleted.js'));

  const archive = join(temp, 'source.tar.gz');
  windowsBuild.createSourceArchive(project, archive);
  execFileSync('tar', ['-xzf', archive, '-C', extracted]);
  assert.equal(readFileSync(join(extracted, 'src-tauri/Cargo.toml'), 'utf8'), '[package]\nversion = "0.2.0"\n');
  assert.equal(readFileSync(join(extracted, 'src/new file.js'), 'utf8'), 'current source');
  for (const file of ['package.json', 'scripts/build-sidecar.mjs', '.agents/plugins/marketplace.json', 'plugins/codex-halo/.codex-plugin/plugin.json']) {
    assert.ok(existsSync(join(extracted, file)), `missing build input: ${file}`);
  }
  for (const file of ['.git', '.superpowers', 'src/deleted.js', 'src/.env', 'src/private.local.json', 'src-tauri/target', 'src-tauri/binaries']) {
    assert.equal(existsSync(join(extracted, file)), false, `unexpected local state: ${file}`);
  }
});

test('remote build rejects path traversal and Windows shell expansion in generated commands', () => {
  const options = {
    remoteRoot: 'D:\\BuildWorkspace\\codex-math-curve-halo',
    buildId: 'codex-halo-test123',
    artifactName: 'Codex Halo_0.1.0_x64-setup.exe',
  };
  for (const invalid of [
    { remoteRoot: 'relative\\checkout' },
    { remoteRoot: 'D:\\%USERPROFILE%\\checkout' },
    { remoteRoot: 'D:\\build!workspace\\checkout' },
    { buildId: '..\\checkout' },
    { artifactName: '..\\setup.exe' },
    { artifactName: 'setup.exe\r\nwhoami' },
  ]) {
    assert.throws(() => buildRemoteBatch({ ...options, ...invalid }), /invalid/);
  }
});

test('installer download passes real legacy SCP filename validation with a spaced directory', { skip: process.platform === 'win32' }, (t) => {
  assert.equal(typeof windowsBuild.scpDownloadSource, 'function');
  const temp = mkdtempSync(join(tmpdir(), 'halo-scp-test-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const remoteDir = join(temp, 'remote directory');
  mkdirSync(remoteDir);
  const source = join(remoteDir, 'codex-halo-windows-setup.exe');
  const destination = join(temp, 'Codex Halo_0.1.0_x64-setup.exe');
  writeFileSync(source, Buffer.from([0x4d, 0x5a, 0, 0xff, 0x0a, 0x80]));
  // Replace only SSH transport; both SCP protocol endpoints are the real client.
  const transport = join(temp, 'local-ssh');
  writeFileSync(transport, '#!/bin/sh\nfor arg do command=$arg; done\nexec /bin/sh -c "$command"\n');
  chmodSync(transport, 0o700);
  execFileSync('scp', [
    '-O', '-S', transport,
    windowsBuild.scpDownloadSource('local-test', source), destination,
  ], { timeout: 10000 });
  assert.deepEqual(readFileSync(destination), readFileSync(source));
});
