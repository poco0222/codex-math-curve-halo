# Outcome

仅补齐现有 20 个曲线预设在参考项目中已经提供、Halo 尚未提供的专属几何设置。选择不同预设时呈现对应控件，编辑值参与公式、预览与桌面光环绘制，并通过既有保存路径持久化。

# Scope

用户原始需求：这个设置还差点东西，参考仓库 `D:\Projects\math-curve-loaders` 的 20 个预设各有不同设置项，这里只处理缺少项。

当前 `src/curves.js` 将全部 `controls` 固定为空，且 `point` 与 `formula` 只使用闭包默认几何；`AppSettings` 尚无几何参数字段。因此范围包含控件、当前预设参数保存、原生校验及全部实际绘制入口的连接。

## Source coverage

参考：`D:\Projects\math-curve-loaders\main.js`，当前提交 `70f4e00a6d452532039ff7c2ccb4c379ec90c772`。本地代码用于核对已存在控件和交互，不将整个参考应用作为迁移需求。下列 20 个定义中的控件、默认值、公式和采样逻辑已完整读取；每个预设的全部控件映射到 `specs/curve-profiles/spec.md` 的“Preset-specific controls”，验收 A1、A2。

| 来源单元 / main.js 行 | 预设 | 专属项数 | 读取 / 覆盖 | Spec / 验收 |
| --- | --- | ---: | --- | --- |
| 75-114 | original-thinking | 4 | complete / covered | Preset-specific controls / A1,A2 |
| 115-153 | thinking-five | 4 | complete / covered | Preset-specific controls / A1,A2 |
| 155-193 | thinking-nine | 4 | complete / covered | Preset-specific controls / A1,A2 |
| 195-232 | rose-orbit | 4 | complete / covered | Preset-specific controls / A1,A2 |
| 234-276 | rose-curve | 6 | complete / covered | Preset-specific controls / A1,A2 |
| 278-317 | rose-two | 5 | complete / covered | Preset-specific controls / A1,A2 |
| 319-358 | rose-three | 5 | complete / covered | Preset-specific controls / A1,A2 |
| 360-399 | rose-four | 5 | complete / covered | Preset-specific controls / A1,A2 |
| 401-440 | lissajous-drift | 5 | complete / covered | Preset-specific controls / A1,A2 |
| 442-475 | lemniscate-bloom | 2 | complete / covered | Preset-specific controls / A1,A2 |
| 477-518 | hypotrochoid-loop | 4 | complete / covered | Preset-specific controls / A1,A2 |
| 520-562 | three-petal-spiral | 5 | complete / covered | Preset-specific controls / A1,A2 |
| 564-607 | four-petal-spiral | 5 | complete / covered | Preset-specific controls / A1,A2 |
| 608-651 | five-petal-spiral | 5 | complete / covered | Preset-specific controls / A1,A2 |
| 652-695 | six-petal-spiral | 5 | complete / covered | Preset-specific controls / A1,A2 |
| 696-739 | butterfly-phase | 5 | complete / covered | Preset-specific controls / A1,A2 |
| 741-777 | cardioid-glow | 3 | complete / covered | Preset-specific controls / A1,A2 |
| 779-817 | cardioid-heart | 3 | complete / covered | Preset-specific controls / A1,A2 |
| 819-865 | heart-wave | 5 | complete / covered | Preset-specific controls / A1,A2 |
| 867-910 | spiral-search | 5 | complete / covered | Preset-specific controls / A1,A2 |
| 65-72 | 六项通用动画控件 | 已存在 | complete / non-goal；保持 Halo 当前范围、秒单位和默认值 | A5 回归 |
| 1135-1169,1419-1423,1557-1591 | 合并专属控件、输入、打开与重置 | 按选中预设实例编辑 | complete / covered；复用 Halo 自动保存及切换语义 | Parameter editing and persistence / A3,A4 |
| 911-963 | fourier-flow | 当前目录外第 21 项 | complete / non-goal；用户限定现有 20 项 | 无需映射 |

共 89 个预设专属控件实例，45 个不同参数键；分组定义可复用，但显示集合、顺序、范围、步长及默认值必须逐预设匹配。

# Non-goals

- 不增加预设、曲线算法、状态、配色、旋转开关或参考未暴露的参数。
- 不重做设置布局、图库、通用动画、时间单位、默认动画值或现有动画重置。
- 不新增每个预设的历史参数档案、导入导出、收藏、撤销栈或第三方依赖。
- 不修改参考仓库、插件集成、窗口定位、生命周期或用户已有 `src-tauri/Cargo.toml` 改动。

# Acceptance examples

- **A1**：逐项遍历 20 个预设，仅显示参考对应的 2-6 项专属控件，共 89 项实例；键、顺序、默认值、范围和步长符合完整 Spec；Rose Two/Three/Four 不显示可调 k，参考未暴露字段及 Fourier Flow 不出现。
- **A2**：对每个专属参数至少选择一个非默认有效值，固定采样相位时公式与几何符合参考计算；路径、粒子、当前曲线入口及当前项预览使用相同有效参数。所有默认曲线保留既有外观，合法边界组合产生有限坐标且没有除零或无效开方。
- **A3**：编辑当前专属参数后沿用自动保存；切换设置页、重新打开设置窗口及配置序列化往返保留值；旧配置缺少新字段时使用当前预设默认值。非有限值或类型错误被拒绝，未知键或其他预设参数不作用于当前曲线；有效数值按范围约束，离散整数项保持整数。
- **A4**：切换另一预设时使用其专属默认值，原有六项动画加载行为继续成立；再次选择当前预设保留自定义值；“重置曲线参数”仅重置当前专属值，现有“重置曲线动画”仅重置原六项动画。保存失败显示现有错误，重试不意外重置参数。
- **A5**：六项动画控件的现有范围、整秒显示与默认值、状态颜色、透明度、位置及集成设置行为保持；候选预览不写入设置、不改变悬浮层，开放曲线不闭合，动画相位、减少动态效果偏好和预览清理保持。
- **A6**：中文与英文标签及读数完整，原生滑块可用键盘操作，标签与输出关联正确；1130x890 和 390x844 视口无文字重叠或横向溢出，所有新控件与重置操作可达。

# Constraints and invariants

- 复用现有 Store、Bridge、串行保存队列、`save_settings` 和 `settings-changed`；只扩展当前预设的几何参数数据。
- 初次加载、后台事件或较早保存响应不能覆盖正在编辑的参数；参数编辑必须作用于所有几何消费者，避免路径与粒子使用不同配置。
- 参考没有暴露的常量继续固定：Rose Two/Three/Four 的 k、Lissajous 相位、Hypotrochoid 两项呼吸增量等。
- 默认坐标继续满足现有 `[-20,120]` 校验；用户调至参考合法范围的极端值可以像参考一样超出逻辑画布，不能通过改变算法或自动适配缩放改变语义。自定义值必须始终有限。
- 当前分支 `main`，当前目录 `D:\Projects\codex-math-curve-halo`；保留用户未提交改动。

# Decisions

- 用户已明确选择当前目录、当前分支开展工作。
- 仅补齐参考实际提供的专属控件；控件沿用现有原生滑块和布局样式。
- 沿用现有预设切换语义：只保存当前预设的参数，切换另一项加载默认值；不新增逐预设历史存储。
- 独立提供“重置曲线参数”，保持现有动画重置行为；当前项缩略图/预览体现实际参数，其余候选使用默认几何。
- 使用单个 Native change。设置、持久化、公式与绘制共享同一参数契约，拆分会反复修改相同核心区域。
- 上述范围与行为随完整 Shape 摘要提交用户最终确认；确认前不修改实现。

# Open questions

无尚待调查或独立决定的问题；等待 Runtime 的最终 Shape 确认边界。

# Verification expectations

- Node：现有 `src/app.test.mjs`、renderer 检查和设置页检查；在现有测试方式中加入参数集合、实际几何、切换重置、保存及边界回归。
- Rust：`AppSettings` 缺省兼容、参数白名单、数值校验与序列化往返测试。
- 浏览器：20 个控件集合，中英文本，键盘操作，正常/失败保存和桌面/窄屏截图；Canvas 像素与运动检查。
- 原生集成与浏览器替身证据分开报告，未执行检查不得标记通过；Builder 复核及独立 Verifier 按 Runtime 推进。

Shape 事实核验：使用 Node 内置 vm 读取参考曲线对象，对照本规格参数表与当前默认值，确认 20 项目录、89 个控件实例、45 个键、全部范围/步长及当前动画默认值匹配。尚未执行实现期功能测试。`comet native check` 返回 `Unsupported Native change schema comet.native.v4 for runtime protocol 3`；随后只读 `doctor` 返回 healthy，并允许继续准备 Shape 确认。不改写 Runtime 状态或安装文件。
