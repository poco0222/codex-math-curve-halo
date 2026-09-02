# Codex Halo

Codex Halo is a small Tauri desktop companion for showing Codex lifecycle
states as a transparent, click-through mathematical halo.

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

## Codex hooks

Use **Install hooks** in settings to add the owned lifecycle commands to the
user-level Codex hooks configuration. Codex may require the user to review and
trust new or changed hooks. **Remove hooks** deletes only Codex Halo entries.
Installed commands call the helper copied to the app-data directory and pass
that app's `state` directory with `--state-dir`; updates replace the helper at
the same path. Installing hooks never auto-trusts them.

Windows packaging and native runtime checks require a Windows x86_64 MSVC
runner. macOS checks do not establish Windows runtime behavior.

## Privacy

The hook helper reads only the session identifier and lifecycle event name. It
stores only hashed session state, state names, and timestamps. Prompts,
transcripts, tool data, model names, paths, network data, telemetry, and cloud
sync are not used.

## Attribution

The curve and particle concepts are independently re-expressed from the
project references `claude-halo` and `math-curve-loaders`; no source files are
copied here.
