# 目标

设置页改为真正的分段界面：顶层设置只挂载当前分段；颜色配置内部使用横向状态 Tabs，只挂载当前状态的颜色编辑器。用户选择什么，就只看到对应内容。

# 范围

- 顶层分段：Display、Renderer、Colors、Integration、Test。
- 顶层分段使用原生 `<template>` 和 mount/unmount；不再依赖锚点滚动定位。
- Colors 分段使用横向状态 Tabs，覆盖当前契约中的 6 个状态：`idle`、`thinking`、`executing`、`input_needed`、`completed`、`compacting`。
- 当前状态下只挂载一个颜色编辑器，包含 color picker、HEX 输入、颜色预览和 Reset。
- 10 组现有预置色板继续显示在当前状态编辑器下，点击后只修改当前状态。
- 用前端内存 settings model 保存未挂载分段和未激活状态的值；保存时继续提交完整 settings。
- 保留现有控件 ID、`name`、`data-i18n`、`data-state`、`data-color-*`、自动保存、IPC command、事件和双语逻辑。

# 非目标

- 不新增状态；当前代码中的状态仍为 6 个。
- 不改 `AppSettings` 字段、范围、settings JSON、IPC command、事件名称或保存事务。
- 不改 Overlay 渲染算法、Plugin hook、托盘菜单、原生 helper 和其他页面。
- 不引入 React、Vue、UI 框架、图标依赖或第三方组件库。
- 不把设置拆成多个窗口，不引入需要额外持久化的路由系统。

# 验收示例

- A1: 初始打开设置页时只挂载并显示 Display 分段；其余顶层分段不在当前内容 DOM 中。
- A2: 切换顶层分段时，旧分段卸载，新分段挂载；不修改 URL，不滚动到锚点；键盘焦点和 `tab`/`tabpanel` 语义正确。
- A3: Colors 分段显示 6 个横向状态 Tabs；切换状态时只显示当前状态颜色编辑器，当前颜色、HEX、预览、Reset 和 10 组预置色板同步正确。
- A4: 修改任意状态颜色后切换其他顶层分段或状态，再返回时修改值仍保留；保存提交完整 6 色 settings，不覆盖未激活状态。
- A5: 切换 `en` 与 `zh-CN` 后，顶层 tabs、状态 tabs、字段、按钮、预置色板和诊断文本正确更新；窄视口不横向溢出。
- A6: 现有插件操作、诊断导出、位置重置、状态模拟、设置加载、`settings-changed` 和自动保存行为保持不变。

# 约束与不变量

- 状态定义和颜色键保持数据驱动，避免重复维护 6 套颜色编辑器。
- 未挂载控件不能参与 DOM 读取；settings model 是保存完整设置的唯一来源。
- 当前活动 tab 必须有清晰焦点样式，并满足键盘操作和可访问名称。

# 决策

- 采用原生 HTML `<template>` + vanilla JS mount/unmount，不添加前端框架。
- 顶层和颜色内部都采用 Tabs 交互；颜色内部 tab 横向排列，适配窄窗口横向滚动。
- 预置色板是当前状态编辑器的共享操作区，不为每个状态复制 10 套预置色 DOM。

# 待解决问题

无。

# 验证预期

- `node --check src/settings.js`
- `node --test src/app.test.mjs`
- `node scripts/check-renderer.mjs`
- 新增设置分段行为的最小 Node/浏览器检查，覆盖顶层 mount、颜色状态切换和完整 settings 保存。
- 使用真实浏览器渲染检查桌面与窄视口，确认无横向溢出、重叠和不可见活动控件。
