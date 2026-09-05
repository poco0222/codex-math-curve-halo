# Curve Preset Picker

## Requirement: Compact entry and complete visual catalog

外观页 SHALL 使用当前曲线的静态缩略图、现有本地化名称和“更换”入口替换可见的曲线下拉框。图库只在打开时占用空间，不永久增加显示与动画参数区的高度。曲线 ID、设置键与控制器读写兼容性 SHALL 保留。

图库 SHALL 是带可访问名称和关闭按钮的模态对话框，展示 Curve Profiles capability 定义的全部 20 个预设，保留其 ID、名称与顺序。当前项使用边框和可访问的选中状态区分，不能只靠颜色。缩略图使用真实曲线数据、统一逻辑画布和固定采样相位，包含完整轮廓；开放曲线不得人为闭合。所有图形使用同一易辨认的中性色，沿用橙色操作强调。

### Scenario: Open the visual catalog

- **WHEN** 用户打开外观页并激活“更换”
- **THEN** 弹层显示现有的全部 20 项真实轮廓和完整本地化名称，无新增或遗漏
- **AND** 初始焦点落在当前项，当前项位于可见区域且明确标记
- **AND** 标准 `1130x890` 窗口中图库为 5 列、4 行，开关弹层不改变背景参数区布局

## Requirement: Local preview without persistence

默认缩略图 SHALL 静止。悬停或键盘聚焦某一项时，最多该项播放局部动画，使用现有 renderer。新候选使用该曲线现有默认动画参数，当前项使用用户当前动画参数。预览使用独立的本地参数副本，能够在桌面悬浮层关闭时查看；预览不得写入共享设置、发送保存命令或改变桌面悬浮层。最后一次明确的悬停或键盘聚焦决定预览项；离开预览目标后恢复静态轮廓。

### Scenario: Browse without changing settings

- **WHEN** 用户悬停、聚焦或通过方向键浏览多个曲线
- **THEN** 同时运行的局部动画至多一个，曲线轮廓与所示名称匹配
- **AND** 已保存曲线、六项动画值、其他设置和实际桌面悬浮层均不因浏览而改变

## Requirement: Explicit application and existing save semantics

只有点击或按 Enter、Space 激活预设才 SHALL 应用选择。新曲线调用现有默认值解析能力，设置 `curve_id` 与粒子数量、尾迹跨度、循环时长、脉冲时长、旋转时长、描边宽度；不得硬编码旧规格中的时长。保存继续走现有共享设置与串行队列，保留未挂载字段与其他设置。

保存开始后 SHALL 显示处理中状态并阻止重复提交；保存成功后关闭弹层，恢复焦点。此处的关闭动作不引入独立“应用”或“取消”提交步骤。

### Scenario: Apply a different preset

- **WHEN** 用户激活与当前曲线不同的预设
- **THEN** 该曲线 ID 与六项现有默认动画值一次提交给现有保存路径
- **AND** 颜色、透明度、位置、语言及集成设置保持原值
- **AND** 保存成功后入口、参数和公式显示新曲线，桌面悬浮层通过既有设置事件更新，弹层关闭并恢复焦点

### Scenario: Keep custom values when selecting the current preset

- **WHEN** 当前曲线已自定义动画参数，且用户再次激活该曲线
- **THEN** 弹层关闭并恢复焦点，全部自定义值保持原样
- **AND** 不执行动画重置或多余保存

### Scenario: Retry a failed application

- **WHEN** 新预设应用的保存失败
- **THEN** 弹层保持打开，显示本地化失败信息和重试操作，全局保存状态为 error
- **AND** 不显示成功，不把局部预览当作已保存结果
- **WHEN** 用户重试
- **THEN** 使用现有保存路径提交当前待保存值，不重复恢复默认值；成功后关闭，失败后仍可重试
- **AND** 失败后关闭弹层不执行回滚或额外保存，现有全局错误状态继续表达未保存结果

## Requirement: Dismissal and lifecycle

关闭按钮、Esc 或点击对话框外的遮罩 SHALL 关闭图库。未执行应用时，关闭不改变任何设置。关闭成功后的焦点返回“更换”；若入口已卸载，焦点交回仍存在的设置页导航。用户在保存过程中关闭时，不取消已经发出的保存，也不撤销用户已明确应用的选择。

图库关闭、外观页卸载或页面隐藏后 SHALL 停止局部动画并移除对应临时监听。外部设置更新继续通过现有合并路径更新当前项和入口；不得把浏览目标保存为新设置，也不得用旧快照覆盖后续更新。

### Scenario: Dismiss an unused preview

- **WHEN** 用户打开并浏览图库后通过关闭按钮、Esc 或遮罩退出，期间没有应用操作
- **THEN** 当前曲线和所有参数保持不变，没有保存请求，焦点返回有效入口

### Scenario: Remount and synchronize the picker

- **WHEN** 用户切换设置页后回到外观页，或收到完整或部分 `settings-changed` 事件
- **THEN** 入口与选中标记从共享设置重新呈现，未挂载字段与自定义参数不丢失
- **AND** 已关闭或卸载的图库没有残留动画循环

## Requirement: Keyboard, responsive layout and localization

图库 SHALL 保持模态焦点约束。Tab 和 Shift+Tab 只在弹层有效控件间移动；方向键在当前网格中移动焦点，Home、End 移至首末项，Enter 和 Space 应用，Esc 关闭。方向键和焦点变化只预览，不提交。所有操作都有可见焦点与可访问名称。

### Scenario: Choose a curve using the keyboard

- **WHEN** 用户只使用键盘打开、浏览、应用或关闭图库
- **THEN** 所有操作均可完成，焦点不会落入背景控件，聚焦与当前使用状态可区分
- **AND** 方向键不发起保存，Enter 或 Space 明确应用，关闭后焦点恢复

### Scenario: Use localized and narrow layouts

- **WHEN** 使用 `en` 或 `zh-CN`，窗口从 `1130x890` 缩小到 `390x844`
- **THEN** 网格减少列数，完整名称可换行且不遮挡缩略图或相邻项
- **AND** 页面没有横向溢出，弹层内容必要时内部纵向滚动，全部 20 项和关闭操作始终可达

### Scenario: Respect reduced motion

- **WHEN** 系统请求 `prefers-reduced-motion`
- **THEN** 所有缩略图和聚焦预览保持静态，选择、焦点及保存反馈正常

## Requirement: Scope and integration boundaries

实现 SHALL 沿用现有暗色视觉、系统字体、中文与英文词典，以及共享设置、Tauri Bridge、命令和事件。不会新增 AppSettings 字段、改变曲线数学定义、扩大状态或配色数量、修改插件集成、添加搜索收藏分类或引入新第三方依赖。

验证 SHALL 区分浏览器替身检查与真实原生集成检查；没有执行过的原生行为不得记为通过。
