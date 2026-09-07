---
generated_from_state_version: 8
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 1
- 验证器尝试次数: 1
- 完成时间: 2026-09-07T12:33:21.393Z
- 摘要: A1–A13 通过，未发现当前修复范围内的必要修复项。已核对实际实现、六项 Runtime 成功检查及最终 MSI 的哈希、PE、资源和真实 GUI 安装证据；Rust 118 项通过，Node 92 项通过，另有一个显式调用的 Rust 夹具与一项既有可选 SCP 检查跳过。只读验收完成，未改文件或推进 Runtime。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：Windows release 主程序与 watcher 的 PE Subsystem 为 GUI；从桌面启动 Halo，以及运行监测、生命周期管理和 Plugin 子进程时，不产生伴随或闪现的控制台，原有应用行为继续正常。 | 独立读取最终 MSI 提取程序：main/watch PE Subsystem 均为 2。platform::background_command 使用 CREATE_NO_WINDOW，覆盖 tasklist、Plugin CLI 和生命周期启动路径；无控制台与管道回归通过，真实 GUI 和 watcher 运行证据未观察到伴随终端。 |
| A2 | passed | brief.md | A2：debug 调试输出保持可用；Hook 的 `stdin`、`stdout`、退出码及协议回归通过，隐藏后台窗口不切断其管道通信。 | main.rs 与 codex-halo-watch.rs 的 GUI 子系统仅作用于 Windows release；独立读取 debug 测试二进制 Subsystem 为 3，最终 Hook 为 3。Runtime 的 Hook 单测、管道集成测试及 background_process_has_no_console_and_keeps_pipes 均通过。 |
| A3 | passed | brief.md | A3：普通桌面环境未注入 Codex `PATH` 时，能够从已安装的 Windows Codex 桌面目录发现实际可启动的 CLI；保留 `CODEX_BIN`、`PATH` 优先级，不硬编码版本目录，遇到不可启动候选可继续发现。 | plugin.rs:309 的候选顺序保留 CODEX_BIN、PATH，再枚举 LOCALAPPDATA/OpenAI/Codex/bin 下版本目录。Windows 隔离进程回归覆盖无 PATH、空格路径、版本候选、优先级与启动失败回退；最终 MSI GUI 在未注入 Codex PATH 的环境安装成功。 |
| A4 | passed | brief.md | A4：包含完整插件资源的 MSI 产物，在隔离配置与普通桌面 `PATH` 下完成设置页安装，CLI 查询确认 `codex-halo@codex-halo` 已安装；重复安装或失败条件解除后的重试能够成功。 | 最终 MSI SHA256 为 418EBE2DF25EA0335F157E9F0B4A7CF8E01211CD90B91D435311B9BFFE35EE32，大小 4239360 字节。独立核对七项提取资源均存在且与源码哈希一致。gui-final-install.txt 显示安装成功，installed-plugins-final.json 确认目标插件 installed/enabled=true；重复安装、冲突解除后重试亦有真实 GUI 证据。 |
| A5 | passed | brief.md | A5：CLI 不可用、操作超时、已知安装步骤失败和市场冲突可显示各自安全的中英文原因；未知错误使用通用提示，不泄漏原始输出；失败后按钮恢复并可重试。 | i18n.js 的固定消息白名单覆盖 CLI 不可用、超时、安装步骤失败和市场冲突；未知字符串、异常对象及附加敏感内容均回退通用提示。src/app.test.mjs:1169、1205 的双语、按钮恢复、语言切换、诊断清除与重试测试通过。 |
| A6 | passed | brief.md | A6：相关回归确认安装/卸载仍互斥、命令仍有超时、失败仅回滚本次新增市场、同名外部市场受保护，Hook 信任行为保持原样。 | 核对 plugin.rs:92、123、270：安装与卸载仍持有同一全局锁，30 秒超时与仅回滚本次新增市场的条件保持原样。市场归属、Hook 配置保护回归通过，实际同名外部市场冲突被拒绝；动态强制超时、后端并发与回滚未额外执行，列入覆盖限制。 |
| A7 | passed | specs/windows-installed-runtime/spec.md | 从桌面启动并运行后台任务 - **GIVEN** 用户通过 MSI 安装 Windows release 版本 - **WHEN** 从桌面启动 Halo，随后执行进程监测、watcher/Halo 生命周期管理和 Plugin 操作 - **THEN** 主程序与 watcher 的 PE Subsystem 为 `2`，启动和后台操作均无伴随或闪现的控制台 - **AND** Halo 界面、托盘、叠加层与既有监测/生命周期行为正常 | 最终 MSI 提取 payload 的真实设置页可启动并完成 Plugin 安装；main/watch PE=2。watcher-runtime.json 记录监测运行、配置禁用后退出码 0，未观察到控制台子进程。生命周期、托盘、叠加层相关现有回归通过；本轮未替换已注册 MSI。 |
| A8 | passed | specs/windows-installed-runtime/spec.md | 调试或通过管道调用 Hook - **WHEN** 运行 debug 程序，或通过标准输入/输出管道调用 Hook - **THEN** 调试输出保持可用，Hook 接收原有输入并产生协议规定的输出与退出码 - **AND** 无窗口设置不截断管道，不改变 Hook 的信任要求 | Hook 源码及协议未修改。Runtime 的五项 Hook 单测与两项进程集成测试验证 stdin 输入、预期 stdout、成功退出及内容保护；后台命令测试同时验证无控制台和完整 stdin/stdout/stderr，debug 子系统保持控制台类型。 |
| A9 | passed | specs/windows-installed-runtime/spec.md | 普通桌面环境没有 Codex PATH - **GIVEN** 持久化 User + Machine `PATH` 找不到 `codex`，Windows Codex 桌面安装目录存在可启动的版本化 CLI - **WHEN** 用户触发 Plugin 操作 - **THEN** 自动发现并使用该 CLI，目录升级或路径含空格时仍能执行 - **AND** 已提供且可启动的 `CODEX_BIN` 或 `PATH` 候选仍优先 | windows_cli_discovery_preserves_priority_and_retries_only_spawn_failures 通过，实际执行不同目录中的候选并断言所选路径，覆盖空格路径、版本目录变化、CODEX_BIN/PATH 优先级。gui-final-process.json 与最终 CLI 查询证据确认普通桌面 PATH 下可完成安装。 |
| A10 | passed | specs/windows-installed-runtime/spec.md | 候选存在但不能启动 - **GIVEN** 某候选不存在、无权执行或不能启动，另有可启动候选 - **WHEN** 查找 CLI - **THEN** 继续检查后续候选；WindowsApps 的拒绝访问不阻断可用用户目录候选 - **AND** 全部候选不可用时返回安全的 CLI 不可用错误；已启动的 Plugin 命令失败时，不切换候选重复执行写操作 | plugin.rs:278–306 仅在 Windows spawn 失败时继续候选；已启动命令的非零退出、超时及运行错误均直接返回。隔离测试覆盖拒绝执行候选、损坏可执行文件、全部不可用，以及退出码 17 的命令仅执行一次。 |
| A11 | passed | specs/windows-installed-runtime/spec.md | 安装与重试 - **GIVEN** MSI 内插件资源完整，可用 CLI 支持 Plugin，配置可写且不存在同名外部市场冲突 - **WHEN** 在普通桌面环境打开设置页集成并安装 Plugin，或解除上次失败条件后重试 - **THEN** 安装成功，CLI 查询确认 `codex-halo@codex-halo` 已安装，设置页显示成功结果 - **AND** 再次安装仍能成功，不要求用户配置 CLI 路径 | 最终提取程序使用独立 codex-home-final，在真实设置页显示 Plugin 已安装；installed-plugins-final.json 的插件来源指向 msi-final 内打包资源。gui-install-repeat.txt、gui-conflict.txt、gui-retry.txt 分别提供重复安装、失败提示和解除条件后成功重试证据。 |
| A12 | passed | specs/windows-installed-runtime/spec.md | 操作失败后重试 - **WHEN** 出现 CLI 不可用、命令超时、已知安装步骤失败或市场冲突 - **THEN** 中英文界面分别显示对应安全原因，未知错误仍显示通用操作失败提示 - **AND** 操作按钮恢复可用，既有状态区可感知错误，用户可在条件解除后重试 | settings.js:749 的 finally 恢复操作按钮；错误状态保留原始安全类别以支持语言切换，成功后清除诊断。双语固定原因、未知错误隐藏、跨页面失败状态及重试回归通过；既有 role=status 和 aria-live=polite 保留，实际冲突与重试界面证据一致。 |
| A13 | passed | specs/windows-installed-runtime/spec.md | 并发、失败或外部同名市场 - **WHEN** 安装/卸载重叠、命令超过超时、Plugin 安装失败，或发现属于其他根目录的同名市场 - **THEN** 写操作继续互斥，超时仍有界；安装失败仅尝试回滚本次新增市场 - **AND** 外部同名市场不得被覆盖或删除；已有市场、其他插件与 Hook 信任状态不因本次修复被重置 | 当前 diff 未改变安装/卸载互斥、30 秒超时、marketplace_added 回滚条件或市场归属判定。候选命令失败不重复执行的动态测试通过；真实外部同名市场受保护，Hook 信任及无关配置保护回归通过。未新增动态后端并发、强制超时或回滚故障注入。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| Rust regressions | test --manifest-path src-tauri/Cargo.toml | . | passed | 0 | 10294 ms |
| Frontend and packaging regressions | -NoProfile -NonInteractive -Command $env:Path += ';D:\DevTools\Git\bin'; & 'D:\DevTools\NodeJS\node.exe' --test 'src/*.test.mjs' 'scripts/*.test.mjs'; exit $LASTEXITCODE | . | passed | 0 | 367 ms |
| Renderer reference checks | scripts/check-renderer.mjs | . | passed | 0 | 111 ms |
| Settings structure | scripts/check-settings-tabs.mjs | . | passed | 0 | 48 ms |
| Rust formatting | fmt --check --manifest-path src-tauri/Cargo.toml | . | passed | 0 | 137 ms |
| Windows MSI release build | tauri build --bundles msi | . | passed | 0 | 26468 ms |

## 阻塞项

_无。_

## 风险与跳过的工作

- 验证对象为最终 MSI 管理提取后的真实 payload；未替换本机已注册安装，未执行 MSI 升级、修复安装或安装器快捷方式部署验证。
- 后台操作锁、30 秒超时与失败回滚采用当前实现静态核查及相关既有回归；本轮未动态强制后端并发、完整超时或回滚故障。
- GUI 验证使用隔离 CODEX_HOME，未修改真实用户 Codex 插件配置；Halo 原生启动触发现有 settings.json 规范化，文件从 571 字节变为 632 字节，不能声称用户 Halo 设置文件保持字节一致。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | pass | — | A1–A13 通过，未发现当前修复范围内的必要修复项。已核对实际实现、六项 Runtime 成功检查及最终 MSI 的哈希、PE、资源和真实 GUI 安装证据；Rust 118 项通过，Node 92 项通过，另有一个显式调用的 Rust 夹具与一项既有可选 SCP 检查跳过。只读验收完成，未改文件或推进 Runtime。 | 2026-09-07T12:33:21.393Z |



## 结论

A1–A13 通过，未发现当前修复范围内的必要修复项。已核对实际实现、六项 Runtime 成功检查及最终 MSI 的哈希、PE、资源和真实 GUI 安装证据；Rust 118 项通过，Node 92 项通过，另有一个显式调用的 Rust 夹具与一项既有可选 SCP 检查跳过。只读验收完成，未改文件或推进 Runtime。
