# Codex Halo

[简体中文](README.zh-CN.md)

Codex Halo is a small Tauri desktop companion for showing Codex lifecycle
states as a transparent, click-through mathematical halo.

The settings window supports `English` and `简体中文`, defaults to `English`,
and stores the selection in local app settings.

## Run locally

Requirements: Rust, Cargo, Node.js, and the Tauri CLI.

```bash
npm run build:sidecar
cargo tauri dev
```

The app starts with an idle overlay and a hidden settings window. Open settings
from the tray or menu bar. Settings are stored as JSON in the Tauri app config
directory.

## Follow Codex lifecycle

Enable **Follow Codex lifecycle** to let the native app manage the bundled
`codex-halo-watch` watcher for Codex CLI and desktop app processes:

- For the CLI, Halo remains active while at least one Codex CLI process exists;
  after the last CLI process exits, the automatically started Halo exits.
- For the desktop app, Halo follows the app process lifetime, not individual
  internal sessions; it exits when the desktop app process exits.
- The watcher closes only Halo instances it started. A manually started Halo
  remains running.

`start_at_login` is independent: it controls whether the native app starts at
login and does not control Codex lifecycle following.

For a macOS package build, generate the target-suffixed helper and bundle with:

```bash
cargo tauri build --target aarch64-apple-darwin
```

## Codex Plugin

Install and start the native app once. In the app Settings window or tray menu,
click **Install Plugin**. The app registers its bundled local marketplace and
installs/enables `codex-halo` through the Codex CLI. Review and trust its hooks
once in `/hooks`, then start a new Codex session.

**Uninstall Plugin** removes only `codex-halo` and its marketplace registration.
It does not remove the native app, its helper, or unrelated hooks. During Plugin
installation, an existing Codex Halo legacy entry in `~/.codex/hooks.json` is
removed once, with a backup; unrelated entries stay unchanged.

The Plugin helper uses the shared `CODEX_HOME/codex-halo/state` directory. Codex
may require the user to review and trust new or changed hooks. Installing a
Plugin never auto-trusts them.

The owned `SessionStart`, `Stop`, and `SessionEnd` hooks run synchronously so
state changes keep Codex event order. `SessionStart` with `source: "compact"`
maps to `thinking`; the source field is not stored. State simulation uses the
Rust reducer and does not add to the real session count.

## Settings and diagnostics

Settings includes a local **Export diagnostics** control. It downloads
`codex-halo-diagnostics.json` with only the current state name and timestamp;
no prompt, transcript, tool, model, or path data is exported.

On Windows, start-at-login writes a quoted current executable path to the
current-user `Run` registry value. Windows runtime and registry checks still
require a Windows runner.

Windows packaging and native runtime checks require a Windows x86_64 MSVC
runner. macOS checks do not establish Windows runtime behavior.

## Privacy

The hook helper reads `session_id` and the lifecycle event name from hook input,
plus the optional `source` field in `SessionStart` input to identify
`source: "compact"`. It stores only a hash of the session identifier, state
names, and timestamps. Prompts, transcripts, tool data, model names, paths,
network data, telemetry, and cloud sync are not used.

## Attribution

The curve and particle concepts are independently re-expressed from the
project references `claude-halo` and `math-curve-loaders`; no source files are
copied here.
