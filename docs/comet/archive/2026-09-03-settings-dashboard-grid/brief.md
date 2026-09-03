# Outcome

设置页从单列长页面改为可扫描的 Dashboard grid。桌面窗口中，相关设置成组并排；窄窗口自动回到单列，现有设置能力和保存行为不变。

# Scope

- 只调整设置页的 HTML 结构、CSS 布局和设置窗口尺寸。
- 顶部保留 Codex Halo 标题、语言选择和 Overlay 开关。
- 中部使用两列：Display、Renderer、Plugin、Diagnostics 按语义分组。
- State colors 横跨整行，状态模拟按钮与颜色配置保持同组。
- 设置窗口默认尺寸调整为 `760×760`；窄窗口使用单列回流。
- 保留现有 `settings.js` 控件 ID、自动保存、插件操作、诊断导出、重置位置、状态模拟、颜色预设和双语逻辑。

# Non-goals

- 不改 Rust 设置数据结构、IPC command、settings.json、事件名称或保存事务。
- 不新增设置功能，不删除现有控件。
- 不改 Overlay 渲染、Plugin hook、托盘菜单和其他页面。
- 不引入 UI 框架或新运行时依赖。

# Acceptance examples

- A1: 在 `760×760` 桌面窗口中，设置页显示顶部总览、中部双栏分组和底部整行 State colors，不再把所有内容排成一条单列长流。
- A2: 在窄于 `720px` 的视口中，所有分区回流为单列；控件、按钮和长文本不发生横向溢出或重叠。
- A3: 切换 `en` 与 `zh-CN` 后，标题、标签、按钮、状态和颜色预置文本仍由现有 i18n 逻辑更新，布局不破坏。
- A4: 现有设置控件 ID 和 DOM 顺序保持可用；自动保存、插件操作、诊断导出、位置重置和状态模拟行为不变。
- A5: 浏览器实渲染检查覆盖桌面和窄视口，结构扫描、JavaScript 检查和现有测试通过；失败或未运行项单独记录。

# Constraints and invariants

- 继续使用原生 HTML/CSS/JavaScript 和现有深色视觉基调。
- 视觉层级服务于 Operate 模式：先看总开关和核心显示，再看渲染参数、集成状态、颜色和模拟。
- DOM 顺序与键盘焦点顺序保持一致，不用 CSS 视觉重排制造反向阅读顺序。
- 固定格式控件使用稳定尺寸；中文、英文和错误状态都允许自然换行。
- 保留 `settings.js` 已使用的 `id`、`name`、`data-i18n`、`data-state`、`data-color-*` 契约。

# Decisions

- 采用视觉辅助中的 `A · Dashboard grid`。
- 使用语义分组网格，不做侧边栏导航或 Tab 状态切换；设置项数量有限，避免增加额外导航成本。
- 桌面容器扩大到 `760px` 级别，以容纳两列；窄视口回到单列。
- 颜色区跨两列，避免六组颜色编辑器被压缩成狭窄列表。

# Open questions

无。

# Verification expectations

- `node --check src/settings.js`
- `node --test src/app.test.mjs`
- `node scripts/check-renderer.mjs`
- `node /Users/PopoY/.agents/skills/impeccable/scripts/detect.mjs --json --scope layout src/settings.html src/styles.css`
- 使用真实浏览器渲染检查 `760×760` 与窄视口，确认无横向溢出、重叠和不可见控件。
