import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { DEFAULT_APP_SETTINGS } from '../src/app.js';
import { curveProfiles, getCurveAnimationSettings } from '../src/curves.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.env.HALO_TEST_URL ?? 'http://127.0.0.1:1430';
const output = resolve(process.env.HALO_QA_DIR ?? '.comet/runtime/picker-qa');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.HALO_BROWSER_CHANNEL ?? 'chrome' });
const errors = [];
const screenshots = [];
const initial = { ...DEFAULT_APP_SETTINGS, enabled: false, opacity: 0.73, particle_count: 91, duration_ms: 4637 };

// The browser owns this isolated IPC substitute; no installed Halo settings are changed.
async function createPage() {
  const page = await browser.newPage({ viewport: { width: 1130, height: 890 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((defaults) => {
    const listeners = new Map();
    const frames = new Set();
    const visibilityListeners = new Set();
    const addListener = document.addEventListener.bind(document);
    const removeListener = document.removeEventListener.bind(document);
    document.addEventListener = (name, handler, options) => {
      if (name === 'visibilitychange') visibilityListeners.add(handler);
      addListener(name, handler, options);
    };
    document.removeEventListener = (name, handler, options) => {
      if (name === 'visibilitychange') visibilityListeners.delete(handler);
      removeListener(name, handler, options);
    };
    const requestFrame = window.requestAnimationFrame.bind(window);
    const cancelFrame = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      const id = requestFrame((time) => { frames.delete(id); callback(time); });
      frames.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => { frames.delete(id); cancelFrame(id); };
    const read = () => JSON.parse(localStorage.getItem('picker-test-settings') ?? JSON.stringify(defaults));
    const emit = (payload) => {
      for (const handler of listeners.get('settings-changed') ?? []) handler({ payload });
    };
    const state = window.__pickerTest = {
      saves: [], failures: 0, hold: false, release: null,
      activeFrames: () => frames.size,
      visibilityListeners: () => visibilityListeners.size,
      read,
      external(payload) {
        localStorage.setItem('picker-test-settings', JSON.stringify({ ...read(), ...payload }));
        emit(payload);
      },
    };
    window.__TAURI__ = {
      core: { invoke: async (command, args) => {
        if (command === 'get_settings') return read();
        if (command === 'get_display_state') return { state: 'idle', updated_at_ms: 0 };
        if (command !== 'save_settings') return null;
        const snapshot = structuredClone(args.settings);
        state.saves.push(snapshot);
        if (state.hold) await new Promise((accept) => { state.release = accept; });
        if (state.failures > 0) { state.failures -= 1; throw new Error('Injected picker save failure'); }
        localStorage.setItem('picker-test-settings', JSON.stringify(snapshot));
        emit(snapshot);
        return snapshot;
      } },
      event: { listen: async (name, handler) => {
        const handlers = listeners.get(name) ?? new Set();
        handlers.add(handler);
        listeners.set(name, handlers);
        return () => handlers.delete(handler);
      } },
    };
  }, initial);
  await page.goto(url + '/settings.html');
  await page.locator('#curve-picker-open').waitFor({ timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('#duration-ms-value').textContent === '4.637 s');
  return page;
}

const item = (page, id) => page.locator(`#curve-picker-grid button[data-curve-id="${id}"]`);
const saveCount = (page) => page.evaluate(() => window.__pickerTest.saves.length);
const persisted = (page) => page.evaluate(() => window.__pickerTest.read());
const waitClosed = (page) => page.waitForFunction(() => !document.querySelector('#curve-picker-dialog')?.open);
const open = async (page) => {
  await page.click('#curve-picker-open');
  await page.locator('#curve-picker-dialog[open]').waitFor();
};
const waitNoFrames = (page) => page.waitForFunction(() => window.__pickerTest.activeFrames() === 0);

try {
  const page = await createPage();
  assert.equal(await page.locator('#curve-id').isVisible(), false);
  const background = await page.locator('#animation-section').boundingBox();
  await open(page);
  assert.deepEqual(await page.locator('#curve-picker-grid button[data-curve-id]').evaluateAll((buttons) => buttons.map((button) => button.dataset.curveId)), curveProfiles.map(({ id }) => id));
  assert.equal(await page.evaluate(() => document.activeElement.dataset.curveId), initial.curve_id);
  assert.equal(await item(page, initial.curve_id).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#curve-picker-grid [aria-pressed="true"]').count(), 1);
  assert.deepEqual(await page.locator('#animation-section').boundingBox(), background);
  const pixels = await page.locator('#curve-picker-grid button[data-curve-id]').evaluateAll((buttons) => buttons.map((button) => {
    const canvas = button.querySelector('canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return { id: button.dataset.curveId, nonblank: data.some((value, index) => index % 4 === 3 && value > 0), image: canvas.toDataURL() };
  }));
  assert(pixels.every(({ nonblank }) => nonblank), 'all 20 real thumbnails must render with the overlay disabled');
  assert.equal(new Set(pixels.map(({ image }) => image)).size, 20, 'thumbnails must show distinct profiles');
  await item(page, 'original-thinking').press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.curveId), 'thinking-five');
  await item(page, 'thinking-five').press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.curveId), 'rose-three');
  await item(page, 'rose-three').press('End');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.curveId), 'spiral-search');
  await item(page, 'spiral-search').press('Home');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.curveId), 'original-thinking');
  for (let step = 0; step < 25; step += 1) {
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.querySelector('#curve-picker-dialog').contains(document.activeElement)), 'Tab must remain inside the modal');
  }
  for (let step = 0; step < 4; step += 1) {
    await page.keyboard.press('Shift+Tab');
    assert(await page.evaluate(() => document.querySelector('#curve-picker-dialog').contains(document.activeElement)), 'Shift+Tab must remain inside the modal');
  }
  await item(page, 'heart-wave').hover();
  await page.waitForFunction(() => window.__pickerTest.activeFrames() === 1);
  const before = await page.locator('#curve-picker-preview').evaluate((canvas) => canvas.toDataURL());
  await page.waitForFunction((image) => document.querySelector('#curve-picker-preview').toDataURL() !== image, before);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitNoFrames(page);
  assert.equal(await page.evaluate(() => window.__pickerTest.visibilityListeners()), 0, 'hiding the page must release temporary listeners');
  await page.evaluate(() => { delete document.hidden; });
  await item(page, 'rose-two').hover();
  await page.waitForFunction(() => window.__pickerTest.activeFrames() === 1);
  assert.equal(await page.evaluate(() => window.__pickerTest.visibilityListeners()), 1, 'interacting after visibility resumes must restore preview cleanup');
  assert.equal(await saveCount(page), 0, 'focus and hover must not save');
  assert.deepEqual(await persisted(page), initial);
  await page.keyboard.press('Escape');
  await waitClosed(page);
  await waitNoFrames(page);
  assert.equal(await page.evaluate(() => window.__pickerTest.visibilityListeners()), 0);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'curve-picker-open');
  await open(page);
  await page.mouse.click(4, 4);
  await waitClosed(page);
  assert.equal(await saveCount(page), 0, 'backdrop dismissal must not save');
  await open(page);
  await item(page, initial.curve_id).press('Enter');
  await waitClosed(page);
  assert.equal(await saveCount(page), 0, 'same selection must preserve customized values without saving');
  assert.deepEqual(await persisted(page), initial);

  await open(page);
  await item(page, 'heart-wave').press('Space');
  await waitClosed(page);
  assert.equal(await saveCount(page), 1);
  assert.deepEqual(await persisted(page), { ...initial, curve_id: 'heart-wave', ...getCurveAnimationSettings('heart-wave') });
  await page.click('#settings-tab-colors');
  assert.equal(await page.locator('#curve-picker-open').count(), 0);
  await page.click('#settings-tab-display');
  assert.equal(await page.locator('#curve-id').inputValue(), 'heart-wave');
  await open(page);
  await page.evaluate(() => window.__pickerTest.external({ curve_id: 'rose-two', ...{ duration_ms: 4321, idle_color: '#234567' } }));
  await page.waitForFunction(() => document.querySelector('#curve-id').value === 'rose-two');
  assert.equal(await item(page, 'rose-two').getAttribute('aria-pressed'), 'true');
  assert.equal(await saveCount(page), 1, 'external settings are not a new local save');
  await page.click('#curve-picker-close');
  await waitClosed(page);
  await waitNoFrames(page);

  await open(page);
  await page.evaluate(() => { window.__pickerTest.failures = 1; });
  await item(page, 'rose-three').click();
  await page.locator('#curve-picker-retry').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#settings-save-status').getAttribute('data-status'), 'error');
  assert.equal(await page.locator('#curve-picker-dialog').evaluate((dialog) => dialog.open), true);
  const failed = await page.evaluate(() => window.__pickerTest.saves.at(-1));
  await page.click('#curve-picker-retry');
  await waitClosed(page);
  assert.deepEqual(await page.evaluate(() => window.__pickerTest.saves.at(-1)), failed, 'retry must keep the submitted values');
  assert.equal((await persisted(page)).idle_color, '#234567');

  await open(page);
  await page.evaluate(() => { window.__pickerTest.failures = 1; });
  await item(page, 'rose-orbit').click();
  await page.locator('#curve-picker-retry').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await waitClosed(page);
  await page.locator('#particle-count').fill('93');
  await page.locator('#particle-count').dispatchEvent('input');
  await page.waitForFunction(() => document.querySelector('#settings-save-status').dataset.status === 'saved');
  await open(page);
  assert.equal(await page.locator('#curve-picker-retry').isVisible(), false, 'a later successful settings save must clear the picker error');
  await page.keyboard.press('Escape');
  await waitClosed(page);

  // A completed save from an earlier modal session must not close a freshly opened one.
  await open(page);
  await page.evaluate(() => { window.__pickerTest.hold = true; });
  await item(page, 'rose-four').click();
  await page.waitForFunction(() => typeof window.__pickerTest.release === 'function');
  const pendingCount = await saveCount(page);
  await page.keyboard.press('Enter');
  assert.equal(await saveCount(page), pendingCount, 'pending application must not submit twice');
  await page.keyboard.press('Escape');
  await waitClosed(page);
  await open(page);
  await page.evaluate(() => { window.__pickerTest.hold = false; window.__pickerTest.release(); });
  await page.waitForFunction(() => document.querySelector('#settings-save-status').dataset.status === 'saved');
  assert.equal(await page.locator('#curve-picker-dialog').evaluate((dialog) => dialog.open), true);
  await page.click('#curve-picker-close');
  await waitClosed(page);
  await waitNoFrames(page);

  for (const language of ['en', 'zh-CN']) {
    await page.selectOption('#language', language);
    for (const [width, height] of [[1130, 890], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await open(page);
      const geometry = await page.evaluate(() => {
        const dialog = document.querySelector('#curve-picker-dialog');
        const cards = [...document.querySelectorAll('#curve-picker-grid button[data-curve-id]')];
        const rows = new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top)));
        const columns = new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left)));
        return { columns: columns.size, rows: rows.size, overflow: document.documentElement.scrollWidth > innerWidth || dialog.scrollWidth > dialog.clientWidth, fits: cards.every((card) => card.scrollWidth <= card.clientWidth && card.scrollHeight <= card.clientHeight) };
      });
      assert(!geometry.overflow && geometry.fits, JSON.stringify({ language, width, geometry }));
      if (width === 1130) assert.deepEqual([geometry.columns, geometry.rows], [5, 4]);
      else assert(geometry.columns < 5);
      await item(page, 'spiral-search').focus();
      await page.keyboard.press('Tab');
      assert(await page.evaluate(() => document.querySelector('#curve-picker-dialog').contains(document.activeElement)));
      await page.mouse.move(0, 0);
      await page.locator('#curve-picker-close').focus();
      await page.locator('#curve-picker-dialog').evaluate((dialog) => { dialog.scrollTop = 0; });
      const path = resolve(output, `picker-${language}-${width}.png`);
      await page.screenshot({ path });
      screenshots.push(path);
      await page.keyboard.press('Escape');
      await waitClosed(page);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await item(page, 'heart-wave').hover();
  await waitNoFrames(page);
  await page.keyboard.press('Escape');
  await waitClosed(page);
  await page.reload();
  await page.locator('#curve-picker-open').waitFor();
  assert.equal(await page.locator('#curve-id').inputValue(), 'rose-four');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ result: 'passed', catalog: pixels.map(({ id, nonblank }) => ({ id, nonblank })), screenshots, errors, nativeIPC: 'NOT RUN; isolated browser substitute' }, null, 2) + '\n');
  console.log('curve picker browser: PASS (20 thumbnails, local motion, keyboard, saves, retry, reopen race, sync, remount, reduced motion, en/zh-CN desktop/mobile)');
  console.log(output);
} finally {
  await browser.close();
}
