import assert from 'node:assert/strict';
import test from 'node:test';
import { createHaloRenderer } from './halo.js';
import { curveProfiles } from './curves.js';

const palette = { thinking_color: '#123456', executing_color: '#abcdef', input_needed_color: '#a13377', completed_color: '#12aa34' };
const session = (key, state = 'thinking', updated_at_ms = 100000) => ({ session_key: key, state, updated_at_ms });

function probe(options = {}) {
  let time = 0;
  let callback;
  let path = [];
  let circle;
  let strokeAfterCore = false;
  const strokes = [];
  const cores = [];
  const context = {
    setTransform() {}, clearRect() {},
    beginPath() { path = []; },
    moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); },
    stroke() { if (cores.length) strokeAfterCore = true; strokes.push({ path, color: this.strokeStyle, width: this.lineWidth }); },
    arc(x, y, radius) { circle = { x, y, radius }; },
    fill() { cores.push({ ...circle, color: this.fillStyle }); },
  };
  const canvas = { style: {}, clientWidth: 112, clientHeight: 112, getContext: () => context };
  const renderer = createHaloRenderer(canvas, {
    settings: palette, phaseOffset: 0.13, now: () => time, wallNow: () => 100000 + time,
    requestAnimationFrame(fn) { callback = fn; return 1; }, cancelAnimationFrame() {}, ...options,
  });
  renderer.start();
  return { renderer, frame(nextTime) {
    time = nextTime; strokes.length = 0; cores.length = 0; strokeAfterCore = false; callback(time);
    return { strokes: structuredClone(strokes), cores: structuredClone(cores), strokeAfterCore };
  } };
}

test('2, 4 and 13 sessions retain distinct cores and custom colors on every curve', () => {
  for (const curve of curveProfiles) for (const count of [2, 4, 13]) {
    const p = probe({ curve: curve.id });
    assert.equal(typeof p.renderer.setSessions, 'function', 'renderer must accept the complete session collection');
    p.renderer.setSessions(Array.from({ length: count }, (_, i) => session(`s${i}`, i % 2 ? 'executing' : 'thinking')));
    p.frame(0);
    const { cores, strokes } = p.frame(420);
    assert.equal(cores.length, count, curve.id);
    assert(cores.some((core) => core.color === 'rgba(18,52,86,1)'));
    assert(cores.some((core) => core.color === 'rgba(171,205,239,1)'));
    assert(cores.every((core) => Number.isFinite(core.x) && Number.isFinite(core.y)));
    assert(strokes.every((stroke) => stroke.path.every((point) => point.every(Number.isFinite))));
    p.renderer.stop();
  }
});

test('poll reorder, additions, removals and simulated mode preserve existing core positions', () => {
  const p = probe();
  const records = [session('a'), session('b', 'executing')];
  p.renderer.setSessions(records); p.frame(0);
  const before = p.frame(420).cores;
  p.renderer.setSessions([...records].reverse());
  assert.deepEqual(p.frame(420).cores, before);
  p.renderer.setSessions([...records, session('c', 'input_needed')]);
  assert.deepEqual(p.frame(420).cores.slice(0, 2).map(({ x, y }) => [x, y]), before.map(({ x, y }) => [x, y]));
  p.renderer.setState('idle');
  assert(p.frame(420).cores.length > 3, 'legacy simulation still draws its original particle trail');
  p.renderer.setSessions(records);
  assert.deepEqual(p.frame(420).cores, before);
});

test('color travels from head to tail and rapid changes resume actual displayed colors', () => {
  const p = probe();
  p.renderer.setSessions([session('a')]); p.frame(0); p.frame(420);
  p.renderer.setSessions([session('a', 'executing')]);
  const middle = p.frame(520);
  assert.notEqual(middle.cores[0].color, 'rgba(18,52,86,1)');
  assert(middle.strokes.some(({ color }) => color.startsWith('rgba(18,52,86,')), 'tail still carries previous color');
  p.renderer.setSessions([session('a', 'input_needed')]);
  assert.deepEqual(p.frame(520), middle, 'no color jump at interruption');
  const end = p.frame(940);
  assert.equal(end.cores[0].color, 'rgba(161,51,119,1)');
  assert(end.strokes.slice(1).every(({ color }) => color.startsWith('rgba(161,51,119,')));
  p.renderer.setSettings({ input_needed_color: '#fedcba' });
  assert.equal(p.frame(940).cores[0].color, 'rgba(254,220,186,1)');
});

test('entry expands within 420ms; terminal exit uses event time and does not remove running peers', () => {
  const p = probe();
  p.renderer.setSessions([session('a', 'completed'), session('b')]);
  const entry = p.frame(0).cores[0];
  const full = p.frame(420).cores[0];
  assert(full.radius > entry.radius);
  assert(p.frame(2790).cores[0].radius < full.radius);
  const expired = p.frame(3001).cores;
  assert.equal(expired.length, 1);
  assert.equal(expired[0].color, 'rgba(18,52,86,1)');
  assert.equal(p.frame(70000).cores.length, 1, 'running sessions do not expire at 60s');
  p.renderer.setSessions([]);
  assert(p.frame(70000).cores.length > 1, 'empty collection restores idle renderer');
});

test('reduced motion freezes geometry while retaining same-color cores and status feedback', () => {
  const previous = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  try {
    const p = probe();
    p.renderer.setSessions(Array.from({ length: 13 }, (_, i) => session(`s${i}`)));
    const first = p.frame(420);
    assert.equal(first.cores.length, 13);
    assert.equal(new Set(first.cores.map(({ x, y }) => `${x},${y}`)).size, 13);
    assert.deepEqual(p.frame(5420), first);
    p.renderer.setSettings({ thinking_color: '#654321' });
    assert(p.frame(5420).cores.every(({ color }) => color === 'rgba(101,67,33,1)'));
  } finally { globalThis.matchMedia = previous; }
});

test('saved stroke width and particle density still control silk rendering', () => {
  const p = probe();
  p.renderer.setSessions([session('a')]); p.frame(0);
  p.renderer.setSettings({ particle_count: 24, stroke_width: 1 });
  const thin = p.frame(420);
  p.renderer.setSettings({ particle_count: 140, stroke_width: 7.5 });
  const thick = p.frame(420);
  assert(thick.strokes.length > thin.strokes.length, 'configured sample density must affect the tail');
  assert(thick.cores[0].radius > thin.cores[0].radius);
});

test('a restored terminal snapshot expires at its original event deadline', () => {
  const p = probe();
  p.renderer.setSessions([session('a', 'completed', 97500), session('b')]);
  p.frame(0);
  assert.equal(p.frame(420).cores.length, 2);
  assert.equal(p.frame(501).cores.length, 1, 'arrival must not restart the three-second terminal lifetime');
});

test('rapid recoloring preserves each displayed tail segment at custom particle density', () => {
  const p = probe({ settings: { ...palette, particle_count: 140 } });
  p.renderer.setSessions([session('a')]); p.frame(0); p.frame(420);
  p.renderer.setSessions([session('a', 'executing')]);
  const before = p.frame(551);
  p.renderer.setSessions([session('a', 'input_needed')]);
  assert.deepEqual(p.frame(551), before);
});

function assertCoreGaps(cores, label) {
  for (let i = 0; i < cores.length; i += 1) for (let j = i + 1; j < cores.length; j += 1) {
    const a = cores[i]; const b = cores[j];
    const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius;
    assert(gap >= 0.6 - 1e-5, `${label}: cores ${i}/${j} gap ${gap.toFixed(5)}px`);
  }
}

test('13 same-color cores keep a visible gap at curve crossings in reduced motion', () => {
  const previous = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  try {
    for (const curve of curveProfiles) for (const phaseOffset of [0.96, 0, 0.13, 0.37, 0.61]) {
      const p = probe({ curve: curve.id, phaseOffset });
      p.renderer.setSessions(Array.from({ length: 13 }, (_, i) => session(`s${i}`)));
      const first = p.frame(420);
      assertCoreGaps(first.cores, `${curve.id}/${phaseOffset}`);
      assert.deepEqual(p.frame(5420), first, 'stationary placement cannot drift');
      assert(first.cores.every(({ x, y, radius }) => x >= radius && x <= 100 - radius && y >= radius && y <= 100 - radius));
    }
  } finally { globalThis.matchMedia = previous; }
});

test('moving heads retain their visible gap through crossings without abrupt displacement', () => {
  for (const curve of ['original-thinking', 'rose-four', 'lissajous-drift']) {
    const p = probe({ curve, phaseOffset: 0.96 });
    p.renderer.setSessions(Array.from({ length: 13 }, (_, i) => session(`s${i}`)));
    p.frame(0);
    let previous = p.frame(420).cores;
    for (let time = 436; time <= 5000; time += 16) {
      const current = p.frame(time).cores;
      assertCoreGaps(current, `${curve}/${time}`);
      assert(current.every((core, i) => Math.hypot(core.x - previous[i].x, core.y - previous[i].y) < 5), `${curve}/${time}: abrupt head jump`);
      previous = current;
    }
  }
});

test('oversized geometry keeps finite heads within eight pixels of their original curve anchors', () => {
  const previous = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  try {
    const p = probe({ phaseOffset: 0.96, settings: { ...palette,
      curve_parameters: { baseRadius: 10, detailAmplitude: 5, petalCount: 12, curveScale: 5.5 } } });
    p.renderer.setSessions(Array.from({ length: 13 }, (_, i) => session(`s${i}`)));
    // Reference arc-length anchors before avoidance; this geometry already crosses the viewport.
    const anchors = [[127.758318, 46.765587], [121.301651, 75.389396], [101.780816, 96.597989],
      [74.894654, 102.154279], [45.842966, 87.933551], [12.279345, 61.810491], [-15.556754, 41.733902],
      [-24.550347, 28.069414], [-12.552169, 21.636035], [21.956938, 21.120547], [67.444293, 11.858847],
      [99.123076, 7.451867], [119.512002, 20.944366]];
    const { cores } = p.frame(420);
    assert.equal(cores.length, 13);
    for (const [i, core] of cores.entries()) {
      assert(Number.isFinite(core.x) && Number.isFinite(core.y));
      assert(Math.hypot(core.x - anchors[i][0], core.y - anchors[i][1]) <= 8.00001, `head ${i} moved beyond its local neighborhood`);
    }
  } finally { globalThis.matchMedia = previous; }
});

test('all configured-color cores are painted above every translucent tail', () => {
  const p = probe();
  p.renderer.setSessions([session('a'), session('b', 'executing'), session('c', 'input_needed')]);
  p.frame(0);
  assert.equal(p.frame(420).strokeAfterCore, false, 'another session tail must not tint an already painted core');
});
