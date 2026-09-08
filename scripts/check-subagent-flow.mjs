import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHaloRenderer } from '../src/halo.js';
import { applyRendererDisplayState } from '../src/app.js';

const helper = process.argv[2];
assert.ok(helper, 'Usage: node scripts/check-subagent-flow.mjs <built-helper-path>');
const sandbox = await mkdtemp(join(tmpdir(), 'halo-subagent-flow-'));
const pluginRoot = fileURLToPath(new URL('../plugins/codex-halo/', import.meta.url));
const runtime = join(sandbox, 'codex-halo');
const stateDir = join(runtime, 'state');
const config = JSON.parse(await readFile(join(pluginRoot, 'hooks/hooks.json'), 'utf8'));
let clock = 0;
let frame;
let cores = 0;
const context = {
  setTransform() {}, clearRect() { cores = 0; }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  arc() {}, fill() { if (this.globalCompositeOperation !== 'destination-out') cores += 1; },
};
const renderer = createHaloRenderer({ style: {}, getContext: () => context, getBoundingClientRect: () => ({ width: 112, height: 112 }) }, {
  now: () => clock, wallNow: () => Date.now(), phaseOffset: 0.2,
  requestAnimationFrame(callback) { frame = callback; return 1; }, cancelAnimationFrame() {},
});
async function snapshots() {
  const names = (await readdir(stateDir)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(join(stateDir, name), 'utf8'))));
}
function hook(sessionId, event, agentId) {
  const handler = config.hooks[event]?.[0]?.hooks?.[0];
  assert.ok(handler, `Plugin must register ${event}`);
  const input = { session_id: sessionId, hook_event_name: event, ...(agentId ? { agent_id: agentId } : {}) };
  // Only the test directory receives the helper and snapshots; no installed plugin is touched.
  const result = spawnSync('sh', ['-c', handler.command], {
    input: JSON.stringify(input), encoding: 'utf8',
    env: { ...process.env, CODEX_HOME: sandbox, PLUGIN_ROOT: pluginRoot },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '{}\n');
  assert.equal(result.stderr, '');
}
function draw(items) {
  applyRendererDisplayState(renderer, { sessions: items, simulated: false });
  clock += 500;
  frame(clock);
  return cores;
}

try {
  await mkdir(runtime, { recursive: true });
  await copyFile(resolve(helper), join(runtime, 'codex-halo-hook'));
  renderer.start();
  hook('family-A', 'UserPromptSubmit');
  hook('family-A', 'SubagentStart', 'worker-1');
  hook('family-A', 'SubagentStart', 'worker-2');
  let items = await snapshots();
  assert.equal(items.length, 3);
  assert.equal(items.filter((item) => item.parent_session_key).length, 2);
  assert.equal(draw(items), 1, 'Two child snapshots must stay inside one root stream');
  assert.equal(draw([...items].reverse()), 1, 'Snapshot ordering cannot create extra roots');
  hook('family-B', 'PreToolUse');
  assert.equal(draw(await snapshots()), 2, 'Independent main sessions keep separate cores');
  hook('family-A', 'SubagentStop', 'worker-1');
  items = await snapshots();
  assert.equal(items.filter((item) => item.parent_session_key && item.state === 'completed').length, 1);
  assert.equal(draw(items), 2, 'A child completion does not end another family');
  hook('family-A', 'Stop');
  items = await snapshots();
  assert.equal(draw(items.map((item) => item.state === 'completed' ? { ...item, updated_at_ms: Date.now() - 4000 } : item)), 2,
    'An active child keeps its completed parent family visible');
  hook('family-A', 'SessionEnd');
  items = await snapshots();
  assert.equal(items.length, 1, 'SessionEnd removes only the ended family');
  assert.equal(draw(items), 1);
  const payload = JSON.stringify(items);
  assert.ok(!payload.includes('family-B') && !payload.includes('worker-1'), 'Raw identities never reach the display contract');
  console.log('PASS: plugin launcher → native helper → anonymous snapshots → actual renderer; parent/child isolation and family cleanup.');
} finally {
  renderer.stop();
  await rm(sandbox, { recursive: true, force: true });
}
