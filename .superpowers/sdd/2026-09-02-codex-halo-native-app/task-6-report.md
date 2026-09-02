# Task 6 Report

Date: 2026-09-02
Base commit: `a281d57`
Commit message: `feat: add Codex Halo native controls`

## Status

Task 6 is implemented in the requested repository. The native shell now has a
persisted settings contract, overlay event wiring, settings controls, tray
actions, single-instance behavior, user-level autostart integration, and a
usable tray icon.

The two carried fixes are included:

- simulator/display events invalidate older in-flight poll responses;
- empty `--state-dir ""` is rejected by the hook helper argument boundary.

## Implementation

- `AppSettings` now owns all 12 persisted fields in `src-tauri/src/state.rs`.
- Settings are normalized at the Rust boundary. Non-finite floating-point
  values are rejected. Opacity, offsets, particle count, trail span, and stroke
  width use the required bounds.
- Settings are stored in the Tauri app config directory as `settings.json`.
  Missing files receive defaults. Invalid files are renamed to a timestamped
  `.invalid` file and replaced with defaults. Writes use a same-directory
  temporary file and atomic replacement, including the Windows replacement
  path.
- The overlay loads persisted settings, reacts to `settings-changed`, remains
  transparent and click-through, and is positioned from the primary monitor.
- The settings window loads and saves every control, renders the active formula,
  refreshes hook status, exposes reset and simulation actions, and limits
  diagnostics to state names, timestamps, and setup errors.
- Tray actions cover settings, enable/disable, hook install/remove, all six
  simulation states, reset position, and quit. They use the same Rust command
  functions as the settings bridge.
- The existing single-instance plugin focuses settings on a second launch.
- The existing autostart plugin is used through `platform.rs`; it writes the
  user LaunchAgent on macOS and the current-user Run value on Windows.
- `src-tauri/icons/icon.png` is now a transparent 64x64 halo icon.
- `README.md` documents local run, hook trust/removal, privacy, and attribution.

## Verification

Passed:

- `cargo test --manifest-path src-tauri/Cargo.toml`: `45 + 9 + 5` tests passed.
- `node --test src/app.test.mjs scripts/build-sidecar.test.mjs`: `3` tests passed.
- `node --check src/app.js`
- `node --check src/settings.js`
- `npm run check:renderer`: `PASS (4 profiles)`.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `python3 -m json.tool src-tauri/tauri.conf.json`
- `python3 -m json.tool src-tauri/capabilities/default.json`
- `git diff --check`
- PNG type/size check: `64 x 64`, RGBA.

Focused RED/GREEN evidence:

- The simulator race test first failed because `createDisplayStateBridge` did
  not exist, then passed after the bridge was implemented.
- The settings normalization tests first failed because the new settings fields
  did not exist, then passed after the full `AppSettings` contract was added.
- The empty state-directory test first failed because an empty value was
  accepted, then passed after the helper boundary rejected it.

## macOS Evidence

`cargo tauri dev` built and launched the app. The latest compiled binary was
also started directly for deterministic window checks.

Observed through macOS accessibility inspection:

- one `Codex Halo` overlay window at `112 x 112`;
- position `2420,1188`, matching a `2560 x 1440` primary display with the
  required `28px` right and `140px` bottom offsets;
- a second process produced `Codex Halo Settings` and did not create a second
  overlay;
- no app process was left running after the checks.

Not fully verified through interactive UI automation:

- visual transparency and click-through behavior;
- tray menu item activation;
- visible morphs for all six simulation states;
- changing numeric controls and confirming the live renderer;
- reset-position action through the visible tray/settings control;
- closing settings while visually observing the overlay.

The settings window was confirmed to exist and become visible through the
single-instance path. The remaining items need a human desktop pass.

## Windows and Codex Runtime Boundaries

Windows full runtime remains unverified, as required. A cross-target sidecar
attempt was made with:

```bash
npm run build:sidecar -- --target x86_64-pc-windows-gnu
```

It stopped because this host does not have
`x86_64-w64-mingw32-dlltool`. This is toolchain evidence, not Windows build or
runtime evidence.

Actual `cmd.exe`/PowerShell hook execution, live Windows tray/window behavior,
and a live Codex integration remain unverified. The app did not access or
modify `ChatGPT.app` or private desktop-app data.

## Repository State

Only Task 6 source, UI, configuration, icon, README, and focused test files are
included in the commit. Cargo/Tauri generated `Cargo.lock` and `src-tauri/gen`
files were removed from the working tree and are not part of the change.

## Fix Round 1/5 Evidence

Date: 2026-09-02
Original commit: `e8a505a`

All five blocking findings were addressed in this fix round.

1. Simulator state now has a `420ms` hold. Scheduled `150ms` polls cannot
   overwrite it during the renderer morph window. A real display event clears
   the hold, and an explicit superseding poll remains available. The
   deterministic test covers simulate -> next scheduled poll -> end of morph
   window.
2. The settings window intercepts `CloseRequested`, calls
   `api.prevent_close()`, and hides the existing window. It can be reopened by
   tray Open Settings or the single-instance callback.
3. Settings/autostart writes now use a transaction helper. Autostart changes
   are rolled back when `settings.json` writing fails; rollback failure returns
   the fixed `start-at-login:reconciliation` category. Windows disable first
   checks `is_enabled()` and treats an absent Run value as already disabled.
4. Autostart failures use fixed categories: `permission`, `launch-agent`,
   `registry`, `unsupported`, and `reconciliation`. `settings.js` renders only
   the category, never the raw OS error, path, or payload.
5. The overlay starts with native visibility false. The renderer applies
   persisted settings, starts, and then calls `set_overlay_visible`; disabled
   startup keeps the native window hidden and does not render a visible first
   frame.

Focused RED/GREEN evidence:

- The simulator hold test first failed because
  `showSimulatedDisplayState` was absent, then passed.
- The close/reopen source check first failed because no close handler existed,
  then passed after the hide handler was added.
- The persistence transaction tests first failed because
  `save_settings_transaction` was absent, then passed with rollback and
  reconciliation cases.
- The autostart category test first failed because `AutostartError` was absent,
  then passed with fixed redacted categories.
- The startup visibility source check first failed because `set_overlay_visible`
  was absent, then passed after hidden-first startup wiring.

Fix-round verification:

- `cargo test --manifest-path src-tauri/Cargo.toml`: `46 + 11 + 5` tests passed.
- `node --test src/app.test.mjs scripts/build-sidecar.test.mjs`: `8` tests
  passed.
- `node --check src/app.js`
- `node --check src/settings.js`
- `npm run check:renderer`: `PASS (4 profiles)`.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `python3 -m json.tool src-tauri/tauri.conf.json`
- `python3 -m json.tool src-tauri/capabilities/default.json`
- `git diff --check`
- `cargo build --manifest-path src-tauri/Cargo.toml`: passed.

Fix-round macOS runtime evidence:

- Latest compiled binary showed `Codex Halo Settings` after a second launch.
- Command-W closed settings while preserving the single `Codex Halo` overlay.
- A third launch showed `Codex Halo Settings` again, proving reopen behavior.
- An isolated HOME with persisted `enabled:false` produced zero windows after
  startup, proving the native overlay stayed hidden.

Environment boundaries:

- Windows runtime: `NOT RUN`.
- Windows cross-target sidecar build: `NOT RUN` because the host lacks
  `x86_64-w64-mingw32-dlltool`.
- Actual Windows Registry/LaunchAgent execution and live Codex integration:
  `NOT RUN`.
- The no-op `tauri-build` features edit was not touched in this fix round.

## Fix Round 2/5 Evidence

Date: 2026-09-02
Base commit: `fc67838`

The remaining partial-autostart failure hole is closed. When the autostart
operation changes native state and then returns an error, the transaction now
attempts to restore `current.start_at_login`. A successful reconciliation
returns the original fixed redacted autostart category. A failed
reconciliation returns `start-at-login:reconciliation`. The settings write is
not attempted on this error path. The existing settings-write rollback path
is unchanged.

Focused RED/GREEN evidence:

- `settings_transaction_reconciles_autostart_error_before_writing_settings`
  first failed because the transaction returned on the initial autostart
  error; it then passed with a stub that mutates native state, returns
  `start-at-login:registry`, and succeeds when restoring the current value.
- `settings_transaction_reports_initial_autostart_reconciliation_failure`
  covers the same mutating error with a failed restore and passes with the
  stable `start-at-login:reconciliation` category.
- The regression asserts native autostart ends at the current value and the
  settings write is not committed.

Verification:

- Focused Rust tests: `4` passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: `46 + 13 + 5` tests
  passed; doc-tests had `0` tests.
- `cargo check --manifest-path src-tauri/Cargo.toml`: passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: passed.
- `git diff --check`: passed.
- JavaScript tests: `NOT RUN`; no JavaScript files were affected.

Residual gap: Windows and live macOS autostart runtime behavior remain
unverified on this host boundary, as recorded above. This round adds unit
evidence for the dependency partial-failure contract but does not exercise the
native OS APIs.
