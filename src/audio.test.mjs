import assert from 'node:assert/strict';
import test from 'node:test';
import { createHaloRenderer } from './halo.js';
import { curveProfiles } from './curves.js';

const frame = (extra = {}) => ({ generation: 1, sequence: 1, timestamp_ms: 100000,
  status: 'capturing', reason: null, level: 0.8, low: 0, mid: 0, high: 0, ...extra });

function probe(settings = {}, sessionMode = false) {
  let time = 0;
  let callback;
  let path = [];
  let circle;
  const strokes = [], circles = [];
  const context = {
    setTransform() {}, clearRect() {}, beginPath() { path = []; },
    moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); },
    stroke() { strokes.push({ path, color: this.strokeStyle, width: this.lineWidth }); },
    arc(x, y, radius) { circle = { x, y, radius }; },
    fill() { if (this.globalCompositeOperation !== 'destination-out') circles.push({ ...circle, color: this.fillStyle }); },
  };
  const renderer = createHaloRenderer({ style: {}, clientWidth: 112, clientHeight: 112, getContext: () => context }, {
    settings: { audio_enabled: true, audio_intensity: 1, ...settings }, curve: settings.curve_id,
    phaseOffset: 0.13, now: () => time, wallNow: () => 100000 + time,
    requestAnimationFrame(fn) { callback = fn; return 1; }, cancelAnimationFrame() {},
  });
  if (sessionMode) renderer.setSessions([{ session_key: 'root', state: 'thinking', updated_at_ms: 100000 }]);
  renderer.start();
  return { renderer, tick(nextTime, bands) {
    time = nextTime;
    if (bands) renderer.setAudioFrame(frame({ sequence: time + 1, timestamp_ms: 100000 + time, ...bands }));
    strokes.length = 0; circles.length = 0; callback(time);
    return structuredClone({ strokes, circles });
  } };
}

test('real renderer responds to independent frequency bands in idle and session paths', () => {
  for (const sessions of [false, true]) {
    const base = probe({}, sessions);
    const bass = probe({}, sessions);
    const mids = probe({}, sessions);
    const treble = probe({}, sessions);
    assert.equal(typeof bass.renderer.setAudioFrame, 'function', 'renderer needs a transient audio input');
    for (let t = 0; t <= 400; t += 20) {
      base.tick(t); bass.tick(t, { low: 1 }); mids.tick(t, { mid: 1 }); treble.tick(t, { high: 1 });
    }
    const b = base.tick(420), l = bass.tick(420), m = mids.tick(420), h = treble.tick(420);
    assert.notDeepEqual(l.strokes[0].path, b.strokes[0].path, 'bass changes the contour scale');
    assert.deepEqual(m.strokes[0].path, b.strokes[0].path, 'mid frequencies do not deform the contour');
    assert.notDeepEqual(m.circles, b.circles, 'mid frequencies advance the particles');
    assert.notDeepEqual(h.strokes[0].path, b.strokes[0].path, 'treble changes bounded contour detail');
    assert.equal(l.circles.length, b.circles.length, 'audio cannot invent sessions or particles');
    assert.deepEqual(l.circles.map(c => c.color), b.circles.map(c => c.color), 'state colors retain meaning');
  }
});

test('zero intensity and reduced motion preserve the original renderer output', () => {
  for (const reduced of [false, true]) {
    const original = globalThis.matchMedia;
    globalThis.matchMedia = () => ({ matches: reduced });
    try {
      const base = probe({ audio_enabled: false });
      const audio = probe({ audio_intensity: reduced ? 1 : 0 });
      assert.equal(typeof audio.renderer.setAudioFrame, 'function');
      for (let t = 0; t <= 500; t += 20) {
        const actual = audio.tick(t, { low: 1, mid: 1, high: 1 });
        assert.deepEqual(actual, base.tick(t));
      }
    } finally { globalThis.matchMedia = original; }
  }
});

test('stale audio releases its contour effect instead of holding the last peak', () => {
  const base = probe();
  const audio = probe();
  assert.equal(typeof audio.renderer.setAudioFrame, 'function');
  for (let t = 0; t <= 2000; t += 20) {
    base.tick(t); audio.tick(t, t <= 400 ? { low: 1, high: 1 } : undefined);
  }
  assert.deepEqual(audio.tick(2020).strokes[0], base.tick(2020).strokes[0]);
});

test('a large contour eases out of its audio safety inset without a final snap', () => {
  const p = probe({ curve_id: 'heart-wave' });
  let previous = null;
  for (let t = 0; t <= 2300; t += 20) {
    const path = p.tick(t, t <= 400 ? { low: 1, high: 1 } : undefined).strokes[0].path;
    if (t > 1300) {
      const displacement = Math.max(...path.map(([x, y], i) => Math.hypot(x - previous[i][0], y - previous[i][1])));
      assert(displacement < 1, `released contour moved ${displacement}px in one 20ms frame`);
    }
    previous = path;
  }
});

test('every preset fits full-strength audio inside the canvas with unchanged session counts', () => {
  for (const curve of curveProfiles) for (const sessionMode of [false, true]) {
    const p = probe({ curve_id: curve.id }, sessionMode);
    assert.equal(typeof p.renderer.setAudioFrame, 'function');
    let result;
    for (let t = 0; t <= 600; t += 20) result = p.tick(t, { low: 1, mid: 1, high: 1 });
    for (const { path, width } of result.strokes) for (const [x, y] of path) {
      assert(x >= width / 2 - 0.01 && x <= 100 - width / 2 + 0.01, `${curve.id}: x=${x}`);
      assert(y >= width / 2 - 0.01 && y <= 100 - width / 2 + 0.01, `${curve.id}: y=${y}`);
    }
    for (const { x, y, radius } of result.circles) {
      assert(x - radius >= 0 && x + radius <= 100 && y - radius >= 0 && y + radius <= 100, curve.id);
    }
    if (sessionMode) assert.equal(result.circles.length, 1);
  }
});

test('audio transport rejects stale runs, malformed bands and out-of-order snapshots', async () => {
  const module = await import('./audio.js').catch(() => ({}));
  assert.equal(typeof module.createAudioFrameReceiver, 'function');
  const received = [];
  const accept = module.createAudioFrameReceiver(value => received.push(value), { now: () => 100000 });
  assert.equal(accept(frame()), true);
  assert.equal(accept(frame()), false);
  assert.equal(accept(frame({ sequence: 2, low: NaN })), false);
  assert.equal(accept(frame({ sequence: 2, low: 9, high: -1 })), true);
  assert.equal(received.at(-1).low, 1);
  assert.equal(received.at(-1).high, 0);
  assert.equal(accept(frame({ generation: 2, sequence: 0, timestamp_ms: 1, status: 'disabled', low: 1 })), true);
  assert.equal(received.at(-1).low, 0, 'terminal snapshots can never carry energy');
  assert.equal(accept(frame({ sequence: 20 })), false, 'old generation cannot revive audio');
  assert.equal(accept(frame({ generation: 3, timestamp_ms: 99000 })), false, 'queued old audio cannot revive a peak');
  assert.equal(accept(frame({ generation: 3, timestamp_ms: 100001 })), true);
});
