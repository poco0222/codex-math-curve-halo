# 目标

将 Codex Halo 的内置曲线方案从当前 4 项替换为上游画廊的 20 项案例：Original Thinking、Thinking Five、Thinking Nine、Rose Orbit、Rose Curve、Rose Two、Rose Three、Rose Four、Lissajous Drift、Lemniscate Bloom、Hypotrochoid Loop、Three-Petal Spiral、Four-Petal Spiral、Five-Petal Spiral、Six-Petal Spiral、Butterfly Phase、Cardioid Glow、Cardioid Heart、Heart Wave、Spiral Search。`Fourier Flow` 不加入。

# 范围

## Source coverage

- 来源：`https://github.com/Paidax01/math-curve-loaders/blob/70f4e00a6d452532039ff7c2ccb4c379ec90c772/main.js`，完整读取状态：`complete`。该版本的曲线定义位于 `main.js` L76-L958，通用动画参数位于 L65-L72，点采样和动效位于 L1060-L1101。
- 覆盖：20 个目标案例的名称、几何点函数、公式和默认几何参数进入本 change 的完整目标规格与验收 A1；`Fourier Flow` 归类为 `non-goal`，理由是用户明确排除。
- 来源说明：上游仅提供名称，不提供稳定 `id`；本项目生成并固定自己的 kebab-case `curve_id`，不依赖上游运行时 slug。

以下单元均定位于该固定版本 `main.js` 的同名曲线对象；均为 `complete / covered`，名称、默认数学参数与点函数映射到 `specs/curve-profiles/spec.md` 的 Catalog 和 Geometry，验收 A1、A3。上游预览器的专属编辑控件仅作为公式参数说明读取，控件本身属于非目标。

| 来源单元 | 保留语义 |
| --- | --- |
| Original Thinking | 七倍频项的原始轨迹 |
| Thinking Five | 五倍频轨迹变体 |
| Thinking Nine | 九倍频轨迹变体 |
| Rose Orbit | 七倍频半径调制轨道 |
| Rose Curve | k=5 玫瑰曲线 |
| Rose Two | k=2 玫瑰曲线 |
| Rose Three | k=3 玫瑰曲线 |
| Rose Four | k=4 玫瑰曲线 |
| Lissajous Drift | x/y 不同频率及相位 |
| Lemniscate Bloom | 伯努利双纽线 |
| Hypotrochoid Loop | 随脉冲变化的内旋轮线 |
| Three-Petal Spiral | R=3、r=1 的螺旋 |
| Four-Petal Spiral | R=4、r=1 的螺旋 |
| Five-Petal Spiral | R=5、r=1 的螺旋 |
| Six-Petal Spiral | R=6、r=1 的螺旋 |
| Butterfly Phase | 参数范围 0..12π 的蝶形曲线 |
| Cardioid Glow | r=a(1-cos t) 心形线 |
| Cardioid Heart | r=a(1+cos t) 及竖向坐标变换 |
| Heart Wave | 开放的爱心波函数，保留首尾端点 |
| Spiral Search | 四倍转角及余弦半径调制 |

- 公共点/旋转逻辑：`complete / covered`；按目标数学参数采样，保留上游旋转开关/方向，使用本项目已有的脉冲时钟与通用时长；映射 Geometry、Existing animation contract，验收 A3、A5。
- 页面选项名称：`complete / covered`；按页面 20 项顺序且排除 Fourier Flow，映射 Catalog，验收 A1、A2。
- 上游 gallery、预览/代码弹窗、复制、下载、社交链接、说明和视觉样式：`complete / non-goal`；作为实现参考读取，不引入本地设置页。

- 更新 `src/curves.js`：以内置 20 个 profile 替换旧 4 个 profile，保留 `getCurveProfile`、`sampleCurve`、公式输出和边界校验契约。
- 更新 `src/settings.html`、`src/i18n.js`：曲线下拉项和英文/简体中文名称覆盖 20 项，不显示 `Fourier Flow`。
- 更新 `src/app.js`、`src-tauri/src/state.rs`：默认 `curve_id` 指向 `original-thinking`；已移除的 `rose-seven`、`fourier-flow` 读取后回退到新默认方案；仍在目录中的 `lissajous-drift`、`spiral-search` 保持原 ID，不新增 `AppSettings` 字段或持久化协议。
- 更新现有 renderer/self-check 与应用测试，覆盖数量、顺序、名称、公式、有限坐标、默认方案和旧 ID 回退。

# 非目标

- 不复制上游 HTML/CSS/JS 文件；仅按其公开数学定义在现有 renderer 中重表达。
- 不加入 `Fourier Flow`。
- 不新增每条曲线的可编辑参数控件或新的 native 设置字段；现有 Appearance 通用动画控件保持不变。
- 不改变状态颜色、Tauri bridge、窗口生命周期、插件安装或现有工作区未提交改动。

# 验收示例

- **A1**：`curveProfiles` 按上述顺序包含恰好 20 个 profile，且不包含 `fourier-flow`；每个 profile 有稳定 `id`、本地化名称、公式、默认几何参数、`point` 和 `rotate`。
- **A2**：设置页曲线选择器显示恰好这 20 个名称，英文与 `zh-CN` 文案一致；不存在 `Fourier Flow` 选项。
- **A3**：20 个 profile 在 `detailScale` 为 `0`、`0.5`、`1` 和完整采样范围内均返回有限且位于 renderer 既有校验边界 `[-20,120]` 内的坐标；现有 renderer self-check 通过。
- **A4**：默认设置使用 `original-thinking`；`rose-seven`、`fourier-flow` 设置值加载后回退到 `original-thinking`，`lissajous-drift`、`spiral-search` 保持对应目标案例，并可正常保存新值。
- **A5**：现有通用动画控件、公式输出、自动保存、状态切换和跨窗口 `settings-changed` 行为保持可用；相关现有测试与新增曲线检查通过。

# 约束与不变量

- `AppSettings.curve_id` 仍为字符串，native `normalize` 必须保证未知 ID 不导致启动失败，并使用新默认方案。
- 通用 `duration_ms`、`pulse_duration_ms`、`rotation_duration_ms`、`particle_count`、`trail_span`、`stroke_width` 的既有范围不变。
- 7 个 Halo 状态、颜色键、settings Store/Bridge、Tauri command/event 契约不变。
- 曲线点必须保持在现有 100x100 逻辑画布的校验边界内；超出范围的上游尺度需在 profile 内缩放。

# 决策

- 默认方案采用上游首项 `Original Thinking`，稳定 ID 为 `original-thinking`，因为它是画廊的原始加载动画案例。
- 曲线名称和几何定义采用上游固定 commit 的公开内容；本项目仅适配现有 `point(progress, detailScale, settings)` 接口。
- 保留本项目通用动画速度和状态样式；上游每案例的预览器时长、粒子数和线宽不写入 AppSettings，避免扩大持久化契约。
- 用户已确认 ID 修正：仅已移除的 `rose-seven`、`fourier-flow` 与未知 ID 回退；`lissajous-drift`、`spiral-search` 作为目标案例保持可选、可保存。

# 待解决问题

- 无。用户已确认目标、范围与 ID 兼容修正。

# 验证预期

- `node scripts/check-renderer.mjs`
- `node --test src/app.test.mjs scripts/*.test.mjs`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- `git diff --check`
- 真实浏览器核对 20 个选项、中英文、选中项切页保留、桌面/窄屏布局，以及实际 Canvas 非空与运动；浏览器静态预览不冒充 Tauri IPC 保存验证。
- 全量 Node 测试需报告 HEAD 已有的两个窗口尺寸断言失败；独立 `git archive HEAD` 基线已复现期望 960x760、实际 1130x890。使用 `--test-skip-pattern='settings page uses (a responsive settings workbench|the Halo Control Room workbench layout)'` 仅排除这两项后检查其余回归，不能称全量通过。
