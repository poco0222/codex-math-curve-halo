# Settings Layout

## Requirement: Four-view settings shell

设置窗口 SHALL 使用稳定导航、全局控件及单一活动内容区组成的四页 App Shell。当前页为外观、状态颜色、集成或测试之一，不再将全部分区同时摆入 Dashboard 网格。

### Scenario: Desktop settings window

- **WHEN** 设置页在默认 `1130×890` 或 `760×760` 桌面窗口打开
- **THEN** 四项导航位于侧栏，Codex Halo 品牌仅在一个品牌区出现
- **AND** 内容区标题及用途说明对应当前页，语言选择、Overlay 开关及保存反馈在四页均可用
- **AND** 默认打开外观，仅活动页内容挂载；允许纵向滚动，不产生横向溢出

### Scenario: Narrow settings window

- **WHEN** 可用宽度不足以容纳侧栏与内容，包含 `390px` 宽视口
- **THEN** 导航回流到内容上方，四项入口可见或换行排列
- **AND** 页头控件、设置行、颜色主从区及按钮组按空间回流，DOM 顺序与视觉顺序一致
- **AND** 标签、数值、诊断、公式和对话框内容可读且可操作，无页面横向滚动

## Requirement: Consistent settings visual language

四页 SHALL 使用中性深灰背景、略亮灰色分组面、清晰文字层级、细分隔和少量暖橙交互强调。保留 Halo 曲线缩略图和品牌辨识，不使用白色分组面，不引入主题切换。设置视觉规则覆盖音频分组，不改变音频行为。

### Scenario: Scan settings groups

- **WHEN** 用户依次查看四页
- **THEN** 每页以当前页标题/用途开头，随后显示命名清楚的功能分组
- **AND** 主要标签与控件文字为 `14px`，辅助文案较弱但可读；常规文字对比度不低于 `4.5:1`
- **AND** 同级分组采用一致内边距、标题及边界样式，不重复堆叠同名页标题或品牌
- **AND** 没有新增导航页、搜索、常驻预览或主题切换

### Scenario: Operate consistent controls

- **WHEN** 用户调整滑块、开关或执行重置
- **THEN** 滑块使用细轨道，标签/数值对齐，数值保留单位与精度；轨道变细不缩小可操作区域
- **AND** 开关由原生 checkbox 经 CSS 美化，仍有 label 关联、选中/禁用语义及 Space 键操作
- **AND** 同类动作采用一致按钮层级，重置作为次要操作显示，名称及作用范围可读
- **AND** 焦点可见，交互目标至少 `24×24px`，禁用及选中状态不只靠颜色表达

## Requirement: Preserve settings behavior

布局 SHALL 保留现有控件契约与行为；设置样式限定在设置页，避免改变桌面 Overlay。

### Scenario: Existing control contract

- **WHEN** 设置页加载、重新挂载、切换语言或收到 `settings-changed`
- **THEN** 现有控件 ID、name、设置键、`data-i18n`、状态模拟和颜色字段仍可被控制器读取和更新
- **AND** `en` 与 `zh-CN` 文本完整渲染，动态生成的参数与颜色行采用相同视觉规则

### Scenario: Existing actions

- **WHEN** 用户修改设置、执行插件安装/卸载、导出诊断、重置位置或模拟状态
- **THEN** 原有自动保存、IPC command、事件、参数转换和错误处理保持不变
- **AND** 没有因排版、重绘或导航产生额外写入或丢失未挂载字段

## Requirement: Accessible reading and navigation order

布局 SHALL 保证扫描顺序、DOM 顺序与可访问顺序一致，保留原生表单和对话框语义。

### Scenario: Keyboard and localized rendering

- **WHEN** 用户用键盘遍历控件，或在 `en` 与 `zh-CN` 间切换
- **THEN** 导航和状态列表保留选中语义、方向键/Home/End 操作和可见焦点
- **AND** 标签、辅助文字及错误反馈与控件关联，自动保存和操作状态可被辅助技术读取
- **AND** 文本可换行，不遮挡相邻内容、不裁切控件、不因翻译丢失焦点
- **AND** 曲线对话框可用键盘进入、关闭并恢复焦点，窄屏仍可操作
