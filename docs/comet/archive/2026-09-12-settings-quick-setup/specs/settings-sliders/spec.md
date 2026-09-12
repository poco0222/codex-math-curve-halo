# Settings Sliders

## Requirement: Native controls with progressive disclosure

光环页 SHALL 使用原生 range 调节数值。透明度及原生 Glow checkbox 默认可见；六动画滑块与当前曲线几何滑块放在高级调整折叠区，公式在独立 details 中保持只读 output。曲线通过 Curve Preset Picker 选择，控制器可保留内部 select 兼容绑定，但用户不必操作重复下拉。位置由桌面拖动调整，不显示 X/Y 控件。

| Setting | Persisted bounds | UI min / max / step | Display |
| --- | --- | --- | --- |
| opacity | 0.1..1 | 0.1 / 1 / 0.01 | whole percent |
| particle_count | 24..140 | 24 / 140 / 1 | integer |
| trail_span | 0.12..0.68 | 0.12 / 0.68 / 0.01 | two decimals |
| duration_ms | 500..12000 ms | 1 / 12 / 1 seconds | seconds, retain existing fractional value |
| pulse_duration_ms | 500..10000 ms | 1 / 10 / 1 seconds | seconds, retain existing fractional value |
| rotation_duration_ms | 500..60000 ms | 1 / 60 / 1 seconds | seconds, retain existing fractional value |
| stroke_width | 1..7.5 | 1 / 7.5 / 0.1 | one decimal |

时长 SHALL 持久化毫秒，用户直接操作 slider 时秒值转换为毫秒；旧有效非整秒值仍保留在共享设置和读数中，挂载、导航、折叠或改其他字段不得把它舍入到 UI 步长。有限值遵守既有边界，非法输入不得进入 renderer。几何参数元数据、默认值和精度按 Curve Profiles。

### Scenario: Access basic and advanced sliders

- **WHEN** 用户打开光环并展开高级调整
- **THEN** 透明度和 Glow 默认可达，六动画及适用几何有原生控件、可见关联标签和 output，公式只读且可单独展开
- **AND** 不提供位置滑块，参数范围、步长及读数遵守上表及 Curve Profiles

## Requirement: Numeric editing and exact-value preservation

每个 slider SHALL 有 `for/id` 标签、关联 output、正确单位和足够精度；保留原生方向键、可见焦点和可读值。用户编辑更新有限数值，自动保存走既有串行队列。曲线应用加载六动画默认值与几何默认值，无特殊默认数值哨兵；动画重置只改六字段，几何重置只改几何，均不改透明度、Glow、颜色、音频、位置和集成设置。

### Scenario: Edit duration and preserve legacy precision

- **WHEN** 已保存有效非整秒时长，用户切页、展开折叠、切语言或编辑其他字段
- **THEN** 原毫秒值和真实秒数读数保留，未因控件重新挂载产生量化或保存
- **WHEN** 用户明确拖动时长到某整秒刻度
- **THEN** 将该秒数乘以 1000 保存，曲线默认值和独立重置仍按原元数据执行

## Requirement: Shared state, validation and layout

滑块 SHALL 从共享设置同步，保留初始延迟加载、较早响应、部分事件、正在编辑与未挂载值保护。保存失败遵守 Settings Workbench 的最新值重试与错误反馈。原生校验继续保证有限、合法边界的数值；不能通过重排绕过校验。

### Scenario: Synchronize and reject invalid values

- **WHEN** 收到设置更新或原生边界处理非法、非有限、超界值
- **THEN** 活动编辑保护有效，renderer 仅收到既有规范化或错误处理允许的有效值，失败可见且不宣称成功
- **AND** `en`、`zh-CN` 及窄窗下标签、数值、焦点和错误均可读，无重叠或横向溢出

## Non-goals

不引入 slider 库、新的持久化路径或参数值模型；不改变定位、音频采集或插件行为。
