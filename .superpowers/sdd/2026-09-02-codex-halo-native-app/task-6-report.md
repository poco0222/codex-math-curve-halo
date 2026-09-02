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
