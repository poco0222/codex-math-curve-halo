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

The geometry SHALL follow the corresponding public definitions in upstream commit `70f4e00a6d452532039ff7c2ccb4c379ec90c772` of `main.js`. The exposed geometry parameters SHALL be configurable using the preset-specific controls defined below. Unexposed constants stay fixed. Persisted settings extend the current contract only for the selected profile's geometry values.

Let `p` be path progress in `[0,1]`, `t=2πp`, and `s` be the animated detail value in `[0.52,1]`. The following defaults define the full catalog geometry; exposed values may be overridden using the controls below:

| Profiles | Coordinates and parameters |
| --- | --- |
| Original Thinking / Thinking Five / Thinking Nine | `k=7/5/9`, `x=50+3.9(7cos t-3s cos kt)`, `y=50+3.9(7sin t-3s sin kt)` |
| Rose Orbit | `r=7-2.7s cos 7t`, `(x,y)=(50,50)+3.9r(cos t,sin t)` |
| Rose Curve / Rose Two / Rose Three / Rose Four | `k=5/2/3/4`, `r=(9.2+0.6s)(0.72+0.28s)cos kt`, `(x,y)=(50,50)+3.25r(cos t,sin t)` |
| Lissajous Drift | `a=24+6s`, `x=50+a sin(3t+1.57)`, `y=50+0.92a sin 4t` |
| Lemniscate Bloom | `a=20+7s`, `d=1+sin²t`, `x=50+a cos t/d`, `y=50+a sin t cos t/d` |
| Hypotrochoid Loop | `R=8.2`, `r=2.7+0.45s`, `d=4.8+1.2s`, `k=(R-r)/r`, `x=50+3.05((R-r)cos t+d cos kt)`, `y=50+3.05((R-r)sin t-d sin kt)` |
| Three/Four/Five/Six-Petal Spiral | `R=3/4/5/6`, `r=1`, `d=3+0.25s`, `m=2.2+0.45s`, `k=(R-r)/r`, `x=50+m((R-r)cos t+d cos kt)`, `y=50+m((R-r)sin t-d sin kt)` |
| Butterfly Phase | `u=12πp`, `B=exp(cos u)-2cos 4u-sin(u/12)^5`, `m=4.6+0.45s`, `(x,y)=(50,50)+mB(sin u,cos u)` |
| Cardioid Glow | `r=(8.4+0.8s)(1-cos t)`, `(x,y)=(50,50)+2.15r(cos t,sin t)` |
| Cardioid Heart | `r=(8.8+0.8s)(1+cos t)`, `x=50-2.15r sin t`, `y=50-2.15r cos t` |
| Heart Wave | `u=-√3.3+2p√3.3`, `f=abs(u)^(2/3)+0.9√max(0,3.3-u²)sin(6.4πu)`, `x=50+23.2u`, `y=18+(1.75-f)(24.5+1.5s)` |
| Spiral Search | `r=8+(1-cos t)(8.5+2.4s)`, `(x,y)=(50,50)+r(cos 4t,sin 4t)` |

The first eight profiles and the four Petal Spiral profiles rotate in the upstream negative-angle direction, using the selected reference rotation duration without state speed multipliers. The remaining profiles do not rotate. Whole paths SHALL be sampled in their original order from `p=0` through `p=1`; non-closed paths SHALL not gain a segment between the endpoints. Only particle progress wraps to the next cycle. Formula output SHALL include the selected profile's coordinates, parameters, and pulse definition.

### Scenario: Render every profile

- **WHEN** each profile is sampled with default geometry at 128 points with `detailScale` values `0`, `0.5`, and `1`
- **THEN** every point has finite `x` and `y` values
- **AND** every point remains within the existing validation bounds `[-20,120]` on both axes
- **AND** the profile has a non-empty formula

## Requirement: Default and compatibility

本规格仅新增下述专属参数能力；默认动画值、时间单位和现有动画重置语义按当前应用保持。

The default `curve_id` SHALL be `original-thinking`. Native settings normalization SHALL map unknown and removed IDs (`rose-seven` and `fourier-flow`) to `original-thinking`; the retained target IDs `lissajous-drift` and `spiral-search` SHALL remain valid with the same compatibility behavior; an absent geometry-settings field uses the selected profile's defaults.

### Scenario: Load legacy settings

- **WHEN** a persisted settings file contains a removed or unknown `curve_id`
- **THEN** the native settings value returned to both windows is `original-thinking`
- **AND** saving the normalized settings writes the new ID
- **WHEN** a persisted settings file contains `lissajous-drift` or `spiral-search`
- **THEN** that curve ID remains unchanged

## Requirement: Reference animation

Every profile SHALL keep its current Halo animation defaults. Durations derived from upstream `70f4e00` are rounded up to whole seconds and stored in milliseconds:

| Profile | Particles | Trail | Loop ms | Pulse ms | Rotation ms | Stroke |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| original-thinking | 64 | 0.38 | 5000 | 5000 | 28000 | 5.5 |
| thinking-five | 62 | 0.38 | 5000 | 5000 | 28000 | 5.5 |
| thinking-nine | 68 | 0.39 | 5000 | 5000 | 30000 | 5.5 |
| rose-orbit | 72 | 0.42 | 6000 | 5000 | 28000 | 5.2 |
| rose-curve | 78 | 0.32 | 6000 | 5000 | 28000 | 4.5 |
| rose-two | 74 | 0.30 | 6000 | 5000 | 28000 | 4.6 |
| rose-three | 76 | 0.31 | 6000 | 5000 | 28000 | 4.6 |
| rose-four | 78 | 0.32 | 6000 | 5000 | 28000 | 4.6 |
| lissajous-drift | 68 | 0.34 | 6000 | 6000 | 36000 | 4.7 |
| lemniscate-bloom | 70 | 0.40 | 6000 | 5000 | 34000 | 4.8 |
| hypotrochoid-loop | 82 | 0.46 | 8000 | 7000 | 42000 | 4.6 |
| three-petal-spiral | 82 | 0.34 | 5000 | 5000 | 28000 | 4.4 |
| four-petal-spiral | 84 | 0.34 | 5000 | 5000 | 28000 | 4.4 |
| five-petal-spiral | 85 | 0.34 | 5000 | 5000 | 28000 | 4.4 |
| six-petal-spiral | 86 | 0.34 | 5000 | 5000 | 28000 | 4.4 |
| butterfly-phase | 88 | 0.32 | 9000 | 7000 | 50000 | 4.4 |
| cardioid-glow | 72 | 0.36 | 7000 | 6000 | 36000 | 4.9 |
| cardioid-heart | 74 | 0.36 | 7000 | 6000 | 36000 | 4.9 |
| heart-wave | 104 | 0.18 | 9000 | 6000 | 22000 | 3.9 |
| spiral-search | 86 | 0.28 | 8000 | 7000 | 44000 | 4.3 |

Each renderer starts with one uniformly random phase offset `f in [0,1)`, shared by its loop, pulse and rotation phases. Tests may inject `phaseOffset`. For uninterrupted constant settings, phases are `f + elapsed / duration` modulo one. Pulse detail is `0.52 + (sin(2*pi*pulsePhase+0.55)+1)*0.24`.

The Canvas renderer SHALL draw one path at alpha `0.1`, then exactly the configured particles in upstream head-to-tail order. Particle `i` uses `u=i/(count-1)`, wrapped progress `loopPhase-u*trail`, fade `(1-u)^0.56`, radius `0.9+2.7*fade`, and alpha `0.04+0.96*fade`. No extra head or shadow layers apply. The gallery is the visual baseline; the enlarged viewer's additional radius multiplier is excluded.

### Scenario: Match reference motion

- **WHEN** each curve runs with its reference parameters and a fixed phase at elapsed times 0, 1234 and 65000 ms
- **THEN** path endpoints, particle positions, radii, alpha, order, count and line width match the upstream gallery at the same phase
- **AND** comparison uses the same configured durations, including Halo's existing whole-second defaults
- **AND** the seven states do not alter reference speed, pulse, particle size or alpha

### Scenario: Preserve animation phase

- **WHEN** durations are edited or states change during a long-running animation
- **THEN** existing motion phases remain continuous and subsequent frames use the new durations
- **WHEN** the renderer stops or is disabled
- **THEN** paused time does not accumulate motion
- **AND** non-rotating profiles do not accumulate rotation

## Requirement: Settings and Halo integration

The existing numeric fields contain actual render values, with no special default-number sentinel. Choosing a different curve in Appearance loads its six current animation defaults and exposed geometry defaults, saving them alongside `curve_id`. Adjusting a slider directly overrides the active value; overrides survive saving, remount and restart. Choosing another preset loads that preset's values. The existing localized animation reset restores only the current curve's six animation values. A separate localized geometry reset restores only its exposed geometry values. Both preserve colors, opacity, position and integration settings; selecting the already-current curve keeps custom values.

A renderer without supplied numeric settings uses the selected profile's reference values. Finite overrides are clamped to the combined old/reference bounds specified by Settings Sliders; non-finite values fall back to the selected profile defaults.

Native normalization upgrades the complete old animation tuple `80,0.4,500,1200,3000,4` to the selected curve defaults. Any tuple differing in at least one field is preserved within the combined bounds. This exact legacy tuple is reserved for compatibility because no version or override metadata is added. The upgrade is idempotent and preserves other fields.

Seven state colors, `420ms` linear color transitions, global opacity, enable switch, Store/Bridge, commands and events remain. Reduced-motion preference holds geometry and particle positions while keeping color state feedback.

### Scenario: Use and override a preset

- **WHEN** the user selects Heart Wave
- **THEN** controls and the save payload contain 104 particles, trail 0.18, loop 9000, pulse 6000, rotation 22000 and stroke 3.9
- **WHEN** particles are changed to 64, loop to 5000 and stroke to 5.5
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

## Requirement: Preset-specific controls

外观页 SHALL 在现有通用动画设置之后显示当前预设的“曲线参数 / Curve parameters”原生滑块。按下表组内顺序呈现；不适用的控件不得出现。预设数量、ID、名称和顺序保持原目录。

| 组 | 适用预设 | 有序参数键 | 各参数默认值 |
| --- | --- | --- | --- |
| Thinking | original-thinking, thinking-five, thinking-nine | baseRadius, detailAmplitude, petalCount, curveScale | 7, 3, 7/5/9, 3.9 |
| Orbit | rose-orbit | orbitRadius, detailAmplitude, petalCount, curveScale | 7, 2.7, 7, 3.9 |
| Rose | rose-curve | roseA, roseABoost, roseBreathBase, roseBreathBoost, roseK, roseScale | 9.2, 0.6, 0.72, 0.28, 5, 3.25 |
| Fixed Rose | rose-two, rose-three, rose-four | roseA, roseABoost, roseBreathBase, roseBreathBoost, roseScale | 9.2, 0.6, 0.72, 0.28, 3.25 |
| Lissajous | lissajous-drift | lissajousAmp, lissajousAmpBoost, lissajousAX, lissajousBY, lissajousYScale | 24, 6, 3, 4, 0.92 |
| Lemniscate | lemniscate-bloom | lemniscateA, lemniscateBoost | 20, 7 |
| Hypotrochoid | hypotrochoid-loop | spiroR, spiror, spirod, spiroScale | 8.2, 2.7, 4.8, 3.05 |
| Petal Spiral | three-petal-spiral, four-petal-spiral, five-petal-spiral, six-petal-spiral | spiralR, spiralr, spirald, spiralScale, spiralBreath | 3/4/5/6, 1, 3, 2.2, 0.45 |
| Butterfly | butterfly-phase | butterflyTurns, butterflyScale, butterflyPulse, butterflyCosWeight, butterflyPower | 12, 4.6, 0.45, 2, 5 |
| Cardioid | cardioid-glow, cardioid-heart | cardioidA, cardioidPulse, cardioidScale | 8.4/8.8, 0.8, 2.15 |
| Heart Wave | heart-wave | heartWaveB, heartWaveRoot, heartWaveAmp, heartWaveScaleX, heartWaveScaleY | 6.4, 3.3, 0.9, 23.2, 24.5 |
| Search | spiral-search | searchTurns, searchBaseRadius, searchRadiusAmp, searchPulse, searchScale | 4, 8, 8.5, 2.4, 1 |

同键参数可复用元数据，但默认值与可用性由当前预设决定。下表定义全部 45 个参数键，对应 20 个预设共 89 个控件实例。英文与中文标签沿用参考语义。

| Key | English / 中文 | Min | Max | Step |
| --- | --- | ---: | ---: | ---: |
| baseRadius | Base radius / 基础半径 | 4 | 10 | 0.1 |
| detailAmplitude | Detail / 细节振幅 | 1 | 5 | 0.1 |
| petalCount | Petals / 花瓣数；Orbit 使用 k / k 值 | 3 | 12 | 1 |
| curveScale | Scale / 缩放 | 2.5 | 5.5 | 0.1 |
| orbitRadius | Base radius / 基础半径 | 4 | 10 | 0.1 |
| roseA | a / a | 5 | 14 | 0.1 |
| roseABoost | a boost / a 呼吸量 | 0 | 2 | 0.05 |
| roseBreathBase | Base pulse / 基础呼吸 | 0.3 | 1.2 | 0.01 |
| roseBreathBoost | Pulse boost / 呼吸增量 | 0 | 0.8 | 0.01 |
| roseK | k / k 值 | 2 | 10 | 1 |
| roseScale | Scale / 缩放 | 2 | 5 | 0.05 |
| lissajousAmp | Amplitude / 振幅 | 8 | 36 | 0.5 |
| lissajousAmpBoost | Amp pulse / 振幅呼吸 | 0 | 12 | 0.1 |
| lissajousAX | a / a | 1 | 8 | 1 |
| lissajousBY | b / b | 1 | 8 | 1 |
| lissajousYScale | Y scale / Y 缩放 | 0.4 | 1.4 | 0.01 |
| lemniscateA | a / a | 8 | 30 | 0.5 |
| lemniscateBoost | Pulse / 呼吸量 | 0 | 12 | 0.1 |
| spiroR | R / R | 4 | 12 | 0.1 |
| spiror | r / r | 1 | 5 | 0.1 |
| spirod | d / d | 1 | 8 | 0.1 |
| spiroScale | Scale / 缩放 | 1.5 | 4.5 | 0.05 |
| spiralR | R / R | 2 | 8 | 1 |
| spiralr | r / r | 1 | 3 | 0.1 |
| spirald | d / d | 1 | 5 | 0.1 |
| spiralScale | Scale / 缩放 | 1.2 | 3.5 | 0.05 |
| spiralBreath | Pulse / 呼吸量 | 0 | 1 | 0.05 |
| butterflyTurns | Turns / 圈数 | 6 | 18 | 0.5 |
| butterflyScale | Scale / 缩放 | 2.5 | 7 | 0.05 |
| butterflyPulse | Pulse / 呼吸量 | 0 | 1.2 | 0.01 |
| butterflyCosWeight | Cos weight / 余弦权重 | 0.5 | 4 | 0.05 |
| butterflyPower | Power / 幂次 | 2 | 8 | 1 |
| cardioidA | a / a | 4 | 14 | 0.1 |
| cardioidPulse | Pulse / 呼吸量 | 0 | 2 | 0.05 |
| cardioidScale | Scale / 缩放 | 1 | 3.5 | 0.05 |
| heartWaveB | b / b | 2 | 12 | 0.1 |
| heartWaveRoot | Root span / 根号范围 | 2.2 | 4.2 | 0.05 |
| heartWaveAmp | Wave amp / 波纹振幅 | 0.3 | 1.6 | 0.05 |
| heartWaveScaleX | X scale / X 缩放 | 14 | 30 | 0.1 |
| heartWaveScaleY | Y scale / Y 缩放 | 14 | 34 | 0.1 |
| searchTurns | Turns / 圈数 | 2 | 8 | 0.1 |
| searchBaseRadius | Base radius / 基础半径 | 2 | 16 | 0.1 |
| searchRadiusAmp | Radius amp / 半径振幅 | 2 | 16 | 0.1 |
| searchPulse | Pulse / 呼吸量 | 0 | 6 | 0.1 |
| searchScale | Scale / 缩放 | 0.5 | 1.8 | 0.05 |

Rose Two/Three/Four 的 `roseK=2/3/4` 不暴露；`lissajousPhase=1.57`、`spirorBoost=0.45`、`spirodBoost=1.2` 及其余参考未提供控件的常量保持固定。Petal Spiral 的 `spiralR` 和 `spiralr` 均可调。Butterfly 的圈数允许半步，幂次为整数。参数调整只替换相应公式常量，不增加拟合、归一化或自动缩放。

### Scenario: Display the selected control set

- **WHEN** 依次选择目录中的全部 20 个预设
- **THEN** 逐项显示上表的控件集合、顺序、标签、默认值、范围与步长，共 89 个实例
- **AND** 不出现参考未暴露的参数或 Fourier Flow

### Scenario: Apply values to every geometry consumer

- **WHEN** 任一专属参数改为非默认合法值
- **THEN** 公式和坐标按该预设参考表达式使用实际有效值，路径与粒子使用同一配置
- **AND** 当前曲线的入口图与当前项动画预览反映该几何；其他候选使用自身默认值
- **AND** 缺少覆盖值时默认外观保持，原有动画相位与状态反馈继续成立

## Requirement: Parameter editing and persistence

新增参数 SHALL 仅持久化当前预设的可调几何值，不新增逐预设历史。共享设置扩展一个当前曲线参数对象，沿用现有自动保存、串行队列与原生事件。缺少对象或缺少某键时，从当前曲线默认值补全；保存后重载和重新挂载仍显示用户值。

切换另一预设 SHALL 同时加载它的默认几何和现有六项动画默认值，其他设置不变；再次激活当前预设保持值且不多余保存。独立“重置曲线参数 / Reset curve parameters”只重置当前几何；现有“重置曲线动画”继续只重置六项动画。新控件输入、重置与曲线切换在模型、公式、预览和保存负载中保持一致。

前端与原生边界 SHALL 对当前预设的参数键建立白名单，不让未知键、参考未暴露常量或其他预设参数影响结果。原生输入要求数值类型且有限；非法类型或非有限数值报错并走既有保存失败路径，有限数值限制在对应范围内，`step=1` 的离散参数舍入为整数。渲染器对缺失、无效或不适用的覆盖使用相应默认值；不要通过字符串隐式转换接受非法输入。

合法自定义值可能像参考一样超出 100x100 逻辑画布；不得更改采样算法或额外缩放以掩盖。保持正分母、Heart Wave 的安全开方及整数幂。所有合法边界组合均产生有限坐标，默认值继续满足既有坐标边界。

初次载入、外部设置事件与较早保存结果 SHALL 保留正在进行的本地参数编辑。失败保存保留可重试值并显示既有错误状态，不宣称已保存；图库重试不可重新加载默认值。单纯浏览候选不得触发保存。

### Scenario: Save and reload geometry values

- **WHEN** 编辑专属参数并完成既有保存，随后切换设置页、重开设置窗口或进行配置序列化往返
- **THEN** 当前预设与自定义几何值保持，公式和实际绘制一致
- **WHEN** 旧配置未包含新字段
- **THEN** 使用其有效曲线的几何默认值，已有动画与非曲线设置保留

### Scenario: Switch and reset geometry independently

- **WHEN** 从自定义预设切换到另一预设
- **THEN** 新预设加载自己的几何默认值与当前六项动画默认值，不残留上一项覆盖
- **WHEN** 使用几何重置、动画重置或重新选择当前项
- **THEN** 分别只重置几何、只重置动画或保持全部自定义值

### Scenario: Validate geometry at the settings boundary

- **WHEN** 提交类型错误、非有限数值、超界数值、非整数离散项或不适用参数键
- **THEN** 类型错误与非有限值沿用保存失败路径，有限数值限制范围、离散值取整数，不适用键不能影响当前预设
- **AND** 所有合法极值组合均产生有限坐标，无除零、无效开方或非整数负底数幂

### Scenario: Preserve pending edits and save errors

- **WHEN** 拖动参数期间到达初次读取、外部事件或较早保存响应
- **THEN** 本地编辑值不被旧快照覆盖，保存队列最终提交最新参数
- **WHEN** 保存失败并随后重试
- **THEN** 失败反馈可见且重试提交用户保留的值，不隐式重置

## Requirement: Geometry controls accessibility and layout

新增控件 SHALL 沿用现有布局、系统字体、原生滑块、焦点样式及中英文本。每个控件有可见 label，通过 for/id 与 input 关联，output 与输入关联。读数按步长提供足够小数精度，避免把 0.05/0.01 步长显示成整数。切换语言不丢失值，切换预设和外部同步正确挂载控件，不引入重复事件监听。

### Scenario: Operate geometry controls in both layouts

- **WHEN** 在英文或中文环境用鼠标和原生键盘操作新控件，并在 1130x890 与 390x844 视口检查
- **THEN** 标签、读数、参数区和重置操作均可见或可滚动到达，没有文字重叠和横向溢出
- **AND** 控件保持可访问名称、关联输出与可见焦点，不引入第三方控件库
