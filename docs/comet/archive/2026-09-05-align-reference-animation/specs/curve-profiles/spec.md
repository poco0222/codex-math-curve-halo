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

Let `p` be path progress in `[0,1]`, `t=2πp`, and `s` be the animated detail value in `[0.52,1]`. The following fixed defaults define the full catalog geometry:

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

The first eight profiles and the four Petal Spiral profiles rotate in the upstream negative-angle direction, using the selected reference rotation duration without state speed multipliers. The remaining profiles do not rotate. Whole paths SHALL be sampled in their original order from `p=0` through `p=1`; non-closed paths SHALL not gain a segment between the endpoints. Only particle progress wraps to the next cycle. Formula output SHALL include the selected profile's coordinates, parameters, and pulse definition.

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

## Requirement: Reference animation

Every profile SHALL carry the gallery defaults from upstream `70f4e00`:

| Profile | Particles | Trail | Loop ms | Pulse ms | Rotation ms | Stroke |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| original-thinking | 64 | 0.38 | 4600 | 4200 | 28000 | 5.5 |
| thinking-five | 62 | 0.38 | 4600 | 4200 | 28000 | 5.5 |
| thinking-nine | 68 | 0.39 | 4700 | 4200 | 30000 | 5.5 |
| rose-orbit | 72 | 0.42 | 5200 | 4600 | 28000 | 5.2 |
| rose-curve | 78 | 0.32 | 5400 | 4600 | 28000 | 4.5 |
| rose-two | 74 | 0.30 | 5200 | 4300 | 28000 | 4.6 |
| rose-three | 76 | 0.31 | 5300 | 4400 | 28000 | 4.6 |
| rose-four | 78 | 0.32 | 5400 | 4500 | 28000 | 4.6 |
| lissajous-drift | 68 | 0.34 | 6000 | 5400 | 36000 | 4.7 |
| lemniscate-bloom | 70 | 0.40 | 5600 | 5000 | 34000 | 4.8 |
| hypotrochoid-loop | 82 | 0.46 | 7600 | 6200 | 42000 | 4.6 |
| three-petal-spiral | 82 | 0.34 | 4600 | 4200 | 28000 | 4.4 |
| four-petal-spiral | 84 | 0.34 | 4600 | 4200 | 28000 | 4.4 |
| five-petal-spiral | 85 | 0.34 | 4600 | 4200 | 28000 | 4.4 |
| six-petal-spiral | 86 | 0.34 | 4600 | 4200 | 28000 | 4.4 |
| butterfly-phase | 88 | 0.32 | 9000 | 7000 | 50000 | 4.4 |
| cardioid-glow | 72 | 0.36 | 6200 | 5200 | 36000 | 4.9 |
| cardioid-heart | 74 | 0.36 | 6200 | 5200 | 36000 | 4.9 |
| heart-wave | 104 | 0.18 | 8400 | 5600 | 22000 | 3.9 |
| spiral-search | 86 | 0.28 | 7800 | 6800 | 44000 | 4.3 |

Each renderer starts with one uniformly random phase offset `f in [0,1)`, shared by its loop, pulse and rotation phases. Tests may inject `phaseOffset`. For uninterrupted constant settings, phases are `f + elapsed / duration` modulo one. Pulse detail is `0.52 + (sin(2*pi*pulsePhase+0.55)+1)*0.24`.

The Canvas renderer SHALL draw one path at alpha `0.1`, then exactly the configured particles in upstream head-to-tail order. Particle `i` uses `u=i/(count-1)`, wrapped progress `loopPhase-u*trail`, fade `(1-u)^0.56`, radius `0.9+2.7*fade`, and alpha `0.04+0.96*fade`. No extra head or shadow layers apply. The gallery is the visual baseline; the enlarged viewer's additional radius multiplier is excluded.

### Scenario: Match reference motion

- **WHEN** each curve runs with its reference parameters and a fixed phase at elapsed times 0, 1234 and 65000 ms
- **THEN** path endpoints, particle positions, radii, alpha, order, count and line width match the upstream gallery at the same phase
- **AND** the seven states do not alter reference speed, pulse, particle size or alpha

### Scenario: Preserve animation phase

- **WHEN** durations are edited or states change during a long-running animation
- **THEN** existing motion phases remain continuous and subsequent frames use the new durations
- **WHEN** the renderer stops or is disabled
- **THEN** paused time does not accumulate motion
- **AND** non-rotating profiles do not accumulate rotation

## Requirement: Settings and Halo integration

The existing numeric fields contain actual render values, with no special default-number sentinel. Choosing a curve in Appearance loads its six reference animation values and saves them alongside `curve_id`. Adjusting a slider directly overrides the active value; overrides survive saving, remount and restart. Choosing another preset loads that preset's values. A localized reset action restores only the current curve's animation values, preserving colors, opacity, position and integration settings.

A renderer without supplied numeric settings uses the selected profile's reference values. Finite overrides are clamped to the combined old/reference bounds specified by Settings Sliders; non-finite values fall back to the selected profile defaults.

Native normalization upgrades the complete old animation tuple `80,0.4,500,1200,3000,4` to the selected curve defaults. Any tuple differing in at least one field is preserved within the combined bounds. This exact legacy tuple is reserved for compatibility because no version or override metadata is added. The upgrade is idempotent and preserves other fields.

Seven state colors, `420ms` linear color transitions, global opacity, enable switch, Store/Bridge, commands and events remain. Reduced-motion preference holds geometry and particle positions while keeping color state feedback.

### Scenario: Use and override a preset

- **WHEN** the user selects Heart Wave
- **THEN** controls and the save payload contain 104 particles, trail 0.18, loop 8400, pulse 5600, rotation 22000 and stroke 3.9
- **WHEN** particles are changed to 64, loop to 4600 and stroke to 5.5
- **THEN** those exact values render and survive a remount and reload
- **WHEN** the current-curve reset action is used
- **THEN** only its six animation values return to the reference values

### Scenario: Upgrade existing settings

- **WHEN** existing settings contain the complete old default animation tuple
- **THEN** normalization adopts the selected curve's reference tuple, keeps other settings and remains stable on another load
- **WHEN** any of the six old animation values was customized
- **THEN** valid custom values remain unchanged

### Scenario: Preserve Halo controls

- **WHEN** the state changes with custom state colors
- **THEN** the new color is reached after 420 ms and motion stays continuous
- **WHEN** global opacity or enabled changes
- **THEN** opacity and visibility still apply
- **WHEN** reduced motion is requested
- **THEN** positions remain still while colors can transition
