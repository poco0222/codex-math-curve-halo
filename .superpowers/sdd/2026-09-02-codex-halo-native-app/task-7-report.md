# Task 7 Report: Codex Event Integration and Packaging Verification

Date: 2026-09-02
Base: `32d3b21`

## Status

Local macOS ARM64 integration and packaging checks passed. Windows MSVC and a
real live Codex turn are `NOT RUN` under the stated environment boundary.

## Task 7 Changes

- Added `src-tauri/tests/task7_integration.rs`, a dependency-free Rust
  integration test.
- Updated `README.md` with the stable app-data helper path, explicit
  `--state-dir` behavior, macOS package command, and Windows evidence boundary.
- Existing `src-tauri/src/main.rs`, `src-tauri/src/hooks.rs`, and
  `src-tauri/tauri.conf.json` already matched the approved Task 7 interfaces;
  no production change was needed in those files.
- Added no network, Web deployment, database, `ChatGPT.app` access, or hook
  trust bypass.

## Isolated Hook Installation

Command:

```bash
TASK7_HELPER="$PWD/src-tauri/binaries/codex-halo-hook-aarch64-apple-darwin" \
  cargo test --manifest-path src-tauri/Cargo.toml \
  --test task7_integration -- --nocapture
```

Result:

```text
task7 metadata: platform=macos-aarch64 hook_file=/var/folders/_h/ryqldvf154d0dc3_qs0mjlrr0000gp/T/codex-halo-task7-76457-1788342125346956000/codex-home/hooks.json
test task7_installs_twice_preserves_unrelated_hooks_and_reduces_helper_events ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

The test sets `CODEX_HOME` only inside its own test process and restores it.
It uses a temporary `codex-home/hooks.json`, an unrelated command handler, and
a copied helper at the stable app-data path. It then:

- installs hooks twice;
- parses both results and confirms the unrelated handler is unchanged;
- confirms all eight owned commands contain `--codex-halo`, the copied helper
  path, and explicit `--state-dir`;
- confirms `HookStatus::Installed` remains independent of display snapshots;
- runs the eight event transitions with minimal stdin fixtures;
- confirms snapshots contain only `session_key`, `state`, and
  `updated_at_ms`;
- confirms a second session remains independent while the first is completed;
- removes the owned handlers and confirms the unrelated handler remains;
- removes local helper/state artifacts and confirms `HookStatus::Missing`.

The real `~/.codex/hooks.json` was not read or modified.

## Packaged Helper and State Sequence

The macOS bundle helper was run from:

```text
/Users/PopoY/Documents/Projects/codex-math-curve-halo/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Codex Halo.app/Contents/MacOS/codex-halo-hook
```

Minimal stdin probes returned `{}` and empty stderr for every mapped event:

```text
SessionStart: state=idle timestamp=present
UserPromptSubmit: state=thinking timestamp=present
PreToolUse: state=executing timestamp=present
PermissionRequest: state=input_needed timestamp=present
PreCompact: state=compacting timestamp=present
PostCompact: state=thinking timestamp=present
Stop: state=completed timestamp=present
SessionEnd: state=idle timestamp=0 (empty snapshot directory)
mode=100755 path=/Users/PopoY/Documents/Projects/codex-math-curve-halo/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Codex Halo.app/Contents/MacOS/codex-halo-hook
```

The integration test also passed with that bundle helper through `TASK7_HELPER`.
The reducer result for two simultaneous sessions preserved both snapshots and
selected the expected state by the existing priority rules.

## Sidecar and Bundle

Command:

```bash
npm run build:sidecar -- --target aarch64-apple-darwin
```

Exact result:

```text
> build:sidecar
> node scripts/build-sidecar.mjs --target aarch64-apple-darwin
Finished `release` profile [optimized] target(s) in 2.20s
```

Command:

```bash
cargo tauri build --target aarch64-apple-darwin
```

Exact final bundle output:

```text
Info Looking up installed tauri packages to check mismatched versions...
Warn The bundle identifier "com.codex-halo.app" set in `"tauri.conf.json" identifier` ends with `.app`. This is not recommended because it conflicts with the application bundle extension on macOS.
Running beforeBuildCommand `npm run build:sidecar`
Finished `release` profile [optimized] target(s) in 20.23s
Built application at: /Users/PopoY/Documents/Projects/codex-math-curve-halo/src-tauri/target/aarch64-apple-darwin/release/codex-halo
Bundling Codex Halo.app (/Users/PopoY/Documents/Projects/codex-math-curve-halo/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Codex Halo.app)
Bundling Codex Halo_0.1.0_aarch64.dmg (/Users/PopoY/Documents/Projects/codex-math-curve-halo/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Codex Halo_0.1.0_aarch64.dmg)
Running bundle_dmg.sh
Finished 2 bundles at:
    /Users/PopoY/Documents/Projects/codex-math-curve-halo/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Codex Halo.app
    /Users/PopoY/Documents/Projects/codex-math-curve-halo/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Codex Halo_0.1.0_aarch64.dmg
```

Bundle checks:

- `Info.plist` reports `CFBundleShortVersionString` and `CFBundleVersion` as
  `0.1.0` and identifier `com.codex-halo.app`.
- The bundle contains `Contents/MacOS/codex-halo-hook`, a Mach-O ARM64 helper
  with mode `100755`.
- `tauri.conf.json` keeps `bundle.externalBin` as
  `["binaries/codex-halo-hook"]`; Tauri emits the runtime helper beside
  the main executable with the stable non-suffixed name.
- The runtime helper lookup uses the same stable non-Windows name.

Isolated bundle runtime was started with temporary `HOME` and `CODEX_HOME`.
The app created only its isolated app-data helper and settings files. A second
launch exposed one `Codex Halo Settings` window and did not create a second
overlay process. Accessibility exposed the window title but not webview
diagnostic text; no stronger GUI state claim is made.

## Final Checks

Passed:

```text
node scripts/check-renderer.mjs
renderer self-check: PASS (4 profiles)

node --test src/app.test.mjs scripts/build-sidecar.test.mjs
8 passed; 0 failed

cargo test --manifest-path src-tauri/Cargo.toml --lib
46 passed; 0 failed

cargo test --manifest-path src-tauri/Cargo.toml --bin codex-halo-hook
5 passed; 0 failed

cargo test --manifest-path src-tauri/Cargo.toml
46 lib + 13 main + 5 helper + 1 integration passed; 0 doc-test failures

cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
PASS

python3 -m json.tool package.json
python3 -m json.tool src-tauri/tauri.conf.json
python3 -m json.tool src-tauri/capabilities/default.json
PASS

git diff --check
PASS
```

The existing source tests also cover hook merge/removal, status validation,
strict snapshot fields, state priority, expiry, settings, and platform safety.

## Windows Boundary

`NOT RUN`:

- Windows x86_64 MSVC build and runtime.
- `.exe` helper execution under Windows `cmd.exe`/PowerShell.
- Windows transparent click-through window, tray, current-user autostart, and
  live hook transitions.

Host/toolchain evidence only:

```text
host: aarch64-apple-darwin
installed targets:
aarch64-apple-darwin
x86_64-pc-windows-gnu
Windows MSVC target: not installed
Windows runner shell: absent
```

No macOS GNU cross-compilation was used as Windows evidence.

## Live Codex Boundary

`NOT RUN`: no live Codex turn was started. The user has not explicitly
reviewed/trusted the temporary hooks for a real Codex session, and no
network/paid Codex turn was run. Automated evidence stops at isolated hook
fixtures, helper output, snapshot parsing, and reducer behavior.

No prompt, transcript, tool, model, token, or event payload content was written
to this report, test output, app diagnostics, or committed files.

## Untracked Review

Kept out of the Task 7 commit:

- existing `.comet/config.yaml`, `.impeccable/config.json`, and
  `docs/openspec/config.yaml`;
- generated `src-tauri/Cargo.lock` and `src-tauri/gen/`;
- ignored `src-tauri/target/` and target-suffixed generated sidecars.

Only Task 7 README, integration test, and report are intended for staging.
