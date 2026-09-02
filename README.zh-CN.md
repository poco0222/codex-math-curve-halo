# Codex Halo

[English](README.md)

Codex Halo 是一个小型 Tauri 桌面伴侣应用，用透明、可穿透点击的数学光环
显示 Codex 生命周期状态。

设置窗口支持 `English` 和 `简体中文`，默认使用 `English`，语言选择保存在本地
应用设置中。

## 本地运行

依赖：Rust、Cargo、Node.js 和 Tauri CLI。

```bash
npm run build:sidecar
cargo tauri dev
```

应用启动时显示空闲光环，并隐藏设置窗口。可从托盘或菜单栏打开设置。设置以
JSON 格式保存在 Tauri 应用配置目录中。

macOS 打包时，使用带目标后缀的 helper 并执行打包：

```bash
cargo tauri build --target aarch64-apple-darwin
```

## Codex Plugin hooks

推荐使用 `codex-halo` Plugin。先安装并启动 Codex Halo 原生应用一次，再通过本地
或团队 marketplace 添加 Plugin，启用后在 `/hooks` 中检查并信任 hooks，最后启动
新的 Codex session。原生应用会把 helper 安装到 `CODEX_HOME/codex-halo`；Plugin
负责生命周期 hooks，Tauri 应用继续负责光环、托盘、设置和 reducer。

兼容用的 **安装兼容 hooks** 仍保留给已有安装和迁移场景，只会改动
`~/.codex/hooks.json` 中 Codex Halo 自有条目，并保留其他 hooks。**移除兼容 hooks**
也只删除 Codex Halo 条目。已有手动安装时，在启用 Plugin 后执行一次移除即可避免
重复监听。Plugin 和兼容流程都不会自动信任 hooks。

自有的 `SessionStart`、`Stop` 和 `SessionEnd` hooks 会同步运行，以保持状态变化
与 Codex 事件顺序一致。带有 `source: "compact"` 的 `SessionStart` 会映射为
`thinking`；source 字段不会被保存。状态模拟使用 Rust reducer，不会增加真实
session 计数。

## 设置与诊断

设置中有本地 **导出诊断** 控件。它会下载
`codex-halo-diagnostics.json`，其中只有当前状态名称和 timestamp；不会导出
prompt、transcript、tool、model 或 path 数据。

在 Windows 上，启动时运行会将带引号的当前 executable path 写入当前用户的
`Run` 注册表值。Windows 运行时和注册表检查仍需要 Windows runner。

Windows 打包和原生运行时检查需要 Windows x86_64 MSVC runner。macOS 检查不能
证明 Windows 运行时行为正确。

## 隐私

hook helper 读取 hook 输入中的 `session_id` 和生命周期事件名称，并在处理
`SessionStart` 输入时读取可选的 `source` 字段，用于识别 `source: "compact"`。它只
保存经过哈希的 session identifier、状态名称和 timestamp。不使用 prompt、
transcript、tool data、model names、paths、network data、telemetry，也不进行 cloud
sync。

## 归属

曲线和粒子概念参考项目 `claude-halo` 与 `math-curve-loaders` 独立重新表达；此处
未复制其源文件。
