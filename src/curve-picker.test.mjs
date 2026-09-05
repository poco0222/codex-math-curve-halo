import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_APP_SETTINGS } from './app.js';
import { curveProfiles, getCurveAnimationSettings, sampleCurve } from './curves.js';
import { createSettingsStore } from './settings-store.js';
import { createCurveSelection, drawCurveThumbnail } from './curve-picker.js';

function selectionFixture(persist = async () => ({ ok: true })) {
  const defaults = { ...DEFAULT_APP_SETTINGS, particle_count: 123, opacity: 0.46, thinking_color: '#123456' };
  const store = createSettingsStore({ defaults, persist });
  let resets = 0;
  const selection = createCurveSelection({
    store,
    changeCurve(id) {
      resets += 1;
      store.mergeSettings({ curve_id: id, ...getCurveAnimationSettings(id) });
    },
    save: () => store.saveLatest(),
  });
  return { store, selection, resets: () => resets };
}

test('selecting the current curve retains custom settings without saving', async () => {
  const fixture = selectionFixture(() => assert.fail('same curve must not save'));
  const before = fixture.store.getSettings();
  assert.deepEqual(await fixture.selection.apply(before.curve_id), { ok: true, unchanged: true });
  assert.deepEqual(fixture.store.getSettings(), before);
  assert.equal(fixture.resets(), 0);
});

test('curve application is single-flight and retry keeps latest settings without another reset', async () => {
  let resolveSave;
  const calls = [];
  const fixture = selectionFixture((settings) => {
    calls.push(settings);
    return new Promise((resolve) => { resolveSave = resolve; });
  });
  const first = fixture.selection.apply('heart-wave');
  assert.equal(fixture.selection.pending, true);
  assert.equal((await fixture.selection.apply('rose-two')).ok, false);
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].curve_id, 'heart-wave');
  for (const [key, value] of Object.entries(getCurveAnimationSettings('heart-wave'))) assert.equal(calls[0][key], value);
  assert.equal(calls[0].opacity, 0.46);
  assert.equal(calls[0].thinking_color, '#123456');
  resolveSave({ ok: false });
  assert.equal((await first).ok, false);
  assert.equal(fixture.selection.error, true);
  fixture.store.mergeSettings({ offset_x: 412, stroke_width: 6 });
  const retry = fixture.selection.retry();
  await Promise.resolve();
  assert.equal(calls[1].offset_x, 412);
  assert.equal(calls[1].stroke_width, 6);
  assert.equal(fixture.resets(), 1);
  fixture.store.mergeSettings({ language: 'zh-CN', opacity: 0.77 });
  resolveSave({ ok: true });
  await retry;
  assert.equal(fixture.selection.pending, false);
  assert.equal(fixture.selection.error, false);
  assert.equal(fixture.store.getSettings().opacity, 0.77, 'completion must not restore an old snapshot');
  assert.equal(fixture.store.getSettings().language, 'zh-CN');
});

test('a thrown save releases pending state and exposes retry', async () => {
  const fixture = selectionFixture(async () => { throw new Error('save unavailable'); });
  assert.equal((await fixture.selection.apply('rose-two')).ok, false);
  assert.equal(fixture.selection.pending, false);
  assert.equal(fixture.selection.error, true);
});

test('all thumbnails draw the actual full sampled path without closing open curves', () => {
  for (const profile of curveProfiles) {
    const points = [];
    let transform;
    const context = {
      setTransform(...value) { transform = value; }, clearRect() {}, beginPath() {}, stroke() {},
      moveTo(x, y) { points.push({ x, y }); },
      lineTo(x, y) { points.push({ x, y }); },
      closePath() { assert.fail('open curves must not be joined'); },
    };
    const canvas = { width: 160, height: 160, getContext: () => context };
    drawCurveThumbnail(canvas, profile.id);
    assert.deepEqual(points, sampleCurve(profile, 0, 1), profile.id);
    const [scaleX, , , scaleY, offsetX, offsetY] = transform;
    assert.ok(points.every(({ x, y }) => {
      const left = (x - 0.825) * scaleX + offsetX;
      const right = (x + 0.825) * scaleX + offsetX;
      const top = (y - 0.825) * scaleY + offsetY;
      const bottom = (y + 0.825) * scaleY + offsetY;
      return left > 0 && right < canvas.width && top > 0 && bottom < canvas.height;
    }), profile.id);
  }
});

test('the current thumbnail reflects customized geometry without changing preset defaults', () => {
  const points = [];
  const context = {
    setTransform() {}, clearRect() {}, beginPath() {}, stroke() {},
    moveTo(x, y) { points.push({ x, y }); },
    lineTo(x, y) { points.push({ x, y }); },
  };
  const canvas = { width: 160, height: 160, getContext: () => context };
  drawCurveThumbnail(canvas, 'original-thinking', { curve_parameters: { baseRadius: 8 } });
  assert.deepEqual(points[0], { x: 69.5, y: 50 });
  assert.equal(curveProfiles[0].defaults.baseRadius, 7);
});
