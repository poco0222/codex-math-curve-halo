import assert from 'node:assert/strict';
import test from 'node:test';
import { createSettingsPreview } from './settings-preview.js';

function fixture(reduce = false) {
  const listeners = new Map();
  const mediaListeners = new Set();
  const frames = new Map();
  let sequence = 0;
  let strokes = 0;
  const media = { matches: reduce, addEventListener: (_, cb) => mediaListeners.add(cb), removeEventListener: (_, cb) => mediaListeners.delete(cb) };
  const document = { hidden: false, addEventListener: (name, cb) => listeners.set(name, cb), removeEventListener: (name) => listeners.delete(name) };
  const context = { setTransform() {}, clearRect() {}, beginPath() {}, lineTo() {}, moveTo() {}, arc() {}, fill() {}, stroke() { strokes++; } };
  const canvas = { width: 400, height: 400, style: {}, ownerDocument: document, getContext: () => context, getBoundingClientRect: () => ({ width: 400, height: 400 }) };
  const previous = { matchMedia: globalThis.matchMedia, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  globalThis.matchMedia = () => media;
  globalThis.requestAnimationFrame = (cb) => { frames.set(++sequence, cb); return sequence; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  const preview = createSettingsPreview(canvas);
  const tick = () => { const current = [...frames.values()]; frames.clear(); for (const cb of current) cb(performance.now()); };
  return { preview, canvas, context, document, media, frames, listeners, mediaListeners, tick, strokes: () => strokes,
    visibility(hidden) { document.hidden = hidden; listeners.get('visibilitychange')?.(); },
    reduce(value) { media.matches = value; for (const cb of mediaListeners) cb(); },
    cleanup() { preview.destroy(); Object.assign(globalThis, previous); },
  };
}

test('local preview draws the selected state while preserving opacity and stops across modal, visibility and teardown', () => {
  const f = fixture();
  try {
    f.preview.update({ enabled: false, opacity: 0.4, curve_id: 'heart-wave', thinking_color: '#123456' }, 'thinking');
    f.tick();
    assert(f.strokes() > 0, 'disabled desktop still has a visible sample');
    assert.equal(f.canvas.style.opacity, '0.4');
    assert.equal(f.frames.size, 1);
    f.preview.setPaused(true);
    assert.equal(f.frames.size, 0);
    f.preview.setPaused(false);
    assert.equal(f.frames.size, 1);
    f.visibility(true);
    assert.equal(f.frames.size, 0);
    f.visibility(false);
    assert.equal(f.frames.size, 1);
    f.preview.destroy();
    assert.equal(f.frames.size, 0);
    assert.equal(f.listeners.size + f.mediaListeners.size, 0);
    f.preview.update({ opacity: 1 }, 'completed');
    assert.equal(f.frames.size, 0, 'detached preview cannot restart');
  } finally { f.cleanup(); }
});

test('reduced motion paints an initial frame and changed state color without leaving RAF running', () => {
  const f = fixture(true);
  try {
    f.preview.update({ enabled: false, opacity: 0.7, curve_id: 'original-thinking', thinking_color: '#123456', completed_color: '#abcdef' }, 'thinking');
    f.tick();
    assert(f.strokes() > 0);
    assert.equal(f.frames.size, 0);
    assert.equal(f.context.strokeStyle, 'rgba(18,52,86,0.1)');
    f.preview.update({ completed_color: '#abcdef' }, 'completed');
    f.tick();
    assert.equal(f.context.strokeStyle, 'rgba(171,205,239,0.1)', 'the only static frame must contain the exact target color');
    assert.equal(f.frames.size, 0);
    f.reduce(false);
    assert.equal(f.frames.size, 1);
    f.reduce(true);
    f.tick();
    assert.equal(f.frames.size, 0);
  } finally { f.cleanup(); }
});

test('enabling reduced motion during a color transition paints the exact target on its final frame', () => {
  const f = fixture();
  try {
    f.preview.update({ thinking_color: '#ff0000', completed_color: '#00ff00' }, 'thinking');
    f.tick();
    f.preview.update({}, 'completed');
    f.reduce(true);
    f.tick();
    assert.equal(f.context.strokeStyle, 'rgba(0,255,0,0.1)');
    assert.equal(f.frames.size, 0);
  } finally { f.cleanup(); }
});
