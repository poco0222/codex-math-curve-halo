# Curve Profiles

## Requirement: Built-in curve catalog

The application SHALL expose exactly these 20 built-in curve profiles, in this order:

1. `original-thinking` — Original Thinking
2. `thinking-five` — Thinking Five
3. `thinking-nine` — Thinking Nine
4. `rose-orbit` — Rose Orbit
5. `rose-curve` — Rose Curve
6. `rose-two` — Rose Two
7. `rose-three` — Rose Three
8. `rose-four` — Rose Four
9. `lissajous-drift` — Lissajous Drift
10. `lemniscate-bloom` — Lemniscate Bloom
11. `hypotrochoid-loop` — Hypotrochoid Loop
12. `three-petal-spiral` — Three-Petal Spiral
13. `four-petal-spiral` — Four-Petal Spiral
14. `five-petal-spiral` — Five-Petal Spiral
15. `six-petal-spiral` — Six-Petal Spiral
16. `butterfly-phase` — Butterfly Phase
17. `cardioid-glow` — Cardioid Glow
18. `cardioid-heart` — Cardioid Heart
19. `heart-wave` — Heart Wave
20. `spiral-search` — Spiral Search

### Scenario: Select a built-in profile

- **WHEN** the Appearance view is opened
- **THEN** the curve selector contains exactly the 20 IDs and labels above in the same order
- **AND** `fourier-flow` is absent
- **AND** the active formula output describes the selected profile

## Requirement: Curve geometry

Each profile SHALL implement the existing `point(progress, detailScale, settings)` and `rotate(progress)` interfaces. Path `progress` includes both endpoints in `[0,1]`; particle progress wraps within one cycle. `detailScale` SHALL remain finite in `[0,1]`, and each point SHALL use the existing 100x100 logical coordinate system.

The geometry SHALL follow the corresponding public definitions in upstream commit `70f4e00a6d452532039ff7c2ccb4c379ec90c772` of `main.js`. The project may freeze the upstream geometry parameters in profile code because curve-specific fields are outside the existing persisted settings contract.

Let `p` be path progress in `[0,1]`, `t=2πp`, and `s` be the project's existing pulse value in `[0,1]`. The following fixed defaults define the full catalog geometry:

| Profiles | Coordinates and parameters |
| --- | --- |
| Original Thinking / Thinking Five / Thinking Nine | `k=7/5/9`, `x=50+3.9(7cos t-3s cos kt)`, `y=50+3.9(7sin t-3s sin kt)` |
| Rose Orbit | `r=7-2.7s cos 7t`, `(x,y)=(50,50)+3.9r(cos t,sin t)` |
| Rose Curve / Rose Two / Rose Three / Rose Four | `k=5/2/3/4`, `r=(9.2+0.6s)(0.72+0.28s)cos kt`, `(x,y)=(50,50)+3.25r(cos t,sin t)` |
| Lissajous Drift | `a=24+6s`, `x=50+a sin(3t+1.57)`, `y=50+0.92a sin 4t` |
| Lemniscate Bloom | `a=20+7s`, `d=1+sin²t`, `x=50+a cos t/d`, `y=50+a sin t cos t/d` |
| Hypotrochoid Loop | `R=8.2`, `r=2.7+0.45s`, `d=4.8+1.2s`, `k=(R-r)/r`, `x=50+3.05((R-r)cos t+d cos kt)`, `y=50+3.05((R-r)sin t-d sin kt)` |
| Three/Four/Five/Six-Petal Spiral | `R=3/4/5/6`, `r=1`, `d=3+0.25s`, `m=2.2+0.45s`, `k=R-1`, `x=50+m((R-1)cos t+d cos kt)`, `y=50+m((R-1)sin t-d sin kt)` |
| Butterfly Phase | `u=12πp`, `B=exp(cos u)-2cos 4u-sin(u/12)^5`, `m=4.6+0.45s`, `(x,y)=(50,50)+mB(sin u,cos u)` |
| Cardioid Glow | `r=(8.4+0.8s)(1-cos t)`, `(x,y)=(50,50)+2.15r(cos t,sin t)` |
| Cardioid Heart | `r=(8.8+0.8s)(1+cos t)`, `x=50-2.15r sin t`, `y=50-2.15r cos t` |
| Heart Wave | `u=-√3.3+2p√3.3`, `f=abs(u)^(2/3)+0.9√max(0,3.3-u²)sin(6.4πu)`, `x=50+23.2u`, `y=18+(1.75-f)(24.5+1.5s)` |
| Spiral Search | `r=8+(1-cos t)(8.5+2.4s)`, `(x,y)=(50,50)+r(cos 4t,sin 4t)` |

The first eight profiles and the four Petal Spiral profiles rotate in the upstream negative-angle direction, with the project's existing speed and rotation factors. The remaining profiles do not rotate. Whole paths SHALL be sampled in their original order from `p=0` through `p=1`; non-closed paths SHALL not gain a segment between the endpoints. Only particle progress wraps to the next cycle. Formula output SHALL include the selected profile's coordinates, parameters, and pulse definition.

### Scenario: Render every profile

- **WHEN** each profile is sampled at 128 points with `detailScale` values `0`, `0.5`, and `1`
- **THEN** every point has finite `x` and `y` values
- **AND** every point remains within the existing validation bounds `[-20,120]` on both axes
- **AND** the profile has a non-empty formula

## Requirement: Default and compatibility

The default `curve_id` SHALL be `original-thinking`. Native settings normalization SHALL map unknown and removed IDs (`rose-seven` and `fourier-flow`) to `original-thinking`; the retained target IDs `lissajous-drift` and `spiral-search` SHALL remain valid without adding a new AppSettings field.

### Scenario: Load legacy settings

- **WHEN** a persisted settings file contains a removed or unknown `curve_id`
- **THEN** the native settings value returned to both windows is `original-thinking`
- **AND** saving the normalized settings writes the new ID
- **WHEN** a persisted settings file contains `lissajous-drift` or `spiral-search`
- **THEN** that curve ID remains unchanged

## Requirement: Existing animation contract

The renderer SHALL keep the existing particle trail, state-specific style, color transition, generic timing controls, settings Store/Bridge, Tauri commands/events, and seven-state color contract. No curve-specific controls or persistence fields SHALL be added in this change.

### Scenario: Change profile without changing global settings

- **WHEN** the user selects any of the 20 profiles
- **THEN** the existing auto-save path persists only `curve_id` and current generic settings
- **AND** particle count, trail span, durations, stroke width, state colors, and cross-window synchronization keep their existing behavior
