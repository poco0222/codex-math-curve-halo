import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../src/settings.html', import.meta.url), 'utf8');
const settings = await readFile(new URL('../src/settings.js', import.meta.url), 'utf8');
const colors = await readFile(new URL('../src/colors.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

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
assert.match(settings, /const SETTINGS_VIEWS = \{/);
assert.match(settings, /function mountSettingsView\(/);
assert.match(settings, /host\.replaceChildren\(/);
assert.doesNotMatch(settings, /const sectionNames = \[/);
assert.match(settings, /function mountColorState\(/);
assert.match(settings, /settingsModel/);
assert.match(settings, /function syncSettingsModelFromControls\(/);
assert.match(settings, /if \(key && isHexColor\(field\.value\)\)/);
assert.match(settings, /settingsModel = \{\s*\.\.\.settingsModel,/);
assert.match(settings, /event\.key === 'ArrowRight'/);
assert.match(settings, /event\.key === 'ArrowLeft'/);
assert.doesNotMatch(settings, /document\.querySelector\('\[data-color-state-label\]'\)/);
assert.match(settings, /let pluginOperationInFlight = false/);
assert.match(settings, /if \(pluginOperationInFlight\) return;/);
assert.match(settings, /function setPluginButtonsDisabled\(/);
assert.match(settings, /setPluginButtonsDisabled\(pluginOperationInFlight\)/);
assert.match(css, /@media\s*\(max-width:\s*880px\)[\s\S]*\.settings-nav-link\s*\{[\s\S]*width:\s*auto/);

console.log('settings tabs structure: PASS');
