# Outcome

将 Appearance 页面中的数字调节项统一为可访问的原生 HTML range slider，保留清晰的当前值展示，并保持设置、预览和持久化行为稳定。

# Scope

## Source coverage

- `codex-clipboard-939fe4e9-5f75-45ed-97b2-322d8271fce5.png`：`complete`。覆盖截图中 Appearance 页可见的曲线选择、不透明度、X/Y 偏移、粒子数量、轨迹跨度、三个时长参数、线条宽度、公式展示和整体布局。图片只提供 UI 参考，没有面向 Agent 的执行指令。
- 用户确认的范围：`complete`。数字调节项改为 slider；曲线方案、公式和其他非数字控件保持原控件语义。

## Functional scope

- 将 `opacity`、`offset_x`、`offset_y`、`particle_count`、`trail_span`、`duration_ms`、`pulse_duration_ms`、`rotation_duration_ms`、`stroke_width` 渲染为 `input[type="range"]`。
- 为每个 slider 提供关联的当前值 `output`，支持拖动和键盘调整。
- 保留 `curve_id` 的 `select` 和 `formula` 的只读展示。
- 保持现有设置 key、设置桥接、外部 `settings-changed` 同步和错误处理。
- 为连续参数使用已确认的 UI/native 范围：`duration_ms` 500-1500、`pulse_duration_ms` 500-2000、`rotation_duration_ms` 500-3000、`particle_count` 80-140、`stroke_width` 1.0-5.0。

# Non-goals

- 不把曲线方案、颜色、语言、checkbox、按钮或公式改成 slider。
- 不重构设置存储、Tauri command、渲染器架构或颜色编辑器。
- 不修复本变更之前已经存在的窗口尺寸断言失败。

# Acceptance examples

- A1：Appearance 页的九个数字字段都是 `type="range"`，范围和步长分别符合既定约束；曲线方案仍是 `select`，公式仍是只读 `output`。
- A2：用户拖动或用键盘调整任一 slider 时，当前值按正确精度更新，关联 label/output 可访问，设置模型收到数值而非字符串。
- A3：外部 `settings-changed` 事件、初始加载和 Appearance 重新挂载后，所有 slider 与当前值展示同步，未改变的本地编辑不被覆盖。
- A4：保存后的设置继续到达 overlay 和 settings 窗口；renderer 使用的数值保持有限、正值或对应范围内，不改变现有保存错误处理。
- A5：越界设置经 native normalize 后落在对应允许范围；响应式布局不溢出，renderer/settings 结构检查通过。

# Constraints and invariants

- `opacity`: `0.1..1`, step `0.01`。
- `offset_x`, `offset_y`: `-2000..2000`, step `1`。
- `particle_count`: `80..140`, step `1`。
- `trail_span`: `0.12..0.68`, step `0.01`。
- `duration_ms`: `500..1500`, step `1`。
- `pulse_duration_ms`: `500..2000`, step `1`。
- `rotation_duration_ms`: `500..3000`, step `1`。
- `stroke_width`: `1.0..5.0`, step `0.1`。
- slider 必须保留原生键盘操作和可见 focus 状态；动态值不得遮挡 label 或相邻内容。
- 外部设置仍通过既有 Store/Bridge 路径进入，不新增第二套持久化协议。

# Decisions

- 采用原生 HTML `input[type="range"]`，复用现有 CSS、事件绑定和设置模型。
- 仅数字设置改为 slider；离散选择和只读信息保留原语义。
- 采用用户确认的逐字段范围，使 UI、native normalize 和 renderer clamp 一致。
- 使用每个字段旁的 `output` 展示精确值；格式化逻辑按字段精度区分，避免只显示粗略百分比。

# Open questions

无。

# Verification expectations

- `npm run check:renderer`
- `npm run check:settings-tabs`
- `node src/app.test.mjs`，记录与本变更无关的既有失败。
- `cargo test --manifest-path src-tauri/Cargo.toml state::tests`；若运行中的 `codex-halo.exe` 锁定构建产物，记录阻塞并在进程释放后重试。
