import { getCurveAnimationSettings, getCurveProfile, prepareCurveSettings, sampleCurve } from './curves.js';
import { DEFAULT_STATE_COLORS, normalizeHexColor, STATE_COLOR_KEYS } from './colors.js';

const MORPH_DURATION_MS = 420;
const LOGICAL_SIZE = 100;
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const opacityValue = (value) => clamp(Number.isFinite(Number(value)) ? Number(value) : 1, 0, 1);
const normalize = (value) => ((value % 1) + 1) % 1;

function hexToRgb(color) {
  const value = normalizeHexColor(color, '#000000').slice(1);
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function mixColor(from, to, progress) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const rgb = a.map((channel, index) => Math.round(channel + (b[index] - channel) * progress));
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function rgba(color, alpha) {
  return `rgba(${hexToRgb(color).join(',')},${clamp(alpha, 0, 1)})`;
}

function rotatePoint(point, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const x = point.x - 50;
  const y = point.y - 50;
  return { x: 50 + x * cosine - y * sine, y: 50 + x * sine + y * cosine };
}

function styleFor(state, settings) {
  return normalizeHexColor(settings?.[STATE_COLOR_KEYS[state]], DEFAULT_STATE_COLORS[state]);
}

export function createHaloRenderer(canvas, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('createHaloRenderer requires a canvas');
  }

  const context = canvas.getContext('2d');
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const clock = options.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const requestFrame = options.requestAnimationFrame ?? globalThis.requestAnimationFrame?.bind(globalThis) ?? ((callback) => setTimeout(() => callback(clock()), 16));
  const cancelFrame = options.cancelAnimationFrame ?? globalThis.cancelAnimationFrame?.bind(globalThis) ?? clearTimeout;
  let state = Object.hasOwn(STATE_COLOR_KEYS, options.state) ? options.state : 'idle';
  let curve = getCurveProfile(options.curve ?? options.curve_id ?? 'original-thinking');
  let settings = { enabled: true, opacity: 1, ...(options.settings ?? {}) };
  let curveSettings = prepareCurveSettings(curve, settings);
  let animation = animationSettings();
  let currentStyle = styleFor(state, settings);
  let transition = null;
  let frameId = null;
  let running = false;
  let lastFrameTime = null;
  const phaseOffset = normalize(Number.isFinite(options.phaseOffset) ? options.phaseOffset : Math.random());
  let progressPhase = phaseOffset;
  let pulsePhase = phaseOffset;
  let rotationPhase = phaseOffset;

  function animationSettings() {
    const defaults = getCurveAnimationSettings(curve.id);
    const bounded = (key, min, max) => clamp(Number.isFinite(settings[key]) ? settings[key] : defaults[key], min, max);
    return {
      duration_ms: bounded('duration_ms', 500, 12000),
      pulse_duration_ms: bounded('pulse_duration_ms', 500, 10000),
      rotation_duration_ms: bounded('rotation_duration_ms', 500, 60000),
      particle_count: Math.floor(bounded('particle_count', 24, 140)),
      trail_span: bounded('trail_span', 0.12, 0.68),
      stroke_width: bounded('stroke_width', 1, 7.5),
    };
  }

  function applyOpacity() {
    if (canvas.style) canvas.style.opacity = String(opacityValue(settings.opacity));
  }

  applyOpacity();

  function styleAt(time) {
    if (!transition) return currentStyle;
    const progress = clamp((time - transition.startedAt) / MORPH_DURATION_MS, 0, 1);
    const from = transition.from;
    const to = transition.to;
    const style = mixColor(from, to, progress);
    if (progress === 1) {
      currentStyle = to;
      transition = null;
      return currentStyle;
    }
    return style;
  }

  function resizeCanvas() {
    const bounds = canvas.getBoundingClientRect?.();
    const width = bounds?.width || canvas.clientWidth || 112;
    const height = bounds?.height || canvas.clientHeight || 112;
    const pixelRatio = globalThis.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
    const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(pixelWidth / LOGICAL_SIZE, 0, 0, pixelHeight / LOGICAL_SIZE, 0, 0);
  }

  function drawPath(points, angle, color, lineWidth, alpha) {
    context.beginPath();
    points.forEach((point, index) => {
      const rotated = rotatePoint(point, angle);
      if (index === 0) context.moveTo(rotated.x, rotated.y);
      else context.lineTo(rotated.x, rotated.y);
    });
    context.strokeStyle = rgba(color, alpha);
    context.lineWidth = lineWidth;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
  }

  function drawParticle(point, angle, color, radius, alpha) {
    const rotated = rotatePoint(point, angle);
    context.beginPath();
    context.arc(rotated.x, rotated.y, radius, 0, TAU);
    context.fillStyle = rgba(color, alpha);
    context.fill();
  }

  function draw(time) {
    const deltaTime = reducedMotion?.matches ? 0 : Math.max(0, time - (lastFrameTime ?? time));
    lastFrameTime = time;
    resizeCanvas();
    context.clearRect(0, 0, LOGICAL_SIZE, LOGICAL_SIZE);
    if (settings.enabled === false) return;

    // Accumulate each phase so edits and pause/resume never replay prior elapsed time.
    progressPhase = normalize(progressPhase + deltaTime / animation.duration_ms);
    pulsePhase = normalize(pulsePhase + deltaTime / animation.pulse_duration_ms);
    const detailScale = 0.52 + ((Math.sin(TAU * pulsePhase + 0.55) + 1) / 2) * 0.48;
    if (curve.rotate(1) !== 0) {
      rotationPhase = normalize(rotationPhase + deltaTime / animation.rotation_duration_ms);
    }
    const angle = curve.rotate(rotationPhase, settings);
    const points = sampleCurve(curve, 0, detailScale, curveSettings);
    const color = styleAt(time);

    drawPath(points, angle, color, animation.stroke_width, 0.1);

    const particleCount = animation.particle_count;
    for (let index = 0; index < particleCount; index += 1) {
      const fraction = index / (particleCount - 1);
      const particleProgress = normalize(progressPhase - animation.trail_span * fraction);
      const point = curve.point(particleProgress, detailScale, curveSettings);
      const fade = (1 - fraction) ** 0.56;
      drawParticle(point, angle, color, 0.9 + fade * 2.7, 0.04 + fade * 0.96);
    }
  }

  function renderFrame(time) {
    if (!running) return;
    draw(time);
    frameId = requestFrame(renderFrame);
  }

  return {
    setState(nextState) {
      if (!Object.hasOwn(STATE_COLOR_KEYS, nextState) || nextState === state) return;
      const time = clock();
      transition = { from: styleAt(time), to: styleFor(nextState, settings), startedAt: time };
      state = nextState;
    },
    setCurve(id) {
      const nextCurve = getCurveProfile(id);
      if (nextCurve !== curve) {
        curve = nextCurve;
        curveSettings = prepareCurveSettings(curve, settings);
        animation = animationSettings();
        lastFrameTime = null;
      }
    },
    setSettings(nextSettings = {}) {
      if (nextSettings.enabled !== undefined && nextSettings.enabled !== settings.enabled) lastFrameTime = null;
      settings = { ...settings, ...nextSettings };
      curveSettings = prepareCurveSettings(curve, settings);
      animation = animationSettings();
      if (transition) {
        transition.to = styleFor(state, settings);
      } else {
        currentStyle = styleFor(state, settings);
      }
      applyOpacity();
    },
    start() {
      if (running) return;
      running = true;
      lastFrameTime = null;
      frameId = requestFrame(renderFrame);
    },
    stop() {
      running = false;
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
    },
  };
}
