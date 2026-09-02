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

## Codex hooks

在设置中使用 **安装 hooks**，将 Codex Halo 自有的生命周期命令添加到用户级
Codex hooks 配置 `~/.codex/hooks.json` 中。Codex 可能要求用户检查并信任新增或
变更的 hooks。**移除 hooks** 只会删除 Codex Halo 的条目。已安装的命令会调用
复制到应用数据目录中的 helper，并使用 `--state-dir` 传入该应用的 `state` 目录；
更新时会在同一路径替换 helper。安装 hooks 不会自动信任它们。

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
