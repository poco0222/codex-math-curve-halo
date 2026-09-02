import assert from 'node:assert/strict';
import { curveProfiles, formatFormula } from '../src/curves.js';

for (const profile of curveProfiles) {
  for (const detailScale of [0, 0.5, 1]) {
    for (let i = 0; i < 128; i += 1) {
      const point = profile.point(i / 127, detailScale, profile.defaults);
      assert(Number.isFinite(point.x));
      assert(Number.isFinite(point.y));
      assert(point.x >= -20 && point.x <= 120);
      assert(point.y >= -20 && point.y <= 120);
    }
  }
  assert(formatFormula(profile, profile.defaults).trim().length > 0);
}

console.log(`renderer self-check: PASS (${curveProfiles.length} profiles)`);
