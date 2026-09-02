# Codex Halo Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add English and Simplified Chinese README variants plus a persisted in-app language selector that localizes the settings window and tray menu.

**Architecture:** Keep one settings DOM tree and add a small dependency-free `src/i18n.js` translation table. Add `language` to the existing `AppSettings` JSON contract with `en` as the default and fallback. Retain tray menu item handles in managed Rust state so labels and the settings window title update after the existing `settings-changed` path.

**Tech Stack:** Rust 2021, Tauri 2.11, serde/serde_json, vanilla JavaScript ES modules, Node `node:test`, Markdown.

**Spec:** `docs/superpowers/specs/2026-09-02-codex-halo-localization-design.md`

## Global Constraints

- Supported language values are `en` and `zh-CN`.
- Default language is English (`en`) for first launch, fallback, and old settings files.
- Unsupported persisted language values normalize to `en`.
- Existing numeric, boolean, hook, renderer, and overlay behavior stays unchanged.
- The overlay remains text-free.
- Mathematical formulas, source identifiers, and developer console messages are not translated.
- No language auto-detection, i18n package, network call, or new Tauri command.
- README commands, paths, privacy claims, and Windows verification limits stay factually aligned in both language files.
- Windows-only runtime behavior remains unverified on the macOS runner.
- Do not stage or modify unrelated existing worktree changes.

---

### Task 1: Extend the persisted settings contract

**Files:**
- Modify: `src-tauri/src/state.rs:162-222`
- Modify: `src/app.js:7-20`
- Modify: `src/app.test.mjs`

**Interfaces:**
- `AppSettings` gains `language: String`.
- `AppSettings::default().language` is `"en"`.
- `AppSettings::normalize()` accepts only `"en"` and `"zh-CN"`; all other values become `"en"`.
- `DEFAULT_APP_SETTINGS.language` is `'en'`.

- [ ] **Step 1: Write the failing Rust and JavaScript contract tests.**

Append these tests to the existing `src-tauri/src/state.rs` test module:

```rust
#[test]
fn defaults_to_english_language() {
    assert_eq!(AppSettings::default().language, "en");
}

#[test]
fn normalizes_unsupported_language_to_english() {
    let mut settings = AppSettings::default();
    settings.language = "fr".to_owned();

    assert_eq!(settings.normalize().unwrap().language, "en");
}

#[test]
fn missing_language_uses_the_english_default() {
    let settings: AppSettings = serde_json::from_str("{}").unwrap();

    assert_eq!(settings.language, "en");
}
```

Add `"language"` to the key list in `serializes_the_complete_settings_contract()` and add `language: 'en'` to the expected object in the existing `renderer startup uses exact frontend defaults after get_settings fails` test. The existing deep equality assertion must continue to cover the complete frontend default object.

```js
assert.equal(DEFAULT_APP_SETTINGS.language, 'en');
```

- [ ] **Step 2: Run tests and verify the expected RED state.**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml state::tests
node --test src/app.test.mjs
```

Expected: FAIL because `AppSettings` and `DEFAULT_APP_SETTINGS` do not yet expose `language`.

- [ ] **Step 3: Implement the minimal settings-field change.**

In `AppSettings`, add:

```rust
pub language: String,
```

At the start of `normalize()` add:

```rust
if self.language != "en" && self.language != "zh-CN" {
    self.language = "en".to_owned();
}
```

In `Default for AppSettings`, add:

```rust
language: "en".to_owned(),
```

In `DEFAULT_APP_SETTINGS`, add:

```js
language: 'en',
```

- [ ] **Step 4: Run focused tests and verify GREEN.**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml state::tests
node --test src/app.test.mjs
```

Expected: all Rust state tests and the JavaScript test file pass, including the complete frontend default-object equality assertion.

- [ ] **Step 5: Commit the settings contract.**

```bash
git add src-tauri/src/state.rs src/app.js src/app.test.mjs
git commit -m "feat: persist Codex Halo language setting"
```

### Task 2: Add the frontend localization table and selector

**Files:**
- Create: `src/i18n.js`
- Modify: `src/settings.html`
- Modify: `src/settings.js`
- Modify: `src/styles.css`
- Modify: `src/app.js`
- Modify: `src/app.test.mjs`

**Interfaces:**
- `src/i18n.js` exports `DEFAULT_LANGUAGE`, `SUPPORTED_LANGUAGES`, `normalizeLanguage(value)`, `getText(language, key)`, `getStateLabel(language, state)`, `getHookLabel(language, status)`, `getCurveLabel(language, curveId)`, `localeForLanguage(language)`, and `formatSetupError(command, error, language = DEFAULT_LANGUAGE)`.
- `src/app.js` re-exports `formatSetupError` so its existing import contract remains valid.
- `settings.js` includes `language` in `readSettings()` and applies translations without dispatching synthetic change events.

- [ ] **Step 1: Write failing pure localization and document contract tests.**

Add these imports to `src/app.test.mjs`:

```js
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  formatSetupError as formatLocalizedSetupError,
  getCurveLabel,
  getStateLabel,
  getText,
  normalizeLanguage,
} from './i18n.js';
```

Add these tests:

```js
test('localization defaults and falls back to English', () => {
  assert.equal(DEFAULT_LANGUAGE, 'en');
  assert.deepEqual(SUPPORTED_LANGUAGES, ['en', 'zh-CN']);
  assert.equal(normalizeLanguage('fr'), 'en');
  assert.equal(normalizeLanguage('zh-CN'), 'zh-CN');
  assert.equal(getText('zh-CN', 'settings.display'), '显示');
  assert.equal(getStateLabel('zh-CN', 'input_needed'), '需要输入');
  assert.equal(getCurveLabel('zh-CN', 'rose-seven'), '七瓣玫瑰');
});

test('localized setup errors keep only safe categories', () => {
  assert.match(
    formatLocalizedSetupError('save_settings', 'start-at-login:permission', 'zh-CN'),
    /权限/,
  );
  assert.equal(
    formatLocalizedSetupError('save_settings', 'raw path and payload', 'zh-CN'),
    'save_settings failed',
  );
});

test('settings page exposes a persisted language selector', async () => {
  const html = await readFile(new URL('./settings.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');

  assert.match(html, /id="language"/);
  assert.match(html, /value="en"/);
  assert.match(html, /value="zh-CN"/);
  assert.match(html, /data-i18n="settings\.display"/);
  assert.match(source, /language: control\('language'\)\.value/);
  assert.match(source, /document\.documentElement\.lang/);
});
```

- [ ] **Step 2: Run the frontend tests and verify the expected RED state.**

Run:

```bash
node --test src/app.test.mjs
```

Expected: FAIL because `src/i18n.js` and the language selector do not yet exist.

- [ ] **Step 3: Implement `src/i18n.js` with two complete dictionaries.**

Use plain objects and functions only. Use a flat map keyed by the exact dotted
strings below; do not nest the map, because `settings.hooks` is both a section
label and a prefix for hook-status keys. Include these exact semantic keys in
both dictionaries:

```text
settings.title
settings.overlayEnabled
settings.language
settings.display
settings.curveProfile
settings.opacity
settings.offsetX
settings.offsetY
settings.renderer
settings.particleCount
settings.trailSpan
settings.loopDuration
settings.pulseDuration
settings.rotationDuration
settings.strokeWidth
settings.activeFormula
settings.hooks
settings.installHooks
settings.removeHooks
settings.resetPosition
settings.simulateState
settings.startAtLogin
settings.exportDiagnostics
settings.diagnosticsLoading
settings.diagnosticsState
settings.diagnosticsLastEvent
settings.diagnosticsNever
settings.diagnosticsSetupError
settings.hooks.loading
settings.curves.roseSeven
settings.curves.lissajousDrift
settings.curves.spiralSearch
settings.curves.fourierFlow
settings.states.idle
settings.states.thinking
settings.states.executing
settings.states.inputNeeded
settings.states.completed
settings.states.compacting
settings.hooks.installed
settings.hooks.missing
settings.hooks.invalid
settings.hooks.partiallyInstalled
settings.hooks.unavailable
errors.startAtLogin
errors.permission
errors.launchAgent
errors.registry
errors.unsupported
errors.reconciliation
```

Use these exact dictionary values (English first, Simplified Chinese second):

```text
settings.title: Codex Halo Settings | Codex Halo 设置
settings.overlayEnabled: Overlay enabled | 启用叠加层
settings.language: Language | 语言
settings.display: Display | 显示
settings.curveProfile: Curve profile | 曲线方案
settings.opacity: Opacity | 不透明度
settings.offsetX: Offset X | X 偏移
settings.offsetY: Offset Y | Y 偏移
settings.renderer: Renderer | 渲染器
settings.particleCount: Particle count | 粒子数量
settings.trailSpan: Trail span | 轨迹跨度
settings.loopDuration: Loop duration (ms) | 循环时长（毫秒）
settings.pulseDuration: Pulse duration (ms) | 脉冲时长（毫秒）
settings.rotationDuration: Rotation duration (ms) | 旋转时长（毫秒）
settings.strokeWidth: Stroke width | 线条宽度
settings.activeFormula: Active formula | 当前公式
settings.hooks: Hooks | Hooks
settings.installHooks: Install hooks | 安装 hooks
settings.removeHooks: Remove hooks | 移除 hooks
settings.resetPosition: Reset position | 重置位置
settings.simulateState: Simulate state | 模拟状态
settings.startAtLogin: Start at login | 登录时启动
settings.exportDiagnostics: Export diagnostics | 导出诊断
settings.diagnosticsLoading: State: Idle | Last event: never | 状态：空闲 | 上次事件：从未
settings.diagnosticsState: State | 状态
settings.diagnosticsLastEvent: Last event | 上次事件
settings.diagnosticsNever: never | 从未
settings.diagnosticsSetupError: Setup error | 设置错误
settings.curves.roseSeven: Rose Seven | 七瓣玫瑰
settings.curves.lissajousDrift: Lissajous Drift | 李萨如漂移
settings.curves.spiralSearch: Spiral Search | 螺旋搜索
settings.curves.fourierFlow: Fourier Flow | 傅里叶流
settings.states.idle: Idle | 空闲
settings.states.thinking: Thinking | 思考中
settings.states.executing: Executing | 执行中
settings.states.inputNeeded: Input needed | 需要输入
settings.states.completed: Completed | 已完成
settings.states.compacting: Compacting | 压缩中
settings.hooks.loading: loading | 加载中
settings.hooks.installed: Installed | 已安装
settings.hooks.missing: Missing | 缺失
settings.hooks.invalid: Needs repair | 需要修复
settings.hooks.partiallyInstalled: Partially installed | 部分安装
settings.hooks.unavailable: Unavailable | 不可用
errors.startAtLogin: start-at-login setup failed | 启动时设置失败
errors.permission: permission | 权限
errors.launchAgent: launch-agent | LaunchAgent
errors.registry: registry | 注册表
errors.unsupported: unsupported | 不支持
errors.reconciliation: reconciliation | 状态恢复
```

Keep English equivalent to the current UI strings, including
`start-at-login setup failed (permission)` for the existing English test. For
the Chinese setup error, join the translated prefix and category with the full-
width parentheses `（` and `）`.

`formatSetupError(command, error, language)` keeps the current safe regex behavior: only `permission`, `launch-agent`, `registry`, `unsupported`, and `reconciliation` may be shown from a string error; unknown errors return `${command} failed`. Keep the safe category extraction in the pure module so the settings UI can re-render a stored `{ command, error }` after a language switch. `settings.diagnosticsState`, `settings.diagnosticsLastEvent`, and `settings.diagnosticsSetupError` are short translated fragments; `settings.js` joins them with the existing `: ` and ` | ` separators.

- [ ] **Step 4: Mark HTML elements with translation keys and add the native selector.**

In `src/settings.html`, place this selector directly below the existing header and above the status lines:

```html
<label class="language-row" for="language">
  <span data-i18n="settings.language">Language</span>
  <select id="language" name="language" aria-label="Language">
    <option value="en">English</option>
    <option value="zh-CN">简体中文</option>
  </select>
</label>
```

Add `data-i18n` to every visible static label, legend, button, status placeholder, and curve/state option. Add `data-i18n-aria-label="settings.language"` to the selector and `data-i18n-aria-label="settings.activeFormula"` to the formula output. Keep English text as the no-JavaScript fallback and keep `<html lang="en">` in the source. In `src/styles.css`, make `.language-row` a two-column grid with the label on the left and a stable native select on the right; use `margin-bottom: 12px`, `grid-template-columns: 1fr auto`, and a `min-width` of `120px` for its select.

- [ ] **Step 5: Wire translation rendering into `settings.js`.**

Add `currentLanguage = DEFAULT_LANGUAGE`, `currentHookStatus = 'loading'`, and `setupError = null`. Store setup errors as `{ command, error }`, not as a translated string, so switching language redraws the same safe error. Implement:

```js
function renderLanguage(language) {}
function renderHookStatus(status) {}
function renderDiagnostics(displayState = {}) {}
```

`renderLanguage()` normalizes the value, updates `document.documentElement.lang`, `document.title`, all `[data-i18n]` text, and all `[data-i18n-aria-label]` attributes, then redraws current hook status and diagnostics. `readSettings()` returns `language: control('language').value`. `applySettings()` sets the language selector to `normalizeLanguage(settings.language)` and calls `renderLanguage()` without emitting a new change event. Keep the existing generic field listener as the single save listener for the selector, and add only a second selector-specific listener that calls `renderLanguage(field.value)` immediately; both listeners use the existing serial `saveCurrentSettings()` queue without creating duplicate saves. `renderDiagnostics()` must call `formatSetupError(setupError.command, setupError.error, currentLanguage)` only after the safe error object exists.

Use `localeForLanguage(currentLanguage)` for timestamp formatting. Keep formula content unchanged, but localize its accessibility label and curve option names.

- [ ] **Step 6: Preserve the `app.js` error API and run GREEN.**

Replace the local `SAFE_SETUP_ERROR` implementation in `src/app.js` with the imported/re-exported implementation from `src/i18n.js`, without changing the existing two-argument English result.

Run:

```bash
node --test src/app.test.mjs
npm run check:renderer
```

Expected: PASS for the JavaScript tests and renderer self-check.

- [ ] **Step 7: Commit the frontend localization.**

```bash
git add src/i18n.js src/settings.html src/settings.js src/app.js src/app.test.mjs
git commit -m "feat: add selectable settings language"
```

### Task 3: Localize the native tray and settings window title

**Files:**
- Modify: `src-tauri/src/main.rs:1-28,265-277,541-738`
- Modify: `src/app.test.mjs`

**Interfaces:**
- `ReducerRuntimeState` gains `tray_menu: Mutex<Option<TrayMenuItems>>`.
- `TrayMenuItems` retains the existing `MenuItem` handles by their stable IDs.
- `build_tray(app, settings: &AppSettings)` creates the existing menu IDs and installs localized initial text.
- `update_tray_menu(items, settings)` updates menu text in place and never returns a label-update failure to settings persistence.
- `apply_settings_to_overlay()` updates native labels and the settings window title after a successful settings write, then emits the existing `settings-changed` events.

- [ ] **Step 1: Write the failing native localization contract test.**

Add this test to `src/app.test.mjs`:

```js
test('native menu refresh follows the persisted language setting', async () => {
  const source = await readFile(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');

  assert.match(source, /struct TrayMenuItems/);
  assert.match(source, /tray_menu: Mutex<Option<TrayMenuItems>>/);
  assert.match(source, /set_text\(/);
  assert.match(source, /settings_window\.set_title/);
  assert.match(source, /settings\.language/);
  assert.match(source, /打开设置/);
});
```

- [ ] **Step 2: Run the test and verify the expected RED state.**

Run:

```bash
node --test src/app.test.mjs
```

Expected: FAIL because the tray state and localized native updates do not yet exist.

- [ ] **Step 3: Add retained tray item handles.**

Define `TrayMenuItems` in `src-tauri/src/main.rs` with these `MenuItem<tauri::Wry>` fields:

```text
open_settings
toggle_overlay
install_hooks
remove_hooks
simulate_idle
simulate_thinking
simulate_executing
simulate_input_needed
simulate_completed
simulate_compacting
reset_position
quit
```

Add `tray_menu: Mutex<Option<TrayMenuItems>>` to `ReducerRuntimeState`. Keep the existing `#[derive(Default)]`; `Option<TrayMenuItems>` supplies the initial empty value.

In `build_tray()`, construct the `TrayMenuItems` value from the existing `MenuItem::with_id()` results, use references to its fields when building `Menu::with_items()`, build the tray, then store a clone of the handles in `app.state::<ReducerRuntimeState>().tray_menu`.

- [ ] **Step 4: Add native label selection and update helpers.**

Implement these functions in `src-tauri/src/main.rs`:

```rust
fn is_simplified_chinese(language: &str) -> bool;
fn settings_window_title(language: &str) -> &'static str;
fn update_tray_menu(items: &TrayMenuItems, settings: &AppSettings);
```

Use English for every value except the exact `"zh-CN"` language. English labels preserve the current menu meaning:

```text
Open Settings
Enable overlay / Disable overlay
Install/repair Codex hooks
Remove Codex Halo hooks
Simulate Idle
Simulate Thinking
Simulate Executing
Simulate Input needed
Simulate Completed
Simulate Compacting
Reset position
Quit
```

Simplified Chinese labels are:

```text
打开设置
启用叠加层 / 禁用叠加层
安装/修复 Codex hooks
移除 Codex Halo hooks
模拟空闲
模拟思考
模拟执行
模拟需要输入
模拟已完成
模拟压缩
重置位置
退出
```

Use `"Codex Halo Settings"` and `"Codex Halo 设置"` for the two settings-window titles. Select `Disable`/`禁用` when `settings.enabled` is true; select `Enable`/`启用` when false. Wrap each `MenuItem::set_text()` call so a native update error is logged with `eprintln!` and does not abort the settings save.

- [ ] **Step 5: Connect native refresh to the existing settings flow.**

Change the signature from `build_tray(app, _enabled)` to `build_tray(app, settings: &AppSettings)` and pass the loaded settings from `build_windows()`. Set the settings window's initial native title from `settings_window_title(&settings.language)` before building the tray.

In `apply_settings_to_overlay()`:

1. keep the existing `position_overlay()` and `set_overlay_visibility()` calls;
2. clone `TrayMenuItems` out of `ReducerRuntimeState.tray_menu`, call `update_tray_menu()` with the new settings, and call `settings_window.set_title(settings_window_title(&settings.language))`;
3. keep the existing `app.emit_to("main", "settings-changed", ...)` and `app.emit_to("settings", "settings-changed", ...)` calls.

Do not change menu event IDs or their action branches. Do not localize the hook `statusMessage` stored in `hooks.json`; it is an owned marker/source label, not the settings UI.

- [ ] **Step 6: Run native tests, compile, and contract tests.**

Run:

```bash
node --test src/app.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml state::tests
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all JavaScript contract tests, Rust state tests, and Rust compilation pass.

- [ ] **Step 7: Commit native localization.**

```bash
git add src-tauri/src/main.rs src/app.test.mjs
git commit -m "feat: localize Codex Halo tray menu"
```

### Task 4: Add README variants and run final integration checks

**Files:**
- Modify: `README.md`
- Create: `README.zh-CN.md`
- Modify: `src/app.test.mjs`

**Interfaces:**
- `README.md` remains the English canonical guide.
- `README.zh-CN.md` is the matching Simplified Chinese guide.
- Both files link to each other near the title and describe the same commands, settings behavior, privacy boundary, and Windows verification limits.

- [ ] **Step 1: Write the failing README contract test.**

Add this test to `src/app.test.mjs`:

```js
test('README has English and Simplified Chinese variants', async () => {
  const english = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const chinese = await readFile(new URL('../README.zh-CN.md', import.meta.url), 'utf8');

  assert.match(english, /README\.zh-CN\.md/);
  assert.match(chinese, /README\.md/);
  assert.match(chinese, /本地运行/);
  assert.match(chinese, /隐私/);
  assert.match(english, /English|language/i);
});
```

- [ ] **Step 2: Run the test and verify the expected RED state.**

Run:

```bash
node --test src/app.test.mjs
```

Expected: FAIL because `README.zh-CN.md` and the reciprocal links/documentation do not yet exist.

- [ ] **Step 3: Add the English README link and language note.**

Near the first heading in `README.md`, add:

```markdown
[简体中文](README.zh-CN.md)
```

Add a short paragraph stating that the settings window supports `English` and `简体中文`, defaults to `English`, and stores the selection in local app settings. Keep all existing English operational and privacy content.

- [ ] **Step 4: Create the matching Simplified Chinese README.**

Update `README.md` to use matching `## Settings and diagnostics` and `## Privacy` headings, then create `README.zh-CN.md` with this section order:

```text
Codex Halo
本地运行
Codex hooks
设置与诊断
隐私
归属
```

Translate the existing README prose into Simplified Chinese. Keep these literals unchanged: `npm run build:sidecar`, `cargo tauri dev`, `cargo tauri build --target aarch64-apple-darwin`, `~/.codex/hooks.json`, `--state-dir`, `codex-halo-diagnostics.json`, `SessionStart`, `Stop`, `SessionEnd`, `state`, `timestamp`, `Rust`, `Cargo`, `Node.js`, `Tauri`, `macOS`, and `Windows`.

Near the title, add:

```markdown
[English](README.md)
```

Document the same English-default language selector and local persistence behavior. Preserve the same statements about hook trust, owned-hook removal, content-free diagnostics, Windows runner requirements, and excluded prompt/transcript/tool/model/path data.

- [ ] **Step 5: Run all local verification commands.**

Run:

```bash
node --test src/app.test.mjs
npm run check:renderer
npm run test:build-sidecar
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check origin/main..HEAD
git status --short --branch
```

Expected: JavaScript tests, renderer check, sidecar tests, Rust tests, and Rust compilation pass. `git status` may still show the pre-existing unrelated files; do not stage or remove them.

- [ ] **Step 6: Review the final changed files for scope.**

Run:

```bash
git diff --stat origin/main..HEAD
git diff -- src/i18n.js src/settings.html src/settings.js src/app.js src-tauri/src/state.rs src-tauri/src/main.rs README.md README.zh-CN.md
```

Confirm:

```text
language defaults to en
only en and zh-CN are accepted
settings selector saves through save_settings
settings-changed updates both frontend windows
tray labels and settings title follow language
overlay has no visible text
diagnostics still contain only state and timestamp
no new dependency or Tauri command exists
```

- [ ] **Step 7: Commit the bilingual README.**

```bash
git add README.md README.zh-CN.md src/app.test.mjs
git commit -m "docs: add bilingual Codex Halo README"
```
