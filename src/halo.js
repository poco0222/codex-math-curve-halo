import { getCurveProfile, sampleCurve } from './curves.js';
import { DEFAULT_STATE_COLORS, normalizeHexColor, STATE_COLOR_KEYS } from './colors.js';

const MORPH_DURATION_MS = 420;
const LOGICAL_SIZE = 100;
const TAU = Math.PI * 2;
const DEFAULT_SETTINGS = {
  enabled: true,
  opacity: 1,
  particle_count: 80,
  trail_span: 0.4,
  duration_ms: 500,
  pulse_duration_ms: 1200,
  rotation_duration_ms: 3000,
  stroke_width: 4,
};

const STATE_STYLES = {
  idle: { color: DEFAULT_STATE_COLORS.idle, alpha: 0.28, radius: 14, pulse: 0.04, speed: 0.32, rotation: 0.55 },
  thinking: { color: DEFAULT_STATE_COLORS.thinking, alpha: 0.68, radius: 16, pulse: 0.16, speed: 0.64, rotation: 0.82 },
  executing: { color: DEFAULT_STATE_COLORS.executing, alpha: 0.82, radius: 17, pulse: 0.1, speed: 1.45, rotation: 1.55 },
  input_needed: { color: DEFAULT_STATE_COLORS.input_needed, alpha: 0.76, radius: 17, pulse: 0.2, speed: 0.72, rotation: 0.9 },
  completed: { color: DEFAULT_STATE_COLORS.completed, alpha: 0.58, radius: 15, pulse: 0.12, speed: 0.42, rotation: 0.7 },
  interrupted: { color: DEFAULT_STATE_COLORS.interrupted, alpha: 0.68, radius: 16, pulse: 0.2, speed: 0.58, rotation: 0.82 },
  compacting: { color: DEFAULT_STATE_COLORS.compacting, alpha: 0.72, radius: 16, pulse: 0.24, speed: 0.88, rotation: 1.05 },
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const positive = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);
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
  const base = STATE_STYLES[state];
  return {
    ...base,
    color: normalizeHexColor(settings?.[STATE_COLOR_KEYS[state]], base.color),
  };
}

export function createHaloRenderer(canvas, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('createHaloRenderer requires a canvas');
  }

  const context = canvas.getContext('2d');
  const clock = options.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const requestFrame = options.requestAnimationFrame ?? globalThis.requestAnimationFrame?.bind(globalThis) ?? ((callback) => setTimeout(() => callback(clock()), 16));
  const cancelFrame = options.cancelAnimationFrame ?? globalThis.cancelAnimationFrame?.bind(globalThis) ?? clearTimeout;
  let state = STATE_STYLES[options.state] ? options.state : 'idle';
  let curve = getCurveProfile(options.curve ?? options.curve_id ?? 'original-thinking');
  let settings = { ...DEFAULT_SETTINGS, ...(options.settings ?? {}) };
  let currentStyle = styleFor(state, settings);
  let transition = null;
  let frameId = null;
  let running = false;
  let animationStartedAt = null;
  let lastFrameTime = null;
  let rotationPhase = 0;

  function applyOpacity() {
    if (canvas.style) canvas.style.opacity = String(opacityValue(settings.opacity));
  }

  applyOpacity();

  function styleAt(time) {
    if (!transition) return currentStyle;
    const progress = clamp((time - transition.startedAt) / MORPH_DURATION_MS, 0, 1);
    const from = transition.from;
    const to = transition.to;
    const style = {
      color: mixColor(from.color, to.color, progress),
      alpha: from.alpha + (to.alpha - from.alpha) * progress,
      radius: from.radius + (to.radius - from.radius) * progress,
      pulse: from.pulse + (to.pulse - from.pulse) * progress,
      speed: from.speed + (to.speed - from.speed) * progress,
      rotation: from.rotation + (to.rotation - from.rotation) * progress,
    };
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

  function drawPath(points, angle, color, lineWidth, alpha, shadowBlur = 0) {
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
    context.shadowColor = rgba(color, alpha * 0.9);
    context.shadowBlur = shadowBlur;
    context.stroke();
    context.shadowBlur = 0;
  }

  function drawParticle(point, angle, color, radius, alpha) {
    const rotated = rotatePoint(point, angle);
    context.beginPath();
    context.arc(rotated.x, rotated.y, radius, 0, TAU);
    context.fillStyle = rgba(color, alpha);
    context.fill();
  }

  function draw(time) {
    const deltaTime = Math.max(0, time - (lastFrameTime ?? time));
    lastFrameTime = time;
    resizeCanvas();
    context.clearRect(0, 0, LOGICAL_SIZE, LOGICAL_SIZE);
    if (settings.enabled === false) return;

    const style = styleAt(time);
    const elapsed = time - (animationStartedAt ?? time);
    const loopDuration = clamp(positive(settings.duration_ms, DEFAULT_SETTINGS.duration_ms), 500, 1500);
    const pulseDuration = clamp(positive(settings.pulse_duration_ms, DEFAULT_SETTINGS.pulse_duration_ms), 500, 2000);
    const rotationDuration = clamp(positive(settings.rotation_duration_ms, DEFAULT_SETTINGS.rotation_duration_ms), 500, 3000);
    const pulse = 0.5 + 0.5 * Math.sin(TAU * elapsed / pulseDuration);
    const detailScale = clamp(pulse, 0, 1);
    const progress = normalize(elapsed * style.speed / loopDuration);
    // Integrate new frame time so changing speed or duration never replays elapsed time.
    if (curve.rotate(1, settings) !== 0) {
      rotationPhase = normalize(rotationPhase + deltaTime * style.speed * style.rotation / rotationDuration);
    }
    const angle = curve.rotate(rotationPhase, settings);
    const points = sampleCurve(curve, 0, detailScale);
    const strokeWidth = clamp(positive(settings.stroke_width, DEFAULT_SETTINGS.stroke_width), 1, 5);
    const color = style.color;
    const alpha = style.alpha;

    drawPath(points, angle, color, strokeWidth * 3, alpha * 0.12, 10);
    drawPath(points, angle, color, strokeWidth * 1.8, alpha * 0.34, 4);
    drawPath(points, angle, color, strokeWidth, alpha * 0.88);

    const particleCount = clamp(Math.max(2, Math.floor(Number(settings.particle_count) || DEFAULT_SETTINGS.particle_count)), 80, 140);
    const trailSpan = clamp(Number(settings.trail_span) || DEFAULT_SETTINGS.trail_span, 0.12, 0.68);
    const headRadius = style.radius * (1 + style.pulse * (pulse * 2 - 1)) / 5;
    for (let index = particleCount - 1; index >= 0; index -= 1) {
      const fraction = index / (particleCount - 1);
      const particleProgress = normalize(progress - trailSpan * fraction);
      const point = curve.point(particleProgress, detailScale, settings);
      const fade = 1 - fraction;
      drawParticle(point, angle, color, Math.max(0.45, headRadius * (0.3 + 0.7 * fade)), alpha * (0.12 + 0.72 * fade));
    }
    drawParticle(curve.point(progress, detailScale, settings), angle, color, headRadius * 1.35, alpha);
  }

  function renderFrame(time) {
    if (!running) return;
    if (animationStartedAt === null) animationStartedAt = time;
    draw(time);
    frameId = requestFrame(renderFrame);
  }

  return {
    setState(nextState) {
      if (!STATE_STYLES[nextState] || nextState === state) return;
      const time = clock();
      transition = { from: styleAt(time), to: styleFor(nextState, settings), startedAt: time };
      state = nextState;
    },
    setCurve(id) {
      const nextCurve = getCurveProfile(id);
      if (nextCurve !== curve) {
        curve = nextCurve;
        lastFrameTime = null;
      }
    },
    setSettings(nextSettings = {}) {
      if (nextSettings.enabled !== undefined && nextSettings.enabled !== settings.enabled) lastFrameTime = null;
      settings = { ...settings, ...nextSettings };
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
