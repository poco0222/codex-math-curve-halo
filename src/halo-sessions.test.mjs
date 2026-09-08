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
  const clearances = [];
  const context = {
    setTransform() {}, clearRect() {},
    beginPath() { path = []; },
    moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); },
    stroke() { if (cores.length) strokeAfterCore = true; strokes.push({ path, color: this.strokeStyle, width: this.lineWidth }); },
    arc(x, y, radius, startAngle, endAngle) { circle = { x, y, radius, startAngle, endAngle }; },
    fill() { (this.globalCompositeOperation === 'destination-out' ? clearances : cores).push({ ...circle, color: this.fillStyle }); },
  };
  const canvas = { style: {}, clientWidth: 112, clientHeight: 112, getContext: () => context };
  const renderer = createHaloRenderer(canvas, {
    settings: palette, phaseOffset: 0.13, now: () => time, wallNow: () => 100000 + time,
    requestAnimationFrame(fn) { callback = fn; return 1; }, cancelAnimationFrame() {}, ...options,
  });
  renderer.start();
  return { renderer, frame(nextTime) {
    time = nextTime; strokes.length = 0; cores.length = 0; clearances.length = 0; strokeAfterCore = false; callback(time);
    return { strokes: structuredClone(strokes), cores: structuredClone(cores), clearances: structuredClone(clearances), strokeAfterCore };
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

test('fusion preserves configured outline and substantial trail width at 1, 4 and 13 sessions', () => {
  for (const stroke_width of [1, 4.3, 7.5]) for (const count of [1, 4, 13]) {
    const p = probe({ settings: { ...palette, stroke_width } });
    p.renderer.setSessions(Array.from({ length: count }, (_, i) => session(`s${i}`)));
    p.frame(0);
    const { strokes, cores } = p.frame(420);
    assert.equal(strokes[0].width, stroke_width, 'fusion must keep the configured curve outline');
    const bodies = strokes.slice(1);
    const widestBody = Math.max(...bodies.map(({ width }) => width));
    assert(widestBody >= stroke_width * (count <= 4 ? 0.95 : 0.5), 'visible trail must not collapse into a thin thread');
    assert(widestBody <= stroke_width * (count <= 4 ? 1 : 0.6), 'dense sessions still adapt their trail width');
    assert.equal(cores.length, count);
    assertCoreGaps(cores, `${stroke_width}/${count}`);
    p.renderer.stop();
  }
});

test('glow is opt-in and toggling preserves the body, cores and idle rendering', () => {
  const p = probe({ settings: { ...palette, stroke_width: 4.3 } });
  p.renderer.setSessions([session('a'), session('b', 'executing')]);
  p.frame(0);
  const off = p.frame(420);
  assert(off.strokes.every(({ width }) => width <= 4.3), 'missing setting must not add wide glow strokes');
  p.renderer.setSettings({ glow_enabled: true });
  const on = p.frame(420);
  assert(on.strokes.some(({ width }) => width > 4.3), 'enabled glow adds its wider layer');
  assert.deepEqual(on.cores, off.cores, 'toggling must preserve head color, size and phase');
  assert.deepEqual(on.strokes.filter(({ width }) => width <= 4.3), off.strokes);
  p.renderer.setSettings({ glow_enabled: false });
  assert.deepEqual(p.frame(420), off);
  p.renderer.setSessions([]);
  const idle = p.frame(420);
  p.renderer.setSettings({ glow_enabled: true });
  assert.deepEqual(p.frame(420), idle, 'idle appearance is independent of the glow switch');
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
    for (const stroke_width of [4.3, 7.5]) for (const curve of curveProfiles) for (const phaseOffset of [0.96, 0, 0.13, 0.37, 0.61]) {
      const p = probe({ curve: curve.id, phaseOffset, settings: { ...palette, stroke_width } });
      p.renderer.setSessions(Array.from({ length: 13 }, (_, i) => session(`s${i}`)));
      const first = p.frame(420);
      assertCoreGaps(first.cores, `${stroke_width}/${curve.id}/${phaseOffset}`);
      assert.deepEqual(p.frame(5420), first, 'stationary placement cannot drift');
      assert(first.cores.every(({ x, y, radius }) => x >= radius && x <= 100 - radius && y >= radius && y <= 100 - radius));
    }
  } finally { globalThis.matchMedia = previous; }
});

test('moving heads retain their visible gap through crossings without abrupt displacement', () => {
  for (const stroke_width of [4.3, 7.5]) for (const curve of ['original-thinking', 'rose-four', 'lissajous-drift']) {
    const p = probe({ curve, phaseOffset: 0.96, settings: { ...palette, stroke_width } });
    p.renderer.setSessions(Array.from({ length: 13 }, (_, i) => session(`s${i}`)));
    p.frame(0);
    let previous = p.frame(420).cores;
    for (let time = 436; time <= 5000; time += 16) {
      const current = p.frame(time).cores;
      assertCoreGaps(current, `${stroke_width}/${curve}/${time}`);
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

test('same-color cores retain a transparent gap from crossing tails', () => {
  const p = probe({ curve: 'rose-four', settings: { ...palette, stroke_width: 7.5 } });
  p.renderer.setSessions(Array.from({ length: 13 }, (_, i) => session(`s${i}`)));
  p.frame(0);
  const { cores, clearances } = p.frame(420);
  assert.equal(clearances.length, cores.length, 'each core needs clearance from other sessions\' tails');
  for (const [i, core] of cores.entries()) {
    assert.deepEqual([clearances[i].x, clearances[i].y], [core.x, core.y]);
    assert(clearances[i].radius - core.radius >= 0.6 - 1e-5, 'the background must show around each core');
    assert(clearances[i].endAngle - clearances[i].startAngle < Math.PI * 1.5, 'leave an opening that connects the core to its own tail');
  }
});

const familyKey = (key) => typeof key === 'string' && key.trim() ? Buffer.from(key).toString('hex').padEnd(64, '0') : key;
const familySnapshot = (key, state = 'thinking', updated_at_ms = 100000) => session(familyKey(key), state, updated_at_ms);
const child = (key, parent, state = 'executing', updated_at_ms = 100000) =>
  ({ ...familySnapshot(key, state, updated_at_ms), parent_session_key: familyKey(parent) });
const hasTailColor = (frame, rgb) => frame.strokes.slice(1).some(({ color }) => color.startsWith(`rgba(${rgb},`));

test('one parent and two children share one full-width core with both child colors inside its tail', () => {
  const p = probe();
  p.renderer.setSessions([familySnapshot('parent'), child('a', 'parent'), child('b', 'parent', 'input_needed')]);
  p.frame(0);
  const family = p.frame(420);
  assert.equal(family.cores.length, 1, 'children must not allocate independent heads');
  assert.equal(family.cores[0].color, 'rgba(18,52,86,1)');
  assert(hasTailColor(family, '171,205,239'));
  assert(hasTailColor(family, '161,51,119'));
  const single = probe(); single.renderer.setSessions([familySnapshot('parent')]); single.frame(0);
  assert.deepEqual(family.cores, single.frame(420).cores, 'children cannot alter parent position, radius or density');
});

test('two families keep two heads and child polling, reorder and membership changes keep their phases', () => {
  const p = probe();
  const parents = [familySnapshot('p'), familySnapshot('q', 'input_needed')];
  p.renderer.setSessions(parents); p.frame(0);
  const before = p.frame(420);
  const records = [...parents, child('b', 'p'), child('a', 'p', 'completed'), child('c', 'q')];
  p.renderer.setSessions(records);
  assert.deepEqual(p.frame(420), before, 'new children start at the currently displayed colors');
  const middle = p.frame(630);
  p.renderer.setSessions([...records].reverse());
  assert.deepEqual(p.frame(630), middle, 'polling does not restart the color transition');
  const settled = p.frame(840);
  assert.equal(settled.cores.length, 2);
  assert(hasTailColor(settled, '171,205,239'));
  p.renderer.setSessions(parents);
  assert.deepEqual(p.frame(840), settled, 'removing children has no immediate jump');
  const removed = p.frame(1260);
  assert(!hasTailColor(removed, '171,205,239'));
  assert(!hasTailColor(removed, '18,170,52'));
});

test('orphan siblings form one neutral parent and an arriving parent keeps that head position', () => {
  const p = probe({ settings: { ...palette, idle_color: '#765432' } });
  const children = [child('a', 'missing'), child('b', 'missing', 'input_needed')];
  p.renderer.setSessions(children); p.frame(0);
  const orphan = p.frame(420);
  assert.equal(orphan.cores.length, 1);
  assert.equal(orphan.cores[0].color, 'rgba(118,84,50,1)');
  assert(hasTailColor(orphan, '171,205,239'));
  p.renderer.setSessions([...children, familySnapshot('missing')]);
  assert.deepEqual(p.frame(420), orphan);
  assert.equal(p.frame(840).cores[0].color, 'rgba(18,52,86,1)');
});

test('expired terminal or idle parent stays full-sized while a child remains active', () => {
  for (const [state, updated] of [['completed', 96000], ['idle', 30000]]) {
    const p = probe();
    p.renderer.setSessions([familySnapshot('p', state, updated), child('a', 'p')]); p.frame(0);
    const family = p.frame(420);
    assert.equal(family.cores.length, 1);
    assert.equal(family.cores[0].radius, 2.75);
    assert.equal(family.cores[0].color, state === 'completed' ? 'rgba(18,170,52,1)' : 'rgba(167,173,181,1)');
    assert(hasTailColor(family, '171,205,239'));
    assert.equal(p.frame(70000).cores.length, 1);
    p.renderer.setSessions([familySnapshot('p', state, updated)]);
    assert(p.frame(70000).cores.length > 1, 'the expired parent cannot outlive its last child');
  }
});

test('child completion uses its original three-second deadline and leaves the running parent intact', () => {
  const p = probe();
  p.renderer.setSessions([familySnapshot('p'), child('a', 'p', 'completed')]); p.frame(0);
  const completed = p.frame(420);
  assert.equal(completed.cores.length, 1);
  assert(hasTailColor(completed, '18,170,52'));
  const beforeExit = p.frame(2580);
  const exiting = p.frame(2790);
  assert.notDeepEqual(exiting.strokes.map(({ color }) => color), beforeExit.strokes.map(({ color }) => color));
  const expired = p.frame(3001);
  assert.equal(expired.cores.length, 1);
  assert(!hasTailColor(expired, '18,170,52'));
  p.renderer.setSessions([familySnapshot('p'), child('a', 'p', 'completed')]);
  assert(!hasTailColor(p.frame(3421), '18,170,52'), 'old polling cannot replay completion feedback');
});

test('child state changes remain continuous, palette edits apply to children and reduced motion updates immediately', () => {
  const p = probe();
  p.renderer.setSessions([familySnapshot('p'), child('a', 'p')]); p.frame(0); const before = p.frame(420);
  p.renderer.setSessions([familySnapshot('p'), child('a', 'p', 'input_needed')]);
  assert.deepEqual(p.frame(420), before);
  const middle = p.frame(620);
  p.renderer.setSessions([familySnapshot('p'), child('a', 'p', 'completed', 100620)]);
  assert.deepEqual(p.frame(620), middle);
  assert(hasTailColor(p.frame(1040), '18,170,52'));
  p.renderer.setSettings({ completed_color: '#ff8800' });
  assert(hasTailColor(p.frame(1040), '255,136,0'));
  const previous = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  try {
    const still = probe();
    still.renderer.setSessions([familySnapshot('p'), child('a', 'p')]);
    const initial = still.frame(0);
    assert.equal(initial.cores.length, 1);
    assert(hasTailColor(initial, '171,205,239'));
    still.renderer.setSessions([familySnapshot('p'), child('a', 'p', 'input_needed')]);
    const updated = still.frame(0);
    assert(hasTailColor(updated, '161,51,119'), 'static mode does not need elapsed animation time');
    assert.deepEqual(updated.cores, initial.cores);
    assert.deepEqual(still.frame(1000), updated);
  } finally { globalThis.matchMedia = previous; }
});

test('invalid relationships, future snapshots and invalid children cannot become extra main heads', () => {
  const p = probe();
  p.renderer.setSessions([familySnapshot('p'),
    child('self', 'self'), child('empty', ''), child('space', '  '), child('null', null),
    child('number', 12),
    { ...child('short', 'p'), parent_session_key: 'p' },
    { ...child('upper', 'p'), parent_session_key: 'A'.repeat(64) },
    { ...child('nonhex', 'p'), parent_session_key: 'g'.repeat(64) },
    child('cycle-a', 'cycle-b'), child('cycle-b', 'cycle-a'),
    child('future', 'p', 'executing', 100001), child('bad-state', 'p', '__proto__'),
    child('nested', 'future'), { ...familySnapshot('blank'), session_key: '  ' },
  ]);
  p.frame(0);
  const frame = p.frame(420);
  assert.equal(frame.cores.length, 1);
  assert(frame.strokes.slice(1).every(({ color }) => color.startsWith('rgba(18,52,86,')));
});

test('late child completion still contributes color until its original deadline', () => {
  const p = probe();
  p.renderer.setSessions([familySnapshot('p'), child('a', 'p', 'completed', 97300)]);
  const late = p.frame(0);
  assert.equal(late.cores.length, 1);
  assert(late.strokes.slice(1).some(({ color }) => !color.startsWith('rgba(18,52,86,')), 'valid late completion is not silently discarded');
  assert(p.frame(301).strokes.slice(1).every(({ color }) => color.startsWith('rgba(18,52,86,')));
});

test('a renewed child completion keeps its new deadline without restarting unchanged colors', () => {
  const p = probe();
  p.renderer.setSessions([familySnapshot('p'), child('a', 'p', 'completed')]); p.frame(0);
  const first = p.frame(420);
  p.renderer.setSessions([familySnapshot('p'), child('a', 'p', 'completed', 100420)]);
  assert.deepEqual(p.frame(420), first);
  assert(hasTailColor(p.frame(3000), '18,170,52'), 'the renewed three-second deadline starts exit at 3000, not 2580');
  assert(!hasTailColor(p.frame(3421), '18,170,52'));
});

test('an overdue child exit cannot backdate a simultaneous parent color change', () => {
  let wallTime = 100000;
  const p = probe({ wallNow: () => wallTime });
  p.renderer.setSessions([familySnapshot('p'), child('a', 'p', 'completed')]); p.frame(0); p.frame(420);
  wallTime = 103500;
  p.renderer.setSessions([familySnapshot('p', 'input_needed', wallTime)]);
  const updated = p.frame(420);
  assert.equal(updated.cores[0].color, 'rgba(18,52,86,1)', 'a new parent state still begins at its displayed color');
  assert.equal(p.frame(840).cores[0].color, 'rgba(161,51,119,1)');
});

test('late completion in an existing family shows feedback and exits within its remaining deadline', () => {
  for (const wasRunning of [false, true]) for (const remaining of [200, 300]) {
    let wallTime = 100000;
    const p = probe({ wallNow: () => wallTime });
    p.renderer.setSessions([familySnapshot('p'), ...(wasRunning ? [child('a', 'p')] : [])]); p.frame(0);
    const before = p.frame(420);
    wallTime = 103500 - remaining;
    const completed = [familySnapshot('p'), child('a', 'p', 'completed', 100500)];
    p.renderer.setSessions(completed);
    assert.deepEqual(p.frame(420), before, 'late feedback starts from the displayed state');
    wallTime += remaining / 2;
    const feedback = p.frame(420 + remaining / 2);
    assert.equal(feedback.cores.length, 1);
    assert(hasTailColor(feedback, '18,170,52'), 'the remaining lifetime must include completed feedback');
    p.renderer.setSessions(completed);
    assert.deepEqual(p.frame(420 + remaining / 2), feedback, 'polling cannot restart or extend late feedback');
    wallTime = 103501;
    const expired = p.frame(421 + remaining);
    assert(expired.strokes.slice(1).every(({ color }) => color.startsWith('rgba(18,52,86,')), 'completed and prior executing colors are gone after the original deadline');
  }
});
