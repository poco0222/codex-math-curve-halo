import assert from 'node:assert/strict';
import { curveProfiles, formatFormula, sampleCurve, validateCurveProfiles } from '../src/curves.js';
import { createHaloRenderer } from '../src/halo.js';
import { createCommandInvoker, createDisplayStatePoller } from '../src/app.js';

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
  assert(profile.animation?.particleCount >= 24);
  assert(profile.animation?.durationMs >= 2400);
}

assert.equal(curveProfiles.find((profile) => profile.id === 'original-thinking').animation.particleCount, 64);
assert.equal(curveProfiles.find((profile) => profile.id === 'heart-wave').animation.particleCount, 104);

function createRenderProbe(settings = {}, curve = 'original-thinking', state = 'idle', phaseOffset = 0) {
  let frame;
  let currentTime = 0;
  let path = [];
  const strokes = [];
  const particles = [];
  const context = {
    setTransform() {},
    clearRect() {},
    beginPath() { path = []; },
    moveTo(x, y) { path.push({ x, y }); },
    lineTo(x, y) { path.push({ x, y }); },
    stroke() { strokes.push({ path, width: this.lineWidth, color: this.strokeStyle }); },
    arc(x, y, radius) { particles.push({ x, y, radius }); },
    fill() { particles.at(-1).color = this.fillStyle; },
  };
  const canvas = {
    width: 0, height: 0, style: {},
    getContext: () => context,
    getBoundingClientRect: () => ({ width: 112, height: 112 }),
  };
  const renderer = createHaloRenderer(canvas, {
    curve, state, phaseOffset, settings,
    now: () => currentTime,
    requestAnimationFrame: (callback) => { frame = callback; return 1; },
    cancelAnimationFrame() {},
  });
  renderer.start();
  return {
    renderer, canvas,
    frame(time) {
      currentTime = time;
      strokes.length = 0;
      particles.length = 0;
      frame(time);
      return { path: strokes[0]?.path, strokes: [...strokes], particles: [...particles] };
    },
  };
}

function renderSnapshot(settings, time, curve, state, phaseOffset) {
  const probe = createRenderProbe(settings, curve, state, phaseOffset);
  probe.frame(0);
  const snapshot = probe.frame(time);
  probe.renderer.stop();
  return snapshot;
}

const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-8, message ?? `${actual} != ${expected}`);
const nearPoint = (actual, expected, label) => {
  near(actual.x, expected.x, `${label} x`);
  near(actual.y, expected.y, `${label} y`);
};

// Audited gallery defaults from upstream 70f4e00: count, trail, loop, rotation, pulse, stroke.
const referenceAnimations = [
  [64, .38, 4600, 28000, 4200, 5.5], [62, .38, 4600, 28000, 4200, 5.5],
  [68, .39, 4700, 30000, 4200, 5.5], [72, .42, 5200, 28000, 4600, 5.2],
  [78, .32, 5400, 28000, 4600, 4.5], [74, .30, 5200, 28000, 4300, 4.6],
  [76, .31, 5300, 28000, 4400, 4.6], [78, .32, 5400, 28000, 4500, 4.6],
  [68, .34, 6000, 36000, 5400, 4.7], [70, .40, 5600, 34000, 5000, 4.8],
  [82, .46, 7600, 42000, 6200, 4.6], [82, .34, 4600, 28000, 4200, 4.4],
  [84, .34, 4600, 28000, 4200, 4.4], [85, .34, 4600, 28000, 4200, 4.4],
  [86, .34, 4600, 28000, 4200, 4.4], [88, .32, 9000, 50000, 7000, 4.4],
  [72, .36, 6200, 36000, 5200, 4.9], [74, .36, 6200, 36000, 5200, 4.9],
  [104, .18, 8400, 22000, 5600, 3.9], [86, .28, 7800, 44000, 6800, 4.3],
];
const states = ['idle', 'thinking', 'executing', 'input_needed', 'completed', 'interrupted', 'compacting'];
for (const [index, profile] of curveProfiles.entries()) {
  const [count, trail, loop, rotation, pulse, stroke] = referenceAnimations[index];
  for (const [time, phase] of [[0, 0], [1234, .37], [65000, .91]]) {
    const state = states[index % states.length];
    const snap = renderSnapshot({ [`${state}_color`]: '#123456' }, time, profile.id, state, phase);
    assert.equal(snap.strokes.length, 1);
    assert.equal(snap.strokes[0].width, stroke, profile.id);
    assert.equal(snap.strokes[0].color, 'rgba(18,52,86,0.1)');
    assert.equal(snap.particles.length, count, profile.id);
    const detail = .52 + (Math.sin((time / pulse + phase) * Math.PI * 2 + .55) + 1) * .24;
    const rotates = index < 8 || (index >= 11 && index <= 14);
    const angle = rotates ? -(time / rotation + phase) * Math.PI * 2 : 0;
    const rotate = ({ x, y }) => ({
      x: 50 + (x - 50) * Math.cos(angle) - (y - 50) * Math.sin(angle),
      y: 50 + (x - 50) * Math.sin(angle) + (y - 50) * Math.cos(angle),
    });
    // Geometry is checked against independent golden coordinates above.
    nearPoint(snap.path[0], rotate(profile.point(0, detail)), profile.id);
    nearPoint(snap.path.at(-1), rotate(profile.point(1, detail)), profile.id);
    for (const particleIndex of [0, Math.floor(count / 2), count - 1]) {
      const fraction = particleIndex / (count - 1);
      const progress = ((time / loop + phase - fraction * trail) % 1 + 1) % 1;
      nearPoint(snap.particles[particleIndex], rotate(profile.point(progress, detail)), profile.id);
      const fade = (1 - fraction) ** .56;
      near(snap.particles[particleIndex].radius, .9 + fade * 2.7);
      near(Number(snap.particles[particleIndex].color.match(/,([0-9.]+)\)$/)[1]), .04 + fade * .96);
    }
  }
}
for (const id of ['butterfly-phase', 'heart-wave']) {
  const profile = curveProfiles.find((item) => item.id === id);
  const detail = .52 + (Math.sin(.55) + 1) * .24;
  const snapshot = renderSnapshot({}, 0, id);
  assert(screenInterpolationError(profile, snapshot.path, detail) < 1.1, id);
}

// Values matching Original Thinking defaults are still legal overrides on other curves.
const overrides = { particle_count: 64, duration_ms: 4600, pulse_duration_ms: 4200, rotation_duration_ms: 28000, stroke_width: 5.5, trail_span: .38 };
const overridden = renderSnapshot(overrides, 1150, 'heart-wave');
assert.equal(overridden.particles.length, 64);
assert.equal(overridden.strokes[0].width, 5.5);
const heart = curveProfiles.find((profile) => profile.id === 'heart-wave');
nearPoint(overridden.particles[0], heart.point(.25, .52 + (Math.sin(1150 / 4200 * 2 * Math.PI + .55) + 1) * .24), 'explicit loop');
for (const [key, low, high] of [
  ['duration_ms', 500, 12000], ['pulse_duration_ms', 500, 10000],
  ['rotation_duration_ms', 500, 60000], ['particle_count', 24, 140],
  ['trail_span', .12, .68], ['stroke_width', 1, 7.5],
]) {
  assert.deepEqual(renderSnapshot({ [key]: low / 2 }, 625), renderSnapshot({ [key]: low }, 625), key);
  assert.deepEqual(renderSnapshot({ [key]: high * 2 }, 625), renderSnapshot({ [key]: high }, 625), key);
  for (const invalid of [NaN, Infinity, -Infinity, null, 'bad']) {
    assert.deepEqual(renderSnapshot({ [key]: invalid }, 625), renderSnapshot({}, 625), key);
  }
}

const anchorAngle = (snapshot) => Math.atan2(snapshot.path[0].y - 50, snapshot.path[0].x - 50);
const angleDelta = (before, after) => Math.atan2(Math.sin(after - before), Math.cos(after - before));
function transitionRotation(startTime) {
  const probe = createRenderProbe();
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
const fresh = transitionRotation(0);
const aged = transitionRotation(60000);
for (let index = 0; index < aged.length; index++) {
  near(aged[index], fresh[index], 'state transition depends on uptime');
  near(aged[index], -2 * Math.PI * 10 / 28000);
}
const durationProbe = createRenderProbe();
durationProbe.frame(0);
const beforeDuration = durationProbe.frame(60000);
durationProbe.renderer.setSettings({ rotation_duration_ms: 500, duration_ms: 500, pulse_duration_ms: 500 });
const changedDuration = durationProbe.frame(60000);
assert.deepEqual(changedDuration, beforeDuration, 'editing duration rewound phase');
const nextDuration = durationProbe.frame(60016);
near(angleDelta(anchorAngle(changedDuration), anchorAngle(nextDuration)), -2 * Math.PI * 16 / 500);
durationProbe.renderer.stop();
for (const pause of ['stopped', 'disabled', 'non-rotating']) {
  const probe = createRenderProbe();
  probe.frame(0);
  const before = probe.frame(60000);
  if (pause === 'stopped') {
    probe.renderer.stop();
    probe.renderer.start();
  } else if (pause === 'disabled') {
    probe.renderer.setSettings({ enabled: false });
    assert.equal(probe.frame(120000).particles.length, 0);
    probe.renderer.setSettings({ enabled: true });
  } else {
    probe.renderer.setCurve('heart-wave');
    probe.frame(120000);
    probe.renderer.setCurve('original-thinking');
  }
  const resumed = probe.frame(120000);
  const next = probe.frame(120016);
  near(angleDelta(anchorAngle(before), anchorAngle(resumed)), 0, `${pause} accrued rotation`);
  near(angleDelta(anchorAngle(resumed), anchorAngle(next)), -2 * Math.PI * 16 / 28000);
  if (pause !== 'non-rotating') assert.deepEqual(resumed, before, `${pause} accrued motion`);
  probe.renderer.stop();
}

const transitionProbe = createRenderProbe({ idle_color: '#000000', thinking_color: '#FFFFFF' });
transitionProbe.frame(0);
transitionProbe.renderer.setState('thinking');
transitionProbe.renderer.setSettings({ opacity: .5 });
assert.equal(transitionProbe.frame(210).strokes[0].color, 'rgba(128,128,128,0.1)');
assert.equal(transitionProbe.frame(420).strokes[0].color, 'rgba(255,255,255,0.1)');
assert.equal(transitionProbe.canvas.style.opacity, '0.5');
transitionProbe.renderer.stop();
assert.match(renderSnapshot({ idle_color: 'not-a-color' }, 0).strokes[0].color, /^rgba\(167,173,181,/);

const savedMatchMedia = globalThis.matchMedia;
globalThis.matchMedia = () => ({ matches: true });
try {
  assert.deepEqual(renderSnapshot({}, 0), renderSnapshot({}, 1000), 'reduced motion must hold position');
} finally {
  globalThis.matchMedia = savedMatchMedia;
}

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
