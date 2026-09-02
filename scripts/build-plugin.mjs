import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSidecar, sidecarFilename, targetTripleFromArgs } from './build-sidecar.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function pluginOutputPath(projectRoot, targetTriple) {
  sidecarFilename(targetTriple);
  const filename = targetTriple.includes('windows')
    ? 'codex-halo-hook.exe'
    : 'codex-halo-hook';
  return join(projectRoot, 'plugins', 'codex-halo', 'bin', filename);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = targetTripleFromArgs(process.argv.slice(2));
  buildSidecar(target, pluginOutputPath(PROJECT_ROOT, target));
}
