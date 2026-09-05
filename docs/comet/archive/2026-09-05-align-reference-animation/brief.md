# 目标

让 Codex Halo 的曲线动画行为尽可能贴近本地参考仓库 `/Users/PopoY/Documents/Projects/math-curve-loaders`（上游 `70f4e00`）：曲线运动、呼吸、旋转、粒子尾迹和轨迹呈现保持参考项目的节奏与形态；继续使用现有 Halo 状态和设置桥接。

# 范围

## Source coverage

- 来源：`/Users/PopoY/Documents/Projects/math-curve-loaders/main.js`，版本 `70f4e00a6d452532039ff7c2ccb4c379ec90c772`。本地副本为实现参考；动画定义与默认参数覆盖状态为 `complete`。
- 参考动画公共参数：`CONTROL_DEFS` 与各曲线对象中的 `particleCount`、`trailSpan`、`durationMs`、`rotationDurationMs`、`pulseDurationMs`、`strokeWidth`、`rotate`。
- 参考动画运行逻辑：`getParticle`、`getDetailScale`、`getRotation`、`renderInstance`、`renderViewer`，完整读取状态：`complete`。
- 当前实现已调查：`src/halo.js` 的 Canvas renderer、`src/curves.js` 的 20 个曲线 profile、`src/app.js`/`src-tauri/src/state.rs` 的通用动画设置合同。

| 来源单元 | 状态及保留语义 | Spec / 验收 |
| --- | --- | --- |
| main.js 20 个已收录曲线对象 | complete / covered；每条曲线全部六项动画默认值及旋转开关 | curve-profiles / Reference animation；A1、A3 |
| main.js buildPath | complete / covered；481点、完整参数域、开放首尾 | curve-profiles / Curve geometry；A2 |
| main.js getParticle | complete / covered；位置、非线性淡出、半径、alpha及头到尾绘制顺序 | curve-profiles / Reference animation；A1、A2 |
| main.js getDetailScale、getRotation、renderInstance | complete / covered；共享随机初始相位、独立时钟、呼吸及负向旋转 | curve-profiles / Reference animation；A1 |
| main.js CONTROL_DEFS | complete / covered；并集范围保留旧合法自定义值，涵盖上游所有默认值 | settings-sliders / Controls；A3、A4 |
| main.js renderViewer | complete / background；大图额外1.35倍粒子不用于112px Halo，以gallery为基准 | 非目标 |
| original.js | complete / background；早期单案例，当前gallery main.js为本次基准 | 非目标 |
| gallery布局、下载、复制、链接、Fourier Flow | non-goal；保留当前产品范围 | 非目标 |

## 已确认差异

- 参考项目按曲线保存动画默认值；当前项目仅有全局动画设置。
- 参考项目使用每实例 `phaseOffset`，呼吸范围为 `0.52..1`，粒子 `fade = (1-tailOffset)^0.56`，半径和透明度按尾迹非线性衰减。
- 当前 renderer 使用全局时长、全局粒子范围、线性衰减和三层 Canvas 发光描边。
- 参考路径和粒子使用 SVG；当前产品 renderer 合同是 Canvas，状态颜色和状态过渡属于现有行为。

## 目标实现边界

- 采用用户选择的对齐深度后，只改曲线动画实现与对应检查；不复制上游页面、弹窗、下载、社交链接或 CSS。
- 保留 20 个曲线 ID、现有 `point(progress, detailScale, settings)`/`rotate(progress)` 接口、七个 Halo 状态、颜色过渡、Tauri settings Store/Bridge 和持久化字段。
- 选择曲线加载对应六项参考参数；滑块值即实际覆盖值并持久化；恢复当前曲线动效只重置六项动画参数。范围扩为旧值与上游值并集。

# 非目标

- 不改曲线数学定义；不加入 `Fourier Flow`。
- 不迁移上游 gallery UI 或 SVG 页面结构。
- 不新增无法由本次决定推导出的 native 持久化字段。
- 不改变状态颜色合同、窗口生命周期、插件安装和其他未提交改动。

# 验收示例

- **A1**：20 个现有曲线在 renderer 中呈现与参考项目一致的进度、呼吸、旋转方向和粒子尾迹节奏；随机相位不会破坏可重复的测试注入。
- **A2**：Canvas 仍输出非空轨迹和粒子；开放曲线保留首尾端点，不人为闭合。
- **A3**：状态颜色、`420ms` 状态过渡、启用开关、透明度、跨窗口设置同步和现有通用动画控件继续工作；用户可见的覆盖语义与最终决定一致。
- **A4**：现有 renderer/self-check、应用测试和 Rust library tests 通过；新增检查覆盖参考动画公式与边界。

# 约束与不变量

- `AppSettings` 仍使用现有 `curve_id`、`particle_count`、`trail_span`、`duration_ms`、`pulse_duration_ms`、`rotation_duration_ms`、`stroke_width` 字段。
- 曲线点仍在逻辑画布 `100x100` 和现有校验边界 `[-20,120]` 内。
- 测试时可注入 `now`、`requestAnimationFrame`、随机相位或等价确定性输入；生产动画可保留参考项目的实例错相。

# 决策

- 用户选择 A：参考动画行为完整对齐。
- 吸收每曲线默认节奏、粒子/尾迹公式、呼吸基线、旋转相位和轨迹透明度；保留 Halo 状态颜色与现有设置字段，并把通用设置明确实现为覆盖机制。
- 用户已明确确认以上范围进入 Build，无需重复确认。单个 change 处理共享 renderer 和设置合同，无独立子 change。
- 状态仅决定颜色并保留420ms颜色过渡，移除旧速度、半径、alpha倍率，使默认动画与上游一致。全局透明度继续生效。
- 参数存储实际数值，不把正常默认数字当作自动标记。切换预设加载该曲线六项默认值；手工值保存后跨切页、重启保持。
- 完整旧默认六元组迁移到所选曲线默认值；含自定义值的配置保留。未新增版本或override字段，因此完整旧默认元组保留为兼容识别值。
- 连续累积相位防止调参、停启及状态切换重放运行时间；系统减少动态效果时保持位置和颜色反馈。

# 待解决问题

- 无。

# 验证预期

- `node scripts/check-renderer.mjs`
- `node --test src/app.test.mjs scripts/*.test.mjs`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- `cargo check --manifest-path src-tauri/Cargo.toml --bins`
- `node scripts/check-settings-tabs.mjs`
- `NODE_PATH=<existing-playwright-modules> node scripts/check-animation-browser.mjs`
- `git diff --check`
- 真实浏览器检查 Canvas 非空、运动、20 个曲线切换、状态颜色过渡和窄屏布局；静态预览不冒充 Tauri IPC 验证。
- 用户要求以正式代码的窗口尺寸为准：两项设置窗口测试断言采用 `1130x890`，与 `src-tauri/src/main.rs` 一致；完整 Node 套件不再排除任何用例。
