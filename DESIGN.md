---
name: Codex Halo Settings
description: 中性深灰、暖橙强调的现代桌面设置界面。
colors:
  accent: "#f5a66a"
  accent-hover: "#ffc397"
  accent-surface: "#38312b"
  accent-ink: "#26190f"
  page: "#171819"
  sidebar: "#1d1e20"
  panel: "#202123"
  field: "#292b2e"
  field-hover: "#323437"
  line: "#35373a"
  line-strong: "#61656b"
  text: "#f1f1f2"
  text-soft: "#d4d5d8"
  muted: "#a6a9ae"
  saved: "#a8dab9"
  saving: "#ffd29e"
  error: "#ffaaaa"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  dialog-title:
    fontSize: "20px"
    fontWeight: 650
  title:
    fontSize: "16px"
    fontWeight: 650
    lineHeight: "24px"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    lineHeight: 1.5
  helper:
    fontSize: "13px"
    lineHeight: 1.6
  formula:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    lineHeight: 1.7
rounded:
  swatch: "4px"
  control: "6px"
  feedback: "8px"
  panel: "12px"
spacing:
  field-gap: "4px"
  action-gap: "8px"
  subsection-gap: "12px"
  control-gap: "16px"
  compact-panel: "20px"
  panel: "24px"
  column-gap: "28px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
  navigation-active:
    backgroundColor: "{colors.accent-surface}"
    textColor: "{colors.accent-hover}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    padding: "24px"
  switch:
    rounded: "{rounded.panel}"
    width: "40px"
    height: "24px"
---

## Overview

**Creative North Star: "清晰、克制的暖橙设置台"**

中性深灰承载设置内容，略亮分组面建立层级，暖橙标识动作、选中状态与键盘焦点。系统字体、紧凑控件与明确留白服务快速扫描和持续调整。

本文记录 `src/styles.css` 中已实现的设置页视觉系统；页面任务与布局意图见 `.impeccable/surfaces/src-settings-html.md`。颜色以 `.settings-page` 局部变量为准，不将根节点旧变量或透明桌面光环当作设置页配色。

**Key Characteristics:**

- 中性深灰分层，无卡片阴影。
- 暖橙集中表达交互与选中状态。
- 系统字体、细滑块、紧凑开关。
- 双语内容可换行，保留明确焦点和错误反馈。

## Colors

Primary：`accent` 用于安装动作、开关开启、滑块、音量反馈、品牌图形及焦点；`accent-hover` 用于主要动作悬停和选中文本；`accent-surface` 承载轻量选中背景。

Neutral：`page`、`sidebar`、`panel`、`field` 构成背景层次；`line` 分组，`line-strong` 标识可编辑控件。正文、次级正文、说明分别使用 `text`、`text-soft`、`muted`。

状态色：`saved`、`saving`、`error` 只表达对应反馈。用户配置的七种光环状态颜色是内容，不替代设置界面的强调色。

**The Scoped Palette Rule.** 设置页颜色保留局部作用域，避免改变共享样式表中的透明桌面光环。

## Typography

使用系统无衬线字体，不加载展示字体。页面标题使用 `headline`；对话框标题使用 `dialog-title`；分组标题使用 `title`；正文和标签使用 `body`；帮助与诊断使用 `helper`。品牌字样为 15px、650；辅助说明和保存反馈为 12px。

公式使用 `formula`，可选择且允许长内容换行。数值输出为 13px，使用等宽数字、右对齐；十六进制颜色使用 12px 等宽字体。层级依靠字号、字重与间距，无大写装饰标签。

## Layout

当前设置壳体最大宽度 1320px，居中；桌面侧栏 196px，顶部粘附，工作区为剩余宽度。工作区内边距 32px 36px 48px；分组间距 24px，分组内部间距 18px。双列字段使用等宽列，行列间距为 14px 与 28px。

- ≤1000px：侧栏 168px；工作区内边距 28px 24px 40px；分组内边距 20px；状态颜色主从区域改为单列。
- ≤700px：侧栏转为顶部区域，分类导航四列；工作区内边距 24px 20px 36px；曲线选择网格三列。
- ≤480px：导航与曲线选择网格两列；字段单列；工作区内边距 24px 16px 32px；分组内边距 18px；常规按钮、选择框和非开关/滑块输入最小高度 40px。

容器与子列保留 `min-width: 0`；长标签、公式、颜色值和诊断允许换行。响应式规则属于现有设置页，不强制其他产品表面采用同一侧栏。

## Elevation & Depth

没有 `box-shadow`。背景明度、细分隔线和控件边框建立层级。曲线选择器是原生对话框，以强边框和黑色 72% 遮罩分离背景；内部可滚动，标题粘附。

## Shapes

分组与对话框使用 `panel` 圆角；输入、按钮与状态色预览使用 `control`；反馈区使用 `feedback`；小色片使用 `swatch`。导航圆点、开关滑块、范围控件滑块为圆形；不将普通按钮做成胶囊。

## Components

- **按钮**：常规最小高度 36px。安装动作使用实心暖橙；次级按钮使用字段底色及强边框；重置与卸载使用透明弱化样式。悬停改变底色与边框，过渡为 120ms ease-out。
- **输入与选择框**：使用字段底色、1px 强边框，悬停边框为 `#8d9197`。无效输入采用错误色边框；禁用控件透明度 0.55，指针为不可用。
- **焦点**：按钮、输入、选择框、链接和 disclosure(折叠区)摘要均使用 2px 暖橙轮廓，外偏移 3px。不要移除键盘焦点。
- **导航**：最小高度 44px，默认次级文本；活动项使用暖色浅底、暖橙文字及实心圆点。移动端隐藏圆点，保留文字选中态。
- **分组容器**：无边框、无阴影，标题与内容使用明确网格间距；内部分区采用细线与 20–24px 顶部留白。
- **开关与滑块**：开关为 40×24px，圆钮 16px，开启位移 16px，140ms ease-out；范围轨道 4px、圆形滑块 14px，交互区高 28px。
- **曲线选择器**：最大宽度 920px，桌面距视口两侧合计 48px，移动端合计 24px；保留原生对话框行为。选中曲线使用暖底与强调边框；族缩略图 64px，变体图 96px，现有画布仅覆盖局部预览。
- **状态颜色编辑器**：状态行最小高度 60px，28px 色块配标签和等宽颜色值；选中行使用暖底及 `#997356` 边框。预设色折叠展示，色块同时配文字。
- **保存与错误反馈**：状态色配真实文本；错误横幅保留可换行消息。减少动态偏好下取消设置页全部 CSS 过渡。

## Do's and Don'ts

- **Do** 复用局部颜色、系统字体、控件圆角和分组间距。
- **Do** 保留双语换行、数值对齐、键盘焦点及文字状态反馈。
- **Do** 用轻微底色变化和细线建立层级。
- **Don't** 将设置页背景应用于透明桌面光环。
- **Don't** 加入装饰渐变、厚重阴影或无任务目的的动态效果。
- **Don't** 用颜色取代标签、保存消息或错误说明。
