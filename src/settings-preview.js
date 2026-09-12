import { createHaloRenderer } from './halo.js';

export function createSettingsPreview(canvas) {
  if (!canvas) return null;
  const document = canvas.ownerDocument;
  const media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  let paused = false;
  let destroyed = false;
  let settings = { enabled: true };
  let state = 'thinking';
  let audioFrame;
  let renderer;
  function resetRenderer() {
    renderer?.stop();
    // A static preview starts at its target color, without an unfinished color transition.
    renderer = createHaloRenderer(canvas, {
      state, settings, curve: settings.curve_id, phaseOffset: 0,
      requestAnimationFrame: (callback) => globalThis.requestAnimationFrame((time) => {
        callback(time);
        // The renderer schedules continuously; retain one painted frame for reduced motion.
        if (media?.matches) renderer.stop();
      }),
    });
    if (audioFrame) renderer.setAudioFrame(audioFrame);
  }
  resetRenderer();
  function refresh() {
    renderer.stop();
    if (!destroyed && media?.matches) resetRenderer();
    if (!destroyed && !paused && !document.hidden) renderer.start();
  }
  document.addEventListener('visibilitychange', refresh);
  media?.addEventListener?.('change', refresh);
  return {
    update(nextSettings, nextState) {
      if (destroyed) return;
      settings = { ...settings, ...nextSettings, enabled: true };
      state = nextState;
      if (media?.matches) resetRenderer();
      else {
        if (settings.curve_id) renderer.setCurve(settings.curve_id);
        renderer.setSettings(settings);
        renderer.setState(state);
      }
      if (!paused && !document.hidden) renderer.start();
    },
    setAudioFrame(frame) { audioFrame = frame; renderer.setAudioFrame(frame); },
    setPaused(value) { paused = value; refresh(); },
    destroy() {
      destroyed = true;
      renderer.stop();
      document.removeEventListener('visibilitychange', refresh);
      media?.removeEventListener?.('change', refresh);
    },
  };
}
