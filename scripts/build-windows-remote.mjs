import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const defaults = Object.freeze({
  host: '192.168.10.114',
  user: 'Lenovo',
  port: '22',
  remoteRoot: 'D:\\BuildWorkspace\\codex-math-curve-halo',
  target: 'x86_64-pc-windows-msvc',
});

export function sshTarget({ user, host }) {
  if (!/^[A-Za-z0-9_.-]+$/.test(user) || !/^[A-Za-z0-9_.-]+$/.test(host)) {
    throw new Error('invalid SSH user or host');
  }
  return `${user}@${host}`;
}

export function localArtifactName({ productName, version }) {
  if (!productName || !version) throw new Error('missing Tauri product name or version');
  return `${productName}_${version}_x64-setup.exe`;
}

export function buildRemoteBatch({ remoteRoot, target = defaults.target }) {
  if (!remoteRoot || /["&|<>^]/.test(remoteRoot)) throw new Error('invalid Windows project path');
  if (!/^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)+$/.test(target)) throw new Error('invalid target triple');

  const nsisRoot = `${remoteRoot}\\src-tauri\\target\\${target}\\release\\bundle\\nsis`;
  return `@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "${remoteRoot}"
if errorlevel 1 exit /b 1
git pull --ff-only
if errorlevel 1 exit /b 1
call "C:\\Program Files (x86)\\Microsoft Visual Studio\\18\\BuildTools\\Common7\\Tools\\VsDevCmd.bat" -arch=x64 -host_arch=x64
if errorlevel 1 exit /b 1
set "PATH=D:\\Program Files\\nodejs;C:\\Program Files (x86)\\NSIS;C:\\Program Files (x86)\\WiX Toolset v3.14\\bin;!USERPROFILE!\\.cargo\\bin;!PATH!"
cargo tauri build --target ${target} --bundles nsis
if errorlevel 1 exit /b 1
set "ARTIFACT="
for /f "delims=" %%F in ('dir /b /a-d /o-d "${nsisRoot}\\*-setup.exe" 2^>nul') do if not defined ARTIFACT set "ARTIFACT=${nsisRoot}\\%%F"
if not defined ARTIFACT (
  echo No NSIS installer found.
  exit /b 1
)
copy /y "!ARTIFACT!" "D:\\BuildWorkspace\\codex-halo-windows-setup.exe" >nul
if errorlevel 1 exit /b 1
echo CODEX_HALO_ARTIFACT=!ARTIFACT!
`;
}

function sshArgs(port, key) {
  const args = ['-o', 'AddKeysToAgent=yes', '-o', 'UseKeychain=yes', '-p', String(port)];
  if (key) args.push('-i', key, '-o', 'IdentitiesOnly=yes');
  return args;
}

function scpArgs(port, key) {
  // The Windows build host requires legacy SCP instead of the default SFTP transport.
  const args = ['-O', '-o', 'AddKeysToAgent=yes', '-o', 'UseKeychain=yes', '-P', String(port)];
  if (key) args.push('-i', key, '-o', 'IdentitiesOnly=yes');
  return args;
}

function run(program, args) {
  const result = spawnSync(program, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} exited with status ${result.status}`);
}

function config() {
  return JSON.parse(readFileSync(join(PROJECT_ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
}

function main() {
  const options = {
    host: process.env.WIN_BUILD_HOST ?? defaults.host,
    user: process.env.WIN_BUILD_USER ?? defaults.user,
    port: process.env.WIN_BUILD_PORT ?? defaults.port,
    remoteRoot: process.env.WIN_BUILD_ROOT ?? defaults.remoteRoot,
    sshKey: process.env.WIN_BUILD_SSH_KEY,
  };
  const target = sshTarget(options);
  const tauriConfig = config();
  const artifactName = localArtifactName(tauriConfig);
  const localDir = join(PROJECT_ROOT, 'dist', 'windows');
  const localPath = join(localDir, artifactName);
  const remoteScript = 'D:\\BuildWorkspace\\codex-halo-build.cmd';
  const remoteScriptScpPath = 'D:/BuildWorkspace/codex-halo-build.cmd';
  const remoteArtifact = 'D:/BuildWorkspace/codex-halo-windows-setup.exe';
  const tempDir = mkdtempSync(join(tmpdir(), 'codex-halo-'));
  const tempScript = join(tempDir, 'build-windows.cmd');

  try {
    writeFileSync(tempScript, buildRemoteBatch(options), 'utf8');
    mkdirSync(localDir, { recursive: true });
    run('scp', [...scpArgs(options.port, options.sshKey), tempScript, `${target}:${remoteScriptScpPath}`]);
    run('ssh', [...sshArgs(options.port, options.sshKey), target, `call ${remoteScript}`]);
    run('scp', [...scpArgs(options.port, options.sshKey), `${target}:${remoteArtifact}`, localPath]);
    console.log(`Windows installer: ${localPath}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Windows build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
