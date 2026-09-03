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

## 随 Codex 启停

启用 **随 Codex 启停** 后，由原生 App 管理内置的 `codex-halo-watch` watcher，
并支持 Codex CLI 和桌面 App 进程：

- 所有支持的 Codex CLI 和桌面 App 进程共用一个 combined active set。只要还有任意
  一个支持的 Codex 进程，Halo 就保持；包括 CLI 与桌面 App 混合运行时，也要等所有
  支持的 Codex 进程都退出后，自动管理的 Halo 才退出。
- 桌面 App 内部 session 不改变这条进程级规则；只有桌面 App 进程影响 active set。
- watcher 只会关闭它自己启动的 Halo。手动启动的 Halo 不会被关闭。

`start_at_login` 保持独立含义：它只控制原生 App 是否在登录时启动，不控制随
Codex 启停。

macOS 打包时，使用带目标后缀的 helper 并执行打包：

```bash
cargo tauri build --target aarch64-apple-darwin
```

## Codex Plugin

先安装并启动一次 Codex Halo 原生应用。在 App 设置窗口或托盘菜单点击
**安装 Plugin**。App 会注册安装包内的本地 marketplace，并通过 Codex CLI
安装并启用 `codex-halo`。然后在 `/hooks` 中检查并信任 hooks，最后启动新的
Codex session。

**卸载 Plugin** 只移除 `codex-halo` 和它的 marketplace 注册，不会移除原生 App、
helper 或其他 hooks。安装 Plugin 时，如果 `~/.codex/hooks.json` 中存在旧版
Codex Halo 条目，App 会执行一次带备份的清理；其他条目保持不变。

Plugin helper 使用共享的 `CODEX_HOME/codex-halo/state` 目录。Codex 可能要求用户
检查并信任新的或变更过的 hooks。Plugin 安装不会自动绕过信任步骤。

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
