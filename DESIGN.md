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
    fontSize: "24px"
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
  compact-gap: "20px"
  section-gap: "24px"
  column-gap: "28px"
  workspace-gap: "40px"
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
    padding: "8px 16px"
  panel:
    backgroundColor: "transparent"
    padding: "0"
  switch:
    rounded: "{rounded.panel}"
    width: "40px"
    height: "24px"
---

## Overview

**Creative North Star: "清晰、克制的暖橙设置台"**

中性深灰承载设置内容，略亮预览面与细分隔线建立层级，暖橙标识动作、选中状态与键盘焦点。系统字体、紧凑控件与明确留白服务快速配置和就地查看效果。

本文记录 `src/styles.css` 中已实现的设置页视觉系统；页面任务与布局意图见 `.impeccable/surfaces/src-settings-html.md`。颜色以 `.settings-page` 局部变量为准，不将根节点旧变量或透明桌面光环当作设置页配色。

**Key Characteristics:**

- 中性深灰分层，平面分组与突出预览，无卡片阴影。
- 暖橙集中表达交互与选中状态。
- 系统字体、细滑块、紧凑开关。
- 双语内容可换行，保留明确焦点和错误反馈。

## Colors

Primary：`accent` 用于安装及应用曲线、开关开启、滑块、音量反馈、品牌图形及焦点；`accent-hover` 用于主要动作悬停和选中文本；`accent-surface` 承载轻量选中背景。

Neutral：`page` 承载页面，沿用名称的 `sidebar` 实际用于样例预览底色，`panel` 用于曲线对话框，`field` 用于控件；设置分组本身透明。`line` 分组，`line-strong` 标识可编辑控件。正文、次级正文、说明分别使用 `text`、`text-soft`、`muted`。

状态色：`saved`、`saving`、`error` 只表达对应反馈。用户配置的七种光环状态颜色是内容，不替代设置界面的强调色。

**The Scoped Palette Rule.** 设置页颜色保留局部作用域，避免改变共享样式表中的透明桌面光环。

## Typography

使用系统无衬线字体，不加载展示字体。页面标题使用 `headline`；对话框标题使用 `dialog-title`；分组标题使用 `title`；正文和标签使用 `body`；帮助与诊断使用 `helper`。品牌字样为 15px、650；辅助说明和保存反馈为 12px。

公式使用 `formula`，可选择且允许长内容换行。数值输出为 13px，使用等宽数字、右对齐；状态项的十六进制颜色使用 11px 等宽字体。预览标题及状态为 14px、600；≤480px 的预览说明为 12px、1.5 行高。层级依靠字号、字重与间距，无大写装饰标签。

## Layout

当前设置壳体最大宽度 1220px，居中。顶部横栏由单一品牌和「光环 / 连接与运行」两个入口组成，内边距 18px 36px，底部细线分隔；导航两项间距 6px。工作区内边距 28px 36px 48px；页头允许换行，标题、语言、启用开关及保存反馈同处一行或自然换行。

宽窗光环工作区为 0.9fr / 1.1fr 两列，间距 40px；预览在左，编辑在右。预览面内边距 22px，距顶部 24px 粘附，方形画布最大 400px。编辑分组内部间距 16px，以细线及 24px 上下留白分隔。双列字段等宽，行列间距 14px / 28px；动画字段为 16px / 24px。连接页内容最大宽度 820px，纵向间距 24px。

- ≤900px：工作区内边距 24px；预览上置并取消粘附，内部为 180px 画布与说明两列，内边距 16px 20px；状态项从宽窗三列改为四列。
- ≤700px：品牌与导航分行，导航保持两等宽列；顶部横栏内边距 16px 20px，工作区内边距 20px；保存反馈独占一行；状态项和曲线选择网格三列。
- ≤480px：顶部横栏内边距 16px，工作区内边距 20px 16px 32px；页头控件、双列字段改为单列；预览画布 120px，预览面内边距 12px；状态项与曲线选择网格两列。常规按钮、选择框及非开关/滑块输入最小高度 40px。

容器与子列保留 `min-width: 0`；长标签、公式、颜色值和诊断允许换行。这些布局值描述当前设置页，页面方向与任务流程仍由 surface brief(页面简报)维护。

## Elevation & Depth

没有 `box-shadow`。背景明度、细分隔线和控件边框建立层级。曲线选择器是原生对话框，以强边框和黑色 72% 遮罩分离背景；内部可滚动，标题粘附。

## Shapes

预览面与对话框使用 `panel` 圆角；输入和按钮使用 `control`；反馈区使用 `feedback`；状态色片使用 `swatch`。设置分组保持透明，无独立卡片外形。开关圆钮、范围控件滑块为圆形；导航无圆点，不将普通按钮做成胶囊。

## Components

- **按钮**：常规最小高度 36px。安装和应用曲线使用实心暖橙；更换曲线使用暖底及暖色文字；次级按钮使用字段底色及强边框；重置与卸载使用透明弱化样式。恢复曲线与关闭提示也采用透明底色，但保留次级正文色。悬停改变底色与边框，过渡为 120ms ease-out。
- **输入与选择框**：使用字段底色、1px 强边框，悬停边框为 `#8d9197`。无效输入采用错误色边框；禁用控件透明度 0.55，指针为不可用。
- **焦点**：按钮、输入、选择框、链接和 disclosure(折叠区)摘要均使用 2px 暖橙轮廓，外偏移 3px。不要移除键盘焦点。
- **导航**：两项顶栏，最小高度 42px，默认透明底与次级文本；活动项使用暖色浅底、暖橙文字和 600 字重。保留 tablist/tab(选项卡组/选项卡)、选中语义及键盘切换；各尺寸均无圆点。
- **分组与折叠区**：透明、无阴影，分组外边距及内边距为 0；通过标题、内容间距及相邻细线组织。高级调整、当前公式、音频可视化和高级诊断使用原生 `details`，默认折叠；摘要上下内边距 17px，内容间距 20px、底部留白 22px。
- **开关与滑块**：开关为 40×24px，圆钮 16px，开启位移 16px，140ms ease-out；范围轨道 4px、圆形滑块 14px，交互区高 28px。
- **样例预览**：使用真实 renderer(渲染器)绘制当前曲线与外观，标题、状态文字和说明始终配套。选状态只改变样例；外观编辑应用到桌面并自动保存。桌面光环关闭时仍显示样例；缩窄时按 Layout 上置，避免遮挡编辑。
- **曲线选择器**：最大宽度 920px，桌面距视口两侧合计 48px，≤700px 合计 24px；保留原生对话框行为。候选曲线使用暖底与强调边框，明确「应用」后提交；族缩略图 64px，变体图 96px。当前曲线入口缩略图 48px，≤480px 为 40px。
- **状态颜色编辑器**：网格状态项最小高度 54px，≤480px 为 52px；16px 色片配标签和等宽颜色值，选中项使用暖底及 `#997356` 边框。下方编辑摘要使用 24px 色片；颜色输入、十六进制输入及恢复动作相邻。预设色折叠展示，色块同时配文字。
- **接入提示**：仅光环页显示可关闭的轻量提示，以底部分隔线连接正文，含「查看接入说明」与「关闭提示」动作；连接页直接展示接入步骤、运行选项及折叠诊断。
- **保存与错误反馈**：状态色配真实文本；错误横幅保留可换行消息。减少动态偏好下取消设置页全部 CSS 过渡。

## Do's and Don'ts

- **Do** 复用局部颜色、系统字体、控件圆角和分组间距。
- **Do** 保留双语换行、数值对齐、键盘焦点及文字状态反馈。
- **Do** 用轻微底色变化和细线建立层级。
- **Don't** 将设置页背景应用于透明桌面光环。
- **Don't** 加入装饰渐变、厚重阴影或无任务目的的动态效果。
- **Don't** 用颜色取代标签、保存消息或错误说明。
