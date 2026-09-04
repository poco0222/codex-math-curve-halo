# Settings Web Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Codex Halo settings page into an extensible Web-style workbench with a Master-Detail state color editor while preserving the current native settings contract.

**Architecture:** Keep Tauri WebView and native HTML/CSS/JS. Add small boundaries for frontend state and Tauri communication, keep a literal View registry, and mount one View at a time. Use a six-row state list with one selected detail editor so future state-level settings can grow in place.

**Tech Stack:** Native HTML, CSS, JavaScript modules, Tauri IPC, Node test runner, existing browser checks. No new dependency.

**Spec:** `docs/comet/changes/settings-web-architecture/specs/settings-workbench/spec.md` and `docs/superpowers/specs/2026-09-04-settings-web-architecture-design.md`

## Global Constraints

- Preserve `AppSettings`, settings JSON, existing Tauri command names, event names, validation, and automatic save behavior.
- Preserve existing control IDs, `name` values, `data-i18n`, `data-state`, and `data-color-*` attributes unless a compatibility alias is required.
- Keep exactly six state colors and ten preset palette groups.
- Mount only the active top-level View in `#settings-panel-host`.
- Do not add React, Vue, Router, or another UI dependency.
- Keep the graphite dark base, warm orange accent, native controls, radius at or below `8px`, and no gradients or heavy shadows.
- Run browser checks in desktop and narrow layouts, `en` and `zh-CN`, with no document overflow or console errors.

---

### Task 1: Add pure settings state and bridge tests

**Files:**
- Create: `src/settings-store.js`
- Create: `src/settings-bridge.js`
- Test: `src/app.test.mjs`

**Interfaces:**
- `createSettingsStore({ defaults, persist })` returns `getSettings()`, `getUiState()`, `replaceSettings(value)`, `mergeSettings(patch)`, `patchSetting(key, value)`, `setUi(patch)`, and `save()`.
- `createSettingsBridge({ invoke, listen, warn })` returns `command(name, args)` and `subscribe(event, handler)`.
- The store owns settings values and UI-only values. The bridge owns command errors and event subscription mechanics.

- [ ] **Step 1: Write failing tests for full-model merge and active UI state**

Add focused Node tests using the existing `node:test` style:

```javascript
test('settings store merges partial external updates without erasing inactive values', async () => {
  const calls = [];
  const store = createSettingsStore({
    defaults: { opacity: 1, idle_color: '#A7ADB5', thinking_color: '#FF8A3D' },
    persist: (settings) => calls.push(settings),
  });

  store.replaceSettings({ opacity: 0.8, idle_color: '#111111', thinking_color: '#222222' });
  store.mergeSettings({ idle_color: '#333333' });

  assert.deepEqual(store.getSettings(), {
    opacity: 0.8,
    idle_color: '#333333',
    thinking_color: '#222222',
  });
  assert.deepEqual(calls, []);
});

test('settings bridge returns safe failure results when invoke rejects', async () => {
  const bridge = createSettingsBridge({
    invoke: async () => { throw new Error('raw detail'); },
    warn: () => {},
  });

  assert.deepEqual(await bridge.command('save_settings'), { ok: false, value: null });
});
```

- [ ] **Step 2: Run the focused tests and verify they fail for missing modules**

Run: `node --test src/app.test.mjs`

Expected: FAIL because `src/settings-store.js` and `src/settings-bridge.js` do not exist yet.

- [ ] **Step 3: Implement the minimum store and bridge**

Use a plain object store and the existing `createSerialTaskQueue` pattern. Keep `settingsStore` complete. `mergeSettings` must shallow-merge patches. `save()` must pass a copied full settings object to `persist`. The bridge must return `{ ok: true, value }` for successful commands and `{ ok: false, value: null }` after warning on rejection. `subscribe` must no-op when `listen` is unavailable.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `node --test src/app.test.mjs`

Expected: PASS for the new store and bridge tests, with existing tests still passing.

- [ ] **Step 5: Commit the pure boundaries**

```bash
git add src/settings-store.js src/settings-bridge.js src/app.test.mjs
git commit -m "拆分设置页状态与 Tauri 通信边界"
```

### Task 2: Rebuild the settings View registry and shell

**Files:**
- Modify: `src/settings.html`
- Modify: `src/settings.js`
- Modify: `src/i18n.js`
- Test: `src/app.test.mjs`
- Test: `scripts/check-settings-tabs.mjs`

**Interfaces:**
- `settings.js` uses a literal `SETTINGS_VIEWS` registry with `appearance`, `colors`, `integration`, and `test` entries.
- Each registry entry provides `template`, `labelKey`, and a bind function.
- The shell keeps `#settings-panel-host`, global `#enabled`, `#language`, and `#settings-save-status`.

- [ ] **Step 1: Write failing source-contract tests for the four Views and Appearance merge**

Extend the existing source checks to require:

```javascript
assert.match(html, /data-view-target="appearance"/);
assert.match(html, /data-view-target="colors"/);
assert.match(html, /data-view-target="integration"/);
assert.match(html, /data-view-target="test"/);
assert.match(html, /data-view-template="appearance"/);
assert.match(html, /id="particle-count"/);
assert.match(html, /id="color-state-list"/);
```

Also require the controller to use `replaceChildren()` on the active content host and to read the View registry instead of hard-coding five top-level sections.

- [ ] **Step 2: Run the checks and verify they fail against the current five-section markup**

Run: `node --test src/app.test.mjs && npm run check:settings-tabs`

Expected: FAIL because `animation` is still a top-level View and the Master-Detail list does not exist.

- [ ] **Step 3: Implement the shell and registry**

Change the top-level navigation to `Appearance`, `State colors`, `Integration`, and `Test`. Merge the current Display and Renderer templates into `Appearance`. Keep all existing IDs and `name` values. Replace `sectionNames` and duplicated navigation logic with the literal registry and one `mountSettingsView(viewId)` path. Keep roving tabindex and arrow/Home/End navigation.

Add localization keys for `settings.appearance` and any new visible labels. Keep existing keys as aliases where current tests or external content depend on them.

- [ ] **Step 4: Run the checks and verify they pass**

Run: `node --test src/app.test.mjs && npm run check:settings-tabs`

Expected: PASS, with one active top-level View and all existing control contracts present.

- [ ] **Step 5: Commit the shell change**

```bash
git add src/settings.html src/settings.js src/i18n.js src/app.test.mjs scripts/check-settings-tabs.mjs
git commit -m "重构设置页 View 工作台结构"
```

### Task 3: Implement the Master-Detail color editor

**Files:**
- Modify: `src/settings.html`
- Modify: `src/settings.js`
- Modify: `src/styles.css`
- Test: `src/app.test.mjs`

**Interfaces:**
- `renderColorStateList()` renders the six state rows from `STATE_COLOR_KEYS`.
- `mountColorStateDetail(state)` mounts exactly one detail editor into `#color-state-panel`.
- Existing `updateColorSetting`, `syncSettingsModelFromControls`, and `saveCurrentSettings` behavior remains the save path.

- [ ] **Step 1: Write failing tests for six visible rows and detail persistence**

Require the source and browser harness to cover:

```javascript
assert.match(html, /id="color-state-list"/);
assert.match(settingsSource, /renderColorStateList/);
assert.match(settingsSource, /mountColorStateDetail/);
assert.match(settingsSource, /STATE_COLOR_KEYS/);
```

Add a fake-DOM scenario that edits `thinking_color`, switches to `completed`, then switches back and asserts that `thinking_color` remains `#FF8A3D` or the edited valid value.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --test src/app.test.mjs`

Expected: FAIL because the current color View has horizontal state tabs and no state list renderer.

- [ ] **Step 3: Implement the minimum Master-Detail editor**

Render six rows with swatch, localized label, and current Hex. Use one selected row with `aria-selected` and roving tabindex. The detail panel keeps the native picker, Hex input, reset, and collapsed preset palette. Valid edits update only the selected state's key and enqueue one save. Invalid Hex stays local and reports validity without saving. Keep `data-color-*` compatibility attributes.

Desktop uses list plus detail columns. Narrow layouts stack list above detail. Do not add batch editing or a new persistence format.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `node --test src/app.test.mjs && npm run check:settings-tabs`

Expected: PASS with all six states readable, one detail editor mounted, and inactive values preserved.

- [ ] **Step 5: Commit the color editor**

```bash
git add src/settings.html src/settings.js src/styles.css src/app.test.mjs
git commit -m "改进状态颜色 Master-Detail 交互"
```

### Task 4: Wire store and bridge into existing behavior

**Files:**
- Modify: `src/settings.js`
- Modify: `src/settings-store.js`
- Modify: `src/settings-bridge.js`
- Test: `src/app.test.mjs`

**Interfaces:**
- All existing command calls route through `createSettingsBridge`.
- All mounted and unmounted fields read from the store's complete settings snapshot.
- `settings-changed` merges into the store. Plugin busy state remains in UI state and is reapplied after View remount.

- [ ] **Step 1: Write failing tests for external merge, save queue, and remount state**

Cover these exact behaviors:

```javascript
test('partial settings-changed payload keeps unmounted fields', () => {
  const store = createSettingsStore({
    defaults: { opacity: 1, idle_color: '#A7ADB5', thinking_color: '#FF8A3D' },
    persist: () => {},
  });

  store.replaceSettings({ opacity: 0.8, idle_color: '#111111', thinking_color: '#222222' });
  store.mergeSettings({ idle_color: '#333333' });

  assert.equal(store.getSettings().opacity, 0.8);
  assert.equal(store.getSettings().thinking_color, '#222222');
  assert.equal(store.getSettings().idle_color, '#333333');
});

test('plugin in-flight state survives a View change', () => {
  const store = createSettingsStore({ defaults: {}, persist: () => {} });

  store.setUi({ activeView: 'integration', pluginOperationInFlight: true });
  store.setUi({ activeView: 'appearance' });

  assert.equal(store.getUiState().activeView, 'appearance');
  assert.equal(store.getUiState().pluginOperationInFlight, true);
});

test('a settings merge does not change the locally patched active setting', () => {
  const store = createSettingsStore({
    defaults: { opacity: 1, curve_id: 'rose-seven' },
    persist: () => {},
  });

  store.patchSetting('opacity', 0.6);
  store.mergeSettings({ curve_id: 'spiral-search' });

  assert.equal(store.getSettings().opacity, 0.6);
  assert.equal(store.getSettings().curve_id, 'spiral-search');
});
```

- [ ] **Step 2: Run the tests and verify each new behavior fails before wiring**

Run: `node --test src/app.test.mjs`

Expected: FAIL on the new store and bridge integration assertions.

- [ ] **Step 3: Wire the controller through the store and bridge**

Keep the current command names, result shapes, safe error formatting, serial save queue, diagnostics polling, Plugin action guards, and event names. Render from state after View mounts. Keep the active form field excluded from external control sync while it is being edited.

- [ ] **Step 4: Run the tests and verify all behavior passes**

Run: `node --test src/app.test.mjs scripts/*.test.mjs`

Expected: PASS with no regressions to existing Plugin, diagnostics, simulation, localization, or save tests.

- [ ] **Step 5: Commit the wiring**

```bash
git add src/settings.js src/settings-store.js src/settings-bridge.js src/app.test.mjs
git commit -m "接入设置页共享状态与 Tauri Bridge"
```

### Task 5: Verify layout, localization, and release boundaries

**Files:**
- Modify: `src/styles.css`
- Modify: `src/i18n.js`
- Test: `scripts/check-settings-tabs.mjs`

- [ ] **Step 1: Run syntax, unit, structural, and renderer checks**

Run: `node --check src/settings.js && node --test src/app.test.mjs scripts/*.test.mjs && npm run check:settings-tabs && node scripts/check-renderer.mjs && git diff --check`

Expected: all checks pass.

- [ ] **Step 2: Run a static server for browser verification**

Run: `python3 -m http.server 4173 --directory src`

Open `http://127.0.0.1:4173/settings.html` in a real browser. Check `960x760`, `760x760`, and `520x900` in both languages.

- [ ] **Step 3: Verify real user flows**

Check:

- Appearance shows Display and Renderer together.
- View navigation mounts only the selected View.
- Six color rows show swatches and Hex values.
- Editing a color, switching state, switching View, and returning preserves the value.
- Invalid Hex does not save.
- Plugin busy state survives remount.
- Chinese text, focus rings, buttons, formula, and diagnostics do not overlap.
- `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.
- Browser console has no errors or warnings.

- [ ] **Step 4: Record known limits**

Report static browser verification separately from real Tauri IPC, Plugin installation, and Windows runtime behavior. Do not claim runtime coverage from the static server.

- [ ] **Step 5: Commit final verification adjustments**

```bash
git add src/styles.css src/i18n.js scripts/check-settings-tabs.mjs
git commit -m "完善设置页响应式与本地化验证"
```
