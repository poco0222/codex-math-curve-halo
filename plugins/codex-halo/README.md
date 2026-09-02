# Codex Halo Plugin

This package registers Codex lifecycle hooks for the Codex Halo desktop app.

## Local setup

1. Install and start the Codex Halo desktop app.
2. Build the helper for the current target from the repository root:

   ```bash
   npm run build:plugin -- --target aarch64-apple-darwin
   ```

3. Add this plugin through a local Codex marketplace.
4. Enable the plugin and review its hooks in `/hooks` once.
5. Start a new Codex session.

The hooks write only hashed session state, state names, and timestamps under
`CODEX_HOME/codex-halo/state`. Prompts, transcripts, tool inputs, model names,
and paths are not stored.

The Tauri app remains responsible for the overlay, tray, settings, and state
display. This Plugin only replaces manual user-level hook installation.
