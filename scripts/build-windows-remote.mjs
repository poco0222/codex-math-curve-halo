import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, win32 } from 'node:path';
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

export function scpDownloadSource(target, remotePath) {
  // Legacy SCP compares the literal basename, so keep quotes on the directory only.
  const directory = win32.dirname(remotePath).replaceAll('\\', '/');
  return `${target}:"${directory}"/${win32.basename(remotePath)}`;
}

export function createSourceArchive(projectRoot, archivePath) {
  // Git selects files; tar reads working-tree contents, including uncommitted edits.
  const candidates = execFileSync('git', [
    'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--',
    'package.json', 'package-lock.json', 'src', 'src-tauri', 'scripts',
    'plugins/codex-halo', '.agents/plugins/marketplace.json',
  ], { cwd: projectRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
  const files = candidates.filter((file) => {
    if (/(^|\/)(target|binaries|node_modules|\.git)(\/|$)/.test(file) || basename(file).startsWith('.env')) return false;
    try {
      if (!lstatSync(join(projectRoot, file)).isFile()) throw new Error(`unsupported source file: ${file}`);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  });
  for (const required of ['package.json', 'src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json']) {
    if (!files.includes(required)) throw new Error(`missing build input: ${required}`);
  }
  execFileSync('tar', ['-czf', archivePath, '--no-xattrs', '--no-recursion', '--null', '-T', '-'], {
    cwd: projectRoot,
    input: files.map((file) => `./${file}\0`).join(''),
    env: { ...process.env, COPYFILE_DISABLE: '1' },
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  return files.length;
}

export function buildRemoteBatch({ remoteRoot, buildId, artifactName, target = defaults.target }) {
  if (!/^[A-Za-z]:[\\/]/.test(remoteRoot ?? '') || /["&|<>^%!\r\n]/.test(remoteRoot)) throw new Error('invalid Windows project path');
  if (!/^codex-halo-[A-Za-z0-9]+$/.test(buildId ?? '')) throw new Error('invalid build ID');
  if (!artifactName || /["&|<>^%!:\\/\r\n]/.test(artifactName)) throw new Error('invalid installer name');
  if (!/^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)+$/.test(target)) throw new Error('invalid target triple');

  const workspace = win32.dirname(remoteRoot);
  const sourceRoot = win32.join(workspace, buildId);
  const targetRoot = win32.join(remoteRoot, 'src-tauri', 'target');
  const archive = win32.join(workspace, 'codex-halo-source.tar.gz');
  const artifact = win32.join(targetRoot, target, 'release', 'bundle', 'nsis', artifactName);
  const remoteArtifact = win32.join(workspace, 'codex-halo-windows-setup.exe');
  return `@echo off
setlocal EnableExtensions EnableDelayedExpansion
if exist "${sourceRoot}" exit /b 1
mkdir "${sourceRoot}"
if errorlevel 1 exit /b 1
tar -xzf "${archive}" -C "${sourceRoot}"
if errorlevel 1 exit /b 1
if not exist "${targetRoot}" mkdir "${targetRoot}"
if errorlevel 1 exit /b 1
rem Reuse compiler outputs while keeping the uploaded source separate from the Windows checkout.
mklink /J "${sourceRoot}\\src-tauri\\target" "${targetRoot}"
if errorlevel 1 exit /b 1
cd /d "${sourceRoot}"
if errorlevel 1 exit /b 1
call "C:\\Program Files (x86)\\Microsoft Visual Studio\\18\\BuildTools\\Common7\\Tools\\VsDevCmd.bat" -arch=x64 -host_arch=x64
if errorlevel 1 exit /b 1
set "PATH=D:\\Program Files\\nodejs;C:\\Program Files (x86)\\NSIS;C:\\Program Files (x86)\\WiX Toolset v3.14\\bin;!USERPROFILE!\\.cargo\\bin;!PATH!"
set "CARGO_TARGET_DIR=${targetRoot}"
echo Source snapshot: ${sourceRoot}
cargo tauri build --target ${target} --bundles nsis
if errorlevel 1 exit /b 1
if not exist "${artifact}" (
  echo Expected NSIS installer not found.
  exit /b 1
)
copy /y "${artifact}" "${remoteArtifact}" >nul
if errorlevel 1 exit /b 1
cd /d "${workspace}"
if errorlevel 1 exit /b 1
rem Remove the junction before deleting the temporary source, preserving the build cache.
rmdir "${sourceRoot}\\src-tauri\\target"
if errorlevel 1 exit /b 1
rmdir /s /q "${sourceRoot}"
if errorlevel 1 exit /b 1
del /q "${archive}"
if errorlevel 1 exit /b 1
echo CODEX_HALO_ARTIFACT=${artifact}
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
  const remoteWorkspace = win32.dirname(options.remoteRoot);
  const remoteScript = win32.join(remoteWorkspace, 'codex-halo-build.cmd');
  const remoteArtifact = win32.join(remoteWorkspace, 'codex-halo-windows-setup.exe').replaceAll('\\', '/');
  const tempDir = mkdtempSync(join(tmpdir(), 'codex-halo-'));
  const tempScript = join(tempDir, 'codex-halo-build.cmd');
  const tempArchive = join(tempDir, 'codex-halo-source.tar.gz');

  try {
    const batch = buildRemoteBatch({ ...options, buildId: basename(tempDir), artifactName });
    writeFileSync(tempScript, batch.replaceAll('\n', '\r\n'), 'utf8');
    const fileCount = createSourceArchive(PROJECT_ROOT, tempArchive);
    console.log(`Uploading current source: ${fileCount} files`);
    mkdirSync(localDir, { recursive: true });
    // ponytail: one build per host; use per-run transfer names if parallel builds are needed.
    run('scp', [...scpArgs(options.port, options.sshKey), tempScript, tempArchive, `${target}:"${remoteWorkspace.replaceAll('\\', '/')}/"`]);
    run('ssh', [...sshArgs(options.port, options.sshKey), target, `call "${remoteScript}"`]);
    run('scp', [...scpArgs(options.port, options.sshKey), scpDownloadSource(target, remoteArtifact), localPath]);
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
