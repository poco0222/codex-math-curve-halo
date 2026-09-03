# Codex 生命周期联动设计

## 1. 目标

增加一个持久化设置 `follow_codex_lifecycle`。勾选后，Codex Halo 在检测到
Codex CLI 或 Codex 桌面 App 运行时启动；所有支持的 Codex 进程都退出后，
由自动功能启动的 Codex Halo 退出。CLI 和桌面 App 使用一个 combined active set，
因此混合运行时也必须等所有支持的 Codex 进程退出。取消勾选后停止自动联动，不影响现有的
`start_at_login` 设置。

## 2. 范围与边界

- CLI 进程名：`codex`、`codex.exe`。
- 桌面进程名：`ChatGPT`、`ChatGPT.exe`、`Codex`、`Codex.exe`。
- CLI 和桌面 App 使用一个 combined active set；所有支持的匹配进程退出后才收尾。
- 桌面 App 只按进程生命周期参与 active set；只结束一个桌面内的 session 不改变规则。
- 设置默认关闭，保证旧配置和旧启动行为不变。
- 自动功能只管理它自己启动的 Halo 子进程；用户手动启动的 Halo 不被强制关闭。
- 不读取命令行参数、prompt、transcript、路径内容，不联网。
- 当前项目已有 macOS、Windows 运行时边界；其他平台返回不支持，不伪装成功。

## 3. 方案

新增独立的 `codex-halo-watch` native sidecar（原生辅助进程）。它在用户登录时
启动，轮询平台进程列表，并按状态边沿管理 Halo 子进程：

```text
macOS/Windows login
        |
        v
codex-halo-watch --config <private lifecycle config>
        |
        +-- Codex CLI/Desktop absent -> no managed Halo
        +-- Codex appears           -> spawn or adopt managed Halo
        +-- Codex disappears        -> stop owned child or target adopted App PID
```

选择 sidecar 的原因：Halo 自身退出后仍需有触发点检测 Codex；让 Halo 登录时
常驻只能隐藏窗口，不能满足进程退出语义。CLI hook 继续只负责状态快照，避免把
显示状态和进程生命周期绑在同一条 hook 路径上。

## 4. 配置与生命周期

### 4.1 设置

`AppSettings` 增加：

```rust
pub follow_codex_lifecycle: bool,
```

前端设置页增加中英文 checkbox：

- English: `Follow Codex lifecycle`
- 简体中文：`随 Codex 启停`

checkbox 复用现有 `readSettings`、`applySettings`、串行保存队列和
`settings-changed` 事件。

### 4.2 私有运行文件

原生 App 启动时，将两个 bundled sidecar 安装到稳定的私有目录：

```text
CODEX_HOME/codex-halo/codex-halo-hook
CODEX_HOME/codex-halo/codex-halo-watch
```

新增 `lifecycle.json`，内容保存联动开关、Halo executable 路径和当前 App PID：

```json
{
  "enabled": true,
  "halo_path": "/absolute/path/to/codex-halo",
  "managed_pid": 12345
}
```

文件和目录沿用现有私有权限策略。watcher 从 `--config` 读取绝对配置路径，
不依赖登录进程是否继承了 shell 的 `CODEX_HOME`。旧 config 缺少
`managed_pid` 时按 `None` 兼容；禁用时清除该字段。

启用时 `sync_app` 写入当前 Halo App 的绝对 executable 路径和 PID。watcher 只有在
Codex active、没有自己 spawn 的 child、且进程列表发现 Halo 时，才从
`managed_pid` 接管该 Halo。Codex 全部退出后，watcher 只对该 PID 通过直接
`Command::new(halo_path)` 调用 `--lifecycle-stop <pid>`；不按进程名批量关闭。

### 4.3 勾选与取消

勾选时，保存事务按此顺序执行：

1. 写入 `lifecycle.json`。
2. 注册 watcher 登录启动项。
3. 启动一个 detached watcher；若已有 watcher，不重复启动。
4. 写入 `settings.json`。

任一步失败，回滚已完成的副作用和设置文件，并返回固定的安全错误类别。

取消时：

1. 将 `lifecycle.json` 标记为 disabled。
2. watcher 读取到 disabled 后，先退出它自己启动的 Halo，或对已接管的 App PID 发出
   定向 stop，再退出 watcher。
3. 删除 watcher 登录启动项。
4. 写入 `settings.json`。

现有 `start_at_login` 仍只控制 Halo 本体，不被复用或隐式修改。

## 5. 平台实现

### macOS

- 使用用户级 `~/Library/LaunchAgents/com.codex-halo.lifecycle.plist`。
- `ProgramArguments` 指向 watcher 和绝对 `--config` 路径。
- 通过 `launchctl bootstrap` / `bootout` 切换当前用户的登录项。
- 不使用 shell 拼接命令；plist 中的字符串做 XML 转义。

### Windows

- 使用 `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`。
- 新值名为 `Codex Halo Lifecycle`，值为带引号的 watcher 路径和 `--config` 参数。
- 复用当前 `windows-sys` Registry 能力和路径引用规则。

### 进程检测

- macOS 使用 `ps -axo comm=`，只比较可执行文件 basename。
- Windows 使用 `tasklist /FO CSV /NH`，只解析进程名列。
- 比较大小写不敏感；`codex-halo`、`codex-halo-watch` 不匹配 `codex`。
- 轮询周期为 500ms。该实现保持依赖最小；若未来需要更低开销，再替换为原生
  进程通知，不提前引入新 crate。

## 6. 主 App 交互

- `build_windows` 安装 watcher sidecar；若持久化设置已开启，刷新配置、登录项和
  watcher。
- `save_settings` 在 `follow_codex_lifecycle` 改变时调用生命周期配置事务。
- watcher 启动 Halo 时使用当前 executable 路径，不通过 shell，不继承无关 stdin/stdout。
- watcher 分开保存自己 spawn 的 `Child` 和 adopted PID；Codex 仍 active 时可回收并
  重启 owned child。Codex 全部退出时，owned child 用 `kill` 并等待回收，adopted PID
  用 `--lifecycle-stop <pid>` 定向关闭。
- `--lifecycle-stop <pid>` 通过 single-instance callback 处理：目标 PID 等于当前 App
  PID 时调用 `app.exit(0)`；普通重复启动仍打开设置。无现有实例时，带 stop 参数的
  首实例在 setup 直接退出且不显示 UI。
- Plugin hooks 只写生命周期状态快照；原生 App 独立管理 watcher 和 Halo App 启停。
- Halo 的托盘 `Quit` 不删除已启用的 watcher；用户再次启动 Codex 时仍可自动拉起 Halo。
- watcher 或 Halo 启动失败只记录固定错误类别，不能阻断 Codex 或覆盖设置文件。

## 7. 文件边界

### 新增

- `src-tauri/src/lifecycle.rs`：配置结构、进程检测、watcher 状态循环、Halo 子进程管理。
- `src-tauri/src/bin/codex-halo-watch.rs`：解析 `--config` 并调用 lifecycle watcher。
- `docs/superpowers/specs/2026-09-03-codex-lifecycle-design.md`：本设计。

### 修改

- `src-tauri/src/state.rs`：新增设置字段和默认值。
- `src-tauri/src/main.rs`：安装 sidecar、启动/刷新生命周期配置、保存事务接入。
- `src-tauri/src/platform.rs`：macOS LaunchAgent、Windows Run 注册项和安全错误类别。
- `src-tauri/src/hook_protocol.rs`：复用私有安装逻辑安装第二个 sidecar。
- `src-tauri/src/lib.rs`：导出 lifecycle 模块。
- `src-tauri/Cargo.toml`：注册 watcher binary。
- `src-tauri/tauri.conf.json`：加入第二个 `externalBin`。
- `scripts/build-sidecar.mjs`：构建并复制两个目标后缀 sidecar。
- `scripts/build-sidecar.test.mjs`：覆盖两个 sidecar 名称和目标路径。
- `src/settings.html`、`src/settings.js`、`src/i18n.js`：设置控件、读取保存和翻译。
- `src/app.test.mjs`：前端字段、默认值和设置页契约。
- `src-tauri/src/lifecycle.rs`、`platform.rs`、`state.rs` 测试：进程名解析、状态边沿、
  配置兼容、平台启动命令和回滚行为。
- `README.md`、`README.zh-CN.md`、`plugins/codex-halo/README.md`：说明自动联动和边界。

## 8. 错误与安全

- 配置 JSON 损坏时不覆盖原文件；沿用现有设置恢复规则或禁用生命周期 watcher，保持
  Halo 可手动启动。
- LaunchAgent/Registry 失败返回 `codex-lifecycle:<category>`，前端只显示固定类别。
- 不输出 executable 路径、进程命令行和 hook 输入。
- 不删除用户其他 LaunchAgent、Registry 值或 Codex hooks。
- watcher 退出不影响 Codex 进程；所有 watcher 操作均为 best effort。

## 9. 验证

### 自动验证

- JavaScript：`node --test src/app.test.mjs`。
- Sidecar：`npm run test:build-sidecar`。
- Renderer：`npm run check:renderer`。
- Rust：`cargo test --manifest-path src-tauri/Cargo.toml`。
- 编译：`cargo check --manifest-path src-tauri/Cargo.toml --bins`。
- 静态检查：`git diff --check`，并显式检查未跟踪文件。

### 手动验证

- macOS：CLI 单进程、多 CLI、ChatGPT/Codex 桌面 App 的启动和关闭边沿；LaunchAgent
  登录启动；取消勾选后 watcher 与自动 Halo 都退出。
- Windows：同样的 CLI/桌面进程边沿和 `HKCU` Run 项；Windows runner 验证，不用 macOS
  结果替代。
- 手动启动 Halo 后关闭 Codex，确认手动实例不被 watcher 关闭。
- 确认现有 `start_at_login`、Plugin hooks、设置回滚行为不回归。

## 10. 非目标

- 不按 Codex 桌面 App 内部 session 数量控制 Halo 进程。
- 不自动安装、信任或修改 Codex Plugin hooks。
- 不新增网络服务、数据库、遥测或自动更新。
- 不把现有 `start_at_login` 改成生命周期联动开关。
