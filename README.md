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

For a macOS package build, generate the target-suffixed helper and bundle with:

```bash
cargo tauri build --target aarch64-apple-darwin
```

## Codex Plugin hooks

The preferred setup is the `codex-halo` Plugin. Install and start the native
app once, add the Plugin through a local or team marketplace, enable it,
review/trust its hooks once in `/hooks`, and start a new Codex session. The
native app installs the helper under `CODEX_HOME/codex-halo`; the Plugin owns
the lifecycle hook definition while the Tauri app keeps the overlay, tray,
settings, and reducer.

The legacy **Install legacy hooks** control remains available for existing installs and
migration. After enabling the Plugin, use **Remove legacy hooks** once when an older
manual install is still present; it preserves unrelated entries in
`~/.codex/hooks.json`.

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
