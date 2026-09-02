# Codex Halo Plugin Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Codex Halo's normal user-level hook installation flow with a bundled Codex Plugin while preserving the Tauri overlay and retaining a safe legacy fallback.

**Architecture:** The Plugin owns the lifecycle hook manifest and invokes a portable launcher from `${PLUGIN_ROOT}`. The launcher delegates to the native helper in `CODEX_HOME/codex-halo`, so the app can start independently of Plugin environment variables and the Plugin package stays platform-neutral. Existing `hooks.json` installation remains available only for migration and compatibility.

**Tech Stack:** Rust 2021, Tauri 2, vanilla JavaScript, Node.js scripts, JSON Plugin manifest and hook configuration.

**Spec:** `docs/superpowers/specs/2026-09-02-codex-halo-native-app-design.md` plus the approved Plugin migration scope in the conversation.

## Global Constraints

- Keep the current six Halo states and eight mapped Codex lifecycle events.
- Keep hook commands synchronous and return `{}` on stdout.
- Persist only hashed session state, state names, and timestamps.
- Preserve unrelated user hook handlers during legacy migration/removal.
- Never auto-trust hooks or use a hook-trust bypass flag.
- Do not add MCP, `app-server`, a new frontend framework, or a new persistence service.
- Keep the Tauri app, overlay, tray, settings, reducer, and simulator behavior intact.
- Do not commit generated `target/` or platform packaging binaries unless already tracked by the repository policy.

### Task 1: Define shared runtime paths

**Files:**
- Modify: `src-tauri/src/hooks.rs`
- Modify: `src-tauri/src/main.rs`
- Test: `src-tauri/src/hooks.rs` and `src-tauri/src/main.rs` unit tests

**Interfaces:**
- Add `hooks::runtime_root() -> Result<PathBuf, HookError>` returning `codex_home()/codex-halo`.
- Add `hooks::runtime_state_dir() -> Result<PathBuf, HookError>` returning `runtime_root()/state`.
- Add `hooks::runtime_helper_path() -> Result<PathBuf, HookError>` returning `runtime_root()/helper_filename()`.
- Keep existing explicit-path install functions unchanged for legacy compatibility.

- [ ] **Step 1: Write failing tests**

  Assert `CODEX_HOME=/tmp/codex-home` resolves the helper and state paths under `/tmp/codex-home/codex-halo`, and that missing home still returns the existing safe error.

- [ ] **Step 2: Run the focused Rust tests and verify they fail**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml runtime_`

  Expected: FAIL because the shared path functions do not exist.

- [ ] **Step 3: Implement the minimum path helpers**

  Reuse `codex_home()` and the existing platform-specific helper filename. Do not duplicate environment lookup logic.

- [ ] **Step 4: Update native app scanning and startup helper installation**

  Make the Plugin path the primary runtime path. Keep the current app-data path available to legacy commands until migration is complete.

- [ ] **Step 5: Run focused and full Rust tests**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 6: Commit**

  ```bash
  git add src-tauri/src/hooks.rs src-tauri/src/main.rs
  git commit -m "refactor: add shared Codex Halo plugin runtime paths"
  ```

### Task 2: Add the Plugin hook package

**Files:**
- Create: `plugins/codex-halo/.codex-plugin/plugin.json`
- Create: `plugins/codex-halo/hooks/hooks.json`
- Create: `plugins/codex-halo/hooks/run-helper.sh`
- Create: `plugins/codex-halo/hooks/run-helper.ps1`
- Test: `scripts/plugin-package.test.mjs`

**Interfaces:**
- Plugin name: `codex-halo`.
- Hook command: `sh ${PLUGIN_ROOT}/hooks/run-helper.sh` on POSIX and the equivalent PowerShell launcher through `commandWindows` on Windows.
- The launcher delegates to the native helper at `CODEX_HOME/codex-halo`; a missing helper returns `{}` without blocking the Codex turn.
- The helper defaults to `hooks::runtime_state_dir()` when `--state-dir` is omitted; explicit `--state-dir` remains for tests and legacy callers.

- [ ] **Step 1: Write a failing package contract test**

  Load the manifest and hook JSON. Assert the manifest identity, default hook path, all eight event names, synchronous handlers, and absence of `mcpServers` and `apps`.

- [ ] **Step 2: Run the test and verify it fails**

  Run: `node --test scripts/plugin-package.test.mjs`

  Expected: FAIL because the Plugin files do not exist.

- [ ] **Step 3: Create the minimal manifest and hook map**

  Use the repository icon only after copying it inside the Plugin root. Keep the default `hooks/hooks.json` discovery path; omit the manifest `hooks` field to remain compatible with the local validator.

- [ ] **Step 4: Run the package contract test**

  Run: `node --test scripts/plugin-package.test.mjs`

- [ ] **Step 5: Validate the manifest**

  Run: `python3 /Users/PopoY/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/codex-halo`

- [ ] **Step 6: Commit**

  ```bash
  git add plugins/codex-halo scripts/plugin-package.test.mjs
  git commit -m "feat: add Codex Halo plugin hook package"
  ```

### Task 3: Keep native helper packaging separate

**Files:**
- Keep: `scripts/build-sidecar.mjs`
- Keep: `scripts/build-sidecar.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- The existing Tauri sidecar build remains the only native helper build pipeline.
- The Plugin package contains only portable text launchers; platform binaries stay in the Tauri app bundle and runtime directory.

- [x] **Step 1: Keep the native build pipeline Tauri-owned**

  `build:sidecar` continues to produce the helper bundled by the native app. No second Plugin binary pipeline is needed.

- [x] **Step 2: Keep generated Plugin binary paths out of the repository**

  Local helper outputs under `plugins/codex-halo/bin/` remain ignored; the committed Plugin uses the launchers instead.

- [x] **Step 3: Run the sidecar script checks**

  Run: `npm run test:build-sidecar`

### Task 4: Switch the native app to Plugin-first runtime

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/hook_protocol.rs`
- Modify: `src-tauri/src/hooks.rs`
- Modify: `src/settings.html`
- Modify: `src/settings.js`
- Modify: `src/app.test.mjs`
- Test: existing Rust helper and integration tests

**Interfaces:**
- Plugin runtime state is read from `hooks::runtime_state_dir()`.
- Legacy `install_hooks`, `remove_hooks`, and `get_hook_status` remain callable but are labeled/treated as compatibility operations.
- Normal settings flow no longer invokes `install_hooks` automatically.

- [ ] **Step 1: Write failing source-contract tests**

  Assert the app uses the shared runtime state path for display scans, startup installs the helper there, and settings labels expose Plugin-first wording while retaining legacy controls.

- [ ] **Step 2: Run focused tests and verify failure**

  Run: `node --test src/app.test.mjs`

- [ ] **Step 3: Implement Plugin-first path use**

  Reuse the existing snapshot reader and reducer. Keep simulator behavior unchanged.

- [ ] **Step 4: Update settings wording and status handling**

  Show the Plugin-managed banner as the primary integration state. Keep legacy install/remove only as a compatibility section; do not add new commands.

- [ ] **Step 5: Run all existing checks**

  Run: `npm run check:renderer && npm run test:build-sidecar && node --test src/app.test.mjs && cargo test --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 6: Commit**

  ```bash
  git add src-tauri/src/main.rs src-tauri/src/hook_protocol.rs src-tauri/src/hooks.rs src/settings.html src/settings.js src/app.test.mjs
  git commit -m "feat: make Codex Halo Plugin hooks the primary integration"
  ```

### Task 5: Add legacy migration and end-to-end package verification

**Files:**
- Modify: `src-tauri/src/hooks.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/tests/task7_integration.rs`
- Modify: `README.md`
- Create: `plugins/codex-halo/README.md`

**Interfaces:**
- Migration removes only handlers containing the existing `--codex-halo` marker.
- Unrelated hook handlers remain unchanged.
- Plugin helper events produce the same content-free snapshots and reducer states as the legacy helper.

- [ ] **Step 1: Add failing migration/integration coverage**

  Cover old owned handlers, unrelated handlers, two sessions, all eight events, and absence of prompt/tool/model/path fields in snapshots.

- [ ] **Step 2: Run the focused integration test and verify failure**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml task7`

- [ ] **Step 3: Implement migration using existing ownership predicates**

  Do not replace the whole user `hooks.json` and do not auto-trust anything.

- [ ] **Step 4: Build the local Plugin helper and run it with isolated `CODEX_HOME`**

  Exercise `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PreCompact`, `PostCompact`, `Stop`, and `SessionEnd`.

- [ ] **Step 5: Validate package and repository state**

  Run:

  ```bash
  npm run check:renderer
  npm run test:build-sidecar
  node --test scripts/plugin-package.test.mjs src/app.test.mjs
  cargo test --manifest-path src-tauri/Cargo.toml
  git diff --check
  git status --short --branch
  ```

- [ ] **Step 6: Update docs with the new user flow and limitations**

  Explain: install app, install/enable Plugin, review/trust once, start a new Codex session. Keep the legacy hook path documented as compatibility fallback.

- [ ] **Step 7: Commit**

  ```bash
  git add src-tauri/src/hooks.rs src-tauri/src/main.rs src-tauri/tests/task7_integration.rs README.md plugins/codex-halo/README.md
  git commit -m "docs: document Codex Halo plugin migration"
  ```
