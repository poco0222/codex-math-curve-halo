# Codex Halo Plugin

This package registers Codex lifecycle hooks for the Codex Halo desktop app.

## Setup

1. Install and start the Codex Halo desktop app.
   The app installs the native helper under `CODEX_HOME/codex-halo`.
2. Click **Install Plugin** in the app Settings window or tray menu.
3. Review and trust the Plugin hooks in `/hooks` once.
4. Start a new Codex session.

The app performs a one-time, backup-preserving cleanup of old Codex Halo entries
from `~/.codex/hooks.json` during installation. Other hooks are left unchanged.

Click **Uninstall Plugin** in the app to remove this Plugin and its marketplace
registration. The native app and helper remain installed.

The hooks write only hashed session state, state names, and timestamps under
`CODEX_HOME/codex-halo/state`. Prompts, transcripts, tool inputs, model names,
and paths are not stored.

The Tauri app remains responsible for the overlay, tray, settings, and state
display. This Plugin owns the lifecycle hook definition.
