import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { DEFAULT_APP_SETTINGS } from '../src/app.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = resolve('src');
const output = resolve(process.env.HALO_QA_DIR ?? '.comet/runtime/audio-qa');
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
  if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  try {
    const contents = await readFile(path);
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(path)] ?? 'application/octet-stream');
    response.end(contents);
  } catch { response.writeHead(404).end(); }
});
await new Promise(accept => server.listen(0, '127.0.0.1', accept));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: process.env.HALO_BROWSER_CHANNEL ?? 'chrome' });
const errors = [];
const screenshots = [];

try {
  const page = await browser.newPage({ viewport: { width: 1130, height: 890 } });
  page.on('pageerror', error => errors.push(error.message));
  // This isolated IPC substitute exercises real UI, not installed app settings or native capture.
  await page.addInitScript(defaults => {
    const listeners = new Map();
    let settings = { ...defaults };
    let sequence = 0;
    let state = { generation: 1, sequence: 0, timestamp_ms: Date.now(), status: 'disabled', reason: null,
      level: 0, low: 0, mid: 0, high: 0 };
    const emit = (name, payload) => { for (const handler of listeners.get(name) ?? []) handler({ payload }); };
    window.__audioTest = {
      saves: [], retries: 0,
      frame(values) {
        state = { ...state, ...values, timestamp_ms: Date.now(), sequence: ++sequence };
        emit('audio-state', state);
      },
      settings: () => settings,
      subscriptions: () => listeners.get('audio-state')?.size ?? 0,
    };
    window.__TAURI__ = {
      core: { invoke: async (command, args) => {
        if (command === 'get_settings') return settings;
        if (command === 'get_audio_state') return state;
        if (command === 'save_settings') {
          settings = structuredClone(args.settings);
          window.__audioTest.saves.push(settings);
          emit('settings-changed', settings);
          window.__audioTest.frame({ status: settings.audio_enabled ? 'capturing' : 'disabled', reason: null, level: 0 });
          return settings;
        }
        if (command === 'retry_audio_capture') {
          window.__audioTest.retries++;
          window.__audioTest.frame({ status: 'capturing', reason: null });
          return state;
        }
        if (command === 'get_display_state') return { sessions: [], state: 'idle' };
        return null;
      } },
      event: { listen: async (name, handler) => {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(handler);
        return () => listeners.get(name).delete(handler);
      } },
    };
  }, DEFAULT_APP_SETTINGS);
  await page.goto(url + '/settings.html');
  await page.locator('#audio-enabled').waitFor();
  assert.equal(await page.locator('#audio-enabled').isChecked(), false);
  assert.equal(await page.locator('#audio-intensity').isDisabled(), true);
  await page.locator('#audio-enabled').check();
  await page.waitForFunction(() => !document.querySelector('#audio-intensity').disabled);
  await page.evaluate(() => { window.__audioInterval = setInterval(() => window.__audioTest.frame({ status: 'capturing', level: 0.62, low: 0.7, mid: 0.4, high: 0.3 }), 80); });
  await page.locator('#audio-intensity').fill('73');
  await page.locator('#audio-intensity').dispatchEvent('input');
  await page.waitForFunction(() => window.__audioTest.settings().audio_intensity === 0.73);
  await page.locator('#audio-intensity').press('ArrowRight');
  await page.waitForFunction(() => window.__audioTest.settings().audio_intensity === 0.74);
  await page.click('#settings-tab-colors');
  assert.equal(await page.locator('#audio-enabled').count(), 0);
  await page.click('#settings-tab-display');
  assert.equal(await page.locator('#audio-intensity').inputValue(), '74');
  assert.equal(await page.evaluate(() => window.__audioTest.subscriptions()), 1);
  await page.click('#reset-animation');
  await page.click('#reset-curve-parameters');
  assert.equal(await page.evaluate(() => window.__audioTest.settings().audio_intensity), 0.74);

  for (const language of ['en', 'zh-CN']) {
    await page.selectOption('#language', language);
    for (const width of [1130, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 890 });
      await page.locator('#audio-enabled').scrollIntoViewIfNeeded();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow: ${language}/${width}`);
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForFunction(() => scrollY === 0 && document.querySelector('#audio-level').value > 0);
      const path = resolve(output, `settings-${language}-${width}.png`);
      await page.screenshot({ path, fullPage: true });
      screenshots.push(path);
    }
  }
  await page.locator('#audio-intensity').fill('0');
  await page.locator('#audio-intensity').dispatchEvent('input');
  await page.waitForFunction(() => window.__audioTest.settings().audio_intensity === 0);
  await page.waitForFunction(() => document.querySelector('#audio-level').value > 0);
  await page.evaluate(() => clearInterval(window.__audioInterval));
  await page.waitForFunction(() => document.querySelector('#audio-level').value === 0);
  await page.evaluate(() => window.__audioTest.frame({ status: 'permission_denied', reason: 'permission', level: 0 }));
  assert.equal(await page.locator('#audio-help').isVisible(), true);
  assert.equal(await page.locator('#audio-enabled').isDisabled(), false);
  await page.click('#audio-retry');
  assert.equal(await page.evaluate(() => window.__audioTest.retries), 1);
  await page.evaluate(() => window.__audioTest.frame({ status: 'paused', reason: 'hidden' }));
  assert.match(await page.locator('#audio-help').innerText(), /隐藏/);
  await page.evaluate(() => window.__audioTest.frame({ status: 'paused', reason: 'reduced_motion' }));
  assert.match(await page.locator('#audio-help').innerText(), /减少动态效果/);
  assert.equal(await page.locator('#audio-intensity').isDisabled(), true);
  await page.locator('#audio-enabled').uncheck();
  await page.waitForFunction(() => !window.__audioTest.settings().audio_enabled);

  const gallery = await browser.newPage({ viewport: { width: 1100, height: 1120 } });
  gallery.on('pageerror', error => errors.push(error.message));
  await gallery.goto(url + '/settings.html');
  await gallery.evaluate(async () => {
    const { curveProfiles } = await import('/curves.js');
    const { createHaloRenderer } = await import('/halo.js');
    document.body.replaceChildren();
    document.body.style.cssText = 'padding:24px;display:grid;grid-template-columns:repeat(5,1fr);gap:20px;background:#0e1116;color:#eef1f5';
    const heading = document.createElement('p');
    heading.textContent = 'Audio response · synthetic test signals / 合成频段信号验证';
    heading.style.gridColumn = '1 / -1';
    document.body.append(heading);
    for (const profile of curveProfiles) {
      const cell = document.createElement('div');
      const label = document.createElement('p'); label.textContent = profile.id;
      const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:180px;height:180px';
      cell.append(canvas, label); document.body.append(cell);
      let tick;
      const renderer = createHaloRenderer(canvas, { curve: profile.id, settings: { audio_enabled: true, audio_intensity: 1 },
        phaseOffset: 0.13, requestAnimationFrame(fn) { tick = fn; return 1; }, cancelAnimationFrame() {} });
      renderer.setSessions([{ session_key: profile.id, state: 'thinking', updated_at_ms: Date.now() }]);
      renderer.start();
      for (let time = 0; time <= 600; time += 20) {
        renderer.setAudioFrame({ generation: 1, sequence: time + 1, timestamp_ms: Date.now(), status: 'capturing', reason: null, level: 0.9, low: 1, mid: 0.6, high: 0.8 });
        tick(time);
      }
      renderer.stop();
    }
  });
  const galleryPath = resolve(output, 'curves-full-strength.png');
  await gallery.screenshot({ path: galleryPath, fullPage: true });
  screenshots.push(galleryPath);
  assert.deepEqual(errors, []);
  const report = { result: 'passed', scope: 'Real browser UI and renderer with isolated IPC/synthetic audio; not native capture', screenshots };
  await writeFile(resolve(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise(accept => server.close(accept));
}
