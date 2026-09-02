const TAU = Math.PI * 2;
const DEFAULT_STEPS = 96;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const numberSetting = (settings, key, fallback) => {
  const value = Number(settings?.[key]);
  return Number.isFinite(value) ? value : fallback;
};
const detailValue = (value) => clamp(Number.isFinite(Number(value)) ? Number(value) : 0, 0, 1);
const normalizeProgress = (progress) => ((progress % 1) + 1) % 1;
const formulaNumber = (value) => Number(value).toFixed(2).replace(/\.00$/, '');

const roseDefaults = {
  petals: 7,
  radius: 31,
  detail: 4,
  phase: 0,
};

const lissajousDefaults = {
  x_frequency: 3,
  y_frequency: 2,
  x_phase: 0,
  y_phase: Math.PI / 2,
  drift: 4,
};

const spiralDefaults = {
  turns: 1.75,
  radius: 34,
  modulation: 0.18,
  phase: 0,
};

const fourierDefaults = {
  pulse_mix: 0.24,
  phase: 0,
  x_mix: 1,
  y_mix: 1,
};

const roseParameters = (settings) => ({
  petals: clamp(Math.round(numberSetting(settings, 'petals', roseDefaults.petals)), 3, 11),
  radius: clamp(numberSetting(settings, 'radius', roseDefaults.radius), 24, 38),
  detail: clamp(numberSetting(settings, 'detail', roseDefaults.detail), 0, 8),
  phase: numberSetting(settings, 'phase', roseDefaults.phase),
});

const lissajousParameters = (settings) => ({
  xFrequency: clamp(numberSetting(settings, 'x_frequency', lissajousDefaults.x_frequency), 1, 7),
  yFrequency: clamp(numberSetting(settings, 'y_frequency', lissajousDefaults.y_frequency), 1, 7),
  xPhase: numberSetting(settings, 'x_phase', lissajousDefaults.x_phase),
  yPhase: numberSetting(settings, 'y_phase', lissajousDefaults.y_phase),
  drift: clamp(numberSetting(settings, 'drift', lissajousDefaults.drift), 0, 8),
});

const spiralParameters = (settings) => ({
  turns: clamp(numberSetting(settings, 'turns', spiralDefaults.turns), 0.5, 3),
  radius: clamp(numberSetting(settings, 'radius', spiralDefaults.radius), 26, 38),
  modulation: clamp(numberSetting(settings, 'modulation', spiralDefaults.modulation), 0, 0.35),
  phase: numberSetting(settings, 'phase', spiralDefaults.phase),
});

const fourierParameters = (settings) => ({
  pulseMix: clamp(numberSetting(settings, 'pulse_mix', fourierDefaults.pulse_mix), 0, 0.4),
  phase: numberSetting(settings, 'phase', fourierDefaults.phase),
  xMix: clamp(numberSetting(settings, 'x_mix', fourierDefaults.x_mix), 0.7, 1.3),
  yMix: clamp(numberSetting(settings, 'y_mix', fourierDefaults.y_mix), 0.7, 1.3),
});

export const curveProfiles = [
  {
    id: 'rose-seven',
    label: 'Rose Seven',
    tag: '7-petal rose',
    defaults: roseDefaults,
    controls: [
      { key: 'petals', label: 'Petals', min: 3, max: 11, step: 1 },
      { key: 'radius', label: 'Radius', min: 24, max: 38, step: 1 },
      { key: 'detail', label: 'Detail', min: 0, max: 8, step: 0.5 },
    ],
    rotate: (progress) => TAU * progress,
    point: (progress, detailScale = 0, settings = roseDefaults) => {
      const t = normalizeProgress(progress) * TAU;
      const { petals, radius, detail, phase } = roseParameters(settings);
      const detailScaleValue = detailValue(detailScale);
      const petalRadius = radius + detail * Math.cos(petals * t + phase) + detailScaleValue * 2 * Math.sin(2 * t);
      return {
        x: 50 + petalRadius * Math.cos(t + phase),
        y: 50 + petalRadius * Math.sin(t + phase),
      };
    },
    formula: (settings) => {
      const { petals, radius, detail, phase } = roseParameters(settings);
      return `r(t,d) = ${formulaNumber(radius)} + ${formulaNumber(detail)} cos(${formulaNumber(petals)}t + ${formulaNumber(phase)}) + 2d sin(2t),  x = 50 + r cos(t + ${formulaNumber(phase)}),  y = 50 + r sin(t + ${formulaNumber(phase)}),  d ∈ [0,1]`;
    },
  },
  {
    id: 'lissajous-drift',
    label: 'Lissajous Drift',
    tag: 'independent sine drift',
    defaults: lissajousDefaults,
    controls: [
      { key: 'x_frequency', label: 'X frequency', min: 1, max: 7, step: 1 },
      { key: 'y_frequency', label: 'Y frequency', min: 1, max: 7, step: 1 },
      { key: 'drift', label: 'Drift', min: 0, max: 8, step: 0.5 },
    ],
    rotate: (progress) => TAU * progress * 0.72,
    point: (progress, detailScale = 0, settings = lissajousDefaults) => {
      const t = normalizeProgress(progress) * TAU;
      const { xFrequency, yFrequency, xPhase, yPhase, drift } = lissajousParameters(settings);
      const detailScaleValue = detailValue(detailScale);
      return {
        x: 50 + 34 * Math.sin(xFrequency * t + xPhase) + drift * detailScaleValue * Math.sin(t),
        y: 50 + 34 * Math.sin(yFrequency * t + yPhase) + drift * detailScaleValue * Math.cos(t),
      };
    },
    formula: (settings) => {
      const { xFrequency, yFrequency, xPhase, yPhase, drift } = lissajousParameters(settings);
      return `x(t,d) = 50 + 34 sin(${formulaNumber(xFrequency)}t + ${formulaNumber(xPhase)}) + ${formulaNumber(drift)}d sin(t),  y(t,d) = 50 + 34 sin(${formulaNumber(yFrequency)}t + ${formulaNumber(yPhase)}) + ${formulaNumber(drift)}d cos(t),  d ∈ [0,1]`;
    },
  },
  {
    id: 'spiral-search',
    label: 'Spiral Search',
    tag: 'modulated radius',
    defaults: spiralDefaults,
    controls: [
      { key: 'turns', label: 'Turns', min: 0.5, max: 3, step: 0.25 },
      { key: 'radius', label: 'Radius', min: 26, max: 38, step: 1 },
      { key: 'modulation', label: 'Modulation', min: 0, max: 0.35, step: 0.01 },
    ],
    rotate: (progress) => TAU * progress * 1.2,
    point: (progress, detailScale = 0, settings = spiralDefaults) => {
      const p = normalizeProgress(progress);
      const { turns, radius, modulation, phase } = spiralParameters(settings);
      const detailScaleValue = detailValue(detailScale);
      const angle = TAU * turns * p + phase;
      const wave = 1 + modulation * (1 + detailScaleValue) * Math.cos(TAU * 2 * p + phase);
      const distance = Math.min(68, (4 + radius * p) * wave);
      return {
        x: 50 + distance * Math.cos(angle),
        y: 50 + distance * Math.sin(angle),
      };
    },
    formula: (settings) => {
      const { turns, radius, modulation, phase } = spiralParameters(settings);
      return `θ(t) = ${formulaNumber(turns)}·2πt + ${formulaNumber(phase)},  r(t,d) = min(68,(4 + ${formulaNumber(radius)}t)(1 + ${formulaNumber(modulation)}(1 + d) cos(4πt + ${formulaNumber(phase)}))),  d ∈ [0,1]`;
    },
  },
  {
    id: 'fourier-flow',
    label: 'Fourier Flow',
    tag: 'finite harmonic flow',
    defaults: fourierDefaults,
    controls: [
      { key: 'pulse_mix', label: 'Pulse mix', min: 0, max: 0.4, step: 0.01 },
      { key: 'x_mix', label: 'X mix', min: 0.7, max: 1.3, step: 0.01 },
      { key: 'y_mix', label: 'Y mix', min: 0.7, max: 1.3, step: 0.01 },
    ],
    rotate: (progress) => TAU * progress * 0.86,
    point: (progress, detailScale = 0, settings = fourierDefaults) => {
      const t = normalizeProgress(progress) * TAU;
      const { pulseMix, phase, xMix, yMix } = fourierParameters(settings);
      const detailScaleValue = detailValue(detailScale);
      const pulse = 1 + pulseMix * (0.5 + 0.5 * Math.sin(2 * t + phase));
      const harmonic = 1 + detailScaleValue * 0.12;
      return {
        x: 50 + xMix * pulse * (24 * Math.sin(t + phase) + 8 * Math.sin(2 * t) + 4 * harmonic * Math.cos(3 * t)),
        y: 50 + yMix * pulse * (22 * Math.cos(t) + 10 * Math.cos(2 * t + phase) + 4 * harmonic * Math.sin(3 * t)),
      };
    },
    formula: (settings) => {
      const { pulseMix, phase, xMix, yMix } = fourierParameters(settings);
      return `P(t) = 1 + ${formulaNumber(pulseMix)}(0.5 + 0.5 sin(2t + ${formulaNumber(phase)})),  x(t,d) = 50 + ${formulaNumber(xMix)}P(t)(24 sin(t + ${formulaNumber(phase)}) + 8 sin(2t) + 4(1 + 0.12d) cos(3t)),  y(t,d) = 50 + ${formulaNumber(yMix)}P(t)(22 cos(t) + 10 cos(2t + ${formulaNumber(phase)}) + 4(1 + 0.12d) sin(3t)),  d ∈ [0,1]`;
    },
  },
];

export function getCurveProfile(id) {
  return curveProfiles.find((profile) => profile.id === id) ?? curveProfiles[0];
}

export function sampleCurve(profile, progress, detailScale = 0, settings = profile.defaults, steps = DEFAULT_STEPS) {
  const count = Math.max(2, Math.floor(Number(steps) || DEFAULT_STEPS));
  const pointSettings = settings ?? profile.defaults;
  const points = [];
  for (let index = 0; index < count; index += 1) {
    const offset = index / (count - 1);
    points.push(profile.point(normalizeProgress(progress + offset), detailScale, pointSettings));
  }
  return points;
}

export function formatFormula(profile, settings) {
  if (!profile) return '';
  const formulaSettings = settings ?? profile.defaults;
  return typeof profile.formula === 'function' ? String(profile.formula(formulaSettings)) : String(profile.formula ?? '');
}

export function validateCurveProfiles() {
  for (const profile of curveProfiles) {
    for (const detailScale of [0, 0.5, 1]) {
      for (let index = 0; index < 128; index += 1) {
        const point = profile.point(index / 127, detailScale, profile.defaults);
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < -20 || point.x > 120 || point.y < -20 || point.y > 120) {
          throw new Error(`Invalid point in curve profile: ${profile.id}`);
        }
      }
    }
    if (!formatFormula(profile, profile.defaults).trim()) {
      throw new Error(`Missing formula in curve profile: ${profile.id}`);
    }
  }
  return true;
}
