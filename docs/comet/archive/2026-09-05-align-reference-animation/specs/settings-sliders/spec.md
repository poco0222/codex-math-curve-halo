# Settings Sliders

## Purpose

Appearance 页使用原生 range slider 调整所有连续数字设置，同时保留离散选择和只读公式的语义。

## Controls

| Setting | Control | Min | Max | Step | Display |
| --- | --- | ---: | ---: | ---: | --- |
| `opacity` | `input[type="range"]` | 0.1 | 1 | 0.01 | percent, rounded to whole percent |
| `offset_x` | `input[type="range"]` | -2000 | 2000 | 1 | integer |
| `offset_y` | `input[type="range"]` | -2000 | 2000 | 1 | integer |
| `particle_count` | `input[type="range"]` | 24 | 140 | 1 | integer |
| `trail_span` | `input[type="range"]` | 0.12 | 0.68 | 0.01 | two decimal places |
| `duration_ms` | `input[type="range"]` | 500 | 12000 | 1 | integer with `ms` unit |
| `pulse_duration_ms` | `input[type="range"]` | 500 | 10000 | 1 | integer with `ms` unit |
| `rotation_duration_ms` | `input[type="range"]` | 500 | 60000 | 1 | integer with `ms` unit |
| `stroke_width` | `input[type="range"]` | 1.0 | 7.5 | 0.1 | one decimal place |

`curve_id` remains a native `select`. `formula` remains a read-only `output`. Selecting a curve loads its six reference animation values; sliders save actual overrides without sentinel values. A localized current-curve reset restores those six values only. See Curve Profiles for the preset catalog and compatibility rules.

## Behavior

### Scenario: Numeric fields are sliders

- GIVEN the Appearance view is mounted
- WHEN the view is inspected
- THEN each listed numeric setting has an associated label and `input[type="range"]` with the specified `min`, `max`, and `step`
- AND `curve_id` remains a `select`
- AND `formula` remains read-only

### Scenario: Slider values are readable and editable

- GIVEN a listed slider has focus
- WHEN the user drags it or uses the native arrow keys
- THEN the setting model receives a finite number
- AND the associated output displays the value using the field's required precision
- AND the label, slider, and output remain programmatically associated

### Scenario: External settings stay synchronized

- GIVEN Appearance is mounted or an external `settings-changed` payload arrives
- WHEN the payload contains valid settings
- THEN every mounted slider and output reflects the payload
- AND the existing local-edit preservation behavior remains intact

### Scenario: Native bounds reject invalid values

- GIVEN a settings payload contains a value outside a declared slider range or a non-finite numeric duration
- WHEN native normalization runs
- THEN the resulting settings are finite and inside the declared range
- AND the renderer does not receive an invalid value

### Scenario: Existing persistence and layout remain stable

- GIVEN the user changes any listed slider
- WHEN the existing save path completes
- THEN settings continue to synchronize to both windows and save failures use the existing safe status/error path
- AND the Appearance layout remains usable at its existing responsive breakpoints without overflow

## Accessibility

- Every slider has a visible `label` connected by `for`/`id`.
- Every value output is associated with its slider using `for` and has a stable, readable text value.
- Native slider keyboard behavior and existing `:focus-visible` styling remain enabled.
- Dynamic value text must fit within its parent and must not overlap neighboring controls.

## Non-goals

- No custom slider library.
- No change to color editing, localization architecture or integration actions.
