# State Color Configuration

## Requirement: Persist independent canonical colors

`AppSettings` SHALL 持久化七个 `<state>_color` 字段，格式为大写 `#RRGGBB`；输入六位十六进制不区分大小写。旧配置缺字段采用以下默认值，规范化完整设置沿既有路径写回；非法颜色保存前失败，损坏文件走既有恢复路径。

| State | Default |
| --- | --- |
| idle | #A7ADB5 |
| thinking | #FF8A3D |
| executing | #339CFF |
| input_needed | #F05252 |
| completed | #35C878 |
| interrupted | #FEBA07 |
| compacting | #A56BFF |

### Scenario: Load and validate colors

- **WHEN** 加载旧配置缺少颜色，或提交合法小写、非法格式的颜色
- **THEN** 缺失项补默认，合法值规范化为大写，非法值在文件写入前失败；损坏配置走原恢复路径

## Requirement: State selection and editing beside preview

光环页 SHALL 在本地预览附近呈现七状态选择，每项包含本地化名称、色块及当前 Hex；始终选中一个状态，默认 `thinking`。选择状态同时切换本地预览和相邻颜色编辑器，不发送桌面模拟或保存命令。编辑器提供选中状态的原生 color picker、可编辑 Hex、单状态重置及可展开的预设调色板；完整保留现有十组共 70 种预设色及精确 Hex，每项一次激活应用到选中状态。

合法编辑 SHALL 仅更改选中状态字段，通过原串行队列自动保存；非法 Hex 草稿保留在所属状态并显示关联的本地化校验，不入队、不污染有效预览颜色。切状态、折叠、切页和回来不丢失草稿，其他状态值不受影响。窄窗状态选择采用紧凑换行布局，编辑器紧随其后，键盘保留方向键/Home/End、选中语义和可见焦点。

### Scenario: Select, edit and verify without page switching

- **WHEN** 用户选择任一状态并用 picker、合法 Hex、70 色中任一预设或重置修改
- **THEN** 仅该状态颜色更新，本地预览立即表达有效颜色，现有自动保存同步桌面外观，无状态模拟调用
- **AND** 两种语言及窄窗中，选择与编辑在同一页相邻可达

### Scenario: Retain invalid drafts

- **WHEN** 用户输入非法 Hex 后切换状态或一级页面，再返回
- **THEN** 对应状态的草稿与错误仍在，有效设置和预览颜色未被污染，非法值未保存

## Requirement: Render and synchronize existing colors

Overlay SHALL 用有效状态色绘制现有发光、描边、阴影和粒子；缺少或无效前端值退回相应默认，不产生非法 CSS/RGB。颜色变化保留 `420ms` 线性过渡及当前 Curve Profiles 的几何、运动、透明度和减少动态效果行为，不新增状态速度差异。

成功保存 SHALL 继续向 `main` 和 `settings` 发出完整规范化设置，桌面无需重启，设置页通过现有完整/部分事件合并更新；保留活动编辑与未挂载值保护。本地预览选中状态不被真实任务状态事件自动切换。

### Scenario: Synchronize effective colors

- **WHEN** 保存合法颜色或接收外部设置更新，随后真实工作状态变化
- **THEN** 两窗口使用有效配置，颜色沿既有过渡切换，运动行为不变；本地编辑状态保持用户选择

## Compatibility

沿用 Rust/serde、原生 HTML、vanilla JavaScript、共享 Store/Bridge 与现有事件；不新增预设 API、截图资源、运行依赖、云同步或主题系统。70 色具体值沿用当前已发布数据，布局变化不改变来源目录。
