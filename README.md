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

Hold `Command` on macOS or `Ctrl` on Windows and drag the halo with the left
mouse button to move it. Releasing either the button or modifier saves the
position. **Reset position** in Settings or the tray restores the default.

## System audio visualization

In **Halo → Audio visualization**, enable **System audio**
to animate the current curve from your default sound output. Bass scales the
curve; mids change particle speed; highs add bounded detail. **Intensity** is
0-100% (50% by default). At 0%, the level meter still shows the input.

Capture is off by default. It uses Core Audio taps on macOS 14.2+ and WASAPI
loopback on Windows 10 version 1703+ / Windows 11. Allow system audio capture
when macOS asks. If access is denied, follow the permission help in settings
and retry. Other output devices and protected audio may not be captured.

Audio stays in memory on this device; Halo does not record or upload it.
Hiding the overlay or enabling Reduce Motion pauses capture. Showing the
overlay again resumes an enabled capture; silence and interrupted input
smoothly return the curve to its normal animation.

Windows capture is implemented, but Windows runtime acceptance is deferred
until a Windows test environment is available. macOS checks do not establish
Windows runtime behavior.

## Follow Codex lifecycle

Enable **Follow Codex lifecycle** to let the native app manage the bundled
`codex-halo-watch` watcher for Codex CLI and desktop app processes:

- The watcher uses one combined active set for all supported Codex CLI and
  desktop app processes. Halo stays active while any supported Codex process
  exists and the automatically managed Halo exits only after all supported
  Codex processes exit, including mixed CLI and desktop runs.
- Desktop app sessions do not change this process-level rule; only the desktop
  app process affects the active set.
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

**Uninstall Plugin** removes `codex-halo`, the legacy `codex-halo@personal`
installation identity, and this app's marketplace registration. It does not
remove the native app, its helper, the `personal` marketplace, or unrelated
hooks. During Plugin installation, an existing Codex Halo legacy entry in
`~/.codex/hooks.json` is removed once, with a backup; unrelated entries stay
unchanged.

The Plugin helper uses the shared `CODEX_HOME/codex-halo/state` directory. Codex
may require the user to review and trust new or changed hooks. Installing a
Plugin never auto-trusts them.

The owned lifecycle hooks run synchronously so state changes keep Codex event
order. `PostToolUse` maps back to `thinking`; `Interrupt` maps to
`interrupted`; `Stop` maps to `completed`. `SessionStart` with
`source: "compact"` maps to `thinking`; the source field is not stored. State
simulation uses the Rust reducer and does not add to the real session count.

## Multiple sessions

Each main session has one bright core and fading trail on the selected curve.
Its subagents appear as color segments inside that same trail, sharing its
motion without adding separate cores. The head shows the parent state; each
embedded segment uses its subagent's configured state color. Independent main
sessions remain separate, including when their states match. Color changes
transition smoothly; reduced motion keeps a static multicolor view.
The **Glow** switch under Appearance adds an optional outer glow. It is off by
default, including for older settings, and your choice saves automatically.

Thinking, executing, compacting, and input-needed sessions retain their last
reported state without a 60-second timeout. Completed and interrupted states
last three seconds; idle lasts 60 seconds. A parent that finishes before its
children keeps its trail and last-known head state while child states remain
valid. A completed child leaves only its own color segment. Parent `SessionEnd`
removes the existing snapshots for that family, leaving other families intact.
Each Halo launch starts idle and accepts only events timestamped after that
launch. Older snapshots stay on disk but do not restore trails; a task already
running must emit another event to appear. These are last-known states, not a
liveness check: a missing end event can still leave a trail until Halo restarts.

Coverage includes sessions that emit this plugin's hooks under the same
`CODEX_HOME`. `SubagentStart` and `SubagentStop` require `agent_id` and use
`session_id` to identify the parent. They report activity (`thinking`) and stop
feedback (`completed`); finer states require events explicitly carrying the
subagent identity. Events without that identity retain session-level semantics.
Halo does not infer an agent from transcript content or tool timing. When only
a child's snapshot is available, the family uses an idle-colored parent head.
The session count is the number of represented main-session families, not the
number of agents. Dense trails preserve child records but may not be readable
individually at small sizes. Missing or late events remain a source limitation;
snapshot cleanup is not a liveness or event-order guarantee.

## Settings and diagnostics

Settings has two pages: **Halo** and **Connection & runtime**. Halo keeps the
local sample preview, state selection, and color editing together. Opacity and
Glow are immediately available; geometry, animation, and the read-only formula
sit in expandable sections. Browsing the curve gallery does not save a choice;
Apply loads the selected curve's geometry and animation defaults. Edits save
automatically, with a retry action on failure.

After loading a curve, one restoration can recover the previous curve and six
animation values while preserving current colors, opacity, Glow, audio, position,
language, and runtime settings. A later load replaces that restoration point;
hiding the window or accepting an external change to those parameters clears it.
There is no persistent preset history.

Local sample states never replace real desktop task states. **Connection & runtime
→ Advanced diagnostics → Desktop test** retains the explicit desktop simulation;
new real events can override it. A successful test does not prove plugin
connectivity, and no new event does not mean a disconnected plugin. The connection
page provides setup guidance, existing install/uninstall actions, and the last
known event.

Settings includes a local **Export diagnostics** control. It downloads
`codex-halo-diagnostics.json` with only the current state name and timestamp;
no prompt, transcript, tool, model, or path data is exported.

On Windows, start-at-login writes a quoted current executable path to the
current-user `Run` registry value. Windows runtime and registry checks still
require a Windows runner.

Windows packaging and native runtime checks require a Windows x86_64 MSVC
runner. macOS checks do not establish Windows runtime behavior.

## Privacy

The hook helper reads `session_id`, optional `agent_id`, and the lifecycle event
name, plus optional `source` to identify a compact session start. Snapshots store
only hashed identities (including a child's parent association), state names,
and timestamps. Prompts, transcripts, tool data, model names, paths,
network data, telemetry, and cloud sync are not used.

## Attribution

The curve and particle concepts are independently re-expressed from the
project references `claude-halo` and `math-curve-loaders`; no source files are
copied here.
