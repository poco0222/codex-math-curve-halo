---
generated_from_state_version: 8
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 1
- 验证器尝试次数: 1
- 完成时间: 2026-09-05T12:52:55.958Z
- 摘要: 独立复核 brief、两份完整 spec、最终 diff、上游 70f4e00 定义、8 项 Runtime 检查日志及双语桌面/窄屏截图。A1-A31 均有实现与测试或静态契约证据，未发现可执行缺陷；判定通过。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | **A1**：逐项遍历 20 个预设，仅显示参考对应的 2-6 项专属控件，共 89 项实例；键、顺序、默认值、范围和步长符合完整 Spec；Rose Two/Three/Four 不显示可调 k，参考未暴露字段及 Fourier Flow 不出现。 | `src/curve-controls.js:2-70` 定义 45 个键、20 组有序映射和 89 个实例；`src/curve-parameters.test.mjs:152`、浏览器验收及上游提交 70f4e00 对照均通过。 |
| A2 | passed | brief.md | **A2**：对每个专属参数至少选择一个非默认有效值，固定采样相位时公式与几何符合参考计算；路径、粒子、当前曲线入口及当前项预览使用相同有效参数。所有默认曲线保留既有外观，合法边界组合产生有限坐标且没有除零或无效开方。 | `src/curves.js:34-263` 将有效参数用于公式和全部 point/sample 调用；逐参数参考公式、合法边界、路径与粒子共享配置测试通过，renderer 检查匹配 80 个上游坐标。 |
| A3 | passed | brief.md | **A3**：编辑当前专属参数后沿用自动保存；切换设置页、重新打开设置窗口及配置序列化往返保留值；旧配置缺少新字段时使用当前预设默认值。非有限值或类型错误被拒绝，未知键或其他预设参数不作用于当前曲线；有效数值按范围约束，离散整数项保持整数。 | `src/settings.js:155-175,230-252,655-745` 保留本地编辑并走串行保存；浏览器覆盖自动保存、重挂载、重载、失败重试和竞态；`src-tauri/src/state.rs:247-307` 及 Rust 测试覆盖类型、有限值、白名单、范围和整数归一化。 |
| A4 | passed | brief.md | **A4**：切换另一预设时使用其专属默认值，原有六项动画加载行为继续成立；再次选择当前预设保留自定义值；“重置曲线参数”仅重置当前专属值，现有“重置曲线动画”仅重置原六项动画。保存失败显示现有错误，重试不意外重置参数。 | `src/settings.js:179-190,358-364,771-815` 分离曲线参数与动画重置；浏览器验证切换默认值、重选当前项、两类重置、失败保值及重试。 |
| A5 | passed | brief.md | **A5**：六项动画控件的现有范围、整秒显示与默认值、状态颜色、透明度、位置及集成设置行为保持；候选预览不写入设置、不改变悬浮层，开放曲线不闭合，动画相位、减少动态效果偏好和预览清理保持。 | renderer、animation-browser 和既有 frontend 回归均通过；候选预览使用局部 renderer，未调用保存；开放路径、相位连续、减少动态效果、颜色、透明度及其他设置保留均有代码或测试证据。 |
| A6 | passed | brief.md | **A6**：中文与英文标签及读数完整，原生滑块可用键盘操作，标签与输出关联正确；1130x890 和 390x844 视口无文字重叠或横向溢出，所有新控件与重置操作可达。 | `src/settings.js:320-355` 建立 label/input/output 关联并按步长显示读数；中英文 1130x890、390x844 浏览器检查及截图无重叠或横向溢出，原生 range 键盘操作通过。 |
| A7 | passed | specs/curve-preset-picker/spec.md | Open the visual catalog - **WHEN** 用户打开外观页并激活“更换” - **THEN** 弹层显示现有的全部 20 项真实轮廓和完整本地化名称，无新增或遗漏 - **AND** 初始焦点落在当前项，当前项位于可见区域且明确标记 - **AND** 标准 `1130x890` 窗口中图库为 5 列、4 行，开关弹层不改变背景参数区布局 | `src/curve-picker.js:55-106,211-220` 生成 20 项真实缩略图并聚焦当前项；浏览器确认 5x4 布局、唯一选中标记、完整名称、非空且互异轮廓，背景布局未变化。 |
| A8 | passed | specs/curve-preset-picker/spec.md | Browse without changing settings - **WHEN** 用户悬停、聚焦或通过方向键浏览多个曲线 - **THEN** 同时运行的局部动画至多一个，曲线轮廓与所示名称匹配 - **AND** 已保存曲线、六项动画值、专属几何值、其他设置和实际桌面悬浮层均不因浏览而改变 | `src/curve-picker.js:108-153` 保证单一局部动画并清理监听；浏览器确认悬停、聚焦和方向键浏览不保存、不改变持久设置，活动帧最多一个。 |
| A9 | passed | specs/curve-preset-picker/spec.md | Apply a different preset - **WHEN** 用户激活与当前曲线不同的预设 - **THEN** 该曲线 ID、六项现有默认动画值与专属几何默认值一次提交给现有保存路径 - **AND** 颜色、透明度、位置、语言及集成设置保持原值 - **AND** 保存成功后入口、参数和公式显示新曲线，桌面悬浮层通过既有设置事件更新，弹层关闭并恢复焦点 | 浏览器确认新 ID、六项动画默认值及专属几何默认值一次提交且其他字段保留；`src-tauri/src/main.rs:435-469,280-303` 归一化、写盘后向两窗口发送完整 AppSettings，`src/app.js:107-118` 接入 overlay renderer；原生边界已通过 Rust 测试和全目标编译。 |
| A10 | passed | specs/curve-preset-picker/spec.md | Keep custom values when selecting the current preset - **WHEN** 当前曲线已自定义动画或专属几何参数，且用户再次激活该曲线 - **THEN** 弹层关闭并恢复焦点，全部自定义值保持原样 - **AND** 不执行动画、专属几何重置或多余保存 | `src/curve-picker.js:28-31` 对当前曲线直接返回 unchanged；单元和浏览器测试确认自定义动画与几何不重置、不保存并恢复焦点。 |
| A11 | passed | specs/curve-preset-picker/spec.md | Retry a failed application - **WHEN** 新预设应用的保存失败 - **THEN** 弹层保持打开，显示本地化失败信息和重试操作，全局保存状态为 error - **AND** 不显示成功，不把局部预览当作已保存结果 - **WHEN** 用户重试 - **THEN** 使用现有保存路径提交当前待保存值，不重复恢复默认值；成功后关闭，失败后仍可重试 - **AND** 失败后关闭弹层不执行回滚或额外保存，现有全局错误状态继续表达未保存结果 | `src/curve-picker.js:36-49,190-209` 保留失败后的本地状态并以最新 Store 重试；浏览器注入保存失败，确认错误状态、弹层保持、重试负载相同及关闭不回滚。 |
| A12 | passed | specs/curve-preset-picker/spec.md | Dismiss an unused preview - **WHEN** 用户打开并浏览图库后通过关闭按钮、Esc 或遮罩退出，期间没有应用操作 - **THEN** 当前曲线和所有参数保持不变，没有保存请求，焦点返回有效入口 | `src/curve-picker.js:163-169,222-235` 覆盖关闭、Esc 和遮罩；浏览器确认未应用时零保存、设置不变、焦点返回入口并停止预览。 |
| A13 | passed | specs/curve-preset-picker/spec.md | Remount and synchronize the picker - **WHEN** 用户切换设置页后回到外观页，或收到完整或部分 `settings-changed` 事件 - **THEN** 入口与选中标记从共享设置重新呈现，未挂载字段与自定义参数不丢失 - **AND** 已关闭或卸载的图库没有残留动画循环 | `src/settings.js:655-717,904-927` 通过共享 Store 合并完整或部分事件并在重挂载时重绘；picker destroy 停止动画和监听；浏览器覆盖换页、部分事件和重载。 |
| A14 | passed | specs/curve-preset-picker/spec.md | Choose a curve using the keyboard - **WHEN** 用户只使用键盘打开、浏览、应用或关闭图库 - **THEN** 所有操作均可完成，焦点不会落入背景控件，聚焦与当前使用状态可区分 - **AND** 方向键不发起保存，Enter 或 Space 明确应用，关闭后焦点恢复 | `src/curve-picker.js:237-261` 实现方向键、Home、End 和 Tab 焦点约束，原生按钮处理 Enter/Space；浏览器确认方向键不保存、Enter/Space 应用、Esc 关闭及焦点恢复。 |
| A15 | passed | specs/curve-preset-picker/spec.md | Use localized and narrow layouts - **WHEN** 使用 `en` 或 `zh-CN`，窗口从 `1130x890` 缩小到 `390x844` - **THEN** 网格减少列数，完整名称可换行且不遮挡缩略图或相邻项 - **AND** 页面没有横向溢出，弹层内容必要时内部纵向滚动，全部 20 项和关闭操作始终可达 | 浏览器在 en/zh-CN、1130x890/390x844 下检查列数、卡片尺寸、页面与 dialog overflow、Tab 可达性；四组 picker 截图显示完整文本和内部滚动布局。 |
| A16 | passed | specs/curve-preset-picker/spec.md | Respect reduced motion - **WHEN** 系统请求 `prefers-reduced-motion` - **THEN** 所有缩略图和聚焦预览保持静态，选择、焦点及保存反馈正常 | `src/curve-picker.js:115-153` 在 reduced motion 下不启动预览并响应偏好变化；浏览器验证零活动帧且选择、关闭和反馈仍可用。 |
| A17 | passed | specs/curve-profiles/spec.md | Select a built-in profile - **WHEN** the Appearance view is opened - **THEN** the curve selector contains exactly the 20 IDs and labels above in the same order - **AND** `fourier-flow` is absent - **AND** the active formula output describes the selected profile | `src/curves.js:105-211` 保留规定顺序的 20 个 profile；renderer 和浏览器检查确认 ID/标签完整、无 fourier-flow，活动公式随选中项更新。 |
| A18 | passed | specs/curve-profiles/spec.md | Render every profile - **WHEN** each profile is sampled with default geometry at 128 points with `detailScale` values `0`, `0.5`, and `1` - **THEN** every point has finite `x` and `y` values - **AND** every point remains within the existing validation bounds `[-20,120]` on both axes - **AND** the profile has a non-empty formula | `scripts/check-renderer.mjs:111-124` 对每个 profile、3 个 detailScale、128 个点验证有限性、[-20,120] 默认边界和非空公式，检查通过。 |
| A19 | passed | specs/curve-profiles/spec.md | Load legacy settings - **WHEN** a persisted settings file contains a removed or unknown `curve_id` - **THEN** the native settings value returned to both windows is `original-thinking` - **AND** saving the normalized settings writes the new ID - **WHEN** a persisted settings file contains `lissajous-drift` or `spiral-search` - **THEN** that curve ID remains unchanged | `src-tauri/src/state.rs:262-307,553-605` 将未知/移除 ID 归一为 original-thinking、保留 lissajous-drift/spiral-search并验证序列化往返；`src-tauri/src/main.rs:251-273` 将归一结果写回配置。 |
| A20 | passed | specs/curve-profiles/spec.md | Match reference motion - **WHEN** each curve runs with its reference parameters and a fixed phase at elapsed times 0, 1234 and 65000 ms - **THEN** path endpoints, particle positions, radii, alpha, order, count and line width match the upstream gallery at the same phase - **AND** comparison uses the same configured durations, including Halo's existing whole-second defaults - **AND** the seven states do not alter reference speed, pulse, particle size or alpha | `scripts/check-renderer.mjs:187-234` 对 20 曲线、固定相位和 0/1234/65000ms 检查路径端点、粒子位置/顺序/数量、半径、alpha、线宽和七状态；与上游默认值及整秒时长匹配。 |
| A21 | passed | specs/curve-profiles/spec.md | Preserve animation phase - **WHEN** durations are edited or states change during a long-running animation - **THEN** existing motion phases remain continuous and subsequent frames use the new durations - **WHEN** the renderer stops or is disabled - **THEN** paused time does not accumulate motion - **AND** non-rotating profiles do not accumulate rotation | `src/halo.js:133-189` 累积独立相位并在停用、恢复或换曲线时重置 elapsed 基准；renderer 检查覆盖时长编辑连续性、停止、禁用和非旋转曲线。 |
| A22 | passed | specs/curve-profiles/spec.md | Use and override a preset - **WHEN** the user selects Heart Wave - **THEN** controls and the save payload contain 104 particles, trail 0.18, loop 9000, pulse 6000, rotation 22000 and stroke 3.9 - **WHEN** particles are changed to 64, loop to 5000 and stroke to 5.5 - **THEN** those exact values render and survive a remount and reload - **WHEN** the current-curve reset action is used - **THEN** only its six animation values return to the reference values | animation-browser 验证 Heart Wave 六项默认值；renderer 检查验证显式 64/5000/5.5 覆盖；浏览器换页、重载和动画重置回归通过。 |
| A23 | passed | specs/curve-profiles/spec.md | Upgrade existing settings - **WHEN** existing settings contain the complete old default animation tuple - **THEN** normalization adopts the selected curve's reference tuple, keeps other settings and remains stable on another load - **WHEN** any of the six old animation values was customized - **THEN** valid custom values remain unchanged | `src-tauri/src/state.rs:326-363,1017-1145` 仅迁移完整旧动画 tuple，按曲线采用整秒默认值并保持幂等；任一自定义项不同则保留，Rust 测试通过。 |
| A24 | passed | specs/curve-profiles/spec.md | Preserve Halo controls - **WHEN** the state changes with custom state colors - **THEN** the new color is reached after 420 ms and motion stays continuous - **WHEN** global opacity or enabled changes - **THEN** opacity and visibility still apply - **WHEN** reduced motion is requested - **THEN** positions remain still while colors can transition | `src/halo.js:35-37,64-95,133-159,185-195` 保留颜色过渡、透明度、enabled 和 motion 逻辑；renderer 检查覆盖 420ms 颜色、运动连续、透明度、禁用及 reduced motion 静止。 |
| A25 | passed | specs/curve-profiles/spec.md | Display the selected control set - **WHEN** 依次选择目录中的全部 20 个预设 - **THEN** 逐项显示上表的控件集合、顺序、标签、默认值、范围与步长，共 89 个实例 - **AND** 不出现参考未暴露的参数或 Fourier Flow | 与 A1 独立来源一致：硬编码期望表、Rust 嵌入目录和浏览器逐 profile DOM 检查共同确认 20 组、89 实例、顺序、标签、默认值、范围及步长。 |
| A26 | passed | specs/curve-profiles/spec.md | Apply values to every geometry consumer - **WHEN** 任一专属参数改为非默认合法值 - **THEN** 公式和坐标按该预设参考表达式使用实际有效值，路径与粒子使用同一配置 - **AND** 当前曲线的入口图与当前项动画预览反映该几何；其他候选使用自身默认值 - **AND** 缺少覆盖值时默认外观保持，原有动画相位与状态反馈继续成立 | `src/halo.js:145-157,176-189` 对路径和粒子复用同一 prepareCurveSettings；公式、当前入口和当前预览接收同一设置，其他候选显式使用空参数默认值；对应单元及浏览器检查通过。 |
| A27 | passed | specs/curve-profiles/spec.md | Save and reload geometry values - **WHEN** 编辑专属参数并完成既有保存，随后切换设置页、重开设置窗口或进行配置序列化往返 - **THEN** 当前预设与自定义几何值保持，公式和实际绘制一致 - **WHEN** 旧配置未包含新字段 - **THEN** 使用其有效曲线的几何默认值，已有动画与非曲线设置保留 | 浏览器验证参数自动保存、换页、页面重载和公式/缩略图一致；`src/settings-store.js:14-50` 深克隆嵌套参数；Rust 验证 AppSettings 序列化及缺字段默认兼容。 |
| A28 | passed | specs/curve-profiles/spec.md | Switch and reset geometry independently - **WHEN** 从自定义预设切换到另一预设 - **THEN** 新预设加载自己的几何默认值与当前六项动画默认值，不残留上一项覆盖 - **WHEN** 使用几何重置、动画重置或重新选择当前项 - **THEN** 分别只重置几何、只重置动画或保持全部自定义值 | `restoreCurveParameters` 与 `restoreCurveAnimation` 独立；浏览器确认换预设无旧值残留、几何重置保留动画、动画重置保留几何、重选当前项保留全部自定义值。 |
| A29 | passed | specs/curve-profiles/spec.md | Validate geometry at the settings boundary - **WHEN** 提交类型错误、非有限数值、超界数值、非整数离散项或不适用参数键 - **THEN** 类型错误与非有限值沿用保存失败路径，有限数值限制范围、离散值取整数，不适用键不能影响当前预设 - **AND** 所有合法极值组合均产生有限坐标，无除零、无效开方或非整数负底数幂 | `src/curves.js:229-246` 和 `src-tauri/src/state.rs:247-307` 实施前后端白名单、有限值、范围和整数规则；JS/Rust 测试覆盖错误类型、NaN/Infinity、未知键、非适用键、上下界及有限坐标。 |
| A30 | passed | specs/curve-profiles/spec.md | Preserve pending edits and save errors - **WHEN** 拖动参数期间到达初次读取、外部事件或较早保存响应 - **THEN** 本地编辑值不被旧快照覆盖，保存队列最终提交最新参数 - **WHEN** 保存失败并随后重试 - **THEN** 失败反馈可见且重试提交用户保留的值，不隐式重置 | `src/settings.js:155-175,655-745` 仅在成功保存且快照仍等于当前值时释放本地编辑；浏览器覆盖初载、外部事件、较早保存响应、失败保值和原负载重试。 |
| A31 | passed | specs/curve-profiles/spec.md | Operate geometry controls in both layouts - **WHEN** 在英文或中文环境用鼠标和原生键盘操作新控件，并在 1130x890 与 390x844 视口检查 - **THEN** 标签、读数、参数区和重置操作均可见或可滚动到达，没有文字重叠和横向溢出 - **AND** 控件保持可访问名称、关联输出与可见焦点，不引入第三方控件库 | 浏览器逐项验证 input 元数据、label/for、output/for、键盘 End 操作和双语文本；1130x890 与 390x844 截图及几何检查确认控件、重置、读数可达且无重叠或横向溢出，无新增依赖。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| Frontend tests | --test src/app.test.mjs src/curve-picker.test.mjs src/curve-parameters.test.mjs | . | passed | 0 | 170 ms |
| Renderer reference and geometry | scripts/check-renderer.mjs | . | passed | 0 | 110 ms |
| Settings view structure | scripts/check-settings-tabs.mjs | . | passed | 0 | 50 ms |
| Native library and binary unit tests | test --manifest-path src-tauri/Cargo.toml --lib --bins --quiet | . | passed | 0 | 5823 ms |
| All-target native compile | check --manifest-path src-tauri/Cargo.toml --all-targets --quiet | . | passed | 0 | 958 ms |
| Preset geometry and picker browser acceptance | scripts/check-curve-picker-browser.mjs | . | passed | 0 | 4138 ms |
| Animation browser regression | scripts/check-animation-browser.mjs | . | passed | 0 | 1649 ms |
| Diff whitespace | diff --check | . | passed | 0 | 40 ms |

## 阻塞项

_无。_

## 风险与跳过的工作

- 真实 Tauri 跨窗口 IPC、实际安装配置文件及正在运行的 codex-halo.exe 未做端到端验收；浏览器证据明确为 IPC substitute。结论依赖已编译的既有 emit/listen 链、Rust AppSettings/事务测试和静态调用链，不把浏览器替身描述为原生实测。
- 未在 macOS WebKit/AppKit 上运行本变更；当前动态控件、JSON 兼容模块和浏览器交互仅在 Windows Edge 环境验收。未发现本变更新增的 macOS 专属代码路径。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | pass | — | 独立复核 brief、两份完整 spec、最终 diff、上游 70f4e00 定义、8 项 Runtime 检查日志及双语桌面/窄屏截图。A1-A31 均有实现与测试或静态契约证据，未发现可执行缺陷；判定通过。 | 2026-09-05T12:52:55.958Z |



## 结论

独立复核 brief、两份完整 spec、最终 diff、上游 70f4e00 定义、8 项 Runtime 检查日志及双语桌面/窄屏截图。A1-A31 均有实现与测试或静态契约证据，未发现可执行缺陷；判定通过。
