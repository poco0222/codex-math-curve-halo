import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../src/settings.html', import.meta.url), 'utf8');
const settings = await readFile(new URL('../src/settings.js', import.meta.url), 'utf8');
const colors = await readFile(new URL('../src/colors.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const i18n = await readFile(new URL('../src/i18n.js', import.meta.url), 'utf8');

function readObjectLiteral(source, declaration) {
  const declarationStart = source.indexOf(`const ${declaration} =`);
  assert.notEqual(declarationStart, -1, `${declaration} declaration is required`);
  const objectStart = source.indexOf('{', declarationStart);
  assert.notEqual(objectStart, -1, `${declaration} object is required`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = objectStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(objectStart, index + 1);
    }
  }
  assert.fail(`${declaration} object is incomplete`);
}

assert.match(html, /id="settings-panel-host"/);
for (const view of ['appearance', 'colors', 'integration', 'test']) {
  assert.match(html, new RegExp(`data-view-target="${view}"`));
  assert.match(html, new RegExp(`data-view-template="${view}"`));
}
assert.match(html, /id="particle-count"/);
assert.match(html, /id="color-state-list"/);
assert.match(html, /id="display-section"[^>]*>[\s\S]*?<\/fieldset>\s*<fieldset id="animation-section"/);
assert.doesNotMatch(html, /data-section-target=/);
assert.match(html, /data-section-nav[^>]*role="tablist"/);
assert.match(html, /id="color-state-tabs"[^>]*role="tablist"/);
assert.match(html, /id="color-state-panel"[^>]*role="tabpanel"(?![^>]*tabindex)/);
assert.match(html, /settings-tab-display[^>]*aria-selected="true"[^>]*tabindex="0"/);
assert.equal((html.match(/role="tab"/g) ?? []).length, 4);
assert.equal((html.match(/role="tab"[^>]*tabindex="-1"/g) ?? []).length, 3);
assert.match(html, /id="settings-panel-host"[^>]*role="tabpanel"(?![^>]*tabindex)/);
for (const state of ['idle', 'thinking', 'executing', 'input_needed', 'completed', 'compacting']) {
  assert.match(colors, new RegExp(`${state}: '.*_color'`));
}
assert.equal((colors.match(/id: 'palette-/g) ?? []).length, 10);
assert.equal((colors.match(/#[0-9A-Fa-f]{6}/g) ?? []).length, 76);
assert.match(i18n, /DEFAULT_LANGUAGE = 'en'/);
assert.match(i18n, /SUPPORTED_LANGUAGES = \['en', 'zh-CN'\]/);
const dictionaries = runInNewContext(`(${readObjectLiteral(i18n, 'dictionaries')})`, Object.create(null));
const requiredLanguages = ['en', 'zh-CN'];
assert.deepEqual(Object.keys(dictionaries).sort(), requiredLanguages);
const requiredI18nKeys = [
  'settings.appearance',
  'settings.display',
  'settings.renderer',
  'settings.diagnostics',
  'settings.diagnosticsLoading',
  'settings.diagnosticsState',
  'settings.diagnosticsLastEvent',
  'settings.diagnosticsNever',
  'settings.diagnosticsSetupError',
  ...['idle', 'thinking', 'executing', 'inputNeeded', 'completed', 'compacting'].map((state) => `settings.states.${state}`),
];
const englishKeys = Object.keys(dictionaries.en).sort();
for (const language of requiredLanguages) {
  const dictionary = dictionaries[language];
  assert.deepEqual(Object.keys(dictionary).sort(), englishKeys, `${language} dictionary keys must match en`);
  for (const key of requiredI18nKeys) {
    assert.equal(typeof dictionary[key], 'string', `${language}.${key} must be a string`);
    assert.ok(dictionary[key].trim().length > 0, `${language}.${key} must be non-empty`);
  }
}
assert.match(settings, /const SETTINGS_VIEWS = \{/);
assert.match(settings, /function mountSettingsView\(/);
assert.match(settings, /host\.replaceChildren\(/);
assert.doesNotMatch(settings, /const sectionNames = \[/);
assert.match(settings, /function mountColorState\(/);
assert.match(settings, /const settingsStore = createSettingsStore\(/);
assert.match(settings, /settingsStore\.getSettings\(\)/);
assert.match(settings, /settingsStore\.patchSetting\(/);
assert.match(settings, /settingsStore\.setUi\(/);
assert.match(settings, /settingsStore\.getUiState\(\)\.pluginOperationInFlight/);
assert.doesNotMatch(settings, /\bsettingsModel\b/);
assert.match(settings, /function syncSettingsModelFromControls\(/);
assert.match(settings, /if \(key && isHexColor\(field\.value\)\)/);
assert.match(settings, /event\.key === 'ArrowRight'/);
assert.match(settings, /event\.key === 'ArrowLeft'/);
assert.doesNotMatch(settings, /document\.querySelector\('\[data-color-state-label\]'\)/);
assert.doesNotMatch(settings, /let pluginOperationInFlight = false/);
assert.doesNotMatch(settings, /if \(pluginOperationInFlight\) return;/);
assert.match(settings, /function setPluginButtonsDisabled\(/);
assert.match(settings, /setPluginButtonsDisabled\(settingsStore\.getUiState\(\)\.pluginOperationInFlight\)/);
assert.match(settings, /const settingsBridge = createSettingsBridge\(/);
assert.match(settings, /settingsBridge\.command\(/);
assert.match(settings, /settingsBridge\.subscribe\(/);
assert.doesNotMatch(settings, /await invoke\(command, args\)/);
assert.match(css, /@media\s*\(max-width:\s*880px\)[\s\S]*\.settings-nav-link\s*\{[\s\S]*width:\s*auto/);
assert.match(css, /\.diagnostics\s*\{[^}]*overflow-wrap:\s*anywhere/);

console.log('settings tabs structure: PASS');
