# Codex Halo Native App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform Tauri 2 companion app that renders a mathematical Codex Halo and receives Codex lifecycle state through user-level hooks on macOS and Windows.

**Architecture:** One Tauri 2 binary hosts a transparent overlay and a normal settings window. A small Rust hook helper reads one Codex hook JSON object from `stdin`, maps only lifecycle fields to a per-session atomic snapshot, and exits without affecting Codex. The Tauri process polls snapshots, reduces multiple sessions, and sends the selected state to a dependency-free JavaScript renderer.

**Tech Stack:** Tauri 2, Rust 2021, vanilla JavaScript, SVG/canvas-compatible math renderer, `serde`, `serde_json`, `sha2`, `tokio`, native macOS/Windows APIs.

**Spec:** `docs/superpowers/specs/2026-09-02-codex-halo-native-app-design.md`

## Global Constraints

- Target: macOS and Windows desktop companion app.
- Logical overlay size: `112px x 112px`.
- Default position: `28px` from the right and `140px` from the bottom of the primary display.
- State changes morph over `420ms`.
- A completed state is held for `3s` unless a new event arrives.
- Other states expire after `60s` without a fresh snapshot, except `input_needed`.
- The app installs owned command hooks in the user-level `~/.codex/hooks.json`.
- The helper accepts `--state-dir <path>`.
- The helper must not persist `prompt`, `tool_input`, `tool_response`, `transcript_path`, `cwd`, or `model`.
- Hook failures are best-effort and must not stop a Codex turn.
- No network calls, analytics, telemetry, or remote update checks.
- No Web deployment or browser gallery.
- No Linux support in the first release.
- No code signing, notarization, or auto-update service in the first release.
- Windows runtime correctness requires Windows or a configured Windows CI runner; macOS checks are not Windows evidence.

## File Map

Create this small tree:

```text
src/
  index.html                  overlay document
  settings.html               settings document
  styles.css                  overlay and settings styles
  curves.js                   pure curve profiles and formulas
  halo.js                     animation loop and drawing
  app.js                      overlay bridge and state simulator
  settings.js                 settings bridge and controls

scripts/
  check-renderer.mjs          browserless finite-point self-check

src-tauri/
  Cargo.toml                  Rust dependencies and binary targets
  build.rs                     Tauri build hook
  tauri.conf.json             product, bundle, and frontend settings
  capabilities/default.json   minimal Tauri permissions
  src/lib.rs                   shared Rust modules
  src/main.rs                  Tauri lifecycle, windows, tray, commands
  src/platform.rs             macOS/Windows position and autostart helpers
  src/state.rs                snapshot model and multi-session reducer
  src/hook_protocol.rs        hook input mapping and atomic snapshot writer
  src/hooks.rs                hooks.json merge/install/remove logic
  src/bin/codex-halo-hook.rs  standalone stdin hook helper

README.md                     run, install, trust, and privacy instructions
.gitignore                    build and local state exclusions
```

No database, background server, frontend framework, or separate plugin SDK.

---

### Task 1: Bootstrap the Tauri workspace

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/platform.rs`
- Create: `src-tauri/src/state.rs`
- Create: `src/index.html`
- Create: `src/settings.html`
- Create: `src/styles.css`
- Create: `package.json`
- Create: `.gitignore`

**Interfaces:**
- Produces Tauri commands named `get_display_state`, `get_settings`,
  `save_settings`, `simulate_state`, `install_hooks`, `remove_hooks`, and
  `get_hook_status`.
- Produces two windows named `main` and `settings`; the overlay is transparent,
  frameless, always-on-top, taskbar/dock-hidden, and cursor-transparent.
- Produces a single-instance app entry point. A second launch focuses the
  settings window and exits.

- [ ] **Step 1: Verify the required toolchain before writing source.**

Run:

```bash
rustc --version
cargo --version
cargo tauri --version
```

Expected: Rust and the Tauri CLI are available. If `cargo` or `rustc` is
missing on macOS, install Rust in the user home with `rustup` before continuing;
do not place a new toolchain in `/Applications` or another fixed system path.
Use:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
cargo install tauri-cli --version '^2'
```

- [ ] **Step 2: Add the minimal package and ignore rules.**

`package.json` must contain only scripts needed for the static frontend and
Tauri CLI:

```json
{
  "name": "codex-halo",
  "private": true,
  "type": "module",
  "scripts": {
    "check:renderer": "node scripts/check-renderer.mjs",
    "tauri": "cargo tauri"
  }
}
```

`.gitignore` must exclude `src-tauri/target/`, `dist/`, `.DS_Store`,
`state/`, and local settings exports. Do not ignore `src-tauri/icons/` or
`docs/`.

- [ ] **Step 3: Create the Tauri manifest.**

Use package identity `Codex Halo` and identifier `com.codex-halo.app`. Set
`frontendDist` to `../src`, enable `withGlobalTauri`, and keep the content
security policy local; no remote origins are needed. Create the `main` and
`settings` windows at runtime in `main.rs`. Add the hook helper to
`bundle.externalBin` in Task 4 after the helper target exists.

`src-tauri/Cargo.toml` must include Tauri 2, `serde` with `derive`,
`serde_json`, `tokio` with the runtime/time features, and `sha2`. Add the Tauri
`tray-icon` feature, `tauri-plugin-single-instance = "2"`, and
`tauri-plugin-autostart = "2"`. Register both plugins in `main.rs`.

- [ ] **Step 4: Add the minimal HTML shell.**

`src/index.html` contains one `<canvas id="halo">` and loads `halo.js` and
`app.js` as modules. `src/settings.html` contains a compact settings form with
native controls for curve profile, opacity, offsets, renderer values, hook
install/remove, six state simulation buttons, and start-at-login.

The overlay document must set transparent backgrounds, hide overflow, disable
selection, and contain no visible status text.

- [ ] **Step 5: Add the typed command surface and window creation.**

Make the app launch with an idle overlay and a settings window that opens only
from the tray or `open_settings`. Return explicit defaults from the command
surface (`DisplayState::idle()` and `AppSettings::default()`); do not put hook
or renderer logic in this task. Define the initial serializable types in
`src-tauri/src/state.rs` so the frontend bridge has a stable contract from the
first build:

```rust
#[derive(Clone, Serialize)]
pub struct DisplayState {
    pub state: HaloState,
    pub session_count: usize,
    pub updated_at_ms: i64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub enabled: bool,
    pub opacity: f32,
    pub offset_x: i32,
    pub offset_y: i32,
    pub curve_id: String,
}
```

Add `Default` implementations and `DisplayState::idle()` in this task; Task 3
extends the same module with snapshots and reduction.

- [ ] **Step 6: Run the scaffold check.**

Run:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: PASS with no Rust errors. Commit:

```bash
git add package.json .gitignore src src-tauri
git commit -m "chore: bootstrap Codex Halo Tauri app"
```

---

### Task 2: Implement the pure mathematical curve engine and renderer

**Files:**
- Create: `src/curves.js`
- Create: `scripts/check-renderer.mjs`
- Modify: `src/index.html`
- Modify: `src/styles.css`
- Modify: `src/halo.js`
- Modify: `src/app.js`

**Interfaces:**
- `curves.js` exports `curveProfiles`, `getCurveProfile(id)`,
  `sampleCurve(profile, progress, detailScale, settings, steps)`,
  `formatFormula(profile, settings)`, and `validateCurveProfiles()`.
- `halo.js` exports `createHaloRenderer(canvas, options)` with methods
  `setState(state)`, `setCurve(id)`, `setSettings(settings)`, `start()`, and
  `stop()`.
- `app.js` polls `get_display_state` and calls the renderer methods; simulator
  buttons call `simulate_state` and do not bypass the Rust reducer.

- [ ] **Step 1: Write the renderer self-check first.**

`check-renderer.mjs` imports `curveProfiles` and evaluates 128 samples for
each profile at detail scales `0`, `0.5`, and `1`. Assert every returned `x`
and `y` is finite and within `-20` to `120`, and assert every formula is a
non-empty string.

```js
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
```

- [ ] **Step 2: Run the self-check to prove the initial failure.**

Run:

```bash
node scripts/check-renderer.mjs
```

Expected: FAIL because `src/curves.js` does not yet export the profile
contract.

- [ ] **Step 3: Add the four bounded curve profiles.**

Implement only these profiles:

1. `rose-seven`: the seven-petal custom rose trail from the reference behavior;
2. `lissajous-drift`: independent sine frequencies on x/y;
3. `spiral-search`: angle growth plus cosine-modulated radius;
4. `fourier-flow`: finite sine/cosine components with a pulse mix.

Each profile is a plain object with `id`, `label`, `tag`, `defaults`,
`controls`, `rotate`, `point`, and `formula`. Keep the point functions pure.
Clamp or normalize any denominator before division. Do not copy the entire
upstream gallery source.

- [ ] **Step 4: Implement the renderer.**

Use one `requestAnimationFrame` loop. For each frame:

1. Compute pulse scale from `pulseDurationMs`.
2. Sample the selected point function for the soft background path.
3. Place particles along `trailSpan` behind the head particle.
4. Draw outer glow, mid stroke, core stroke, and particles in the active state
   color.
5. Apply the state-specific rotation, alpha, radius pulse, and speed.
6. Interpolate old/new state colors and motion for exactly `420ms`.

Use a fixed logical coordinate system (`0..100`) and scale it to the canvas;
do not let dynamic text or controls resize the overlay.

- [ ] **Step 5: Add state colors and simulator bridge.**

Use the exact state colors from the spec. `app.js` must poll the Rust command
every `150ms`, pass only the returned display state to the renderer, and expose
six simulator buttons in the settings window. The overlay remains click-through;
all controls live in the settings window or tray.

- [ ] **Step 6: Run the self-check and inspect the static UI.**

Run:

```bash
node scripts/check-renderer.mjs
git diff --check
```

Expected: PASS. Commit:

```bash
git add src scripts/check-renderer.mjs
git commit -m "feat: add mathematical Codex Halo renderer"
```

---

### Task 3: Add the Rust snapshot model and multi-session reducer

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/main.rs`

**Interfaces:**
- `state.rs` exports `HaloState`, `Snapshot`, `DisplayState`,
  `SessionStore`, `STATE_PRIORITY`, and `reduce_snapshots`.
- `HaloState` serializes to the exact strings `idle`, `thinking`,
  `executing`, `input_needed`, `completed`, and `compacting`.
- `SessionStore::upsert(snapshot)`, `SessionStore::remove(session_key)`,
  `SessionStore::display_state(now_ms)`, and
  `SessionStore::clear_expired(now_ms)` are the only reducer entry points.
- `get_display_state` returns `{ state, session_count, updated_at_ms }`.

- [ ] **Step 1: Write reducer tests before implementation.**

Cover these exact cases:

```rust
assert_eq!(priority(HaloState::InputNeeded), 6);
assert_eq!(priority(HaloState::Idle), 1);
let now = 1_000_000;
assert_eq!(reduce_snapshots(&[Snapshot::new("a", HaloState::Thinking, 100), Snapshot::new("b", HaloState::Executing, 200)], now).state, HaloState::Executing);
assert_eq!(reduce_snapshots(&[Snapshot::new("a", HaloState::Executing, 100), Snapshot::new("b", HaloState::InputNeeded, 200)], now).state, HaloState::InputNeeded);
assert_eq!(reduce_snapshots(&[Snapshot::new("a", HaloState::Thinking, 100), Snapshot::new("b", HaloState::Thinking, 200)], now).updated_at_ms, 200);
assert_eq!(reduce_snapshots(&[Snapshot::new("a", HaloState::Completed, now - 3_001)], now).state, HaloState::Idle);
assert_eq!(reduce_snapshots(&[Snapshot::new("a", HaloState::InputNeeded, now - 86_400_000)], now).state, HaloState::InputNeeded);
```

Use table-driven unit tests for malformed state strings and timestamps older
than `60s`.

- [ ] **Step 2: Run the focused tests and confirm failure.**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml state::tests
```

Expected: FAIL because the reducer types are not implemented.

- [ ] **Step 3: Implement the state model and expiry.**

Use the exact priority order:

```text
input_needed > compacting > executing > thinking > completed > idle
```

For equal priority, choose the newest `updated_at_ms`. Expire `completed` at
`3_000ms`; expire other active states at `60_000ms`; never expire
`input_needed` by age alone.

- [ ] **Step 4: Connect the reducer to the Tauri polling loop.**

On each `150ms` tick, scan the configured state directory, parse valid JSON,
replace the in-memory session map, reduce it, and emit the display state to the
overlay command result. Ignore corrupt files without clearing valid sessions.

- [ ] **Step 5: Run the focused tests and full Rust library tests.**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml state::tests
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: PASS. Commit:

```bash
git add src-tauri/src/lib.rs src-tauri/src/state.rs src-tauri/src/main.rs
git commit -m "feat: reduce Codex Halo session states"
```

---

### Task 4: Implement the content-free Codex hook helper

**Files:**
- Create: `src-tauri/src/hook_protocol.rs`
- Create: `src-tauri/src/bin/codex-halo-hook.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- `parse_hook_input(bytes: &[u8]) -> Result<HookInput, HookError>` reads JSON
  from stdin.
- `map_event(input: &HookInput) -> Option<HookAction>` maps lifecycle names to
  `Set(HaloState)` or `Remove`.
- `write_snapshot(state_dir: &Path, input: &HookInput, state: HaloState,
  now_ms: i64) -> Result<(), HookError>` writes one per-session snapshot.
- The helper CLI accepts `--state-dir <path>`, reads all JSON from stdin, and
  writes `{}` to stdout for every successful `Stop` invocation.

- [ ] **Step 1: Write hook fixture tests first.**

Create inline fixtures for each mapped event. Assert that the helper reads only
these fields:

```json
{
  "session_id": "thr_123",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "prompt": "must not be persisted"
}
```

Assert:

- `SessionStart` -> `idle`, except `source: "compact"` -> `thinking`;
- `UserPromptSubmit` -> `thinking`;
- `PreToolUse` -> `executing`;
- `PermissionRequest` -> `input_needed`;
- `PreCompact` -> `compacting`;
- `PostCompact` -> `thinking`;
- `Stop` -> `completed`;
- `SessionEnd` -> remove;
- unknown event -> no snapshot;
- raw prompt/tool/transcript fields never occur in the serialized snapshot.

- [ ] **Step 2: Run the hook tests and prove failure.**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml hook_protocol::tests
```

Expected: FAIL because the parser and writer do not exist.

- [ ] **Step 3: Implement safe parsing and session keying.**

Require a non-empty `session_id` and `hook_event_name`. Hash the session id with
SHA-256 before using it in a filename. Never use the raw id, cwd, transcript
path, prompt, tool input, tool response, or model in the snapshot.

Use a filename `<sha256>.json`. Write to `<sha256>.json.tmp`, flush, then
rename. Create `--state-dir` with restrictive user-only permissions where the
platform supports them.

- [ ] **Step 4: Implement event mapping and non-blocking CLI behavior.**

Map only the eight events in the spec. The helper must return process exit code
`0` for malformed input, unknown events, missing state directory, and write
errors after recording a redacted local diagnostic. It must never emit a
blocking hook decision.

For `Stop`, write exactly `{}` plus a newline to stdout on successful parsing;
for other events, also write `{}` to keep stdout valid and predictable.

Add the sidecar target to `tauri.conf.json`:

```json
{
  "bundle": {
    "externalBin": ["binaries/codex-halo-hook"]
  }
}
```

Build sidecar files with the Tauri target suffix, for example
`codex-halo-hook-aarch64-apple-darwin` and
`codex-halo-hook-x86_64-pc-windows-msvc`. Copy the bundled sidecar to the
stable app-data helper path on first launch.

- [ ] **Step 5: Run fixture tests and direct helper probes.**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml hook_protocol::tests
printf '%s' '{"session_id":"thr_test","hook_event_name":"Stop"}' | \
  cargo run --manifest-path src-tauri/Cargo.toml --bin codex-halo-hook -- \
  --state-dir /tmp/codex-halo-hook-test
```

Expected: tests PASS; stdout is `{}`; the state directory contains one JSON
snapshot with only `session_key`, `state`, and `updated_at_ms`.

- [ ] **Step 6: Commit the helper.**

```bash
git add src-tauri/src/lib.rs src-tauri/src/hook_protocol.rs \
  src-tauri/src/bin/codex-halo-hook.rs src-tauri/Cargo.toml \
  src-tauri/tauri.conf.json
git commit -m "feat: add content-free Codex hook helper"
```

---

### Task 5: Implement safe `hooks.json` installation and removal

**Files:**
- Create: `src-tauri/src/hooks.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/main.rs`

**Interfaces:**
- `codex_home() -> Result<PathBuf, HookError>` uses `$CODEX_HOME` when set,
  otherwise the platform home directory plus `.codex`.
- `install_hooks(config_path, helper_path, state_dir) -> Result<InstallReport,
  HookError>`.
- `remove_hooks(config_path) -> Result<RemoveReport, HookError>`.
- `is_owned_handler(value: &serde_json::Value) -> bool` identifies only the
  stable `--codex-halo` marker.
- `get_hook_status(config_path, helper_path) -> HookStatus` reports installed,
  missing, invalid, or partially installed.

- [ ] **Step 1: Write JSON merge tests first.**

Use temporary directories and this unrelated hook:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "python3 ./mine.py" }] }
    ]
  }
}
```

Assert:

- install preserves the unrelated handler;
- a second install does not duplicate owned handlers;
- removal deletes only owned handlers;
- invalid JSON is not overwritten;
- an atomic replacement is used;
- a timestamped backup is created before the first modification;
- Windows command paths use the `.exe` helper path;
- all eight mapped event groups are present.

- [ ] **Step 2: Run merge tests and prove failure.**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml hooks::tests
```

Expected: FAIL because merge/install functions are absent.

- [ ] **Step 3: Build owned hook entries.**

Each owned command must include:

```text
codex-halo-hook --codex-halo --state-dir "<absolute app-data state dir>"
```

Leave all eight owned lifecycle commands synchronous. This is an intentional
correctness deviation from the earlier asynchronous proposal: Codex background
hook completion can reorder state, and the local helper is fast enough for the
foreground path.

Use matcher values supported by Codex:

- `SessionStart`: `startup|resume|clear|compact`;
- `PreCompact` and `PostCompact`: `manual|auto`;
- `PermissionRequest` and `PreToolUse`: empty matcher;
- `UserPromptSubmit`, `Stop`, and `SessionEnd`: omit matcher.

Set `statusMessage` to `Codex Halo` and include the stable `--codex-halo`
marker in every owned command.

- [ ] **Step 4: Implement parse, backup, merge, and atomic write.**

Read the existing JSON with `serde_json`. If parsing fails, return a repair
error without changing the file. Before the first successful change, copy the
original to `hooks.json.bak.<UTC timestamp>`. Merge arrays instead of replacing
the `hooks` object. Write the merged JSON to a sibling temporary file and
rename it over the original.

Do not auto-trust hooks and do not call Codex with
`--dangerously-bypass-hook-trust`.

- [ ] **Step 5: Implement owned-only removal.**

Walk every event array. Remove only command handlers whose command contains
`--codex-halo`. Keep empty unrelated matcher groups valid JSON. Remove the
helper and state directory only after config removal succeeds.

- [ ] **Step 6: Run tests and commit.**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml hooks::tests
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: PASS. Commit:

```bash
git add src-tauri/src/lib.rs src-tauri/src/hooks.rs src-tauri/src/main.rs
git commit -m "feat: safely install Codex lifecycle hooks"
```

---

### Task 6: Finish native windows, tray controls, settings, and persistence

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/platform.rs`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src/index.html`
- Modify: `src/settings.html`
- Modify: `src/styles.css`
- Modify: `src/app.js`
- Create: `src/settings.js`
- Create: `src-tauri/icons/icon.png`
- Modify: `README.md`

**Interfaces:**
- `AppSettings` persists `enabled`, `opacity`, `offset_x`, `offset_y`,
  `curve_id`, `particle_count`, `trail_span`, `duration_ms`,
  `pulse_duration_ms`, `rotation_duration_ms`, `stroke_width`, and
  `start_at_login`.
- Tauri commands return `Result<T, String>` and never panic on user-config
  errors.
- Tray actions call the same commands as settings controls.

- [ ] **Step 1: Add platform window behavior.**

Create the overlay with logical size `112 x 112`, transparent decorations,
always-on-top, skip-taskbar, no shadow, and `set_ignore_cursor_events(true)`.
Position it at the configured offsets on the primary monitor. Use the Tauri
window APIs for common behavior and `cfg(target_os = "macos")` /
`cfg(target_os = "windows")` only for display coordinate and autostart
differences.

- [ ] **Step 2: Add single-instance and tray/menu-bar behavior.**

Create a tray icon with these actions:

- Open Settings;
- Enable/disable overlay;
- Install/repair Codex hooks;
- Remove Codex Halo hooks;
- Simulate the six states;
- Reset position;
- Quit.

The second process must not create a second overlay. It should request the
first process to show settings, then exit.

- [ ] **Step 3: Add settings persistence.**

Store settings as JSON in the Tauri app config directory. Load defaults when
missing. Reject non-finite numeric values, clamp opacity to `0.1..1.0`, clamp
offsets to signed `2000px`, particle count to `24..140`, trail span to
`0.12..0.68`, and stroke width to `2.5..7.5`.

Write settings atomically. A corrupt settings file is renamed to a timestamped
`.invalid` file and replaced with defaults; the app stays usable.

- [ ] **Step 4: Add start-at-login.**

On macOS, create/remove a user LaunchAgent entry. On Windows, create/remove
the current-user `Run` registry value. Use the installed executable path only;
never write a system-wide entry. Report permission or registry errors in the
settings status line and keep the overlay running.

- [ ] **Step 5: Wire settings controls and hook status.**

`settings.js` must:

1. load `get_settings` and `get_hook_status`;
2. update values through `save_settings` on input/change;
3. call install/remove commands and refresh status;
4. call `simulate_state` for test buttons;
5. render the read-only formula from `formatFormula`;
6. show only state names, timestamps, and setup errors in diagnostics.

Do not display prompt, transcript, tool, model, or path content.

- [ ] **Step 6: Perform local UI checks.**

Run:

```bash
cargo tauri dev
```

Check on macOS:

- overlay is visible and transparent;
- clicks pass through it;
- tray/menu-bar opens settings;
- all six simulated states morph;
- curve and numeric controls update the renderer;
- reset position restores the spec offsets;
- closing settings leaves the overlay running.

Commit:

```bash
git add README.md src src-tauri
git commit -m "feat: add Codex Halo native controls"
```

---

### Task 7: Integrate real Codex events and verify packaging boundaries

**Files:**
- Modify: `README.md`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/hooks.rs`
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- The installed hook commands point to the bundled helper at the stable
  app-data path and pass `--state-dir` explicitly.
- The app reports hook status independently from display state.
- Verification output records platform, app version, hook file path, and test
  result without recording event payload content.

- [ ] **Step 1: Test idempotent installation against a copied user config.**

Create a temporary `CODEX_HOME` with unrelated hooks, run the app's install
command twice, then remove the owned hooks. Compare parsed JSON before and
after and assert the unrelated handler remains unchanged.

- [ ] **Step 2: Test all hook transitions with stdin fixtures.**

For each event, pipe a minimal JSON object to `codex-halo-hook`, read the
snapshot, and query `get_display_state`. Assert the state sequence:

```text
idle -> thinking -> executing -> input_needed -> compacting
      -> thinking -> completed -> idle
```

Use a separate session id in the second sequence and assert the reducer does
not overwrite the first session's snapshot.

- [ ] **Step 3: Run one actual local Codex turn on macOS.**

After the user reviews/trusts the new hooks in Codex, run a small turn that
invokes a local tool and an approval path. Record only:

- whether the hook ran;
- observed halo state names;
- last event timestamp;
- whether Codex behavior was unchanged.

Do not copy the transcript or prompt into the repository or diagnostics.

- [ ] **Step 4: Build the macOS bundle.**

Run:

```bash
cargo tauri build --target aarch64-apple-darwin
```

Expected: a launchable macOS bundle and a bundled hook helper. Record the
artifact path and exact command output in the final verification note.

- [ ] **Step 5: Run the Windows build on Windows or configured CI.**

On a Windows x86_64 runner with the MSVC toolchain, run:

```powershell
cargo tauri build --target x86_64-pc-windows-msvc
```

Verify:

- `.exe` helper path in installed hook commands;
- transparent click-through window;
- tray icon and menu;
- current-user autostart;
- actual Codex hook state transitions.

Mark Windows checks `NOT RUN` when no Windows runner exists. Do not call a
source compile on macOS Windows validation.

- [ ] **Step 6: Run the final checks and commit the verification note.**

Run:

```bash
node scripts/check-renderer.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo test --manifest-path src-tauri/Cargo.toml --bin codex-halo-hook
git diff --check
git status --short
```

Review untracked files explicitly; `git diff --check` does not inspect them.
Commit only source, tests, docs, manifests, and verified icons. Do not stage
local state, settings, tokens, transcripts, or generated build output.

---

## Plan Self-Review

- Spec scope covered: overlay behavior (Tasks 1 and 6), six states and morph
  timing (Task 2), four curve profiles and formulas (Task 2), user-level Codex
  hooks (Tasks 4, 5, and 7), multi-session reduction (Task 3), settings/tray
  controls (Task 6), privacy and error rules (Tasks 4-6), and macOS/Windows
  verification boundaries (Task 7).
- No task reads or stores prompt, transcript, tool, model, or token content.
- No task modifies `ChatGPT.app`.
- All public names used by each task are defined in an earlier task or in the
  same task's Interfaces block.
- `completed` expiry is `3_000ms`; other-state expiry is `60_000ms`; both match
  the spec exactly.
- The only deliberate simplification is the `150ms` directory scan. The
  upgrade condition is recorded in the spec's `ponytail:` comment.
