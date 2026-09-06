import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { DEFAULT_APP_SETTINGS } from '../src/app.js';
import { curveFamilies, curveProfiles, formatFormula, getCurveAnimationSettings, getCurveFamily, getCurveParameterSettings } from '../src/curves.js';
import { getCurveLabel, getText } from '../src/i18n.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.env.HALO_TEST_URL ?? 'http://127.0.0.1:1430';
const output = resolve(process.env.HALO_QA_DIR ?? '.comet/runtime/picker-qa');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.HALO_BROWSER_CHANNEL ?? 'chrome' });
const errors = [];
const screenshots = [];
const initial = { ...DEFAULT_APP_SETTINGS, enabled: false, opacity: 0.65, particle_count: 91, duration_ms: 4637 };

// The browser owns this isolated IPC substitute; no installed Halo settings are changed.
async function createPage({ holdInitial = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1130, height: 890 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ defaults, holdInitial }) => {
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
        if (command === 'get_settings') {
          if (holdInitial) await new Promise((accept) => { state.releaseInitial = accept; });
          return read();
        }
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
  }, { defaults: initial, holdInitial });
  await page.goto(url + '/settings.html');
  await page.locator('#curve-picker-open').waitFor({ timeout: 5000 });
  if (!holdInitial) await page.waitForFunction(() => document.querySelector('#duration-ms-value').textContent === '4.637 s');
  return page;
}

const item = (page, id) => getCurveFamily(id).profileIds.length === 1
  ? familyItem(page, getCurveFamily(id).id)
  : page.locator(`#curve-picker-grid button[data-curve-id="${id}"]`);
const familyItem = (page, id) => page.locator(`#curve-picker-families button[data-family-id="${id}"]`);
const browse = (page, id) => getCurveFamily(id).profileIds.length > 1
  ? familyItem(page, getCurveFamily(id).id).click()
  : Promise.resolve();
const visibleItems = (page) => page.locator('#curve-picker-grid button[data-curve-id]:visible');
const saveCount = (page) => page.evaluate(() => window.__pickerTest.saves.length);
const persisted = (page) => page.evaluate(() => window.__pickerTest.read());
const waitClosed = (page) => page.waitForFunction(() => !document.querySelector('#curve-picker-dialog')?.open);
const open = async (page) => {
  await page.click('#curve-picker-open');
  await page.locator('#curve-picker-dialog[open]').waitFor();
};
const waitNoFrames = (page) => page.waitForFunction(() => window.__pickerTest.activeFrames() === 0);

try {
  const directPage = await createPage();
  await open(directPage);
  await directPage.evaluate(() => { window.__pickerTest.hold = true; });
  await familyItem(directPage, 'heart-wave').press('Enter');
  await directPage.waitForFunction(() => window.__pickerTest.saves.length === 1, undefined, { timeout: 2000 });
  await directPage.keyboard.press('Enter');
  assert.equal(await saveCount(directPage), 1, 'pending direct application must not submit twice');
  await directPage.evaluate(() => { window.__pickerTest.hold = false; window.__pickerTest.release(); });
  await waitClosed(directPage);
  assert.equal((await persisted(directPage)).curve_id, 'heart-wave', 'single-preset cards apply in one activation');
  await open(directPage);
  assert.equal(await visibleItems(directPage).count(), 0, 'single presets must not have a duplicate variant entry');
  assert.equal(await directPage.locator('#curve-picker-variants-heading').isVisible(), false);
  assert.equal(await directPage.evaluate(() => document.activeElement.dataset.familyId), 'heart-wave');
  const directScreenshot = resolve(output, 'singleton-en-1130.png');
  await directPage.screenshot({ path: directScreenshot });
  screenshots.push(directScreenshot);
  await directPage.keyboard.press('Tab');
  assert.equal(await directPage.evaluate(() => document.activeElement.id), 'curve-picker-close');
  await directPage.keyboard.press('Shift+Tab');
  assert.equal(await directPage.evaluate(() => document.activeElement.dataset.familyId), 'heart-wave');
  await directPage.keyboard.press('Space');
  await waitClosed(directPage);
  assert.equal(await saveCount(directPage), 1, 'current single preset must not save or reset');
  await open(directPage);
  await directPage.evaluate(() => { window.__pickerTest.failures = 1; });
  await familyItem(directPage, 'spiral-search').click();
  await directPage.locator('#curve-picker-retry').waitFor({ state: 'visible' });
  const directFailed = await directPage.evaluate(() => window.__pickerTest.saves.at(-1));
  await directPage.click('#curve-picker-retry');
  await waitClosed(directPage);
  assert.deepEqual(await directPage.evaluate(() => window.__pickerTest.saves.at(-1)), directFailed, 'direct retry must keep submitted settings');
  await directPage.close();
  const page = await createPage();
  assert.equal(await page.locator('#curve-id').isVisible(), false);
  assert.equal(await page.locator('#display-section #curve-parameters').count(), 1);
  assert.equal(await page.locator('#display-section #reset-curve-parameters').count(), 1);
  assert.equal(await page.locator('#display-section #formula').count(), 1);
  assert.equal(await page.locator('#animation-section #curve-parameters, #animation-section #formula, #display-section #opacity').count(), 0);
  assert.equal(await page.locator('#animation-section #opacity').count(), 1);
  const background = await page.locator('#animation-section').boundingBox();
  await open(page);
  assert.equal(await page.locator('#curve-picker-dialog select').count(), 0, 'family chooser must not regress to a dropdown');
  assert.deepEqual(await page.locator('#curve-picker-families button').evaluateAll((buttons) => buttons.map((button) => button.dataset.familyId)), curveFamilies.map(({ id }) => id));
  const familyPixels = await page.locator('#curve-picker-families canvas').evaluateAll((canvases) => canvases.map((canvas) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return data.some((value, index) => index % 4 === 3 && value > 0);
  }));
  assert.equal(familyPixels.length, 10);
  assert(familyPixels.every(Boolean), 'every family needs its actual representative outline');
  assert.deepEqual(await visibleItems(page).evaluateAll((buttons) => buttons.map((button) => button.dataset.curveId)), getCurveFamily(initial.curve_id).profileIds);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.curveId), initial.curve_id);
  assert.equal(await item(page, initial.curve_id).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#curve-picker-grid [aria-pressed="true"]').count(), 1);
  assert.deepEqual(await page.locator('#animation-section').boundingBox(), background);
  await familyItem(page, 'thinking').focus();
  await waitNoFrames(page);
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.familyId), 'rose-orbit');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.familyId), 'butterfly');
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.familyId), 'spiral-search');
  assert.equal(await familyItem(page, 'thinking').getAttribute('aria-pressed'), 'true', 'focus alone must not switch the browsing family');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.familyId), 'cardioid');
  await page.keyboard.press('Space');
  assert.equal(await familyItem(page, 'cardioid').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.familyId), 'thinking');
  await page.keyboard.press('Enter');
  assert.equal(await familyItem(page, 'thinking').getAttribute('aria-pressed'), 'true');
  assert.equal(await saveCount(page), 0, 'multi-preset family activation must only browse');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.curveId), initial.curve_id);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.familyId), 'thinking');
  assert.equal(await page.locator('#curve-picker-families button[tabindex="0"]').count(), 1);
  const pixels = [];
  for (const family of curveFamilies) {
    if (family.profileIds.length === 1) {
      assert.equal(await familyItem(page, family.id).locator('.curve-picker-family-count').textContent(), getText('en', 'settings.useCurveDirect'));
      const pixel = await familyItem(page, family.id).locator('canvas.curve-picker-family-thumbnail').evaluate((canvas) => {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        return { nonblank: data.some((value, index) => index % 4 === 3 && value > 0), image: canvas.toDataURL() };
      });
      pixels.push({ id: family.profileIds[0], ...pixel });
      continue;
    }
    await familyItem(page, family.id).click();
    assert.equal(await familyItem(page, family.id).getAttribute('aria-pressed'), 'true');
    assert.equal(await familyItem(page, family.id).locator('.curve-picker-family-count').textContent(), getText('en', 'settings.curveVariantCount').replace('{count}', family.profileIds.length));
    assert((await page.locator('#curve-picker-variants-heading').textContent()).includes(getText('en', `settings.curveFamilies.${family.id}`)));
    assert.deepEqual(await visibleItems(page).evaluateAll((buttons) => buttons.map((button) => button.dataset.curveId)), family.profileIds);
    assert.equal(await page.locator('#curve-picker-grid button[hidden][tabindex="0"]').count(), 0);
    assert.equal(await page.locator('#curve-picker-grid button[aria-pressed="true"]:visible').count(), family.profileIds.includes(initial.curve_id) ? 1 : 0);
    pixels.push(...await visibleItems(page).evaluateAll((buttons) => buttons.map((button) => {
      const canvas = button.querySelector('canvas');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return { id: button.dataset.curveId, nonblank: data.some((value, index) => index % 4 === 3 && value > 0), image: canvas.toDataURL() };
    })));
  }
  assert(pixels.every(({ nonblank }) => nonblank), 'all 20 real thumbnails must render with the overlay disabled');
  assert.equal(new Set(pixels.map(({ image }) => image)).size, 20, 'thumbnails must show distinct profiles');
  await browse(page, initial.curve_id);
  await item(page, 'original-thinking').press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.curveId), 'thinking-five');
  await item(page, 'thinking-five').press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.curveId), 'thinking-nine');
  await item(page, 'thinking-nine').press('End');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.curveId), 'thinking-nine');
  await item(page, 'thinking-nine').press('Home');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.curveId), 'original-thinking');
  for (let step = 0; step < 25; step += 1) {
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.querySelector('#curve-picker-dialog').contains(document.activeElement)), 'Tab must remain inside the modal');
  }
  for (let step = 0; step < 4; step += 1) {
    await page.keyboard.press('Shift+Tab');
    assert(await page.evaluate(() => document.querySelector('#curve-picker-dialog').contains(document.activeElement)), 'Shift+Tab must remain inside the modal');
  }
  await browse(page, 'heart-wave');
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
  await browse(page, 'rose-two');
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
  assert.equal(await familyItem(page, 'thinking').getAttribute('aria-pressed'), 'true', 'reopen must discard the last browsed family');
  await page.mouse.click(4, 4);
  await waitClosed(page);
  assert.equal(await saveCount(page), 0, 'backdrop dismissal must not save');
  await open(page);
  await item(page, initial.curve_id).press('Enter');
  await waitClosed(page);
  assert.equal(await saveCount(page), 0, 'same selection must preserve customized values without saving');
  assert.deepEqual(await persisted(page), initial);

  await open(page);
  await browse(page, 'heart-wave');
  await item(page, 'heart-wave').press('Space');
  await waitClosed(page);
  assert.equal(await saveCount(page), 1);
  assert.deepEqual(await persisted(page), { ...initial, curve_id: 'heart-wave', curve_parameters: getCurveParameterSettings('heart-wave'), ...getCurveAnimationSettings('heart-wave') });
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
  await browse(page, 'rose-orbit');
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
  await browse(page, 'rose-four');
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
      await browse(page, 'hypotrochoid-loop');
      assert.equal(await familyItem(page, 'hypotrochoid').locator('.curve-picker-family-name').textContent(), getText(language, 'settings.curveFamilies.hypotrochoid'));
      const geometry = await page.evaluate(() => {
        const dialog = document.querySelector('#curve-picker-dialog');
        const cards = [...document.querySelectorAll('#curve-picker-grid button[data-curve-id]')].filter((card) => !card.hidden);
        const families = [...document.querySelectorAll('#curve-picker-families button')];
        const familyRows = new Set(families.map((card) => Math.round(card.getBoundingClientRect().top)));
        const familyColumns = new Set(families.map((card) => Math.round(card.getBoundingClientRect().left)));
        const rows = new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top)));
        const columns = new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left)));
        return { familyColumns: familyColumns.size, familyRows: familyRows.size, columns: columns.size, rows: rows.size, overflow: document.documentElement.scrollWidth > innerWidth || dialog.scrollWidth > dialog.clientWidth, fits: [...cards, ...families].every((card) => card.scrollWidth <= card.clientWidth && card.scrollHeight <= card.clientHeight) };
      });
      assert(!geometry.overflow && geometry.fits, JSON.stringify({ language, width, geometry }));
      if (width === 1130) {
        assert.deepEqual([geometry.columns, geometry.rows], [5, 1]);
        assert.deepEqual([geometry.familyColumns, geometry.familyRows], [5, 2]);
      } else assert(geometry.columns < 5 && geometry.familyColumns < 5);
      await item(page, 'six-petal-spiral').focus();
      await page.keyboard.press('Tab');
      assert(await page.evaluate(() => document.querySelector('#curve-picker-dialog').contains(document.activeElement)));
      await page.mouse.move(0, 0);
      await page.locator('#curve-picker-close').focus();
      await page.locator('#curve-picker-dialog').evaluate((dialog) => { dialog.scrollTop = 0; });
      // Let composited text repaint after resetting the modal scroll.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const path = resolve(output, `picker-${language}-${width}.png`);
      await page.screenshot({ path });
      screenshots.push(path);
      await page.keyboard.press('Escape');
      await waitClosed(page);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await browse(page, 'heart-wave');
  await item(page, 'heart-wave').hover();
  await waitNoFrames(page);
  await page.keyboard.press('Escape');
  await waitClosed(page);
  await page.reload();
  await page.locator('#curve-picker-open').waitFor();
  assert.equal(await page.locator('#curve-id').inputValue(), 'rose-four');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1130, height: 890 });
  await page.selectOption('#language', 'en');
  let parameterCount = 0;
  for (const profile of curveProfiles) {
    await open(page);
    await browse(page, profile.id);
    const priorSaveCount = await saveCount(page);
    await item(page, profile.id).click();
    await waitClosed(page);
    assert.equal(await saveCount(page), priorSaveCount + 1, 'each different preset, including singletons, applies with one activation');
    const controls = await page.locator('[data-curve-parameter]').evaluateAll((fields) => fields.map((field) => ({
      key: field.dataset.curveParameter, min: Number(field.min), max: Number(field.max), step: Number(field.step), value: Number(field.value),
      label: document.querySelector(`label[for="${field.id}"]`).textContent,
      outputFor: document.querySelector(`#${field.id}-value`).getAttribute('for'), id: field.id,
    })));
    assert.deepEqual(controls.map(({ key, min, max, step, value, label }) => ({ key, min, max, step, value, label })),
      profile.controls.map(({ key, min, max, step, defaultValue, labelEn }) => ({ key, min, max, step, value: defaultValue, label: labelEn })), profile.id);
    assert(controls.every((control) => control.outputFor === control.id));
    assert.equal((await persisted(page)).opacity, 0.65, 'preset application must keep opacity');
    const name = await page.locator('#curve-picker-name').textContent();
    assert(name.includes(getText('en', `settings.curveFamilies.${getCurveFamily(profile.id).id}`)) && name.includes(getCurveLabel('en', profile.id)), 'entry must identify family and preset');
    parameterCount += controls.length;
    const first = profile.controls[0];
    const field = page.locator(`#curve-parameter-${first.key}`);
    const thumbnail = await page.locator('#curve-picker-current').evaluate((canvas) => canvas.toDataURL());
    await field.press('End');
    await page.waitForFunction(({ key, value }) => window.__pickerTest.read().curve_parameters?.[key] === value, { key: first.key, value: first.max });
    const custom = await persisted(page);
    assert.equal(await page.locator('#formula').textContent(), formatFormula(profile, custom));
    assert.notEqual(await page.locator('#curve-picker-current').evaluate((canvas) => canvas.toDataURL()), thumbnail);
    const count = await saveCount(page);
    await open(page);
    await item(page, profile.id).press('Enter');
    await waitClosed(page);
    assert.equal(await saveCount(page), count, 'reselecting the current curve must preserve custom geometry');
  }
  assert.equal(parameterCount, 89);

  const geometry = (await persisted(page)).curve_parameters;
  await page.click('#reset-animation');
  await page.waitForFunction(() => document.querySelector('#settings-save-status').dataset.status === 'saved');
  assert.deepEqual((await persisted(page)).curve_parameters, geometry, 'animation reset must keep geometry');
  assert.equal((await persisted(page)).opacity, 0.65, 'animation reset must keep opacity');
  await page.locator('#particle-count').fill('90');
  await page.locator('#particle-count').dispatchEvent('input');
  await page.click('#reset-curve-parameters');
  await page.waitForFunction(() => window.__pickerTest.read().curve_parameters.searchTurns === 4);
  assert.equal((await persisted(page)).particle_count, 90, 'geometry reset must keep animation');
  assert.deepEqual((await persisted(page)).curve_parameters, getCurveParameterSettings('spiral-search'));
  assert.equal((await persisted(page)).opacity, 0.65, 'geometry reset must keep opacity');

  await page.locator('#curve-parameter-searchTurns').fill('5.5');
  await page.waitForFunction(() => window.__pickerTest.read().curve_parameters.searchTurns === 5.5);
  await page.click('#settings-tab-colors');
  await page.click('#settings-tab-display');
  assert.equal(await page.locator('#curve-parameter-searchTurns').inputValue(), '5.5');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#curve-parameter-searchTurns')?.value === '5.5');
  await page.evaluate(() => { window.__pickerTest.failures = 1; });
  await page.locator('#curve-parameter-searchTurns').fill('6.5');
  await page.waitForFunction(() => document.querySelector('#settings-save-status').dataset.status === 'error');
  await page.click('#settings-tab-colors');
  await page.click('#settings-tab-display');
  assert.equal(await page.locator('#curve-parameter-searchTurns').inputValue(), '6.5');
  await open(page);
  await page.locator('#curve-picker-retry').waitFor({ state: 'visible' });
  await page.click('#curve-picker-retry');
  await waitClosed(page);
  await page.waitForFunction(() => window.__pickerTest.read().curve_parameters.searchTurns === 6.5);

  await page.evaluate(() => { window.__pickerTest.hold = true; });
  await page.locator('#curve-parameter-searchTurns').fill('7');
  await page.waitForFunction(() => typeof window.__pickerTest.release === 'function');
  await page.locator('#curve-parameter-searchTurns').fill('7.5');
  await page.click('#settings-tab-colors');
  await page.evaluate(() => {
    window.__pickerTest.external({ curve_parameters: { searchTurns: 2 } });
    window.__pickerTest.hold = false;
    window.__pickerTest.release();
  });
  await page.waitForFunction(() => window.__pickerTest.read().curve_parameters.searchTurns === 7.5);
  await page.click('#settings-tab-display');
  assert.equal(await page.locator('#curve-parameter-searchTurns').inputValue(), '7.5', 'queued events must not erase a blurred local edit');

  await open(page);
  await browse(page, 'rose-curve');
  await item(page, 'rose-curve').click();
  await waitClosed(page);
  for (const language of ['en', 'zh-CN']) {
    await page.selectOption('#language', language);
    for (const [width, height] of [[1130, 890], [390, 844]]) {
      await page.setViewportSize({ width, height });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'parameter page horizontal overflow');
      const fieldsFit = await page.locator('#curve-parameters .field-label-row').evaluateAll((rows) => rows.every((row) => {
        const label = row.querySelector('label').getBoundingClientRect();
        const output = row.querySelector('output').getBoundingClientRect();
        return label.right <= output.left && row.scrollWidth <= row.clientWidth;
      }));
      assert(fieldsFit, 'parameter labels must not overlap their values');
      const path = resolve(output, `parameters-${language}-${width}.png`);
      await page.screenshot({ path, fullPage: true });
      screenshots.push(path);
    }
  }

  const loadingPage = await createPage({ holdInitial: true });
  await loadingPage.locator('#curve-parameter-baseRadius').fill('8');
  await loadingPage.click('#settings-tab-colors');
  await loadingPage.evaluate(() => { window.__pickerTest.failures = 1; window.__pickerTest.releaseInitial(); });
  await loadingPage.waitForFunction(() => document.querySelector('#settings-save-status').dataset.status === 'error');
  await loadingPage.evaluate(() => window.__pickerTest.external({ curve_id: 'original-thinking', curve_parameters: { baseRadius: 7 }, opacity: 0.67 }));
  await loadingPage.click('#settings-tab-display');
  await loadingPage.waitForFunction(() => document.querySelector('#opacity').value === '0.67');
  assert.equal(await loadingPage.locator('#curve-parameter-baseRadius').inputValue(), '8', 'initial save failure must preserve a local geometry edit through external events');
  await open(loadingPage);
  await loadingPage.click('#curve-picker-retry');
  await waitClosed(loadingPage);
  await loadingPage.waitForFunction(() => window.__pickerTest.read().curve_parameters?.baseRadius === 8);
  await loadingPage.locator('#curve-parameter-detailAmplitude').fill('4');
  await loadingPage.locator('#curve-parameter-petalCount').fill('6');
  await loadingPage.waitForFunction(() => window.__pickerTest.read().curve_parameters.petalCount === 6);
  await loadingPage.evaluate(() => window.__pickerTest.external({ curve_parameters: { baseRadius: 9 } }));
  await loadingPage.waitForFunction(() => document.querySelector('#curve-parameter-baseRadius').value === '9');
  assert.equal(await loadingPage.locator('#curve-parameter-detailAmplitude').inputValue(), '4', 'partial geometry events must retain other custom keys');
  assert.equal(await loadingPage.locator('#curve-parameter-petalCount').inputValue(), '6');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ result: 'passed', parameterCount, catalog: pixels.map(({ id, nonblank }) => ({ id, nonblank })), screenshots, errors, nativeIPC: 'NOT RUN; isolated browser substitute' }, null, 2) + '\n');
  console.log('curve picker browser: PASS (10 visual families, 6 direct singletons, 20 presets, 89 controls, keyboard, preview, direct retry/pending, no multi-family browse saves, reset/opacity, load races, en/zh-CN desktop/mobile)');
  console.log(output);
} finally {
  await browser.close();
}
