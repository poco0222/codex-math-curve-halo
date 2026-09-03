# State Color Configuration

## Requirements

### Requirement: Persist independent state colors

`AppSettings` SHALL persist one color for each existing state: `idle`,
`thinking`, `executing`, `input_needed`, `completed`, and `compacting`.
The wire fields SHALL be named `<state>_color` and contain canonical
`#RRGGBB` values.

Missing color fields in an older `settings.json` SHALL use the current renderer
defaults:

- `idle_color`: `#A7ADB5`
- `thinking_color`: `#FF8A3D`
- `executing_color`: `#339CFF`
- `input_needed_color`: `#F05252`
- `completed_color`: `#35C878`
- `compacting_color`: `#A56BFF`

When an older file is loaded, the normalized complete settings object SHALL be
written back so the persisted contract contains all six color fields.

Invalid color values SHALL fail the save before the settings file is written.
Loading a damaged settings file SHALL use the existing settings recovery path.
Six-digit hexadecimal input is case-insensitive; persisted values are
uppercase.

Acceptance coverage: A1, A5.

### Requirement: Configure colors from the settings window

The settings window SHALL expose one color picker and one editable hexadecimal
field for each of the six states. Each state control SHALL read and write only
its own `<state>_color` field.

The window SHALL expose all 70 preset colors from the supplied source images,
grouped into the ten source palettes. Each preset SHALL show its exact
hexadecimal value and SHALL be applicable to a selected state with one action.

Custom values SHALL accept only `#RRGGBB` (case-insensitive). Invalid custom
input SHALL be rejected locally and SHALL not enqueue a settings save.

Color changes SHALL use the existing serial save queue and the existing
`settings-changed` event. No second persistence path is allowed.

Acceptance coverage: A2, A3, A5.

### Requirement: Render configured colors

The overlay SHALL use the configured color for the active state in the glow,
strokes, shadow, and particles. A missing or invalid frontend value SHALL fall
back to that state's built-in default and SHALL never produce invalid CSS or
RGB components.

Changing state SHALL preserve the existing state-specific alpha, radius, speed,
rotation, particle, and curve behavior. The existing `420ms` transition SHALL
interpolate from the previous effective color to the next effective color.

Acceptance coverage: A1, A4, A5.

### Requirement: Synchronize both windows

After a successful settings save, the Rust command surface SHALL continue to
emit the complete normalized settings object to both `main` and `settings`.
The overlay SHALL apply color fields without requiring a restart, and the
settings window SHALL reflect changes arriving through `settings-changed`.

Acceptance coverage: A2, A4.

## Source Mapping

The complete source coverage list and the ten image paths are recorded in
`brief.md` under `## Source coverage`. The 70 values map to the preset data in
the settings-window requirement and to acceptance A3.

## Compatibility

The change SHALL use the existing Rust/serde settings contract, vanilla
JavaScript modules, native HTML controls, and existing Tauri commands. No new
runtime dependency, screenshot asset, cloud sync, theme system, or preset
management API is introduced.
