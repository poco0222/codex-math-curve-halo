import assert from 'node:assert/strict';
import test from 'node:test';
import * as curves from './curves.js';
import { createHaloRenderer } from './halo.js';

const CONTROL_META = {
  baseRadius: ['Base radius', '基础半径', 4, 10, 0.1],
  detailAmplitude: ['Detail', '细节振幅', 1, 5, 0.1],
  petalCount: ['Petals', '花瓣数', 3, 12, 1],
  curveScale: ['Scale', '缩放', 2.5, 5.5, 0.1],
  orbitRadius: ['Base radius', '基础半径', 4, 10, 0.1],
  roseA: ['a', 'a', 5, 14, 0.1],
  roseABoost: ['a boost', 'a 呼吸量', 0, 2, 0.05],
  roseBreathBase: ['Base pulse', '基础呼吸', 0.3, 1.2, 0.01],
  roseBreathBoost: ['Pulse boost', '呼吸增量', 0, 0.8, 0.01],
  roseK: ['k', 'k 值', 2, 10, 1],
  roseScale: ['Scale', '缩放', 2, 5, 0.05],
  lissajousAmp: ['Amplitude', '振幅', 8, 36, 0.5],
  lissajousAmpBoost: ['Amp pulse', '振幅呼吸', 0, 12, 0.1],
  lissajousAX: ['a', 'a', 1, 8, 1],
  lissajousBY: ['b', 'b', 1, 8, 1],
  lissajousYScale: ['Y scale', 'Y 缩放', 0.4, 1.4, 0.01],
  lemniscateA: ['a', 'a', 8, 30, 0.5],
  lemniscateBoost: ['Pulse', '呼吸量', 0, 12, 0.1],
  spiroR: ['R', 'R', 4, 12, 0.1],
  spiror: ['r', 'r', 1, 5, 0.1],
  spirod: ['d', 'd', 1, 8, 0.1],
  spiroScale: ['Scale', '缩放', 1.5, 4.5, 0.05],
  spiralR: ['R', 'R', 2, 8, 1],
  spiralr: ['r', 'r', 1, 3, 0.1],
  spirald: ['d', 'd', 1, 5, 0.1],
  spiralScale: ['Scale', '缩放', 1.2, 3.5, 0.05],
  spiralBreath: ['Pulse', '呼吸量', 0, 1, 0.05],
  butterflyTurns: ['Turns', '圈数', 6, 18, 0.5],
  butterflyScale: ['Scale', '缩放', 2.5, 7, 0.05],
  butterflyPulse: ['Pulse', '呼吸量', 0, 1.2, 0.01],
  butterflyCosWeight: ['Cos weight', '余弦权重', 0.5, 4, 0.05],
  butterflyPower: ['Power', '幂次', 2, 8, 1],
  cardioidA: ['a', 'a', 4, 14, 0.1],
  cardioidPulse: ['Pulse', '呼吸量', 0, 2, 0.05],
  cardioidScale: ['Scale', '缩放', 1, 3.5, 0.05],
  heartWaveB: ['b', 'b', 2, 12, 0.1],
  heartWaveRoot: ['Root span', '根号范围', 2.2, 4.2, 0.05],
  heartWaveAmp: ['Wave amp', '波纹振幅', 0.3, 1.6, 0.05],
  heartWaveScaleX: ['X scale', 'X 缩放', 14, 30, 0.1],
  heartWaveScaleY: ['Y scale', 'Y 缩放', 14, 34, 0.1],
  searchTurns: ['Turns', '圈数', 2, 8, 0.1],
  searchBaseRadius: ['Base radius', '基础半径', 2, 16, 0.1],
  searchRadiusAmp: ['Radius amp', '半径振幅', 2, 16, 0.1],
  searchPulse: ['Pulse', '呼吸量', 0, 6, 0.1],
  searchScale: ['Scale', '缩放', 0.5, 1.8, 0.05],
};

const PROFILE_KEYS = {
  'original-thinking': ['baseRadius', 'detailAmplitude', 'petalCount', 'curveScale'],
  'thinking-five': ['baseRadius', 'detailAmplitude', 'petalCount', 'curveScale'],
  'thinking-nine': ['baseRadius', 'detailAmplitude', 'petalCount', 'curveScale'],
  'rose-orbit': ['orbitRadius', 'detailAmplitude', 'petalCount', 'curveScale'],
  'rose-curve': ['roseA', 'roseABoost', 'roseBreathBase', 'roseBreathBoost', 'roseK', 'roseScale'],
  'rose-two': ['roseA', 'roseABoost', 'roseBreathBase', 'roseBreathBoost', 'roseScale'],
  'rose-three': ['roseA', 'roseABoost', 'roseBreathBase', 'roseBreathBoost', 'roseScale'],
  'rose-four': ['roseA', 'roseABoost', 'roseBreathBase', 'roseBreathBoost', 'roseScale'],
  'lissajous-drift': ['lissajousAmp', 'lissajousAmpBoost', 'lissajousAX', 'lissajousBY', 'lissajousYScale'],
  'lemniscate-bloom': ['lemniscateA', 'lemniscateBoost'],
  'hypotrochoid-loop': ['spiroR', 'spiror', 'spirod', 'spiroScale'],
  'three-petal-spiral': ['spiralR', 'spiralr', 'spirald', 'spiralScale', 'spiralBreath'],
  'four-petal-spiral': ['spiralR', 'spiralr', 'spirald', 'spiralScale', 'spiralBreath'],
  'five-petal-spiral': ['spiralR', 'spiralr', 'spirald', 'spiralScale', 'spiralBreath'],
  'six-petal-spiral': ['spiralR', 'spiralr', 'spirald', 'spiralScale', 'spiralBreath'],
  'butterfly-phase': ['butterflyTurns', 'butterflyScale', 'butterflyPulse', 'butterflyCosWeight', 'butterflyPower'],
  'cardioid-glow': ['cardioidA', 'cardioidPulse', 'cardioidScale'],
  'cardioid-heart': ['cardioidA', 'cardioidPulse', 'cardioidScale'],
  'heart-wave': ['heartWaveB', 'heartWaveRoot', 'heartWaveAmp', 'heartWaveScaleX', 'heartWaveScaleY'],
  'spiral-search': ['searchTurns', 'searchBaseRadius', 'searchRadiusAmp', 'searchPulse', 'searchScale'],
};

function parameterSettings(...args) {
  assert.equal(typeof curves.getCurveParameterSettings, 'function', 'getCurveParameterSettings must be exported');
  return curves.getCurveParameterSettings(...args);
}

function expectedPoint(id, p, s, c) {
  const t = p * Math.PI * 2;
  if (id.startsWith('thinking-') || id === 'original-thinking') {
    return { x: 50 + (c.baseRadius * Math.cos(t) - c.detailAmplitude * s * Math.cos(c.petalCount * t)) * c.curveScale,
      y: 50 + (c.baseRadius * Math.sin(t) - c.detailAmplitude * s * Math.sin(c.petalCount * t)) * c.curveScale };
  }
  if (id === 'rose-orbit') {
    const r = c.orbitRadius - c.detailAmplitude * s * Math.cos(c.petalCount * t);
    return { x: 50 + Math.cos(t) * r * c.curveScale, y: 50 + Math.sin(t) * r * c.curveScale };
  }
  if (id.startsWith('rose-')) {
    const a = c.roseA + c.roseABoost * s;
    const r = a * (c.roseBreathBase + c.roseBreathBoost * s) * Math.cos(c.roseK * t);
    return { x: 50 + Math.cos(t) * r * c.roseScale, y: 50 + Math.sin(t) * r * c.roseScale };
  }
  if (id === 'lissajous-drift') {
    const a = c.lissajousAmp + c.lissajousAmpBoost * s;
    return { x: 50 + Math.sin(c.lissajousAX * t + c.lissajousPhase) * a,
      y: 50 + Math.sin(c.lissajousBY * t) * a * c.lissajousYScale };
  }
  if (id === 'lemniscate-bloom') {
    const a = c.lemniscateA + c.lemniscateBoost * s;
    const d = 1 + Math.sin(t) ** 2;
    return { x: 50 + a * Math.cos(t) / d, y: 50 + a * Math.sin(t) * Math.cos(t) / d };
  }
  if (id === 'hypotrochoid-loop') {
    const r = c.spiror + c.spirorBoost * s;
    const d = c.spirod + c.spirodBoost * s;
    const radius = c.spiroR - r;
    return { x: 50 + (radius * Math.cos(t) + d * Math.cos(radius / r * t)) * c.spiroScale,
      y: 50 + (radius * Math.sin(t) - d * Math.sin(radius / r * t)) * c.spiroScale };
  }
  if (id.endsWith('-petal-spiral')) {
    const radius = c.spiralR - c.spiralr;
    const d = c.spirald + 0.25 * s;
    const scale = c.spiralScale + c.spiralBreath * s;
    return { x: 50 + (radius * Math.cos(t) + d * Math.cos(radius / c.spiralr * t)) * scale,
      y: 50 + (radius * Math.sin(t) - d * Math.sin(radius / c.spiralr * t)) * scale };
  }
  if (id === 'butterfly-phase') {
    const u = p * Math.PI * c.butterflyTurns;
    const b = Math.exp(Math.cos(u)) - c.butterflyCosWeight * Math.cos(4 * u) - Math.sin(u / 12) ** c.butterflyPower;
    const scale = c.butterflyScale + c.butterflyPulse * s;
    return { x: 50 + Math.sin(u) * b * scale, y: 50 + Math.cos(u) * b * scale };
  }
  if (id === 'cardioid-glow') {
    const r = (c.cardioidA + c.cardioidPulse * s) * (1 - Math.cos(t));
    return { x: 50 + Math.cos(t) * r * c.cardioidScale, y: 50 + Math.sin(t) * r * c.cardioidScale };
  }
  if (id === 'cardioid-heart') {
    const r = (c.cardioidA + c.cardioidPulse * s) * (1 + Math.cos(t));
    return { x: 50 - Math.sin(t) * r * c.cardioidScale, y: 50 - Math.cos(t) * r * c.cardioidScale };
  }
  if (id === 'heart-wave') {
    const limit = Math.sqrt(c.heartWaveRoot);
    const x = -limit + p * limit * 2;
    const wave = c.heartWaveAmp * Math.sqrt(Math.max(0, c.heartWaveRoot - x * x)) * Math.sin(c.heartWaveB * Math.PI * x);
    const y = Math.abs(x) ** (2 / 3) + wave;
    return { x: 50 + x * c.heartWaveScaleX, y: 18 + (1.75 - y) * (c.heartWaveScaleY + 1.5 * s) };
  }
  const radius = c.searchBaseRadius + (1 - Math.cos(t)) * (c.searchRadiusAmp + c.searchPulse * s);
  return { x: 50 + Math.cos(t * c.searchTurns) * radius * c.searchScale,
    y: 50 + Math.sin(t * c.searchTurns) * radius * c.searchScale };
}

function assertPoint(actual, expected, message) {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-10, `${message} x: ${actual.x} != ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-10, `${message} y: ${actual.y} != ${expected.y}`);
}

test('profiles expose exactly the 89 specified controls with shared metadata', () => {
  assert.equal(Object.keys(CONTROL_META).length, 45);
  assert.equal(curves.curveProfiles.length, 20);
  let count = 0;
  for (const profile of curves.curveProfiles) {
    const expectedKeys = PROFILE_KEYS[profile.id];
    assert.deepEqual(profile.controls.map(({ key }) => key), expectedKeys, profile.id);
    for (const control of profile.controls) {
      const [labelEn, labelZh, min, max, step] = CONTROL_META[control.key];
      const expectedLabels = profile.id === 'rose-orbit' && control.key === 'petalCount'
        ? ['k', 'k 值']
        : [labelEn, labelZh];
      assert.deepEqual(
        [control.labelEn, control.labelZh, control.min, control.max, control.step, control.defaultValue],
        [...expectedLabels, min, max, step, profile.defaults[control.key]],
        `${profile.id}.${control.key}`,
      );
      count += 1;
    }
  }
  assert.equal(count, 89);
});

test('parameter settings whitelist, clamp, round integer controls, and reject non-numbers', () => {
  assert.deepEqual(parameterSettings('rose-two'), {
    roseA: 9.2, roseABoost: 0.6, roseBreathBase: 0.72, roseBreathBoost: 0.28, roseScale: 3.25,
  });
  assert.deepEqual(parameterSettings('original-thinking', {
    baseRadius: 99,
    detailAmplitude: -5,
    petalCount: 6.7,
    curveScale: '4.5',
    roseK: 9,
    unknown: 1,
  }), { baseRadius: 10, detailAmplitude: 1, petalCount: 7, curveScale: 3.9 });
  assert.deepEqual(parameterSettings('butterfly-phase', {
    butterflyTurns: 7.25,
    butterflyScale: Number.NaN,
    butterflyPulse: Number.POSITIVE_INFINITY,
    butterflyCosWeight: null,
    butterflyPower: 4.6,
  }), { butterflyTurns: 7.25, butterflyScale: 4.6, butterflyPulse: 0.45, butterflyCosWeight: 2, butterflyPower: 5 });
});

test('every exposed parameter changes geometry according to the reference formula', () => {
  const progress = 0.173;
  const detail = 0.83;
  for (const profile of curves.curveProfiles) {
    const defaults = profile.defaults;
    assertPoint(profile.point(progress, detail), expectedPoint(profile.id, progress, detail, defaults), `${profile.id} defaults`);
    for (const control of profile.controls) {
      const replacement = defaults[control.key] === control.min ? control.max : control.min;
      const parameters = parameterSettings(profile.id, { [control.key]: replacement });
      const config = { ...defaults, ...parameters };
      const actual = profile.point(progress, detail, { curve_parameters: { [control.key]: replacement } });
      assertPoint(actual, expectedPoint(profile.id, progress, detail, config), `${profile.id}.${control.key}`);
      assert.notDeepEqual(actual, profile.point(progress, detail), `${profile.id}.${control.key} must affect geometry`);
      assert.ok(
        curves.formatFormula(profile, { curve_parameters: { [control.key]: replacement } }).includes(String(parameters[control.key])),
        `${profile.id}.${control.key} formula`,
      );
    }
  }
});

test('boundary values stay finite while hidden and flat settings cannot alter fixed geometry', () => {
  for (const profile of curves.curveProfiles) {
    for (const boundary of ['min', 'max']) {
      const curve_parameters = Object.fromEntries(profile.controls.map((control) => [control.key, control[boundary]]));
      for (const point of curves.sampleCurve(profile, 0, 1, { curve_parameters }, 128)) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `${profile.id} ${boundary}`);
      }
    }
  }
  for (const id of ['rose-two', 'lissajous-drift', 'hypotrochoid-loop']) {
    const profile = curves.getCurveProfile(id);
    const baseline = profile.point(0.173, 0.83);
    assert.deepEqual(profile.point(0.173, 0.83, {
      curve_parameters: { roseK: 9, lissajousPhase: 0, spirorBoost: 4, spirodBoost: 7 },
    }), baseline, id);
    assert.deepEqual(profile.point(0.173, 0.83, Object.fromEntries(Object.keys(profile.defaults).map((key) => [key, 99]))), baseline, `${id} flat settings`);
  }
});

test('halo path and particles use one effective geometry configuration', () => {
  const moves = [];
  const particles = [];
  let frame;
  const context = {
    setTransform() {}, clearRect() {}, beginPath() {}, lineTo() {}, stroke() {}, fill() {},
    moveTo(x, y) { moves.push({ x, y }); },
    arc(x, y) { particles.push({ x, y }); },
  };
  const canvas = {
    width: 100, height: 100, clientWidth: 100, clientHeight: 100, style: {},
    getContext: () => context,
    getBoundingClientRect: () => ({ width: 100, height: 100 }),
  };
  const renderer = createHaloRenderer(canvas, {
    curve: 'original-thinking',
    phaseOffset: 0,
    now: () => 0,
    requestAnimationFrame(callback) { frame = callback; return 1; },
  });
  renderer.setSettings({ curve_parameters: { baseRadius: 8 } });
  renderer.start();
  frame(0);
  const detail = 0.52 + (Math.sin(0.55) + 1) * 0.24;
  const expected = expectedPoint('original-thinking', 0, detail, { ...curves.curveProfiles[0].defaults, baseRadius: 8 });
  assertPoint(moves[0], expected, 'path');
  assertPoint(particles[0], expected, 'particle');
  renderer.stop();
});
