# Codex Halo Native App Design

**Date:** 2026-09-02  
**Status:** Design approved in chat; awaiting spec review  
**Target:** macOS and Windows desktop companion app

## 1. Scope

Codex Halo is a small native companion app for the ChatGPT desktop app's Codex
runtime. It shows Codex activity as a quiet, animated mathematical halo near
the lower-right of the primary display.

The app is independent from `ChatGPT.app`. It does not inject into, patch, or
read private data from the ChatGPT application.

### Goals

- Provide a visible peripheral signal for Codex lifecycle state.
- Run as a background tray/menu-bar app on macOS and Windows.
- Use Codex lifecycle hooks as the event source.
- Combine the halo window behavior from `claude-halo` with the curve and
  particle ideas from `math-curve-loaders`.
- Keep the data path local and content-free.
- Make the first release usable without an active Codex session through state
  simulation.

### Non-goals

- Web deployment or a browser gallery.
- Reimplementing the ChatGPT desktop app.
- Reading prompts, assistant responses, transcripts, source code, tokens, or
  model output.
- Controlling Codex, approving tools, rewriting hooks, or changing permission
  behavior.
- Linux support in the first release.
- Code signing, notarization, or an auto-update service in the first release.

## 2. Product Behavior

### Overlay

- One transparent, frameless window.
- Logical size: `112px x 112px`; scale with the platform device-pixel ratio.
- Always on top, excluded from the taskbar/dock, and mouse-transparent by
  default.
- Default position: `28px` from the right and `140px` from the bottom of the
  primary display, matching the source app's low-distraction placement.
- Position, opacity, and enabled state are stored in local app settings.
- The overlay has no visible text. Status details are available from the tray
  or menu-bar item and the settings window.

### States

| State | Color | Motion | Meaning |
| --- | --- | --- | --- |
| `idle` | `#A7ADB5` | Slow rotation, low alpha | No active turn |
| `thinking` | `#FF8A3D` | Warm breathing pulse | Codex is forming a response |
| `executing` | `#339CFF` | Fast rotation, dense trail | A local tool is running |
| `input_needed` | `#F05252` | Noticeable pulse | Codex is waiting for approval/input |
| `completed` | `#35C878` | Soft breathing for 3 seconds | Turn finished |
| `compacting` | `#A56BFF` | Radius pulse | Context compaction is running |

State changes morph over `420ms`. A completed state is held for `3s` unless a
new event arrives. Unknown or malformed states are ignored and do not block
Codex.

### Curve profiles

The default profile is a seven-petal custom rose trail, chosen as the Codex
identity mark for the first release. The settings window also exposes four
small built-in profiles:

- `Rose Seven`
- `Lissajous Drift`
- `Spiral Search`
- `Fourier Flow`

Each profile owns a point function and a small parameter set. Shared renderer
controls are particle count, trail span, loop duration, pulse duration,
rotation duration, and stroke width. The settings view shows the active
formula as read-only text; it does not become a code editor or gallery.

## 3. Architecture

### Runtime shape

```text
Codex desktop / Codex CLI
        |
        | user-level ~/.codex/hooks.json
        v
codex-halo-hook helper
        |
        | atomic per-session snapshot, local only
        v
Codex Halo Tauri process
        |
        +--> state reducer and session expiry
        +--> transparent overlay window
        +--> tray/menu-bar controls
        +--> settings window
```

### Technology

- Tauri 2 for the native shell and cross-platform window APIs.
- Rust for lifecycle, tray, hook installation, state reduction, persistence,
  and platform-specific behavior.
- Vanilla JavaScript plus SVG for the renderer. No frontend framework or new
  animation dependency.
- One Tauri codebase with `cfg(target_os = "macos")` and
  `cfg(target_os = "windows")` for platform differences.

The existing `claude-halo` Tauri layout is the starting shape, but the new
implementation will keep only the needed behavior. The curve definitions will
be re-expressed behind one point-function contract instead of copying a large
gallery implementation. Upstream behavior and formulas are references; do not
copy source files or assets unless their distribution license is verified.
Include concise attribution in the project README.

### Proposed file boundaries

```text
src/
  index.html              overlay document
  halo.js                 curve, particle, morph, and canvas/SVG renderer
  app.js                  Tauri event bridge and simulator controls
  settings.html           settings document
  settings.js             settings interactions
  styles.css              shared compact dark UI

src-tauri/
  src/main.rs             app startup, windows, tray, commands
  src/platform.rs         macOS/Windows window and autostart helpers
  src/state.rs            session snapshots and state reducer
  src/hooks.rs            hooks.json merge/install/remove logic
  src/bin/codex-halo-hook.rs
                          stdin event parser and snapshot writer
```

The modules are boundaries, not speculative public APIs. No separate service,
database, or plugin SDK is planned.

## 4. Codex Hook Contract

The app installs owned command hooks in the user-level `~/.codex/hooks.json`.
The installer parses and merges JSON, preserves unrelated hooks, writes an
atomic replacement, and creates a timestamped backup before the first change.

Each installed command contains an absolute helper path and an absolute
`--state-dir` path generated for the current platform. The helper never guesses
the repository root or depends on the current working directory. App updates
replace the helper at that stable app-data path, so the hook definition does
not need to change on every update.

Every owned command is asynchronous where Codex permits it, returns quickly,
and never returns a blocking decision. For `Stop`, where Codex expects JSON on
successful stdout, the helper emits `{}`. Hook failures are best-effort and
must not stop a Codex turn.

### Event mapping

| Codex event | Snapshot action |
| --- | --- |
| `SessionStart` | Register session as `idle`; clear stale prior snapshot |
| `UserPromptSubmit` | Set session to `thinking` |
| `PreToolUse` | Set session to `executing` |
| `PermissionRequest` | Set session to `input_needed` |
| `PreCompact` | Set session to `compacting` |
| `PostCompact` | Set session to `thinking` |
| `Stop` | Set session to `completed` |
| `SessionEnd` | Remove session snapshot |

`PostToolUse`, `PostToolUseFailure`, `SubagentStart`, and `SubagentStop` are
not required for the first state machine. They may be added later if observed
events show a real display gap.

The helper reads only `session_id`, `hook_event_name`, and the event-specific
state needed for mapping. It does not persist `prompt`, `tool_input`,
`tool_response`, `transcript_path`, `cwd`, or `model`.

### Snapshot format

Snapshots live under the platform app-data directory, not the repository and
not the system temporary directory:

```json
{
  "session_key": "sha256(session_id)",
  "state": "executing",
  "updated_at_ms": 1788312345678
}
```

The helper writes a temporary sibling file and renames it into place. The app
polls the directory every `150ms`, reads valid snapshots, and ignores partial,
unknown, or corrupt files.

The helper accepts `--state-dir <path>` and creates the directory if needed.
The app passes the same directory to its reducer. The state directory contains
only snapshots and redacted diagnostic metadata.

### Multi-session reducer

The app keeps one in-memory record per session. Active state selection uses
this priority:

```text
input_needed > compacting > executing > thinking > completed > idle
```

For equal priority, the newest snapshot wins. `completed` expires after `3s`.
Other states expire after `60s` without a fresh snapshot, except
`input_needed`, which remains visible until another event or `SessionEnd`.

This is deliberately a polling scan of a small directory. `ponytail: replace
with filesystem notifications only if profiling shows the 150ms scan is
material on machines with many simultaneous sessions.`

## 5. Installation and Settings

### First launch

1. Start the single-instance app.
2. Create the platform app-data directory and hook helper.
3. Offer `Install Codex hooks` in the settings view.
4. Write only the owned hook entries to `~/.codex/hooks.json`.
5. Show that Codex requires the user to review/trust new or changed hooks.
6. Leave the overlay in `idle` until a trusted hook event arrives.

The app must never auto-trust hooks or pass a hook-trust bypass flag.

### Tray/menu-bar actions

- Open Settings
- Enable/disable overlay
- Install/repair Codex hooks
- Remove Codex Halo hooks
- Simulate each state
- Reset position
- Quit

### Settings

The settings window is a small normal window, not the overlay. It contains:

- Hook connection status and last event time;
- install/repair/remove action;
- curve profile selector;
- shared numeric controls;
- opacity and position controls;
- start-at-login toggle;
- test-state buttons;
- local diagnostic export, limited to state names and timestamps.

No prompt preview, transcript viewer, network account, or cloud sync.

### Uninstall behavior

Removal deletes only entries owned by Codex Halo. It does not replace the
whole `hooks.json` with a backup, because the user may have edited unrelated
hooks after installation. The helper and app-data snapshots are removed after
the config update succeeds.

## 6. Error and Safety Rules

- Missing `~/.codex/hooks.json`: create it with the owned entries.
- Invalid existing JSON: do not overwrite; show repair guidance and keep the
  overlay usable in simulator mode.
- Existing hook with the same owned marker: update it in place.
- Helper cannot write a snapshot: exit `0`, emit `{}`, and log a redacted
  local error.
- App cannot read a snapshot: ignore that file and retain other sessions.
- App starts without hooks: show `idle` plus a disconnected indicator in the
  tray/settings view, never a blocking dialog.
- No network calls, analytics, telemetry, or remote update checks.
- Do not log raw stdin, prompt text, command text, file paths, or transcript
  paths.

## 7. Verification

### Automated checks

- Rust unit tests for state priority, equal-priority recency, expiry, malformed
  snapshots, and completed hold behavior.
- Rust hook fixtures for every mapped event. Assert snapshot contents and
  exact `{}` stdout behavior for `Stop`.
- JSON merge tests for preserving unrelated hooks, idempotent install, and
  owned-entry-only removal.
- A browserless renderer self-check that evaluates every curve profile at
  finite sample points and rejects NaN/infinite coordinates.
- `git diff --check` plus explicit review of untracked files.

### Manual checks

- macOS: transparent overlay, mouse passthrough, menu-bar/tray behavior,
  display positioning, start-at-login, and an actual Codex turn.
- Windows: transparent overlay, click-through, tray behavior, positioning,
  start-at-login, and an actual Codex turn.
- Exercise all six simulated states and verify visible morphs.
- Confirm unrelated Codex hooks remain byte-for-byte semantically intact after
  install and removal.
- Confirm no prompt or transcript content appears in app-data or logs.

The current development host is macOS ARM64 and does not have `cargo` or
`rustc`. Tauri compilation therefore requires a user-local Rust toolchain or a
provided build environment. Windows compilation must be performed on Windows
or in a configured Windows CI runner; a macOS source check is not evidence of
Windows runtime correctness.

## 8. Acceptance Criteria

The first release is accepted when:

1. macOS and Windows builds produce launchable Tauri apps from the same source
   tree.
2. The overlay is transparent, click-through, and visible without a Codex
   session.
3. Simulator controls demonstrate all six states and curve changes.
4. Trusted Codex hook events drive the matching states without changing Codex
   behavior.
5. Multiple sessions do not overwrite one another.
6. Hook install/remove preserves unrelated user configuration.
7. No prompt, transcript, tool, token, or model content is stored.
8. Verification results clearly separate local macOS evidence from Windows
   build/runtime evidence.

## References

- `claude-halo`: status-driven transparent Tauri overlay and state animation
  behavior.
- `math-curve-loaders`: mathematical curve point functions, particle trails,
  and formula-backed parameters.
- OpenAI Codex Hooks documentation:
  `https://learn.chatgpt.com/docs/hooks.md`
- OpenAI Codex advanced configuration:
  `https://developers.openai.com/codex/config-advanced.md`
