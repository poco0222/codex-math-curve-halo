import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { curveProfiles, formatFormula, sampleCurve, validateCurveProfiles } from '../src/curves.js';
import { createHaloRenderer } from '../src/halo.js';
import { createCommandInvoker, createDisplayStatePoller } from '../src/app.js';

const haloSource = await readFile(new URL('../src/halo.js', import.meta.url), 'utf8');
assert.match(haloSource, /const loopDuration = clamp\(positive\(settings\.duration_ms, DEFAULT_SETTINGS\.duration_ms\), 500, 1500\)/);
assert.match(haloSource, /const pulseDuration = clamp\(positive\(settings\.pulse_duration_ms, DEFAULT_SETTINGS\.pulse_duration_ms\), 500, 2000\)/);
assert.match(haloSource, /const rotationDuration = clamp\(positive\(settings\.rotation_duration_ms, DEFAULT_SETTINGS\.rotation_duration_ms\), 500, 3000\)/);
assert.match(haloSource, /const particleCount = clamp\(Math\.max\(2, Math\.floor\(Number\(settings\.particle_count\) \|\| DEFAULT_SETTINGS\.particle_count\)\), 80, 140\)/);

const expectedCurveIds = [
  'original-thinking', 'thinking-five', 'thinking-nine', 'rose-orbit', 'rose-curve',
  'rose-two', 'rose-three', 'rose-four', 'lissajous-drift', 'lemniscate-bloom',
  'hypotrochoid-loop', 'three-petal-spiral', 'four-petal-spiral', 'five-petal-spiral',
  'six-petal-spiral', 'butterfly-phase', 'cardioid-glow', 'cardioid-heart', 'heart-wave',
  'spiral-search',
];
assert.deepEqual(curveProfiles.map(({ id }) => id), expectedCurveIds);
assert(!curveProfiles.some(({ id }) => id === 'fourier-flow'));

// Literal coordinates from the audited upstream point functions at commit 70f4e00.
const goldenInputs = [[0, 0], [0.137, 0.5], [0.683, 1], [1, 0.5]];
const goldenPoints = [
  [[77.3, 50], [62.1381019973, 72.1936890326], [36.5793514835, 36.562278718], [71.45, 50]],
  [[77.3, 50], [70.1183758609, 76.0721448476], [48.9145619756, 19.1277350996], [71.45, 50]],
  [[77.3, 50], [67.1713854482, 64.8866206636], [31.7896046219, 15.7493247213], [71.45, 50]],
  [[77.3, 50], [64.4764038817, 66.8422604541], [39.6767380899, 26.943654391], [72.035, 50]],
  [[71.528, 50], [43.1262377848, 42.0028693263], [61.2029646386, 75.021105422], [76.5525, 50]],
  [[71.528, 50], [47.3999232966, 46.9749967328], [58.6684594985, 69.3604501983], [76.5525, 50]],
  [[71.528, 50], [35.3285471102, 32.9308139765], [37.596523082, 22.2976271391], [76.5525, 50]],
  [[71.528, 50], [33.473381118, 30.7724610401], [51.4688792336, 53.2806478769], [76.5525, 50]],
  [[73.9999923904, 50], [27.1241094087, 42.6214871136], [78.5966106331, 22.5763278296], [76.9999914392, 50]],
  [[70, 50], [59.725076577, 57.3751276993], [43.9806386794, 55.4938204389], [73.5, 50]],
  [[81.415, 50], [60.7905490453, 45.7338892722], [58.8434085689, 25.6591612505], [71.5135357026, 65.5509678182]],
  [[61, 50], [52.0229652752, 46.1859287861], [42.0981326956, 38.7383164718], [62.428125, 50]],
  [[63.2, 50], [48.3182809922, 51.4968028652], [54.9587744347, 40.1342106204], [64.853125, 50]],
  [[65.4, 50], [49.0867042573, 59.6071288137], [44.6963441931, 48.8829465854], [67.278125, 50]],
  [[67.6, 50], [54.8938475606, 66.1499974956], [37.1722590522, 33.5227172738], [69.703125, 50]],
  [[50, 53.3040964109], [41.2834658775, 54.2362822419], [59.9250999106, 64.0281017027], [50, 53.4657098223]],
  [[50, 50], [54.2938281558, 54.995561932], [38.6137786706, 24.5696024729], [50, 50]],
  [[50, 12.16], [25.2218355601, 28.70245999], [61.1398417432, 54.9877593745], [50, 10.44]],
  [[7.855107071, 24.3992639526], [19.4028077335, 59.7179234706], [65.425030812, 15.2700746298], [92.144892929, 24.5951597879]],
  [[58, 50], [39.1363028176, 46.6204946968], [47.3643209618, 26.7949282958], [58, 50]],
];
const geometryFailures = [];
function checkGeometry(name, check) {
  try {
    check();
  } catch (error) {
    geometryFailures.push(`${name}: ${error.message.split('\n')[0]}`);
  }
}

for (const [profileIndex, profile] of curveProfiles.entries()) {
  for (const [pointIndex, [progress, detail]] of goldenInputs.entries()) {
    checkGeometry(`${profile.id} upstream point ${pointIndex}`, () => {
      const actual = profile.point(progress, detail, profile.defaults);
      const [x, y] = goldenPoints[profileIndex][pointIndex];
      assert(Math.hypot(actual.x - x, actual.y - y) < 1e-8, JSON.stringify(actual));
    });
  }
  checkGeometry(`${profile.id} rotation`, () => {
    const rotates = profileIndex < 8 || (profileIndex >= 11 && profileIndex <= 14);
    assert.equal(profile.rotate(0.25), rotates ? -Math.PI / 2 : 0);
  });
  checkGeometry(`${profile.id} fixed geometry`, () => {
    const obsoleteSettings = {
      petal_count: 12, base_radius: 99, detail_amplitude: 99, curve_scale: 99,
      lissajous_a: 8, lissajous_b: 8, spiral_turns: 9,
      ...Object.fromEntries(Object.keys(profile.defaults).map((key) => [key, 99])),
    };
    for (const [progress, detail] of goldenInputs) {
      assert.deepEqual(profile.point(progress, detail, obsoleteSettings), profile.point(progress, detail));
    }
    assert.equal(formatFormula(profile, obsoleteSettings), formatFormula(profile));
  });
  checkGeometry(`${profile.id} formula coordinates`, () => {
    const formula = formatFormula(profile);
    assert.match(formula, /s = detailScale/);
    assert.match(formula, /(?:x\(t\)|screenX) =/);
    assert.match(formula, /(?:y\(t\)|screenY) =/);
  });
}

for (const id of ['hypotrochoid-loop', 'heart-wave']) {
  const profile = curveProfiles.find((item) => item.id === id);
  checkGeometry(`${id} unwrapped path`, () => {
    const points = sampleCurve(profile, 0.37, 0.5, profile.defaults, 17);
    assert.deepEqual(points, sampleCurve(profile, 0, 0.5, profile.defaults, 17));
    assert.deepEqual(points[0], profile.point(0, 0.5));
    assert.deepEqual(points.at(-1), profile.point(1, 0.5));
    assert(Math.hypot(points[0].x - points.at(-1).x, points[0].y - points.at(-1).y) > 10);
  });
}

function screenInterpolationError(profile, points, detail) {
  let maxError = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    for (const fraction of [0.25, 0.5, 0.75]) {
      const actual = profile.point((index + fraction) / (points.length - 1), detail);
      const error = Math.hypot(actual.x - (a.x + (b.x - a.x) * fraction), actual.y - (a.y + (b.y - a.y) * fraction)) * 1.12;
      maxError = Math.max(maxError, error);
    }
  }
  return maxError;
}

const maxScreenError = Math.max(...curveProfiles.flatMap((profile) => [0, 0.5, 1].map((detail) => screenInterpolationError(profile, sampleCurve(profile, 0, detail), detail))));
checkGeometry('112px curve interpolation', () => assert(maxScreenError < 1.1, `${maxScreenError.toFixed(3)}px`));
assert.deepEqual(geometryFailures, []);
assert.equal(validateCurveProfiles(), true);
assert.equal(new Set(curveProfiles.map((profile) => JSON.stringify(goldenInputs.map(([progress, detail]) => profile.point(progress, detail))))).size, 20);

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

for (const profile of curveProfiles) {
  assert.equal(profile.controls.length, 0, `${profile.id} must keep geometry parameters internal`);
}

const rendererCalls = [];
const lineWidths = [];
let particleArcs = 0;
const context = {
  setTransform: () => {},
  clearRect: () => {},
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  stroke: () => {},
  arc: () => { particleArcs += 1; },
  fill: () => {},
};
Object.defineProperty(context, 'lineWidth', {
  set: (value) => lineWidths.push(value),
});
const canvas = {
  width: 0,
  height: 0,
  style: {},
  getContext: () => context,
  getBoundingClientRect: () => ({ width: 112, height: 112 }),
};
let nextFrame;
const renderer = createHaloRenderer(canvas, {
  settings: { opacity: 0.5, particle_count: 2, stroke_width: 1, idle_color: '#123456' },
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
assert.equal(lineWidths.at(-1), 1);
assert.equal(particleArcs, 81);
particleArcs = 0;
renderer.setSettings({ particle_count: 999 });
nextFrame(100);
assert.equal(particleArcs, 141);
const coreAlpha = Number(rendererCalls.at(-1).match(/,([0-9.]+)\)$/)[1]);
assert(Math.abs(coreAlpha - 0.2464) < 1e-10);
assert.match(rendererCalls.at(-1), /^rgba\(18,52,86,/);
renderer.stop();

function createRenderProbe(settings, curve = 'original-thinking', state = 'idle') {
  let frame;
  let currentTime = 0;
  let path = [];
  const strokes = [];
  const particles = [];
  const anchorContext = {
    setTransform: () => {},
    clearRect: () => {},
    beginPath: () => { path = []; },
    moveTo: (x, y) => path.push({ x, y }),
    lineTo: (x, y) => path.push({ x, y }),
    stroke: () => strokes.push({ path, width: anchorContext.lineWidth, shadow: anchorContext.shadowBlur, color: anchorContext.strokeStyle }),
    arc: (x, y, radius) => particles.push({ x, y, radius }),
    fill: () => {},
  };
  const anchorCanvas = {
    width: 0,
    height: 0,
    style: {},
    getContext: () => anchorContext,
    getBoundingClientRect: () => ({ width: 112, height: 112 }),
  };
  const anchorRenderer = createHaloRenderer(anchorCanvas, {
    curve,
    state,
    settings: { particle_count: 80, ...settings },
    now: () => currentTime,
    requestAnimationFrame: (callback) => { frame = callback; return 1; },
    cancelAnimationFrame: () => {},
  });
  anchorRenderer.start();
  return {
    renderer: anchorRenderer,
    frame(time) {
      currentTime = time;
      strokes.length = 0;
      particles.length = 0;
      frame(time);
      return { path: strokes[0]?.path, strokes: [...strokes], particles: [...particles] };
    },
  };
}

function renderSnapshot(settings, sampleTime, curve = 'original-thinking', state = 'idle') {
  const probe = createRenderProbe(settings, curve, state);
  probe.frame(0);
  const snapshot = probe.frame(sampleTime);
  probe.renderer.stop();
  return snapshot;
}

assert.deepEqual(renderSnapshot({ duration_ms: 1 }, 500), renderSnapshot({ duration_ms: 500 }, 500));
assert.deepEqual(renderSnapshot({ pulse_duration_ms: 1 }, 625), renderSnapshot({ pulse_duration_ms: 500 }, 625));
assert.deepEqual(renderSnapshot({ rotation_duration_ms: 1 }, 500), renderSnapshot({ rotation_duration_ms: 500 }, 500));
assert.notDeepEqual(renderSnapshot({ duration_ms: 500 }, 500).particles.at(-1), renderSnapshot({ duration_ms: 1000 }, 500).particles.at(-1));

const rendererGeometryFailures = [];
for (const id of ['butterfly-phase', 'heart-wave']) {
  const profile = curveProfiles.find((item) => item.id === id);
  const snapshot = renderSnapshot({}, 0, id);
  const error = screenInterpolationError(profile, snapshot.path, 0.5);
  if (error >= 1.1) rendererGeometryFailures.push(`${id} path error: ${error.toFixed(3)}px`);
}

const stateCases = [
  ['idle', 0.28, 0.32, 0.55],
  ['thinking', 0.68, 0.64, 0.82],
  ['executing', 0.82, 1.45, 1.55],
  ['input_needed', 0.76, 0.72, 0.9],
  ['completed', 0.58, 0.42, 0.7],
  ['interrupted', 0.68, 0.58, 0.82],
  ['compacting', 0.72, 0.88, 1.05],
];
for (const [state, alpha, speed, rotation] of stateCases) {
  const settings = { stroke_width: 1, [`${state}_color`]: '#123456', rotation_duration_ms: 500 };
  const snapshot = renderSnapshot(settings, 0, 'original-thinking', state);
  assert.equal(snapshot.strokes.length, 3);
  assert.deepEqual(snapshot.strokes.map(({ width, shadow }) => [width, shadow]), [[3, 10], [1.8, 4], [1, 0]]);
  assert.deepEqual(snapshot.strokes[0].path, snapshot.strokes[1].path);
  assert.deepEqual(snapshot.strokes[0].path, snapshot.strokes[2].path);
  assert.equal(snapshot.strokes[2].color, `rgba(18,52,86,${alpha * 0.88})`);
  assert.equal(snapshot.particles.length, 81);

  const elapsed = 125;
  const rotated = renderSnapshot(settings, elapsed, 'original-thinking', state).path[0];
  const radius = 27.3 - 11.7 * (0.5 + 0.5 * Math.sin(2 * Math.PI * elapsed / 1200));
  const angle = -2 * Math.PI * elapsed * speed / 500 * rotation;
  assert(Math.hypot(rotated.x - (50 + radius * Math.cos(angle)), rotated.y - (50 + radius * Math.sin(angle))) < 1e-8);

  const boundary = 500 / speed;
  const before = renderSnapshot(settings, boundary - 0.001, 'original-thinking', state).path[0];
  const after = renderSnapshot(settings, boundary + 0.001, 'original-thinking', state).path[0];
  const jump = Math.hypot(before.x - after.x, before.y - after.y);
  if (jump >= 0.01) rendererGeometryFailures.push(`${state} rotation boundary jump: ${jump.toFixed(3)}`);
}
assert.deepEqual(rendererGeometryFailures, []);

const anchorAngle = (snapshot) => Math.atan2(snapshot.path[0].y - 50, snapshot.path[0].x - 50);
const angleDelta = (before, after) => Math.atan2(Math.sin(after - before), Math.cos(after - before));

function transitionRotation(startTime) {
  const probe = createRenderProbe({ rotation_duration_ms: 3000 });
  probe.frame(0);
  let angle = anchorAngle(probe.frame(startTime));
  probe.renderer.setState('thinking');
  const deltas = [];
  for (let offset = 10; offset <= 420; offset += 10) {
    const next = anchorAngle(probe.frame(startTime + offset));
    deltas.push(angleDelta(angle, next));
    angle = next;
  }
  probe.renderer.stop();
  return deltas;
}

checkGeometry('state transition rotation must not depend on uptime', () => {
  const fresh = transitionRotation(0);
  const aged = transitionRotation(60000);
  const maxRateStep = 2 * Math.PI * 10 * 0.64 * 0.82 / 3000;
  const difference = Math.max(...aged.map((step, index) => Math.abs(step - fresh[index])));
  assert(difference < 1e-10, `60s transition differs by ${difference.toFixed(6)}rad/frame`);
  assert(aged.every((step) => step <= 0 && Math.abs(step) <= maxRateStep + 1e-10));
});

checkGeometry('duration changes preserve rotation phase after 60s', () => {
  const probe = createRenderProbe({ rotation_duration_ms: 3000 });
  probe.frame(0);
  const before = anchorAngle(probe.frame(60000));
  probe.renderer.setSettings({ rotation_duration_ms: 500 });
  const changed = anchorAngle(probe.frame(60000));
  const next = anchorAngle(probe.frame(60016));
  probe.renderer.stop();
  assert(Math.abs(angleDelta(before, changed)) < 1e-10, 'changing duration rewound rotation');
  assert(Math.abs(angleDelta(changed, next) + 2 * Math.PI * 16 * 0.32 * 0.55 / 500) < 1e-10);
});

for (const pause of ['stopped', 'disabled', 'non-rotating']) {
  checkGeometry(`${pause} time must not accrue rotation`, () => {
    const probe = createRenderProbe({ rotation_duration_ms: 3000 });
    probe.frame(0);
    const before = anchorAngle(probe.frame(60000));
    if (pause === 'stopped') {
      probe.renderer.stop();
      probe.renderer.start();
    } else if (pause === 'disabled') {
      probe.renderer.setSettings({ enabled: false });
      probe.frame(120000);
      probe.renderer.setSettings({ enabled: true });
    } else {
      probe.renderer.setCurve('heart-wave');
      probe.frame(120000);
      probe.renderer.setCurve('original-thinking');
    }
    const resumed = anchorAngle(probe.frame(120000));
    const next = anchorAngle(probe.frame(120016));
    probe.renderer.stop();
    assert(Math.abs(angleDelta(before, resumed)) < 1e-10, 'resuming rotation included paused time');
    assert(Math.abs(angleDelta(resumed, next) + 2 * Math.PI * 16 * 0.32 * 0.55 / 3000) < 1e-10);
  });
}
assert.deepEqual(geometryFailures, []);

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

console.log(`renderer self-check: PASS (${curveProfiles.length} profiles, 80 upstream points, max 112px interpolation ${maxScreenError.toFixed(3)}px)`);
