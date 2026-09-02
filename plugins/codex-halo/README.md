# Codex Halo Plugin

This package registers Codex lifecycle hooks for the Codex Halo desktop app.

## Local setup

1. Install and start the Codex Halo desktop app.
   The app installs the native helper under `CODEX_HOME/codex-halo`.
2. Add this plugin through a local or team Codex marketplace.
3. Enable the plugin and review its hooks in `/hooks` once.
4. Start a new Codex session.

If an older manual hook install is still present, remove its Codex Halo entries from
the native app's legacy compatibility control after enabling this Plugin.

The hooks write only hashed session state, state names, and timestamps under
`CODEX_HOME/codex-halo/state`. Prompts, transcripts, tool inputs, model names,
and paths are not stored.

The Tauri app remains responsible for the overlay, tray, settings, and state
display. This Plugin only replaces manual user-level hook installation.
