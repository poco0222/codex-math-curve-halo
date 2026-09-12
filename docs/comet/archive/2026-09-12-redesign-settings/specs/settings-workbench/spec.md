# Settings Workbench

## Requirement: Extensible settings shell

The settings page SHALL use a single-window App Shell with a stable navigation area, global controls, and one active content View.

### Scenario: Open settings

- **WHEN** the settings page opens
- **THEN** the App Shell shows the Codex Halo identity once, the global Overlay toggle, language selector, and save status
- **AND** the default View is `Appearance`
- **AND** only the active View is mounted in the content host

### Scenario: Navigate between Views

- **WHEN** the user selects `Appearance`, `State colors`, `Integration`, or `Test`
- **THEN** the selected View replaces the previous View in the content host
- **AND** the page heading and purpose description identify the selected View in the current language
- **AND** the active navigation item exposes the selected state
- **AND** focus and keyboard navigation remain available

## Requirement: Appearance View

The `Appearance` View SHALL contain Curve scheme and Renderer sections in one coherent work area, without adding another navigation View. The Curve scheme section presents the current thumbnail, family and preset name, Change entry, current geometry controls with a separate reset, and the read-only formula, in that order. The formula stays visible below its controls.

The Renderer section contains global opacity and the existing six animation settings: particle count, trail span, loop timing, pulse timing, rotation timing, and stroke width. Opacity is visually separate from the six animation controls and their reset; it remains a global value and is excluded from preset application and animation reset. Geometry controls, geometry reset and formula belong only to Curve scheme.

Sections use the shared neutral dark-gray settings surfaces, compact rows, aligned slider values, and secondary reset actions defined in Settings Layout. The surface is only slightly lighter than the background; no white cards or theme switch are introduced. Controls adapt between columns and stacked rows as space allows, with DOM and keyboard order following the visual order. Position is adjusted by dragging the desktop overlay as defined in Overlay Positioning; no X/Y offset editor is shown.

### Scenario: Configure appearance

- **WHEN** the `Appearance` View is active
- **THEN** Curve scheme contains the family/preset entry, current geometry controls and geometry reset, followed by the active formula
- **AND** Renderer contains opacity, particle count, trail span, loop timing, pulse timing, rotation timing, stroke width, Glow, and the animation reset
- **AND** no geometry control or formula remains in Renderer, and opacity is not part of Curve scheme
- **AND** the default and narrow layouts keep both sections and their actions visible or reachable by vertical scrolling without horizontal overflow
- **AND** the remaining control IDs, names, and setting keys remain usable by the controller

## Requirement: State colors Master-Detail editor

The `State colors` View SHALL use a Master-Detail layout for the seven existing Halo states.

### Scenario: Scan color states

- **WHEN** the `State colors` View is active
- **THEN** the state list shows `idle`, `thinking`, `executing`, `input_needed`, `completed`, `interrupted`, and `compacting`
- **AND** each row shows the localized state label, current color swatch, and current Hex value
- **AND** exactly one row is selected

### Scenario: Edit selected state

- **WHEN** the user selects a state row
- **THEN** the detail panel shows that state's preview, native color picker, Hex input, reset action, and preset palette disclosure
- **AND** changing the picker, valid Hex input, preset, or reset action updates only the selected state's color
- **AND** the change uses the existing automatic save path

### Scenario: Extend state details

- **WHEN** a future state-level setting such as audio linkage or state-specific animation is added
- **THEN** it can be added to the selected state's detail context without changing the state list interaction
- **AND** the current seven-state color contract remains intact

### Scenario: Use colors on a narrow viewport

- **WHEN** the available width is below the desktop layout threshold
- **THEN** the state list and detail panel stack vertically
- **AND** the page does not require document-level horizontal scrolling
- **AND** the selected state, editor controls, and validation message remain visible

## Requirement: Shared settings state and bridge

The frontend SHALL keep settings data, UI state, and Tauri communication as separate responsibilities.

### Scenario: Load settings

- **WHEN** the page loads
- **THEN** the Tauri Bridge requests the complete `AppSettings` value
- **AND** the shared settings state becomes the source of truth for mounted and unmounted controls
- **AND** the active View renders from that state

### Scenario: Save a setting

- **WHEN** the user changes a setting
- **THEN** the shared settings state is updated
- **AND** save requests remain serialized through the existing queue
- **AND** the UI exposes ready, saving, saved, and error feedback

### Scenario: Receive an external settings update

- **WHEN** a `settings-changed` event contains a complete or partial payload
- **THEN** the payload merges into the shared settings state
- **AND** unmounted values and inactive state colors are not erased
- **AND** the active control is not unexpectedly overwritten while it is being edited

### Scenario: Add a future settings View

- **WHEN** a future domain such as default position or audio is introduced
- **THEN** the frontend can register a new View and its field bindings without duplicating save, error, localization, or event synchronization logic
- **AND** native fields, commands, or events are added only by a separate capability change

## Requirement: Accessibility and localization preservation

The redesign SHALL preserve current behavior and provide accessible, localized controls.

### Scenario: Localize the settings page

- **WHEN** the user switches between `en` and `zh-CN`
- **THEN** shell labels, View labels, form labels, state labels, preset labels, status text, and diagnostics are localized
- **AND** localized text wraps without overlap or loss of focus

### Scenario: Use keyboard controls

- **WHEN** the user navigates the shell, View navigation, state list, and form controls with a keyboard
- **THEN** focus order follows the DOM order
- **AND** active navigation and selected state are announced through appropriate ARIA state
- **AND** visible focus remains clear


## Requirement: Unified four-view presentation

设置工作区 SHALL 保留现有四项导航。桌面使用侧栏，窄屏将导航放到内容上方。品牌仅出现一次，当前页有本地化标题及用途说明。全部页面、动态控件和曲线对话框遵循 Settings Layout：中性深灰、略亮分组面、14px 主要控件文字、紧凑行和少量暖橙。不得新增搜索、主题、导航页或常驻预览。

### Scenario: Render each View at supported widths

- **WHEN** 各页分别在 `1130×890`、`760×760`、`390px` 宽及两种语言下显示
- **THEN** 全局控件、页面操作和状态反馈可达，无页面横向滚动
- **AND** 导航、分组标题、控件及次要重置采用一致视觉规则
- **AND** 公式、长诊断、校验反馈和对话框内容换行后不覆盖相邻控件
- **AND** 状态颜色主从区在空间不足时垂直排列

## Requirement: Curve selection preservation

曲线选择 SHALL 保留家族/预设浏览、当前缩略图/名称、几何和动画默认值、显式应用、取消、重试及绘制生命周期。不增加第二个预览区，不折叠隐藏公式。

### Scenario: Browse and apply a curve

- **WHEN** 用户打开对话框浏览家族或预设
- **THEN** 全部既有选项可操作，浏览不触发保存
- **AND** 关闭或取消保留已应用选择，并将焦点恢复到入口
- **WHEN** 用户应用预设
- **THEN** 几何及动画默认值通过现有保存路径应用，不改变全局不透明度
- **AND** 保存失败保留可见错误和重试入口
- **AND** 关闭对话框或离开外观页清理绘制和监听，返回时不重复绑定

### Scenario: Reset appearance parameters

- **WHEN** 用户执行几何参数重置或动画重置
- **THEN** 操作保留当前作用范围及所选曲线默认值
- **AND** 几何重置更新参数和可见公式；动画重置不改变几何参数与全局不透明度
- **AND** 参数范围、精度、秒/毫秒转换保持不变
- **AND** 挂载控件或切换语言不舍入已保存值

## Requirement: Audio controls within Renderer

Renderer SHALL 通过独立标题及留白或分隔，将音频可视化与六项动画参数清晰区分。音频包含系统音频开关、本地处理/来源说明、强度及映射说明、电平、状态、条件帮助和重试。音频功能规格的行为保持有效；旧 unframed 外观措辞由 Settings Layout 统一分组视觉替代，不改变采集、权限、IPC、订阅或生命周期。

### Scenario: Inspect audio controls and feedback

- **WHEN** 外观页显示
- **THEN** 音频在 Renderer 内有独立可见分组标题，不新增导航页
- **AND** 强度仅按原有 capturing/silent 规则启用，百分比转换与禁用行为保持不变
- **AND** off、starting、capturing、silent、awaiting-audio、paused、unsupported、权限、error 和 stale 的状态/帮助/重试条件保持不变
- **AND** 电平逐帧更新不持续播报，离散状态变化仍可被辅助技术读取
- **AND** 重试中禁止重复激活；切页不增加音频订阅

## Requirement: Integration and Test preservation

集成页 SHALL 清晰分组插件设置、诊断和运行选项。测试页保留七项状态模拟，使用相同设置视觉规则。不改变原生命令或载荷。

### Scenario: Manage integration

- **WHEN** 集成页显示
- **THEN** 安装/卸载、插件状态、诊断、重置位置、导出诊断、登录启动和跟随 Codex 生命周期均可用
- **AND** 插件操作保留进行中禁用、成功提示及本地化失败反馈
- **AND** 诊断保留状态、时间、错误信息及现有导出内容
- **AND** 重置位置和运行选项使用原有命令/保存及错误处理路径

### Scenario: Simulate existing states

- **WHEN** 用户在测试页选择状态操作
- **THEN** 完整操作集仍为 `idle`、`thinking`、`executing`、`input_needed`、`completed`、`interrupted`、`compacting`
- **AND** 每项以相同状态值调用现有模拟命令
- **AND** 成功响应更新诊断，错误通过现有反馈显示，不报告虚假成功

## Requirement: Editing and save invariants

视觉修改 SHALL 保留初次加载保护、串行保存队列、部分事件合并、未挂载值、非法颜色草稿及错误处理。

### Scenario: Preserve edits across asynchronous updates

- **WHEN** 设置延迟加载、连续修改排队保存、页面重新挂载或收到部分 `settings-changed` 事件
- **THEN** 受保护本地编辑及未挂载字段按既有规则保留
- **AND** 导航、页头更新或纯样式修改不产生额外保存
- **AND** shell 持续提供 ready/saving/saved/error 反馈

### Scenario: Reject an invalid color draft

- **WHEN** 用户输入非法 Hex，或离开并重新打开对应状态/页面
- **THEN** 草稿及本地化校验保留在对应状态，非法值不持久化
- **AND** 合法编辑、预设和重置仅通过自动保存更新选中状态
