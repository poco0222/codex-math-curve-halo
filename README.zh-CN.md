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

macOS 按住 `Command`、Windows 按住 `Ctrl`，用鼠标左键拖动光环即可调整位置。
松开左键或修饰键后自动保存。设置页或托盘中的 **重置位置** 可恢复默认位置。

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

## Windows 远程打包

在 Mac 项目目录运行：

```bash
npm run build:windows
```

默认连接 `Lenovo@192.168.10.114:22`，上传当前工作区的构建源码，包括未提交修改和
未被 Git 忽略的新文件。无需先提交或推送，Windows 端不执行 `git pull`。上传范围
包含前端、Rust、构建脚本和插件资源；不包含 `.git`、编译产物、`.env*` 和本地工具状态。

源码在 Windows 独立临时目录解包，复用
`D:\BuildWorkspace\codex-math-curve-halo\src-tauri\target` 编译缓存，原仓库源码保留。
成功后清理临时源码，失败时保留供排查。MSI 安装包下载到本地 `dist/windows/`（如 `Codex Halo_0.1.0_x64_en-US.msi`），版本取自
本地 `src-tauri/tauri.conf.json`。

Windows 需要可用的 SSH、传统 SCP、`tar` 和原有的 Rust、Tauri、MSVC、Node.js、WiX Toolset v3.14
构建环境。脚本使用 `scp -O`；密码登录时，上传、构建、下载可能各提示一次密码。
同一台设备同时只运行一个构建。

若构建已完成、只需重试下载，可直接取回远端最新成功生成的安装包：

```bash
scp -O Lenovo@192.168.10.114:D:/BuildWorkspace/codex-halo-windows-setup.msi dist/windows/
```

可通过 `WIN_BUILD_HOST`、`WIN_BUILD_USER`、`WIN_BUILD_PORT`、`WIN_BUILD_ROOT` 和
`WIN_BUILD_SSH_KEY` 覆盖连接配置；`WIN_BUILD_ROOT` 指定 Windows 缓存仓库目录。

## Codex Plugin

先安装并启动一次 Codex Halo 原生应用。在 App 设置窗口或托盘菜单点击
**安装 Plugin**。App 会注册安装包内的本地 marketplace，并通过 Codex CLI
安装并启用 `codex-halo`。然后在 `/hooks` 中检查并信任 hooks，最后启动新的
Codex session。

**卸载 Plugin** 会移除 `codex-halo`、旧版 `codex-halo@personal` 安装身份以及本
应用自己的 marketplace 注册；不会移除原生 App、helper、`personal` marketplace
或其他 hooks。安装 Plugin 时，如果 `~/.codex/hooks.json` 中存在旧版 Codex Halo
条目，App 会执行一次带备份的清理；其他条目保持不变。

Plugin helper 使用共享的 `CODEX_HOME/codex-halo/state` 目录。Codex 可能要求用户
检查并信任新的或变更过的 hooks。Plugin 安装不会自动绕过信任步骤。

自有的生命周期 hooks 会同步运行，以保持状态变化与 Codex 事件顺序一致。
`PostToolUse` 会映射回 `thinking`；`Interrupt` 会映射为 `interrupted`；
`Stop` 会映射为 `completed`。带有 `source: "compact"` 的 `SessionStart` 会
映射为 `thinking`；source 字段不会被保存。状态模拟使用 Rust reducer，不会增加
真实 session 计数。

## 多会话光环

每个主线程在同一曲线上显示一个亮芯和连续渐隐光尾。子代理以色段嵌入所属
主线程尾迹，共用运动位置，不增加独立亮芯；头部表示父状态，内部色段读取
对应子状态的配置色。不同主线程仍各有流线，同状态也不合并。状态颜色平滑
过渡，减少动态效果时保留静态多色显示。外观动画设置中的“光晕”开关控制
外围辉光，默认关闭（旧配置同样默认关闭），选择会自动保存。

思考、执行、压缩和等待输入保留最后收到的状态，不因 60 秒无事件消失；完成、
中断保留 3 秒，空闲保留 60 秒。父线程先完成、子状态仍有效时，保留家族流线和
父线程最后已知的头部状态；子代理完成只退出自己的色段。父 `SessionEnd` 清理
该家族已有快照，不影响其他家族。Halo 每次启动先空闲，
只接收事件时间晚于本次启动的新状态；旧快照保留在磁盘，但不恢复流光。
启动前已在运行的任务须等下一次事件才显示。这里显示的是最后已知状态，
不是存活探测：运行期间缺失结束事件仍可能留下流光，直到 Halo 重启。

监听范围是同一 `CODEX_HOME` 下实际触发本插件 Hook 的会话。`SubagentStart`、
`SubagentStop` 必须提供 `agent_id`，通过 `session_id` 关联父线程，分别表达
活动初态（`thinking`）和停止反馈（`completed`）。精细状态需要事件明确携带
子代理身份；无身份事件维持会话级语义，不从对话内容或工具时序猜测归属。
只收到子快照时，所属家族使用空闲色作为父头的中性回退。会话计数表示主线程
家族数，不是代理总数。密集色段保留全部子记录，但小尺寸下不保证逐个辨认。
缺失或迟到事件仍是来源限制；快照清理不等于存活探测或事件顺序保证。

## 设置与诊断

设置中有本地 **导出诊断** 控件。它会下载
`codex-halo-diagnostics.json`，其中只有当前状态名称和 timestamp；不会导出
prompt、transcript、tool、model 或 path 数据。

在 Windows 上，启动时运行会将带引号的当前 executable path 写入当前用户的
`Run` 注册表值。Windows 运行时和注册表检查仍需要 Windows runner。

Windows 打包和原生运行时检查需要 Windows x86_64 MSVC runner。macOS 检查不能
证明 Windows 运行时行为正确。

## 隐私

hook helper 读取 hook 输入中的 `session_id`、可选的 `agent_id` 和生命周期事件
名称，以及用于识别 compact 启动的可选 `source` 字段。快照只保存经过哈希的
身份（包括子代理的父关联）、状态名称和 timestamp。不使用 prompt、
transcript、tool data、model names、paths、network data、telemetry，也不进行 cloud
sync。

## 归属

曲线和粒子概念参考项目 `claude-halo` 与 `math-curve-loaders` 独立重新表达；此处
未复制其源文件。
