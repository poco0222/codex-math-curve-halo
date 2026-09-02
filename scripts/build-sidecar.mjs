import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function sidecarFilename(targetTriple) {
  if (!/^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)+$/.test(targetTriple)) {
    throw new Error('invalid target triple');
  }
  return `codex-halo-hook-${targetTriple}${targetTriple.includes('windows') ? '.exe' : ''}`;
}

export function targetTripleFromArgs(args, env = process.env) {
  let target;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--target' && target === undefined && index + 1 < args.length) {
      target = args[++index];
      if (target.startsWith('-')) throw new Error('invalid target triple');
      continue;
    }
    throw new Error('invalid sidecar arguments');
  }
  if (target === undefined) {
    target = env.TARGET_TRIPLE ?? env.TAURI_ENV_TARGET_TRIPLE;
  }
  if (target === undefined) {
    target = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
      .match(/^host: (.+)$/m)?.[1];
  }
  if (target === undefined) {
    throw new Error('unable to determine target triple');
  }
  sidecarFilename(target);
  return target;
}

export function sidecarOutputPath(projectRoot, targetTriple) {
  return join(projectRoot, 'src-tauri', 'binaries', sidecarFilename(targetTriple));
}

function buildSidecar(targetTriple) {
  const manifest = join(PROJECT_ROOT, 'src-tauri', 'Cargo.toml');
  const env = { ...process.env, CODEX_HALO_BUILD_SIDECAR: '1' };
  execFileSync('cargo', [
    'build',
    '--manifest-path',
    manifest,
    '--bin',
    'codex-halo-hook',
    '--release',
    '--target',
    targetTriple,
  ], { cwd: PROJECT_ROOT, env, stdio: 'inherit' });

  const source = join(
    PROJECT_ROOT,
    'src-tauri',
    'target',
    targetTriple,
    'release',
    `codex-halo-hook${targetTriple.includes('windows') ? '.exe' : ''}`,
  );
  const output = sidecarOutputPath(PROJECT_ROOT, targetTriple);
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(source, output);
  if (!targetTriple.includes('windows')) chmodSync(output, 0o755);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildSidecar(targetTripleFromArgs(process.argv.slice(2)));
}
