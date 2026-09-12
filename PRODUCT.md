# Codex Halo

<!-- impeccable:product-schema 1 -->

## Platform

web

HTML/CSS/JavaScript 设置界面运行于 Tauri 桌面窗口。

## Users

使用 Codex、需要通过桌面光环识别任务状态的用户。主要使用方式是快速配置后长期使用，偶尔调整外观或排障。

## Product Purpose

通过曲线、动画和状态颜色呈现 Codex 状态。设置页帮助用户选好效果、确认接入并放心关闭窗口。

## Capabilities and Constraints

- 两个设置页面：光环、连接与运行。光环页把本地预览、状态选择和配色放在同一任务流程。
- 保留曲线选择及参数、动画、系统音频响应、七种状态颜色、插件操作与诊断。
- 保留中英文、自动保存、键盘操作、错误反馈及当前原生接口。
- 设置页改造不更换技术栈或重写光环渲染与存储协议。
- 本地预览不覆盖真实桌面任务状态；高级诊断中的桌面测试明确表达影响。
- 曲线先选择候选、再明确应用；恢复仅覆盖曲线及动画参数。保存失败可重试最新值。
- 接入信息只表达实际证据，不把没有事件当作断线；不增加作品库、云同步或插件探测服务。

## Brand Commitments

保留 Codex Halo 名称与曲线辨识度。用户确认以快速配置为目标全面重构交互和信息结构；沿用中性深灰、暖橙、系统字体，以光环预览为视觉焦点，保留全部现有功能。

## Evidence on Hand

现有实现位于 src/settings.html、src/settings.js、src/styles.css；产品说明位于 README.zh-CN.md。CC Switch 官方设置页源码仅作设计参考。
