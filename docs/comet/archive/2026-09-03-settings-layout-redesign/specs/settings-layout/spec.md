# Settings Layout

## Requirement: Dashboard grid layout

设置窗口 SHALL 使用 Dashboard grid 组织现有设置内容，而不是将所有分区连续堆叠为一条单列长流。

### Scenario: Desktop settings window

- **WHEN** 设置页在约 `760×760` 的桌面窗口中打开
- **THEN** 顶部显示 Codex Halo 标题、语言选择和 Overlay 开关
- **AND** Display、Renderer、Plugin、Diagnostics 以两列语义分组显示
- **AND** State colors 横跨内容区整行显示
- **AND** 现有控件仍可见且不发生横向溢出

### Scenario: Narrow settings window

- **WHEN** 设置页可用宽度小于 `720px`
- **THEN** 网格回流为单列
- **AND** 所有标签、输入框、按钮和诊断文本保持可读
- **AND** 页面不产生横向滚动

## Requirement: Preserve settings behavior

布局改造 SHALL 保留现有设置页的控件契约和行为。

### Scenario: Existing control contract

- **WHEN** 设置页加载、切换语言或收到 `settings-changed`
- **THEN** 现有控件 ID、`data-i18n`、状态模拟和颜色字段仍可被 `src/settings.js` 读取和更新
- **AND** 英文与简体中文文本可以正常渲染

### Scenario: Existing actions

- **WHEN** 用户修改设置、执行插件安装/卸载、导出诊断、重置位置或模拟状态
- **THEN** 现有保存、IPC command 和事件行为保持不变

## Requirement: Visual hierarchy and accessibility

布局 SHALL 优先保证设置操作的扫描顺序和可访问顺序。

### Scenario: Keyboard and localized rendering

- **WHEN** 用户用键盘遍历控件，或页面切换到 `zh-CN`
- **THEN** DOM 顺序、焦点顺序和视觉分组一致
- **AND** 文本不遮挡相邻内容，焦点样式仍清晰可见
