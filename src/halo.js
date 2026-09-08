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
  const wallClock = options.wallNow ?? Date.now;
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
  let sessionMode = false;
  const sessions = new Map();

  function validUntil(item) {
    if (!item) return -Infinity;
    return item.updated_at_ms + (item.state === 'completed' || item.state === 'interrupted'
      ? 3000 : item.state === 'idle' ? 60000 : Infinity);
  }

  function targetColorAt(session, fraction) {
    if (!session.palette.length || fraction <= 0.28) return session.color;
    // One continuous tail: reserve the head, then blend only at child segment boundaries.
    const position = (fraction - 0.28) / 0.72 * session.palette.length;
    const index = Math.min(Math.floor(position), session.palette.length - 1);
    const color = session.palette[index].color;
    const previous = index ? session.palette[index - 1].color : session.color;
    return mixColor(previous, color, clamp((position - index) / 0.16, 0, 1));
  }

  function sessionColorAt(session, fraction, time) {
    const target = targetColorAt(session, fraction);
    if (!session.transition || reducedMotion?.matches) return target;
    const { from, startedAt, duration } = session.transition;
    // The head changes first; even the final tail sample settles within 420ms.
    const delay = fraction * duration * 0.6;
    const progress = clamp((time - startedAt - delay) / (duration * 0.4), 0, 1);
    const index = fraction * (from.length - 1);
    const previous = mixColor(from[Math.floor(index)], from[Math.ceil(index)], index % 1);
    return mixColor(previous, target, progress);
  }

  function refreshFamily(session, time, wallTime, immediate = false) {
    const color = styleFor(session.state, settings);
    const palette = session.children.filter((child) => wallTime <= validUntil(child)
      && (session.signature === undefined || reducedMotion?.matches || wallTime < validUntil(child) - (child.exitDuration ?? MORPH_DURATION_MS)))
      .map((child) => ({ key: child.session_key, color: styleFor(child.state, settings),
        until: validUntil(child), duration: child.exitDuration ?? MORPH_DURATION_MS }));
    const signature = JSON.stringify([color, palette.map(({ key, color }) => [key, color])]);
    if (signature === session.signature) { session.palette = palette; return; }
    let startedAt = time;
    let duration = Math.min(MORPH_DURATION_MS, ...palette.map((child) => child.duration));
    // Completion fades inside its original deadline, even when a frame or poll is late.
    for (const previous of session.palette) {
      if (!palette.some(({ key }) => key === previous.key) && wallTime >= previous.until - previous.duration) {
        startedAt = Math.min(startedAt, time - (wallTime - previous.until + previous.duration));
        duration = Math.min(duration, previous.duration);
      }
    }
    const segments = Math.max(Math.ceil(animation.particle_count / 2), session.palette.length * 6, palette.length * 6);
    const from = Array.from({ length: segments + 1 }, (_, i) => sessionColorAt(session, i / segments, startedAt));
    session.color = color;
    session.palette = palette;
    session.signature = signature;
    session.transition = immediate || reducedMotion?.matches ? null : { from, startedAt, duration };
  }

  function updateSessions(nextSessions) {
    const time = clock();
    const wallTime = wallClock();
    const records = Array.isArray(nextSessions) ? nextSessions : [];
    const childKeys = new Set(records.filter((item) => item && Object.hasOwn(item, 'parent_session_key'))
      .map((item) => item.session_key));
    const snapshots = new Map();
    for (const item of records) {
      if (typeof item?.session_key !== 'string' || !item.session_key.trim()
        || !Object.hasOwn(STATE_COLOR_KEYS, item.state) || !Number.isFinite(item.updated_at_ms)
        || item.updated_at_ms < 0 || item.updated_at_ms > wallTime) continue;
      if (Object.hasOwn(item, 'parent_session_key') && (typeof item.parent_session_key !== 'string'
        || !/^[0-9a-f]{64}$/.test(item.parent_session_key) || item.parent_session_key === item.session_key
        || childKeys.has(item.parent_session_key))) continue;
      if (!snapshots.has(item.session_key) || snapshots.get(item.session_key).updated_at_ms < item.updated_at_ms) {
        snapshots.set(item.session_key, item);
      }
    }
    const incoming = new Map();
    for (const item of snapshots.values()) {
      const key = item.parent_session_key ?? item.session_key;
      if (!incoming.has(key)) incoming.set(key, { parent: null, children: [] });
      const family = incoming.get(key);
      if (item.parent_session_key) family.children.push(item);
      else family.parent = item;
    }
    for (const family of incoming.values()) family.children.sort((a, b) => a.session_key < b.session_key ? -1 : a.session_key > b.session_key ? 1 : 0);
    for (const key of sessions.keys()) if (!incoming.has(key)) sessions.delete(key);
    const newcomers = [...incoming.keys()].filter((key) => !sessions.has(key)).sort();
    const initiallyEmpty = sessions.size === 0;
    for (const [index, key] of newcomers.entries()) {
      let offset = index / newcomers.length;
      if (!initiallyEmpty) {
        const offsets = [...sessions.values()].map((item) => item.offset).sort((a, b) => a - b);
        let largestGap = -1;
        for (let i = 0; i < offsets.length; i += 1) {
          const gap = (offsets[(i + 1) % offsets.length] - offsets[i] + 1) % 1 || 1;
          if (gap > largestGap) { largestGap = gap; offset = normalize(offsets[i] + gap / 2); }
        }
      }
      const family = incoming.get(key);
      const state = family.parent?.state ?? 'idle';
      const item = { ...family, state, offset, enteredAt: time, color: styleFor(state, settings), palette: [], transition: null };
      refreshFamily(item, time, wallTime, true);
      sessions.set(key, item);
    }
    for (const [key, family] of incoming) {
      const current = sessions.get(key);
      refreshFamily(current, time, wallTime);
      current.parent = family.parent;
      const previousChildren = new Map(current.children.map((child) => [child.session_key, child]));
      current.children = family.children.map((child) => {
        const previous = previousChildren.get(child.session_key);
        const remaining = validUntil(child) - wallTime;
        // Late feedback shares its remaining lifetime between arrival and exit, never extends it.
        const exitDuration = previous?.state === child.state && previous.updated_at_ms === child.updated_at_ms
          ? previous.exitDuration
          : remaining > 0 && remaining < MORPH_DURATION_MS ? remaining / 2 : undefined;
        return { ...child, exitDuration };
      });
      current.state = family.parent?.state ?? 'idle';
      refreshFamily(current, time, wallTime);
    }
    sessionMode = true;
  }

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

  function drawSessions(time, points, angle) {
    const wallTime = wallClock();
    const active = [...sessions.values()].filter((item) => {
      item.until = Math.max(validUntil(item.parent), ...item.children.map(validUntil));
      refreshFamily(item, time, wallTime);
      return wallTime <= item.until;
    });
    if (!active.length) return false;
    const ordered = [...active].sort((a, b) => a.offset - b.offset);
    const gaps = new Map(ordered.map((item, i) => [item,
      normalize(item.offset - ordered[(i + ordered.length - 1) % ordered.length].offset) || 1]));
    const lengths = [0];
    for (let i = 1; i < points.length; i += 1) {
      lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    }
    // Arc length keeps dense petals from collecting every head in one tiny area.
    function pointAt(progress) {
      const distance = normalize(progress) * lengths.at(-1);
      let lo = 0;
      let hi = lengths.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (lengths[mid] < distance) lo = mid;
        else hi = mid;
      }
      const fraction = (distance - lengths[lo]) / (lengths[hi] - lengths[lo] || 1);
      return { x: points[lo].x + (points[hi].x - points[lo].x) * fraction,
        y: points[lo].y + (points[hi].y - points[lo].y) * fraction };
    }
    const outlineColor = active.length === 1 ? sessionColorAt(active[0], 0, time) : styleFor('idle', settings);
    drawPath(points, angle, outlineColor, animation.stroke_width, 0.08);
    const density = 1 / Math.sqrt(Math.max(1, active.length / 4));
    const width = animation.stroke_width * density;
    const heads = active.map((item) => {
      const entered = reducedMotion?.matches ? 1 : clamp((time - item.enteredAt) / MORPH_DURATION_MS, 0, 1);
      const terminal = [item.parent, ...item.children].some((member) => member && validUntil(member) === item.until
        && (member.state === 'completed' || member.state === 'interrupted'));
      const exit = terminal ? clamp((item.until - wallTime) / MORPH_DURATION_MS, 0, 1) : 1;
      const growth = (0.12 + 0.88 * (1 - (1 - entered) ** 3)) * (reducedMotion?.matches ? 1 : exit);
      const base = progressPhase + item.offset;
      // A monotone, bounded warp gives each head a rhythm without overtaking peers.
      const head = base + 0.012 * Math.sin(TAU * (base + pulsePhase));
      const span = Math.min(animation.trail_span, gaps.get(item) * 0.65) * growth;
      // Match the restored body's half-width so larger cores still fit at crossings.
      const radius = Math.max(0.7, width / 2) * Math.sqrt(growth);
      const anchor = rotatePoint(pointAt(head), angle);
      const recovery = reducedMotion?.matches ? 0 : Math.exp(-Math.max(0, time - (item.shift?.time ?? time)) / 180);
      return { item, head, span, radius, exit, anchor,
        x: anchor.x + (item.shift?.x ?? 0) * recovery,
        y: anchor.y + (item.shift?.y ?? 0) * recovery };
    });
    function confine(head) {
      const dx = head.x - head.anchor.x; const dy = head.y - head.anchor.y;
      const inside = head.anchor.x >= 0 && head.anchor.x <= LOGICAL_SIZE
        && head.anchor.y >= 0 && head.anchor.y <= LOGICAL_SIZE;
      const inset = (value) => clamp(value, head.radius, LOGICAL_SIZE - head.radius);
      const margin = inside ? Math.hypot(inset(head.anchor.x) - head.anchor.x, inset(head.anchor.y) - head.anchor.y) : 0;
      const scale = Math.min(1, (8 - margin) / (Math.hypot(dx, dy) || 1));
      head.x = head.anchor.x + dx * scale;
      head.y = head.anchor.y + dy * scale;
      // Oversized user geometry keeps its existing clipping, never a distant pile-up at the edge.
      if (inside) { head.x = inset(head.x); head.y = inset(head.y); }
    }
    heads.forEach(confine);
    // ponytail: 32 bounded O(n²) passes; use spatial buckets if hundreds of sessions become common.
    // Project only overlaps; retaining the prior displacement avoids lagging through a crossing.
    for (let pass = 0; pass < 32; pass += 1) {
      let moved = false;
      for (let i = 0; i < heads.length; i += 1) for (let j = i + 1; j < heads.length; j += 1) {
        const a = heads[i]; const b = heads[j];
        const dx = b.x - a.x; const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        const overlap = a.radius + b.radius + 0.6001 - distance;
        if (overlap <= 1e-7) continue;
        const direction = TAU * a.item.offset;
        const ux = distance > 1e-7 ? dx / distance : Math.cos(direction);
        const uy = distance > 1e-7 ? dy / distance : Math.sin(direction);
        a.x -= ux * overlap / 2; a.y -= uy * overlap / 2;
        b.x += ux * overlap / 2; b.y += uy * overlap / 2;
        confine(a); confine(b);
        moved = true;
      }
      if (!moved) break;
    }
    for (const core of heads) {
      const { item, head, span, exit, anchor, x, y } = core;
      const shift = { x: x - anchor.x, y: y - anchor.y, time };
      item.shift = shift;
      function tailPoint(progress, fraction) {
        const point = rotatePoint(pointAt(progress), angle);
        const taper = (1 - fraction) ** 2;
        return { x: point.x + shift.x * taper, y: point.y + shift.y * taper };
      }
      const segments = Math.max(Math.ceil(animation.particle_count / 2), item.palette.length * 6);
      for (let i = segments; i > 0; i -= 1) {
        const fraction = i / segments;
        const start = head - span * fraction;
        const end = head - span * (i - 1) / segments;
        // Never bridge the two endpoints of an open curve when its trail wraps.
        if (Math.floor(start) !== Math.floor(end)) continue;
        const fade = (1 - fraction) ** 0.7;
        const color = sessionColorAt(item, fraction, time);
        const segment = [tailPoint(start, fraction), tailPoint(end, (i - 1) / segments)];
        if (i === 1) core.connectionAngle = Math.atan2(segment[0].y - y, segment[0].x - x);
        if (settings.glow_enabled === true) {
          drawPath(segment, 0, color, width * (2.2 + fade), fade * 0.09 * density * exit);
        }
        drawPath(segment, 0, color, width * (0.2 + fade * 0.8), fade * 0.94 * exit);
      }
      if (item.transition && time - item.transition.startedAt >= item.transition.duration) item.transition = null;
    }
    // Clear crossing tails around each core, leaving its own tail connected through an opening.
    context.globalCompositeOperation = 'destination-out';
    for (const { x, y, radius, exit, connectionAngle } of heads) {
      const start = connectionAngle === undefined ? 0 : connectionAngle + Math.PI / 3;
      const end = connectionAngle === undefined ? TAU : connectionAngle + TAU - Math.PI / 3;
      context.beginPath();
      context.moveTo(x, y);
      context.arc(x, y, radius + 0.6, start, end);
      context.fillStyle = rgba('#000000', exit);
      context.fill();
    }
    context.globalCompositeOperation = 'source-over';
    // Every opaque color core sits above every translucent tail, including other sessions'.
    for (const { item, x, y, radius, exit } of heads) {
      drawParticle({ x, y }, 0, sessionColorAt(item, 0, time), radius, exit);
    }
    return true;
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
    if (sessionMode && drawSessions(time, points, angle)) return;
    const color = sessionMode ? styleFor('idle', settings) : styleAt(time);

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
    setSessions: updateSessions,
    setState(nextState) {
      if (Object.hasOwn(STATE_COLOR_KEYS, nextState)) sessionMode = false;
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
      for (const item of sessions.values()) refreshFamily(item, clock(), wallClock(), true);
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
