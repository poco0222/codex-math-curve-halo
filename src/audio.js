const STATUSES = new Set(['disabled', 'starting', 'capturing', 'silent', 'paused', 'permission_denied', 'unsupported', 'error']);
const BANDS = ['level', 'low', 'mid', 'high'];
export const AUDIO_STALE_MS = 500;

export function createAudioFrameReceiver(onFrame, { now = Date.now } = {}) {
  let generation = -1;
  let sequence = -1;
  return (frame) => {
    if (!frame || !STATUSES.has(frame.status)
      || !Number.isSafeInteger(frame.generation) || frame.generation < 0
      || !Number.isSafeInteger(frame.sequence) || frame.sequence < 0
      || !Number.isFinite(frame.timestamp_ms) || frame.timestamp_ms < 0
      || BANDS.some(key => !Number.isFinite(frame[key]))) return false;
    if (frame.generation < generation || (frame.generation === generation && frame.sequence <= sequence)) return false;
    const active = frame.status === 'capturing' || frame.status === 'silent';
    // Static status snapshots stay useful; queued samples must never resurrect a past peak.
    if (active && (now() - frame.timestamp_ms > AUDIO_STALE_MS || frame.timestamp_ms - now() > AUDIO_STALE_MS)) return false;
    generation = frame.generation;
    sequence = frame.sequence;
    onFrame({ generation, sequence, timestamp_ms: frame.timestamp_ms, status: frame.status,
      reason: typeof frame.reason === 'string' ? frame.reason : null,
      ...Object.fromEntries(BANDS.map(key => [key, frame.status === 'capturing' ? Math.min(1, Math.max(0, frame[key])) : 0])) });
    return true;
  };
}
