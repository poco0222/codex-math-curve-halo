# Codex Halo Settings Workbench Design

## Design Read

This is an operational Tauri desktop settings tool for frequent users. The design uses a quiet control-room Web language: dense enough to scan, restrained in color, and clear about state and save feedback.

`DESIGN_VARIANCE: 4`
`MOTION_INTENSITY: 2`
`VISUAL_DENSITY: 6`

## Context

The current page already runs in a Tauri WebView with native HTML, CSS, and JavaScript. It has strict section mounting, a shared `settingsModel`, automatic saving, localized text, and six state colors. The current color interaction exposes one active editor through horizontal state tabs. That preserves data safely, but makes comparison and future state-level settings awkward.

Future work will add default display position and audio linkage. The settings architecture therefore needs an explicit extension boundary without forcing a framework migration or changing the native settings contract in this change.

## Goals

- Make the page feel like a small Web settings application.
- Make common settings easy to find and compare.
- Replace color tabs with a Master-Detail state editor.
- Keep automatic saving, localization, accessibility, Plugin actions, diagnostics, simulation, and Tauri IPC behavior.
- Let future Views and state-level detail sections reuse the same state, save, error, and bridge paths.

## Non-goals

- No React, Vue, Router, or new UI dependency.
- No new `AppSettings` fields in this change.
- No implementation of default position or audio linkage.
- No new window, live Halo preview, or settings database.
- No change to existing command names, event names, JSON shape, or native validation.

## Architecture

### App Shell

`src/settings.html` owns the stable shell:

- sidebar navigation
- global Overlay toggle
- language selector
- save status
- one `#settings-panel-host`
- View templates

Only the active View is mounted. The DOM remains the source of focus order. CSS must not visually reorder controls against the DOM.

Top-level Views:

```text
Appearance
State colors
Integration
Test
```

`Appearance` contains the existing Display and Renderer groups. Future `Position` or `Audio` Views can be added without changing the shell contract.

### Controller and View Registry

`src/settings.js` remains the entry point and controller. It owns View selection, lifecycle binding, localization refresh, and calls into the store and bridge.

Views are registered with a small literal registry containing:

- View ID
- template ID
- label key
- mount/bind function

No generic schema engine. Field bindings stay explicit and readable.

### Shared state

Separate two concerns:

- `settingsModel`: complete `AppSettings` values, including unmounted fields and inactive state colors.
- `uiState`: active View, selected state, save status, setup error, diagnostics snapshot, and in-flight Plugin operation.

The store exposes small operations: replace settings, merge settings, patch one setting, select View, select state, and enqueue save. It does not know DOM details.

### Tauri Bridge

Tauri calls and event subscriptions are kept behind one bridge boundary. The bridge translates `invoke` results and event payloads into controller/store events. UI renderers do not need to know whether a value came from initial load, automatic save, or a `settings-changed` event.

The bridge remains compatible with the current commands and events:

- `get_settings`
- `save_settings`
- `reset_position`
- `simulate_state`
- `install_plugin`
- `uninstall_plugin`
- `get_display_state`
- `settings-changed`
- `plugin-operation`

Future native commands or fields are separate changes. This change only creates the frontend boundary that can receive them cleanly.

## State colors interaction

Desktop uses a two-column Master-Detail layout:

```text
state list  |  selected state detail
```

Each state row contains a swatch, localized label, and current Hex value. The selected row has a clear accent treatment and keyboard focus. The detail panel contains the existing color picker, Hex input, reset action, and collapsed preset palette.

Only one detail editor is mounted. This keeps the existing data-loss protection while improving comparison. On narrow screens, rows stack above the detail panel. No document-level horizontal scrolling.

The detail panel is the extension point for future state-level settings. Audio linkage and state-specific animation can appear below the color controls without creating a second navigation pattern.

## Data flow

```text
Tauri invoke/event
        |
        v
     Bridge
        |
        v
      Store <---- user input from active View
        |
        +--> serialized save
        |
        v
     Renderer
```

External settings payloads merge into `settingsModel`. The active field remains protected while the user edits it. Unmounted fields never disappear from a save payload.

## Visual system

- Keep the graphite dark base and warm orange accent.
- Use one restrained radius scale, no more than `8px` for panels.
- Use borders, spacing, and typography for hierarchy.
- Avoid gradients, large shadows, decorative dots, and unnecessary motion.
- Keep controls native and stable in size.
- Use native `details` for advanced or infrequent options.

The page should feel deliberate through spacing and hierarchy, not decoration.

## Error and feedback behavior

- Automatic save remains the primary save path.
- Save status remains visible in the shell.
- Save failures remain in diagnostics with safe formatted errors.
- Invalid Hex remains local to the active editor and does not trigger a save.
- Plugin operations remain serialized and disabled while in flight.
- Remounting a View must reapply in-flight UI state.

## Verification

Focused checks:

- `node --check src/settings.js`
- `node --test src/app.test.mjs scripts/*.test.mjs`
- `npm run check:settings-tabs`
- `node scripts/check-renderer.mjs`
- `git diff --check`

Browser checks must cover desktop and narrow layouts, `en` and `zh-CN`, keyboard navigation, state selection, Hex validation, color persistence across View switches, automatic save feedback, no document overflow, and no console errors.

Real Tauri IPC, Plugin installation, and Windows runtime behavior remain outside static browser verification and must be reported separately.
