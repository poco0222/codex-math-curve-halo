const TAU = Math.PI * 2;
const DEFAULT_STEPS = 481;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const detailValue = (value) => clamp(Number.isFinite(Number(value)) ? Number(value) : 0, 0, 1);
const tOf = (progress) => progress * TAU;

const REFERENCE_ANIMATION = Object.freeze({
  'original-thinking': { particleCount: 64, trailSpan: 0.38, durationMs: 4600, rotationDurationMs: 28000, pulseDurationMs: 4200, strokeWidth: 5.5 },
  'thinking-five': { particleCount: 62, trailSpan: 0.38, durationMs: 4600, rotationDurationMs: 28000, pulseDurationMs: 4200, strokeWidth: 5.5 },
  'thinking-nine': { particleCount: 68, trailSpan: 0.39, durationMs: 4700, rotationDurationMs: 30000, pulseDurationMs: 4200, strokeWidth: 5.5 },
  'rose-orbit': { particleCount: 72, trailSpan: 0.42, durationMs: 5200, rotationDurationMs: 28000, pulseDurationMs: 4600, strokeWidth: 5.2 },
  'rose-curve': { particleCount: 78, trailSpan: 0.32, durationMs: 5400, rotationDurationMs: 28000, pulseDurationMs: 4600, strokeWidth: 4.5 },
  'rose-two': { particleCount: 74, trailSpan: 0.3, durationMs: 5200, rotationDurationMs: 28000, pulseDurationMs: 4300, strokeWidth: 4.6 },
  'rose-three': { particleCount: 76, trailSpan: 0.31, durationMs: 5300, rotationDurationMs: 28000, pulseDurationMs: 4400, strokeWidth: 4.6 },
  'rose-four': { particleCount: 78, trailSpan: 0.32, durationMs: 5400, rotationDurationMs: 28000, pulseDurationMs: 4500, strokeWidth: 4.6 },
  'lissajous-drift': { particleCount: 68, trailSpan: 0.34, durationMs: 6000, rotationDurationMs: 36000, pulseDurationMs: 5400, strokeWidth: 4.7 },
  'lemniscate-bloom': { particleCount: 70, trailSpan: 0.4, durationMs: 5600, rotationDurationMs: 34000, pulseDurationMs: 5000, strokeWidth: 4.8 },
  'hypotrochoid-loop': { particleCount: 82, trailSpan: 0.46, durationMs: 7600, rotationDurationMs: 42000, pulseDurationMs: 6200, strokeWidth: 4.6 },
  'three-petal-spiral': { particleCount: 82, trailSpan: 0.34, durationMs: 4600, rotationDurationMs: 28000, pulseDurationMs: 4200, strokeWidth: 4.4 },
  'four-petal-spiral': { particleCount: 84, trailSpan: 0.34, durationMs: 4600, rotationDurationMs: 28000, pulseDurationMs: 4200, strokeWidth: 4.4 },
  'five-petal-spiral': { particleCount: 85, trailSpan: 0.34, durationMs: 4600, rotationDurationMs: 28000, pulseDurationMs: 4200, strokeWidth: 4.4 },
  'six-petal-spiral': { particleCount: 86, trailSpan: 0.34, durationMs: 4600, rotationDurationMs: 28000, pulseDurationMs: 4200, strokeWidth: 4.4 },
  'butterfly-phase': { particleCount: 88, trailSpan: 0.32, durationMs: 9000, rotationDurationMs: 50000, pulseDurationMs: 7000, strokeWidth: 4.4 },
  'cardioid-glow': { particleCount: 72, trailSpan: 0.36, durationMs: 6200, rotationDurationMs: 36000, pulseDurationMs: 5200, strokeWidth: 4.9 },
  'cardioid-heart': { particleCount: 74, trailSpan: 0.36, durationMs: 6200, rotationDurationMs: 36000, pulseDurationMs: 5200, strokeWidth: 4.9 },
  'heart-wave': { particleCount: 104, trailSpan: 0.18, durationMs: 8400, rotationDurationMs: 22000, pulseDurationMs: 5600, strokeWidth: 3.9 },
  'spiral-search': { particleCount: 86, trailSpan: 0.28, durationMs: 7800, rotationDurationMs: 44000, pulseDurationMs: 6800, strokeWidth: 4.3 },
});

function profile(id, label, defaults, point, formula, rotate = false) {
  // Geometry follows upstream 70f4e00; persisted animation settings cannot override it.
  const geometry = Object.freeze(defaults);
  return {
    id,
    label,
    tag: 'math curve',
    defaults: geometry,
    animation: Object.freeze(REFERENCE_ANIMATION[id]),
    controls: [],
    rotate: (progress) => (rotate ? -TAU * progress : 0),
    point: (progress, detailScale = 0) => point(progress, detailValue(detailScale), geometry),
    formula: () => `p = progress, 0 ≤ p ≤ 1; t = 2πp; s = detailScale(time), 0 ≤ s ≤ 1\n${formula(geometry)}`,
  };
}

function roseTrail(id, label, petalCount) {
  return profile(id, label, { baseRadius: 7, detailAmplitude: 3, petalCount, curveScale: 3.9 }, (progress, s, config) => {
    const t = tOf(progress);
    const x = config.baseRadius * Math.cos(t) - config.detailAmplitude * s * Math.cos(config.petalCount * t);
    const y = config.baseRadius * Math.sin(t) - config.detailAmplitude * s * Math.sin(config.petalCount * t);
    return { x: 50 + x * config.curveScale, y: 50 + y * config.curveScale };
  }, (config) => [
    `x(t) = 50 + (${config.baseRadius} cos t - ${config.detailAmplitude}s cos(${config.petalCount}t)) · ${config.curveScale}`,
    `y(t) = 50 + (${config.baseRadius} sin t - ${config.detailAmplitude}s sin(${config.petalCount}t)) · ${config.curveScale}`,
  ].join('\n'), true);
}

function roseCurve(id, label, roseK) {
  return profile(id, label, { roseA: 9.2, roseABoost: 0.6, roseBreathBase: 0.72, roseBreathBoost: 0.28, roseK, roseScale: 3.25 }, (progress, s, config) => {
    const t = tOf(progress);
    const a = config.roseA + config.roseABoost * s;
    const r = a * (config.roseBreathBase + config.roseBreathBoost * s) * Math.cos(config.roseK * t);
    return { x: 50 + Math.cos(t) * r * config.roseScale, y: 50 + Math.sin(t) * r * config.roseScale };
  }, (config) => [
    `r(t) = (${config.roseA} + ${config.roseABoost}s)(${config.roseBreathBase} + ${config.roseBreathBoost}s) cos(${config.roseK}t)`,
    `x(t) = 50 + ${config.roseScale}r cos t`,
    `y(t) = 50 + ${config.roseScale}r sin t`,
  ].join('\n'), true);
}

const names = ['Three', 'Four', 'Five', 'Six'];
const spiralProfiles = [3, 4, 5, 6].map((spiralR, index) => profile(
  `${names[index].toLowerCase()}-petal-spiral`,
  `${names[index]}-Petal Spiral`,
  { spiralR, spiralr: 1, spirald: 3, spiralScale: 2.2, spiralBreath: 0.45 },
  (progress, s, config) => {
    const t = tOf(progress);
    const radius = config.spiralR - config.spiralr;
    const d = config.spirald + 0.25 * s;
    const k = radius / config.spiralr;
    const scale = config.spiralScale + config.spiralBreath * s;
    return {
      x: 50 + (radius * Math.cos(t) + d * Math.cos(k * t)) * scale,
      y: 50 + (radius * Math.sin(t) - d * Math.sin(k * t)) * scale,
    };
  },
  (config) => [
    `R = ${config.spiralR}, r = ${config.spiralr}, d = ${config.spirald} + 0.25s, m = ${config.spiralScale} + ${config.spiralBreath}s`,
    'x(t) = 50 + ((R-r) cos t + d cos((R-r)t/r)) · m',
    'y(t) = 50 + ((R-r) sin t - d sin((R-r)t/r)) · m',
  ].join('\n'),
  true,
));

export const curveProfiles = [
  roseTrail('original-thinking', 'Original Thinking', 7),
  roseTrail('thinking-five', 'Thinking Five', 5),
  roseTrail('thinking-nine', 'Thinking Nine', 9),
  profile('rose-orbit', 'Rose Orbit', { orbitRadius: 7, detailAmplitude: 2.7, petalCount: 7, curveScale: 3.9 }, (progress, s, config) => {
    const t = tOf(progress);
    const r = config.orbitRadius - config.detailAmplitude * s * Math.cos(config.petalCount * t);
    return { x: 50 + Math.cos(t) * r * config.curveScale, y: 50 + Math.sin(t) * r * config.curveScale };
  }, (config) => [
    `r(t) = ${config.orbitRadius} - ${config.detailAmplitude}s cos(${config.petalCount}t)`,
    `x(t) = 50 + ${config.curveScale}r cos t`,
    `y(t) = 50 + ${config.curveScale}r sin t`,
  ].join('\n'), true),
  roseCurve('rose-curve', 'Rose Curve', 5),
  roseCurve('rose-two', 'Rose Two', 2),
  roseCurve('rose-three', 'Rose Three', 3),
  roseCurve('rose-four', 'Rose Four', 4),
  profile('lissajous-drift', 'Lissajous Drift', { lissajousAmp: 24, lissajousAmpBoost: 6, lissajousAX: 3, lissajousBY: 4, lissajousPhase: 1.57, lissajousYScale: 0.92 }, (progress, s, config) => {
    const t = tOf(progress);
    const amp = config.lissajousAmp + config.lissajousAmpBoost * s;
    return {
      x: 50 + Math.sin(config.lissajousAX * t + config.lissajousPhase) * amp,
      y: 50 + Math.sin(config.lissajousBY * t) * amp * config.lissajousYScale,
    };
  }, (config) => [
    `A = ${config.lissajousAmp} + ${config.lissajousAmpBoost}s`,
    `x(t) = 50 + A sin(${config.lissajousAX}t + ${config.lissajousPhase})`,
    `y(t) = 50 + ${config.lissajousYScale}A sin(${config.lissajousBY}t)`,
  ].join('\n')),
  profile('lemniscate-bloom', 'Lemniscate Bloom', { lemniscateA: 20, lemniscateBoost: 7 }, (progress, s, config) => {
    const t = tOf(progress);
    const a = config.lemniscateA + config.lemniscateBoost * s;
    const d = 1 + Math.sin(t) ** 2;
    return { x: 50 + a * Math.cos(t) / d, y: 50 + a * Math.sin(t) * Math.cos(t) / d };
  }, (config) => [
    `a = ${config.lemniscateA} + ${config.lemniscateBoost}s, d = 1 + sin²t`,
    'x(t) = 50 + a cos t / d',
    'y(t) = 50 + a sin t cos t / d',
  ].join('\n')),
  profile('hypotrochoid-loop', 'Hypotrochoid Loop', { spiroR: 8.2, spiror: 2.7, spirorBoost: 0.45, spirod: 4.8, spirodBoost: 1.2, spiroScale: 3.05 }, (progress, s, config) => {
    const t = tOf(progress);
    const r = config.spiror + config.spirorBoost * s;
    const d = config.spirod + config.spirodBoost * s;
    const radius = config.spiroR - r;
    const k = radius / r;
    return {
      x: 50 + (radius * Math.cos(t) + d * Math.cos(k * t)) * config.spiroScale,
      y: 50 + (radius * Math.sin(t) - d * Math.sin(k * t)) * config.spiroScale,
    };
  }, (config) => [
    `R = ${config.spiroR}, r = ${config.spiror} + ${config.spirorBoost}s, d = ${config.spirod} + ${config.spirodBoost}s`,
    `x(t) = 50 + ${config.spiroScale}((R-r) cos t + d cos((R-r)t/r))`,
    `y(t) = 50 + ${config.spiroScale}((R-r) sin t - d sin((R-r)t/r))`,
  ].join('\n')),
  ...spiralProfiles,
  profile('butterfly-phase', 'Butterfly Phase', { butterflyTurns: 12, butterflyScale: 4.6, butterflyPulse: 0.45, butterflyCosWeight: 2, butterflyPower: 5 }, (progress, s, config) => {
    const u = progress * Math.PI * config.butterflyTurns;
    const b = Math.exp(Math.cos(u)) - config.butterflyCosWeight * Math.cos(4 * u) - Math.sin(u / 12) ** config.butterflyPower;
    const scale = config.butterflyScale + config.butterflyPulse * s;
    return { x: 50 + Math.sin(u) * b * scale, y: 50 + Math.cos(u) * b * scale };
  }, (config) => [
    `u = ${config.butterflyTurns}πp = ${config.butterflyTurns / 2}t`,
    `B(u) = exp(cos u) - ${config.butterflyCosWeight} cos(4u) - sin(u/12)^${config.butterflyPower}`,
    `x(t) = 50 + sin u · B(u)(${config.butterflyScale} + ${config.butterflyPulse}s)`,
    `y(t) = 50 + cos u · B(u)(${config.butterflyScale} + ${config.butterflyPulse}s)`,
  ].join('\n')),
  profile('cardioid-glow', 'Cardioid Glow', { cardioidA: 8.4, cardioidPulse: 0.8, cardioidScale: 2.15 }, (progress, s, config) => {
    const t = tOf(progress);
    const r = (config.cardioidA + config.cardioidPulse * s) * (1 - Math.cos(t));
    return { x: 50 + Math.cos(t) * r * config.cardioidScale, y: 50 + Math.sin(t) * r * config.cardioidScale };
  }, (config) => [
    `a = ${config.cardioidA} + ${config.cardioidPulse}s, r(t) = a(1 - cos t)`,
    `x(t) = 50 + ${config.cardioidScale}r cos t`,
    `y(t) = 50 + ${config.cardioidScale}r sin t`,
  ].join('\n')),
  profile('cardioid-heart', 'Cardioid Heart', { cardioidA: 8.8, cardioidPulse: 0.8, cardioidScale: 2.15 }, (progress, s, config) => {
    const t = tOf(progress);
    const r = (config.cardioidA + config.cardioidPulse * s) * (1 + Math.cos(t));
    return { x: 50 - Math.sin(t) * r * config.cardioidScale, y: 50 - Math.cos(t) * r * config.cardioidScale };
  }, (config) => [
    `a = ${config.cardioidA} + ${config.cardioidPulse}s, r(t) = a(1 + cos t)`,
    `x(t) = 50 - ${config.cardioidScale}r sin t`,
    `y(t) = 50 - ${config.cardioidScale}r cos t`,
  ].join('\n')),
  profile('heart-wave', 'Heart Wave', { heartWaveB: 6.4, heartWaveRoot: 3.3, heartWaveAmp: 0.9, heartWaveScaleX: 23.2, heartWaveScaleY: 24.5 }, (progress, s, config) => {
    const limit = Math.sqrt(config.heartWaveRoot);
    const x = -limit + progress * limit * 2;
    const wave = config.heartWaveAmp * Math.sqrt(Math.max(0, config.heartWaveRoot - x * x)) * Math.sin(config.heartWaveB * Math.PI * x);
    const y = Math.abs(x) ** (2 / 3) + wave;
    return { x: 50 + x * config.heartWaveScaleX, y: 18 + (1.75 - y) * (config.heartWaveScaleY + 1.5 * s) };
  }, (config) => [
    `x = -√${config.heartWaveRoot} + 2p√${config.heartWaveRoot}`,
    `f(x) = |x|^(2/3) + ${config.heartWaveAmp}√(${config.heartWaveRoot} - x²) sin(${config.heartWaveB}πx)`,
    `screenX = 50 + ${config.heartWaveScaleX}x`,
    `screenY = 18 + (1.75 - f(x))(${config.heartWaveScaleY} + 1.5s)`,
  ].join('\n')),
  profile('spiral-search', 'Spiral Search', { searchTurns: 4, searchBaseRadius: 8, searchRadiusAmp: 8.5, searchPulse: 2.4, searchScale: 1 }, (progress, s, config) => {
    const t = tOf(progress);
    const angle = t * config.searchTurns;
    const radius = config.searchBaseRadius + (1 - Math.cos(t)) * (config.searchRadiusAmp + config.searchPulse * s);
    return { x: 50 + Math.cos(angle) * radius * config.searchScale, y: 50 + Math.sin(angle) * radius * config.searchScale };
  }, (config) => [
    `θ(t) = ${config.searchTurns}t, r(t) = ${config.searchBaseRadius} + (1 - cos t)(${config.searchRadiusAmp} + ${config.searchPulse}s)`,
    `x(t) = 50 + ${config.searchScale}r cos θ`,
    `y(t) = 50 + ${config.searchScale}r sin θ`,
  ].join('\n')),
];

export function getCurveProfile(id) {
  return curveProfiles.find((item) => item.id === id) ?? curveProfiles[0];
}

export function getCurveAnimationSettings(id) {
  const animation = getCurveProfile(id).animation;
  return {
    particle_count: animation.particleCount,
    trail_span: animation.trailSpan,
    duration_ms: animation.durationMs,
    pulse_duration_ms: animation.pulseDurationMs,
    rotation_duration_ms: animation.rotationDurationMs,
    stroke_width: animation.strokeWidth,
  };
}

export function sampleCurve(item, _progress, detailScale = 0, settings = item.defaults, steps = DEFAULT_STEPS) {
  const count = Math.max(2, Math.floor(Number(steps) || DEFAULT_STEPS));
  // Sample the full domain, including both endpoints of open curves. Only particles wrap.
  return Array.from({ length: count }, (_, index) => item.point(index / (count - 1), detailScale, settings));
}

export function formatFormula(item, settings) {
  return item ? String(typeof item.formula === 'function' ? item.formula(settings ?? item.defaults) : item.formula ?? '') : '';
}

export function validateCurveProfiles() {
  for (const item of curveProfiles) {
    for (const detailScale of [0, 0.5, 1]) {
      for (const point of sampleCurve(item, 0, detailScale)) {
        if (![point.x, point.y].every(Number.isFinite) || point.x < -20 || point.x > 120 || point.y < -20 || point.y > 120) {
          throw new Error(`Invalid point in curve profile: ${item.id}`);
        }
      }
    }
    if (!formatFormula(item, item.defaults).trim()) throw new Error(`Missing formula in curve profile: ${item.id}`);
  }
  return true;
}
