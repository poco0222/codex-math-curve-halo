# Outcome

将 Codex Halo 设置页演进为可持续扩展的类 Web 设置工作台。保留当前 Tauri WebView、原生 HTML/CSS/JS、自动保存、双语、Tauri IPC、Plugin、诊断和现有设置字段契约。

后续设置预计加入默认展示位置、音频联动等能力，因此界面需要支持新增设置域、状态级配置和渐进式展开，而不是继续堆叠独立控件。

# Scope

- 设置页采用 App Shell + View 架构，保持单窗口和单页面。
- 顶层设置区按用户任务组织，当前至少覆盖外观、状态配置、集成和测试。
- 设置 View 只渲染当前选中的内容，保留 strict mount 行为。
- 颜色区重新设计为更易扫描、可扩展到状态级属性的交互。
- 保留现有设置字段、控件 ID、`name`、`data-i18n`、Tauri command、事件和自动保存行为；完整设置由 `settingsStore` 持有。

# Non-goals

- 不在本轮引入 React、Vue、Router 或新的 UI 依赖。
- 不修改 `AppSettings` 字段、JSON 格式、IPC command、事件名称或原生校验。
- 不实现默认展示位置和音频联动本身，只为后续扩展预留清晰边界。

# Acceptance examples

- A1: 设置页使用单窗口 App Shell，默认打开 `Appearance`，并同时展示全局 Overlay、语言和保存状态控件。
- A2: 顶层 View 只有 `Appearance`、`State colors`、`Integration`、`Test`，且同一时刻只挂载当前 View。
- A3: `Appearance` 同时提供当前 Display 与 Renderer 设置，并保留公式反馈。
- A4: `State colors` 使用 Master-Detail，六个状态列表展示色块和 Hex，详情只编辑当前状态。
- A5: 颜色选择器、Hex、恢复默认和预置色继续走自动保存，切换 View 或状态不丢值。
- A6: 共享设置状态、UI 状态和 Tauri Bridge 分离；未来新增 View 或状态级字段不复制保存、错误和事件同步逻辑。
- A7: Plugin、诊断、位置重置、状态模拟、双语、键盘操作和现有控件契约保持可用。
- A8: 桌面、窄窗口和 `en`/`zh-CN` 下无页面级横向溢出、文字遮挡、焦点丢失或未处理控制台错误。

# Constraints and invariants

- 当前六个状态和现有颜色字段保持不变。
- `settingsStore` 作为完整设置和 UI 状态的单一前端来源。
- 真实 Tauri IPC、Plugin 和 Windows 行为不由静态浏览器检查推断。

# Decisions

- 状态颜色采用 Master-Detail：左侧六状态列表，右侧当前状态详情编辑器。
- 当前状态详情作为状态级设置扩展边界，后续可加入音频联动、状态专属动效和提示等字段。
- 顶层 View 收敛为 `Appearance`、`State colors`、`Integration`、`Test`。
- `Appearance` 合并 Display 与 Renderer，减少常用设置之间的跳转。
- 继续使用原生 HTML/CSS/JS、模板挂载和共享 `settingsStore`，不引入 React、Vue 或 Router。
- 未来新增设置域只增加 View 和字段映射，不改变保存协议、IPC command 或事件名称。
- 颜色区使用纵向状态列表 + 详情面板：列表展示状态名、色块和当前 Hex，详情展示当前状态的预览、颜色编辑、恢复默认和预置色。
- 状态详情预留可组合的扩展区，未来音频联动、状态专属动效和提示等状态级设置进入同一详情上下文。
- 前端职责分为 App Shell、View 注册、UI/设置状态和 Tauri Bridge；不引入通用 schema 引擎。
- 用户已确认 App Shell、View Registry、共享状态和 Tauri Bridge 四层架构。

# Open questions

- [blocking] CONFIRM: 确认按当前 Outcome、Scope、Non-goals、A1-A8 和 Decisions 进入实现阶段。

# Verification expectations

- `node --check src/settings.js`
- `node --test src/app.test.mjs scripts/*.test.mjs`
- `npm run check:settings-tabs`
- 真实浏览器检查桌面、窄窗口、中文、键盘、颜色编辑、切换和保存状态。
