import assert from 'node:assert/strict';
import { curveProfiles, formatFormula } from '../src/curves.js';
import { createHaloRenderer } from '../src/halo.js';
import { createCommandInvoker, createDisplayStatePoller } from '../src/app.js';

assert.equal(curveProfiles.length, 4);

for (const profile of curveProfiles) {
  for (const detailScale of [0, 0.5, 1]) {
    for (let i = 0; i < 128; i += 1) {
      const point = profile.point(i / 127, detailScale, profile.defaults);
      assert(Number.isFinite(point.x));
      assert(Number.isFinite(point.y));
      assert(point.x >= -20 && point.x <= 120);
      assert(point.y >= -20 && point.y <= 120);
    }
  }
  assert(formatFormula(profile, profile.defaults).trim().length > 0);
}

const formulaChanges = {
  'rose-seven': ['petals', 'radius', 'detail', 'phase'],
  'lissajous-drift': ['x_frequency', 'y_frequency', 'x_phase', 'y_phase', 'drift'],
  'spiral-search': ['turns', 'radius', 'modulation', 'phase'],
  'fourier-flow': ['pulse_mix', 'phase', 'x_mix', 'y_mix'],
};
for (const profile of curveProfiles) {
  const baseFormula = formatFormula(profile, profile.defaults);
  for (const key of formulaChanges[profile.id]) {
    const control = profile.controls.find((item) => item.key === key);
    const delta = control?.step ?? 0.25;
    const candidate = Number(profile.defaults[key]) + delta;
    const changedValue = control && candidate > control.max ? Number(profile.defaults[key]) - delta : candidate;
    const changed = { ...profile.defaults, [key]: changedValue };
    assert.notEqual(formatFormula(profile, changed), baseFormula, `${profile.id} formula omits ${key}`);
  }
}

const rendererCalls = [];
const context = {
  setTransform: () => {},
  clearRect: () => {},
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  stroke: () => {},
  arc: () => {},
  fill: () => {},
};
const canvas = {
  width: 0,
  height: 0,
  style: {},
  getContext: () => context,
  getBoundingClientRect: () => ({ width: 112, height: 112 }),
};
let nextFrame;
const renderer = createHaloRenderer(canvas, {
  settings: { opacity: 0.5, particle_count: 2, idle_color: '#123456' },
  now: () => 0,
  requestAnimationFrame: (callback) => { nextFrame = callback; return 1; },
  cancelAnimationFrame: () => {},
});
Object.defineProperty(context, 'strokeStyle', {
  set: (value) => rendererCalls.push(value),
});
renderer.start();
nextFrame(0);
assert.equal(canvas.style.opacity, '0.5');
const coreAlpha = Number(rendererCalls.at(-1).match(/,([0-9.]+)\)$/)[1]);
assert(Math.abs(coreAlpha - 0.2464) < 1e-10);
assert.match(rendererCalls.at(-1), /^rgba\(18,52,86,/);
renderer.stop();

const transitionCalls = [];
const transitionContext = {
  setTransform: () => {},
  clearRect: () => {},
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  stroke: () => {},
  arc: () => {},
  fill: () => {},
};
Object.defineProperty(transitionContext, 'strokeStyle', {
  set: (value) => transitionCalls.push(value),
});
const transitionCanvas = {
  width: 0,
  height: 0,
  style: {},
  getContext: () => transitionContext,
  getBoundingClientRect: () => ({ width: 112, height: 112 }),
};
let transitionFrame;
let transitionNow = 0;
const transitionRenderer = createHaloRenderer(transitionCanvas, {
  settings: { particle_count: 2 },
  now: () => transitionNow,
  requestAnimationFrame: (callback) => { transitionFrame = callback; return 1; },
  cancelAnimationFrame: () => {},
});
transitionRenderer.start();
transitionFrame(0);
transitionCalls.length = 0;
transitionRenderer.setState('thinking');
transitionNow = 100;
transitionRenderer.setSettings({ opacity: 0.5 });
transitionFrame(100);
transitionNow = 420;
transitionFrame(420);
assert.match(transitionCalls.at(-1), /^rgba\(255,138,61,0\.5984/);
transitionRenderer.stop();

const invalidColorCalls = [];
const invalidColorContext = { ...context };
Object.defineProperty(invalidColorContext, 'strokeStyle', {
  set: (value) => invalidColorCalls.push(value),
});
const invalidColorCanvas = {
  ...canvas,
  getContext: () => invalidColorContext,
};
let invalidColorFrame;
const invalidColorRenderer = createHaloRenderer(invalidColorCanvas, {
  settings: { particle_count: 2, idle_color: 'not-a-color' },
  now: () => 0,
  requestAnimationFrame: (callback) => { invalidColorFrame = callback; return 1; },
  cancelAnimationFrame: () => {},
});
invalidColorRenderer.start();
invalidColorFrame(0);
assert.match(invalidColorCalls.at(-1), /^rgba\(167,173,181,/);
invalidColorRenderer.stop();

const warnings = [];
const commandInvoker = createCommandInvoker(async () => {
  throw new Error('/private/local/path/should-not-leak');
}, (...args) => warnings.push(args));
await commandInvoker('get_display_state');
assert.equal(warnings.length, 1);
assert(warnings.flat().every((value) => !String(value).includes('/private/local/path/should-not-leak')));

const pending = [];
const appliedStates = [];
const poll = createDisplayStatePoller(async () => new Promise((resolve) => pending.push(resolve)), (displayState) => appliedStates.push(displayState.state));
const older = poll();
const newer = poll();
pending[1]({ state: 'executing' });
await newer;
pending[0]({ state: 'thinking' });
await older;
assert.deepEqual(appliedStates, ['executing']);

console.log(`renderer self-check: PASS (${curveProfiles.length} profiles)`);
