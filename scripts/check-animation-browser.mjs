import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { DEFAULT_APP_SETTINGS } from '../src/app.js';

// Run against the static dev server; the IPC shim checks UI integration, not native IPC.
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.env.HALO_TEST_URL ?? 'http://127.0.0.1:8765';
const output = resolve(process.env.HALO_QA_DIR ?? '.comet/runtime/animation-qa');
const reference = resolve(process.env.HALO_REFERENCE_ROOT ?? '../math-curve-loaders', 'main.js');
const upstream = await readFile(reference, 'utf8');
const curveSource = upstream.slice(upstream.indexOf('const curves = ['), upstream.indexOf('function normalizeProgress'));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.HALO_BROWSER_CHANNEL ?? 'chrome' });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((defaults) => {
    const listeners = {};
    window.__haloSaves = [];
    window.__TAURI__ = {
      core: { invoke: async (command, args) => {
        if (command === 'get_settings') return JSON.parse(localStorage.getItem('halo-test') ?? JSON.stringify(defaults));
        if (command === 'get_display_state') return { state: 'idle', updated_at_ms: 0 };
        if (command === 'save_settings') {
          localStorage.setItem('halo-test', JSON.stringify(args.settings));
          window.__haloSaves.push(args.settings);
          listeners['settings-changed']?.({ payload: args.settings });
          return args.settings;
        }
        return null;
      } },
      event: { listen: async (name, callback) => { listeners[name] = callback; } },
    };
  }, DEFAULT_APP_SETTINGS);
  await page.goto(url + '/settings.html');
  await page.waitForSelector('#curve-id');
  await page.selectOption('#curve-id', 'heart-wave');
  await page.waitForFunction(() => window.__haloSaves.length > 0);
  const values = () => page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('#animation-section input')].map((field) => [field.name, Number(field.value)]),
  ));
  const heart = { particle_count: 104, trail_span: .18, duration_ms: 8400, pulse_duration_ms: 5600, rotation_duration_ms: 22000, stroke_width: 3.9 };
  assert.deepEqual(await values(), heart, 'selecting a preset must load its actual animation values');
  for (const [id, value] of [['particle-count', 64], ['duration-ms', 4600], ['stroke-width', 5.5]]) {
    await page.locator('#' + id).fill(String(value));
    await page.locator('#' + id).dispatchEvent('input');
  }
  await page.waitForFunction(() => window.__haloSaves.at(-1)?.stroke_width === 5.5);
  await page.click('#settings-tab-colors');
  assert.equal(await page.locator('#animation-section').count(), 0);
  await page.click('#settings-tab-display');
  const custom = { ...heart, particle_count: 64, duration_ms: 4600, stroke_width: 5.5 };
  assert.deepEqual(await values(), custom, 'remount must retain overrides');
  await page.reload();
  await page.waitForSelector('#curve-id');
  assert.deepEqual(await values(), custom, 'reload must retain overrides');
  await page.click('#reset-animation');
  await page.waitForFunction(() => window.__haloSaves.at(-1)?.particle_count === 104);
  assert.deepEqual(await values(), heart);
  await page.selectOption('#language', 'zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  for (const [width, height] of [[1130, 890], [390, 844]]) {
    await page.setViewportSize({ width, height });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
    await page.screenshot({ path: output + '/settings-' + width + '.png', fullPage: true });
  }

  const visual = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  visual.on('pageerror', (error) => errors.push(error.message));
  await visual.goto(url + '/index.html');
  const comparison = await visual.evaluate(async ({ curveSource }) => {
    const { createHaloRenderer } = await import('/halo.js');
    const { curveProfiles } = await import('/curves.js');
    const referenceCurves = new Function(curveSource + '; return curves;')().slice(0, 20);
    document.body.innerHTML = '';
    document.body.className = '';
    document.body.style.cssText = 'margin:0;padding:16px;background:#151719;color:white;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;font:12px sans-serif';
    const ns = 'http://www.w3.org/2000/svg';
    return Promise.all(curveProfiles.map(async (profile, index) => {
      const config = referenceCurves[index];
      const tile = document.createElement('div');
      tile.style.cssText = 'display:grid;grid-template-columns:112px 112px;gap:8px';
      const title = document.createElement('div');
      title.textContent = profile.label + ' (Halo / Reference)';
      title.style.gridColumn = '1 / -1';
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'width:112px;height:112px';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('width', '112');
      svg.setAttribute('height', '112');
      tile.append(title, canvas, svg);
      document.body.append(tile);
      let frame;
      const renderer = createHaloRenderer(canvas, { curve: profile.id, state: 'thinking', phaseOffset: .37, settings: { thinking_color: '#FFFFFF' }, requestAnimationFrame: (callback) => { frame = callback; }, cancelAnimationFrame() {} });
      renderer.start();
      frame(0);
      const initial = canvas.toDataURL();
      frame(1234);
      const moved = initial !== canvas.toDataURL();
      renderer.stop();
      const pixels = canvas.getContext('2d').getImageData(0, 0, 112, 112).data;
      const nonblank = pixels.some((v, i) => i % 4 === 3 && v > 0);
      const group = document.createElementNS(ns, 'g');
      const angle = config.rotate ? -(1234 / config.rotationDurationMs + .37) * 360 : 0;
      group.setAttribute('transform', 'rotate(' + angle + ' 50 50)');
      const detail = .52 + (Math.sin((1234 / config.pulseDurationMs + .37) * Math.PI * 2 + .55) + 1) * .24;
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', Array.from({ length: 481 }, (_, i) => {
        const p = config.point(i / 480, detail, config);
        return (i === 0 ? 'M ' : 'L ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2);
      }).join(' '));
      for (const [key, value] of Object.entries({ fill: 'none', stroke: '#FFFFFF', 'stroke-width': config.strokeWidth, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: .1 })) path.setAttribute(key, value);
      group.append(path);
      for (let i = 0; i < config.particleCount; i++) {
        const fraction = i / (config.particleCount - 1);
        const p = config.point(((1234 / config.durationMs + .37 - fraction * config.trailSpan) % 1 + 1) % 1, detail, config);
        const fade = (1 - fraction) ** .56;
        const dot = document.createElementNS(ns, 'circle');
        for (const [key, value] of Object.entries({ cx: p.x.toFixed(2), cy: p.y.toFixed(2), r: (.9 + fade * 2.7).toFixed(2), opacity: (.04 + fade * .96).toFixed(3), fill: '#FFFFFF' })) dot.setAttribute(key, value);
        group.append(dot);
      }
      svg.append(group);
      const source = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
      const referenceImage = new Image();
      referenceImage.src = source;
      await referenceImage.decode();
      const raster = document.createElement('canvas');
      raster.width = raster.height = 112;
      const rasterContext = raster.getContext('2d');
      rasterContext.drawImage(referenceImage, 0, 0, 112, 112);
      URL.revokeObjectURL(source);
      const expected = rasterContext.getImageData(0, 0, 112, 112).data;
      let alphaError = 0;
      for (let i = 3; i < pixels.length; i += 4) alphaError += Math.abs(pixels[i] - expected[i]);
      return { id: profile.id, moved, nonblank, alphaError: alphaError / (112 * 112 * 255) };
    }));
  }, { curveSource });
  assert(comparison.every(({ moved, nonblank }) => moved && nonblank));
  // Canvas and SVG rasterization differ slightly at subpixel edges.
  assert(comparison.every(({ alphaError }) => alphaError < .02), JSON.stringify(comparison));
  for (const [width, height] of [[1200, 900], [390, 844]]) {
    await visual.setViewportSize({ width, height });
    await visual.screenshot({ path: output + '/comparison-' + width + '.png', fullPage: true });
  }
  await visual.emulateMedia({ reducedMotion: 'reduce' });
  assert(await visual.evaluate(async () => {
    const { createHaloRenderer } = await import('/halo.js');
    const canvas = document.createElement('canvas');
    let frame;
    const renderer = createHaloRenderer(canvas, { phaseOffset: 0, requestAnimationFrame: (callback) => { frame = callback; }, cancelAnimationFrame() {} });
    renderer.start();
    frame(0);
    const before = canvas.toDataURL();
    frame(1000);
    renderer.stop();
    return before === canvas.toDataURL();
  }), 'reduced motion should hold positions');
  assert.deepEqual(errors, []);
  console.log('animation browser: PASS (preset, overrides, remount, reload, reset, 20 moving canvases, desktop/mobile screenshots)');
  console.log(output);
  console.log('Max Canvas/SVG mean alpha error: ' + Math.max(...comparison.map(({ alphaError }) => alphaError)).toFixed(6));
} finally {
  await browser.close();
}
