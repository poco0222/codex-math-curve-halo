# Outcome

Windows 用户通过 MSI 安装后，Halo 正常启动且不伴随终端；设置页集成能够使用已安装的 Codex CLI 安装 Plugin，失败时显示安全、可辨别、可重试的原因。

# Scope

- 修复 Windows release 主程序、watcher 及相关后台子进程的控制台创建行为。
- 补齐 Windows 桌面安装环境的 CLI 发现，保留 `CODEX_BIN`、`PATH` 和现有非 Windows 路径兼容性。
- 修复设置页丢失 Plugin 安全错误原因的问题，沿用中英文文案、现有状态展示与按钮交互。
- 影响模块：`src-tauri/src/main.rs`、watcher 入口、`platform.rs`、`lifecycle.rs`、`plugin.rs`、`src/settings.js` 及必要的现有测试与打包检查。

# Non-goals

- 不增加 CLI 路径配置界面、CLI 安装器或更新器，不修改系统 `PATH`，不扫描整个磁盘。
- 不修改 Hook 协议、信任要求、插件标识或市场归属规则；不顺带修复其他 Hook 问题或重设计设置页。
- 不自动重装本机 MSI，不改 WindowsApps 权限，不申请管理员权限来运行 CLI。

# Acceptance examples

- A1：Windows release 主程序与 watcher 的 PE Subsystem 为 GUI；从桌面启动 Halo，以及运行监测、生命周期管理和 Plugin 子进程时，不产生伴随或闪现的控制台，原有应用行为继续正常。
- A2：debug 调试输出保持可用；Hook 的 `stdin`、`stdout`、退出码及协议回归通过，隐藏后台窗口不切断其管道通信。
- A3：普通桌面环境未注入 Codex `PATH` 时，能够从已安装的 Windows Codex 桌面目录发现实际可启动的 CLI；保留 `CODEX_BIN`、`PATH` 优先级，不硬编码版本目录，遇到不可启动候选可继续发现。
- A4：包含完整插件资源的 MSI 产物，在隔离配置与普通桌面 `PATH` 下完成设置页安装，CLI 查询确认 `codex-halo@codex-halo` 已安装；重复安装或失败条件解除后的重试能够成功。
- A5：CLI 不可用、操作超时、已知安装步骤失败和市场冲突可显示各自安全的中英文原因；未知错误使用通用提示，不泄漏原始输出；失败后按钮恢复并可重试。
- A6：相关回归确认安装/卸载仍互斥、命令仍有超时、失败仅回滚本次新增市场、同名外部市场受保护，Hook 信任行为保持原样。

# Constraints and invariants

- 高风险边界：后台进程生命周期、外部 CLI 执行、插件配置写入及既有互斥/回滚；改动必须保持这些契约，并有针对性回归证据。
- 沿用现有 30 秒命令超时、全局操作锁、失败回滚、`codex-halo` 市场归属校验与 Hook 信任要求。CLI 命令已启动但失败时，不通过换候选重复执行写操作。
- 只扩展已知桌面安装目录的候选发现；路径包含空格时仍通过参数传递执行。候选文件存在不等于可执行，受保护候选不能挡住后续可用候选。
- 2026-09-07 已核实：本机 MSI 0.1.0 安装在 `D:\Program Files\Codex Halo`，主程序与 watcher 的 PE Subsystem 均为 `3`（CUI），相应源码无 `windows_subsystem`；`platform.rs` 的 `tasklist`、`plugin.rs` 的 `run_codex`、`lifecycle.rs` 的 watcher/Halo 启动均无 Windows 无窗口参数。
- 已核实：MSI 的 7 个插件资源文件齐全；`codex_candidates` 仅有 `CODEX_BIN`、`codex` 和 macOS 固定路径。以持久化 User + Machine `PATH` 执行 `spawnSync('codex', ['--version'])` 得到 `ENOENT`；仅 Codex App 内部环境注入了其 CLI 路径。
- 已核实：`%LOCALAPPDATA%\OpenAI\Codex\bin\8e5b6932251c2c1c\codex.exe` 可执行，版本 `0.153.4`，支持现有 Plugin 参数；WindowsApps 包的 `app/resources/codex.exe` 虽存在，直接启动返回拒绝访问。`plugin marketplace list --json` 成功且无同名市场冲突。
- 已核实：`runPluginAction` 将所有失败泛化，丢失后端已有固定安全错误。调查时无运行中的 Halo，未复现用户原始点击，未改真实插件配置；上述证据定位根因，不等同于修复后的安装验收。

# Decisions

- 使用一个普通 Native change：两个问题共享安装版运行环境与验收，规模无需 Supervisor。
- 最小方案：release GUI/watcher 使用 Windows GUI 子系统，相关后台命令使用 Windows 无窗口启动方式；Hook 保留现有 I/O。
- CLI 查找复用现有候选与执行路径，按 `CODEX_BIN`、`PATH`、Windows 桌面安装目录补充候选；不固定版本/hash，不增加依赖或环境变量配置流程。
- 设置页仅映射后端已知安全错误到现有语言文案；未知错误保持通用提示。
- 实施任务按依赖收敛为：进程窗口修复；CLI 发现修复；安全错误展示；针对性回归与 Windows release/MSI 验证。前两项汇合于安装版运行验收，不拆额外 change。

# Open questions

无。最终 Shape 确认由 Native Runtime 的 `await-user` 边界记录。

# Verification expectations

- 调查基线：`node --test --test-name-pattern 'Codex Halo plugin declares|Codex Halo marketplace|default plugin hooks' scripts/plugin-package.test.mjs` 为 3/3 通过，仅证明相关声明检查通过，不代表真实安装成功。
- 运行与改动相关的 Rust 及 Node 回归，覆盖 A2、A3、A5、A6；复用现有 `cargo test --manifest-path src-tauri/Cargo.toml`、`node --test src/app.test.mjs scripts/plugin-package.test.mjs scripts/build-sidecar.test.mjs` 和必要的新增最小检查。
- 运行 `npm run check:renderer`、`npm run check:settings-tabs`；以已有 `tauri-cli 2.11.4` 执行 `npm run tauri -- build --bundles msi`，沿用 `beforeBuildCommand` 构建 sidecar。旧 MSI 为 `src-tauri/target/release/bundle/msi/Codex Halo_0.1.0_x64_en-US.msi`（4,227,072 bytes），不得作为新版本通过证据。
- 检查新主程序/watcher 的 PE Subsystem 为 `2`（GUI），同时观察真实 release 启动和后台操作的窗口/进程表现；仅检查 PE 字段不足以证明没有子进程闪窗。
- 以持久化 User + Machine `PATH`、隔离 Codex 配置及打包资源执行集成验证，覆盖安装、查询确认、重试、无可用 CLI、不可执行候选和中英文错误。真实用户配置不得因验收被未经授权地删除或覆盖。
- 若完整安装验收需要替换本机现有安装，先明确安装版本、位置与执行范围；本轮不自动重装。未运行的 MSI 安装或 UI 场景须明确记为未验证，不能用单测替代。
