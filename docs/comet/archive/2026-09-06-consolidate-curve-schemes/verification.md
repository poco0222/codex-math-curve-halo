---
generated_from_state_version: 23
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 4
- 迭代: 1
- 验证器尝试次数: 1
- 完成时间: 2026-09-06T01:48:25.402Z
- 摘要: 独立只读验收通过。A1–A41 恰好一次，全部基于当前源码、三份目标 Spec、完整验收分页、Runtime result.json、浏览器检查、静态测试和截图归因。既有 Runtime 检查均 exit 0：frontend 79/79、renderer、settings-structure、native-state 33 项、picker-browser、animation-browser、diff --check。未重跑额外检查，未冒充未执行的原生 IPC、安装包或屏幕阅读器验证。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：仅改变图库的多款族浏览目标并关闭图库，再次打开时定位实际当前预设所属族；浏览目标没有保存成设置。 | picker-browser 与当前源码证明仅浏览多款族不保存，关闭后按共享 curve_id 恢复实际当前族；运行结果 exit 0。 |
| A2 | passed | brief.md | A2：把透明度改为 0.65 后应用其他族的预设、重置曲线参数或重置动画，透明度仍为 0.65；动画重置只影响原六项动画值。 | picker-browser 验证 opacity=0.65 在跨族应用、动画重置、几何重置后保持；结果 exit 0。 |
| A3 | passed | brief.md | A3：任一单款族经点击、Enter 或 Space 一次激活就应用唯一曲线，不要求再次点击；单款不展示重复变体区，打开当前单款时焦点落在顶部对应卡片。单款悬停和聚焦可预览但不保存。 完整目标规格保留已有能力的验收场景，并更新目录、参数归属、图库过滤和布局场景；以上补充跨能力边界和单款直接选择行为。 | picker-browser 验证六个单款族点击/Enter/Space 一次直接应用、隐藏重复变体、当前单款打开时聚焦顶部，并保留预览。 |
| A4 | passed | specs/curve-preset-picker/spec.md | Open the visual catalog - **WHEN** 用户打开外观页并激活“更换” - **THEN** 弹层展示 10 个有序曲线族轮廓和名称，单款显示直接使用、多款显示数量；下方仅在当前族有多款时显示变体 - **AND** 逐族浏览能够访问全部 20 个预设，无新增、重复归属或遗漏 - **AND** 初始焦点落在当前项，当前项位于可见区域且明确标记 - **AND** 标准 `1130x890` 窗口中族网格为 5 列 2 行，当前族预设最多 5 列，不为其他族占用空网格行；开关弹层不改变背景参数区布局 | picker-browser 验证 10 族、20 预设、族内顺序、当前项、桌面 5x2 布局及仅当前多款族显示变体；截图支持。 |
| A5 | passed | specs/curve-preset-picker/spec.md | Browse without changing settings - **WHEN** 用户切换多款浏览族、悬停、聚焦或通过网格方向键浏览多个曲线 - **THEN** 同时运行的局部动画至多一个，曲线轮廓与所示名称匹配 - **AND** 已保存曲线、六项动画值、专属几何值、其他设置和实际桌面悬浮层均不因浏览而改变 | picker-browser 验证多款族浏览、预览不保存，至多一个局部动画，设置保持不变。 |
| A6 | passed | specs/curve-preset-picker/spec.md | Apply a different preset - **WHEN** 用户激活与当前曲线不同的预设 - **THEN** 该曲线 ID、六项现有默认动画值与专属几何默认值一次提交给现有保存路径 - **AND** 颜色、透明度、位置、语言及集成设置保持原值 - **AND** 保存成功后入口、参数和公式显示新曲线，桌面悬浮层通过既有设置事件更新，弹层关闭并恢复焦点 | picker-browser 验证切换预设一次提交、动画与几何默认值、入口与参数同步、保存后关闭并恢复焦点。 |
| A7 | passed | specs/curve-preset-picker/spec.md | Keep custom values when selecting the current preset - **WHEN** 当前曲线已自定义动画或专属几何参数，且用户再次激活该曲线 - **THEN** 弹层关闭并恢复焦点，全部自定义值保持原样 - **AND** 不执行动画、专属几何重置或多余保存 | picker-browser 验证重选当前曲线保持自定义几何与动画值，save count 不增加。 |
| A8 | passed | specs/curve-preset-picker/spec.md | Retry a failed application - **WHEN** 新预设应用的保存失败 - **THEN** 弹层保持打开，显示本地化失败信息和重试操作，全局保存状态为 error - **AND** 不显示成功，不把局部预览当作已保存结果 - **WHEN** 用户重试 - **THEN** 使用现有保存路径提交当前待保存值，不重复恢复默认值；成功后关闭，失败后仍可重试 - **AND** 失败后关闭弹层不执行回滚或额外保存，现有全局错误状态继续表达未保存结果 | picker-browser 验证保存失败时弹层保持、错误状态和重试可见；重试提交保留值并可成功关闭。 |
| A9 | passed | specs/curve-preset-picker/spec.md | Dismiss an unused preview - **WHEN** 用户打开并浏览图库后通过关闭按钮、Esc 或遮罩退出，期间没有应用操作 - **THEN** 当前曲线和所有参数保持不变，没有保存请求，焦点返回有效入口 | picker-browser 验证关闭按钮、Esc、遮罩退出预览不保存且恢复入口焦点。 |
| A10 | passed | specs/curve-preset-picker/spec.md | Remount and synchronize the picker - **WHEN** 用户切换设置页后回到外观页，或收到完整或部分 `settings-changed` 事件 - **THEN** 入口与选中标记从共享设置重新呈现，未挂载字段与自定义参数不丢失 - **AND** 已关闭或卸载的图库没有残留动画循环 | picker-browser 验证 View remount、reload、完整/部分 settings-changed 同步与未挂载字段保留；destroy/close 停止动画。 |
| A11 | passed | specs/curve-preset-picker/spec.md | Choose a curve using the keyboard - **WHEN** 用户只使用键盘打开、浏览、应用或关闭图库 - **THEN** 所有操作均可完成，焦点不会落入背景控件，聚焦与当前使用状态可区分 - **AND** 两个网格的方向键不发起保存，Enter 或 Space 激活单款直接应用、激活多款族只浏览、激活变体才应用，关闭后焦点恢复 | picker-browser 验证方向键、Home/End、Tab、Enter/Space、关闭及焦点陷阱；源码包含显式 ARIA、tabIndex 和键盘处理。 |
| A12 | passed | specs/curve-preset-picker/spec.md | Use localized and narrow layouts - **WHEN** 使用 `en` 或 `zh-CN`，窗口从 `1130x890` 缩小到 `390x844` - **THEN** 网格减少列数，完整名称可换行且不遮挡缩略图或相邻项 - **AND** 页面没有横向溢出，弹层内容必要时内部纵向滚动，族图形网格、所选族全部预设和关闭操作始终可达；通过族按钮可访问全部 20 个预设 | picker-browser 在 en/zh-CN 与 1130x890/390x844 验证网格可达、文本换行、无横向溢出；截图支持。 |
| A13 | passed | specs/curve-preset-picker/spec.md | Respect reduced motion - **WHEN** 系统请求 `prefers-reduced-motion` - **THEN** 所有缩略图和聚焦预览保持静态，选择、焦点及保存反馈正常 | picker-browser 与 animation-browser 验证 reduced-motion 下预览静态且选择/反馈仍可用。 |
| A14 | passed | specs/curve-profiles/spec.md | Select a built-in profile - **WHEN** the Appearance view is opened - **THEN** the family thumbnail grid contains exactly the 10 families above in order, with their outlines, names and either a direct-use label for a single preset or a preset count for multiple presets directly visible - **AND** every one of the 20 retained preset IDs is reachable exactly once within its family, in the specified relative order - **AND** the current entry identifies both the selected family and its named preset - **AND** `fourier-flow` is absent - **AND** the active formula output describes the selected profile | renderer、picker-browser 及 result.json 验证 10 族、20 个 ID 恰好可达，fourier-flow 缺失，当前公式同步。 |
| A15 | passed | specs/curve-profiles/spec.md | Render every profile - **WHEN** each profile is sampled with default geometry at 128 points with `detailScale` values `0`, `0.5`, and `1` - **THEN** every point has finite `x` and `y` values - **AND** every point remains within the existing validation bounds `[-20,120]` on both axes - **AND** the profile has a non-empty formula | renderer 检查 20 profiles/80 upstream points 通过，命令 exit 0；frontend 曲线测试亦通过。 |
| A16 | passed | specs/curve-profiles/spec.md | Load legacy settings - **WHEN** a persisted settings file contains a removed or unknown `curve_id` - **THEN** the native settings value returned to both windows is `original-thinking` - **AND** saving the normalized settings writes the new ID - **WHEN** a persisted settings file contains `lissajous-drift` or `spiral-search` - **THEN** that curve ID remains unchanged | frontend/native-state 测试覆盖未知 ID 归一为 original-thinking、legacy 保留 lissajous-drift 与 spiral-search；均通过。 |
| A17 | passed | specs/curve-profiles/spec.md | Match reference motion - **WHEN** each curve runs with its reference parameters and a fixed phase at elapsed times 0, 1234 and 65000 ms - **THEN** path endpoints, particle positions, radii, alpha, order, count and line width match the upstream gallery at the same phase - **AND** comparison uses the same configured durations, including Halo's existing whole-second defaults - **AND** the seven states do not alter reference speed, pulse, particle size or alpha | animation-browser 对 20 曲线与 upstream reference 做固定 phase、路径/粒子/透明度比较，alpha error 阈值通过。 |
| A18 | passed | specs/curve-profiles/spec.md | Preserve animation phase - **WHEN** durations are edited or states change during a long-running animation - **THEN** existing motion phases remain continuous and subsequent frames use the new durations - **WHEN** the renderer stops or is disabled - **THEN** paused time does not accumulate motion - **AND** non-rotating profiles do not accumulate rotation | animation-browser 验证持续动画、覆盖、重载与 reset；halo 源码保持 phase 累积、暂停不积累、非旋转不转动。 |
| A19 | passed | specs/curve-profiles/spec.md | Use and override a preset - **WHEN** the user selects Heart Wave - **THEN** controls and the save payload contain 104 particles, trail 0.18, loop 9000, pulse 6000, rotation 22000 and stroke 3.9 - **WHEN** particles are changed to 64, loop to 5000 and stroke to 5.5 - **THEN** those exact values render and survive a remount and reload - **WHEN** the current-curve reset action is used - **THEN** only its six animation values return to the reference values | animation-browser 验证 Heart Wave tuple 104/.18/9/6/22/3.9、覆盖值、remount/reload 与动画重置。 |
| A20 | passed | specs/curve-profiles/spec.md | Upgrade existing settings - **WHEN** existing settings contain the complete old default animation tuple - **THEN** normalization adopts the selected curve's reference tuple, keeps other settings and remains stable on another load - **WHEN** any of the six old animation values was customized - **THEN** valid custom values remain unchanged | frontend/native-state 测试验证完整旧动画 tuple 升级为曲线默认、部分自定义值保留且幂等。 |
| A21 | passed | specs/curve-profiles/spec.md | Preserve Halo controls - **WHEN** the state changes with custom state colors - **THEN** the new color is reached after 420 ms and motion stays continuous - **WHEN** global opacity or enabled changes - **THEN** opacity and visibility still apply - **WHEN** reduced motion is requested - **THEN** positions remain still while colors can transition | animation-browser/renderer 验证状态颜色过渡、opacity、enabled、reduced-motion；halo 源码为 420ms transition 且 opacity 直接映射。 |
| A22 | passed | specs/curve-profiles/spec.md | Display the selected control set - **WHEN** 依次选择目录中的全部 20 个预设 - **THEN** 逐项显示上表的控件集合、顺序、标签、默认值、范围与步长，共 89 个实例 - **AND** 不出现参考未暴露的参数或 Fourier Flow | picker-browser 与 result.json 验证 20 预设共 89 个控件实例，未出现 Fourier Flow 或未暴露参数。 |
| A23 | passed | specs/curve-profiles/spec.md | Apply values to every geometry consumer - **WHEN** 任一专属参数改为非默认合法值 - **THEN** 公式和坐标按该预设参考表达式使用实际有效值，路径与粒子使用同一配置 - **AND** 当前曲线的入口图与当前项动画预览反映该几何；其他候选使用自身默认值 - **AND** 缺少覆盖值时默认外观保持，原有动画相位与状态反馈继续成立 | picker-browser 验证几何参数修改同步入口缩略图、公式和当前预览；halo/curve-picker 源码共用 curve_parameters。 |
| A24 | passed | specs/curve-profiles/spec.md | Save and reload geometry values - **WHEN** 编辑专属参数并完成既有保存，随后切换设置页、重开设置窗口或进行配置序列化往返 - **THEN** 当前预设与自定义几何值保持，公式和实际绘制一致 - **WHEN** 旧配置未包含新字段 - **THEN** 使用其有效曲线的几何默认值，已有动画与非曲线设置保留 | picker-browser 验证几何值保存后切 View、reload、重新挂载与序列化往返保持。 |
| A25 | passed | specs/curve-profiles/spec.md | Switch and reset geometry independently - **WHEN** 从自定义预设切换到另一预设 - **THEN** 新预设加载自己的几何默认值与当前六项动画默认值，不残留上一项覆盖 - **WHEN** 使用几何重置、动画重置或重新选择当前项 - **THEN** 分别只重置几何、只重置动画或保持全部自定义值 | picker-browser 验证切换预设加载自身几何/动画默认，几何重置与动画重置互不影响，重选当前项保留自定义值。 |
| A26 | passed | specs/curve-profiles/spec.md | Validate geometry at the settings boundary - **WHEN** 提交类型错误、非有限数值、超界数值、非整数离散项或不适用参数键 - **THEN** 类型错误与非有限值沿用保存失败路径，有限数值限制范围、离散值取整数，不适用键不能影响当前预设 - **AND** 所有合法极值组合均产生有限坐标，无除零、无效开方或非整数负底数幂 | frontend/native-state/renderer 测试覆盖类型、有限性、范围、离散值和合法边界坐标；均通过。 |
| A27 | passed | specs/curve-profiles/spec.md | Preserve pending edits and save errors - **WHEN** 拖动参数期间到达初次读取、外部事件或较早保存响应 - **THEN** 本地编辑值不被旧快照覆盖，保存队列最终提交最新参数 - **WHEN** 保存失败并随后重试 - **THEN** 失败反馈可见且重试提交用户保留的值，不隐式重置 | picker-browser 验证初始读取、外部事件、较早响应和失败重试均保留最新本地参数。 |
| A28 | passed | specs/curve-profiles/spec.md | Operate geometry controls in both layouts - **WHEN** 在英文或中文环境用鼠标和原生键盘操作新控件，并在 1130x890 与 390x844 视口检查 - **THEN** 标签、读数、参数区和重置操作均可见或可滚动到达，没有文字重叠和横向溢出 - **AND** 控件保持可访问名称、关联输出与可见焦点，不引入第三方控件库 | picker-browser 在中英文桌面/窄屏验证参数标签、读数、重置、可访问名称、输出关联和无横向溢出。 |
| A29 | passed | specs/settings-workbench/spec.md | Open settings - **WHEN** the settings page opens - **THEN** the App Shell shows the Codex Halo identity, the global Overlay toggle, language selector, and save status - **AND** the default View is `Appearance` - **AND** only the active View is mounted in the content host | settings-structure 与 frontend 测试验证 App Shell、Appearance 默认 View、全局控件和单活动 View。 |
| A30 | passed | specs/settings-workbench/spec.md | Navigate between Views - **WHEN** the user selects `Appearance`, `State colors`, `Integration`, or `Test` - **THEN** the selected View replaces the previous View in the content host - **AND** the active navigation item exposes the selected state - **AND** focus and keyboard navigation remain available | settings-structure/frontend 测试验证四个 View 替换、活动状态与键盘可用性。 |
| A31 | passed | specs/settings-workbench/spec.md | Configure appearance - **WHEN** the `Appearance` View is active - **THEN** Curve scheme contains the family/preset entry, current geometry controls and geometry reset, followed by the active formula - **AND** Renderer contains opacity, particle count, trail span, loop timing, pulse timing, rotation timing, stroke width and the animation reset - **AND** no geometry control or formula remains in Renderer, and opacity is not part of Curve scheme - **AND** the default and narrow layouts keep both sections and their actions visible or reachable by vertical scrolling without horizontal overflow - **AND** the remaining control IDs, names, and setting keys remain usable by the controller | settings-structure、picker-browser、animation-browser 与参数截图验证 Curve scheme/Renderer 分区、控件顺序、重置归属和窄屏可达。 |
| A32 | passed | specs/settings-workbench/spec.md | Scan color states - **WHEN** the `State colors` View is active - **THEN** the state list shows `idle`, `thinking`, `executing`, `input_needed`, `completed`, `interrupted`, and `compacting` - **AND** each row shows the localized state label, current color swatch, and current Hex value - **AND** exactly one row is selected | settings-structure/frontend 测试验证七个状态、localized labels、swatch/Hex 和单选状态。 |
| A33 | passed | specs/settings-workbench/spec.md | Edit selected state - **WHEN** the user selects a state row - **THEN** the detail panel shows that state's preview, native color picker, Hex input, reset action, and preset palette disclosure - **AND** changing the picker, valid Hex input, preset, or reset action updates only the selected state's color - **AND** the change uses the existing automatic save path | settings-structure/frontend 测试验证状态详情编辑器、native color picker、Hex、reset、palette 与自动保存路径。 |
| A34 | passed | specs/settings-workbench/spec.md | Extend state details - **WHEN** a future state-level setting such as audio linkage or state-specific animation is added - **THEN** it can be added to the selected state's detail context without changing the state list interaction - **AND** the current seven-state color contract remains intact | settings-structure 与当前 View/controller 架构验证状态列表和 detail context 分离，可扩展且七状态契约保留。 |
| A35 | passed | specs/settings-workbench/spec.md | Use colors on a narrow viewport - **WHEN** the available width is below the desktop layout threshold - **THEN** the state list and detail panel stack vertically - **AND** the page does not require document-level horizontal scrolling - **AND** the selected state, editor controls, and validation message remain visible | 基于实际 CSS、settings-structure 静态检查及现有响应式参数/图库窄屏证据核验状态列表堆叠、无文档横向溢出；本项没有专属颜色页截图，未冒充截图验证。 |
| A36 | passed | specs/settings-workbench/spec.md | Load settings - **WHEN** the page loads - **THEN** the Tauri Bridge requests the complete `AppSettings` value - **AND** the shared settings state becomes the source of truth for mounted and unmounted controls - **AND** the active View renders from that state | frontend/settings-structure 测试与 settings bridge/store 源码验证完整 AppSettings 加载、共享状态为 mounted/unmounted 控件源。 |
| A37 | passed | specs/settings-workbench/spec.md | Save a setting - **WHEN** the user changes a setting - **THEN** the shared settings state is updated - **AND** save requests remain serialized through the existing queue - **AND** the UI exposes ready, saving, saved, and error feedback | frontend/native-state 测试验证共享状态更新、串行保存队列及 ready/saving/saved/error 反馈。 |
| A38 | passed | specs/settings-workbench/spec.md | Receive an external settings update - **WHEN** a `settings-changed` event contains a complete or partial payload - **THEN** the payload merges into the shared settings state - **AND** unmounted values and inactive state colors are not erased - **AND** the active control is not unexpectedly overwritten while it is being edited | picker-browser 初始/部分外部事件场景与 settings store/controller 源码验证合并 payload、不擦除未挂载值、不覆盖本地编辑。 |
| A39 | passed | specs/settings-workbench/spec.md | Add a future settings View - **WHEN** a future domain such as default position or audio is introduced - **THEN** the frontend can register a new View and its field bindings without duplicating save, error, localization, or event synchronization logic - **AND** native fields, commands, or events are added only by a separate capability change | settings-structure 与 controller 源码验证 View 注册、field binding、保存/错误/本地化/事件同步集中复用。 |
| A40 | passed | specs/settings-workbench/spec.md | Localize the settings page - **WHEN** the user switches between `en` and `zh-CN` - **THEN** shell labels, View labels, form labels, state labels, preset labels, status text, and diagnostics are localized - **AND** localized text wraps without overlap or loss of focus | picker-browser、animation-browser 在 en/zh-CN 验证 shell、族名、参数、状态文本及窄屏换行；截图支持。 |
| A41 | passed | specs/settings-workbench/spec.md | Use keyboard controls - **WHEN** the user navigates the shell, View navigation, state list, and form controls with a keyboard - **THEN** focus order follows the DOM order - **AND** active navigation and selected state are announced through appropriate ARIA state - **AND** visible focus remains clear | picker-browser 与 settings-structure/frontend 测试验证 DOM/Tab 顺序、ARIA selected/pressed、焦点可见性和键盘导航。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| Frontend tests | --test src/app.test.mjs src/curve-picker.test.mjs src/curve-parameters.test.mjs | . | passed | 0 | 183 ms |
| Renderer reference | scripts/check-renderer.mjs | . | passed | 0 | 114 ms |
| Settings structure | scripts/check-settings-tabs.mjs | . | passed | 0 | 51 ms |
| Native state compatibility | test --manifest-path src-tauri/Cargo.toml --lib state::tests | . | passed | 0 | 302 ms |
| Direct singletons browser | scripts/check-curve-picker-browser.mjs | . | passed | 0 | 5178 ms |
| Animation browser | scripts/check-animation-browser.mjs | . | passed | 0 | 1620 ms |
| Diff whitespace | diff --check | . | passed | 0 | 39 ms |

## 阻塞项

_无。_

## 风险与跳过的工作

- 真实原生双窗口 IPC 未执行；Runtime 使用 isolated browser substitute。
- 未执行安装包验证和实际屏幕阅读器验证。
- A35 依据实际 CSS 与静态检查核验，未提供颜色页专属窄屏截图。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | pass | — | 独立只读验收通过。A1–A40 全部通过，理由已按实际 Runtime 命令、源码、测试脚本和截图证据归因。frontend 79 项、renderer、settings-structure、native-state 33 项、picker-browser、animation-browser、diff --check 均报告通过；未将颜色页未拍截图或浏览器替身冒充真实原生验证。 | 2026-09-05T15:34:04.043Z |
| 1 | 1 | 1 | recovery | — | 用户已看过图形网格与侧栏可交互对比并明确选择推荐图形网格：10族轮廓常显，点族只浏览下方变体，点变体才应用；替换原族下拉，其余已确认范围与边界保持。 | 2026-09-05T23:02:35.479Z |
| 2 | 1 | 1 | pass | — | 独立只读核验完成。已核对全部验收分页、brief、三份目标 spec、当前源码、Runtime result.json、截图及本轮 Runtime 检查。frontend 79/79、renderer、settings-structure、native-state 33项、picker-browser、animation-browser、diff --check 均由本轮 Runtime 在正确 NODE_PATH、HALO_TEST_URL 与 HALO_QA_DIR 环境下 exit 0。A1-A40 恰好一次，全部 passed。 | 2026-09-05T23:22:29.390Z |
| 2 | 1 | 1 | recovery | — | 用户明确要求单款曲线族直接可选，去掉重复点击。调整为单款族激活即应用，多款族激活只展开变体；仍保留当前项重选、自定义参数、自动保存/失败重试和键盘规则。 | 2026-09-06T01:29:32.763Z |
| 3 | 1 | 0 | recovery | — | Native Shape artifacts changed | 2026-09-06T01:43:34.393Z |
| 4 | 1 | 1 | pass | — | 独立只读验收通过。A1–A41 恰好一次，全部基于当前源码、三份目标 Spec、完整验收分页、Runtime result.json、浏览器检查、静态测试和截图归因。既有 Runtime 检查均 exit 0：frontend 79/79、renderer、settings-structure、native-state 33 项、picker-browser、animation-browser、diff --check。未重跑额外检查，未冒充未执行的原生 IPC、安装包或屏幕阅读器验证。 | 2026-09-06T01:48:25.402Z |



## 结论

独立只读验收通过。A1–A41 恰好一次，全部基于当前源码、三份目标 Spec、完整验收分页、Runtime result.json、浏览器检查、静态测试和截图归因。既有 Runtime 检查均 exit 0：frontend 79/79、renderer、settings-structure、native-state 33 项、picker-browser、animation-browser、diff --check。未重跑额外检查，未冒充未执行的原生 IPC、安装包或屏幕阅读器验证。
