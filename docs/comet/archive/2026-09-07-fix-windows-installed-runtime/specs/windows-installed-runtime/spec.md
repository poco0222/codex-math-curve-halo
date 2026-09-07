# Windows Installed Runtime

## Requirement: 无控制台的安装版运行

Windows release 主程序和 watcher 必须使用 GUI 子系统；Halo 发起的进程查询、Plugin CLI、watcher 和 Halo 生命周期启动必须避免创建可见控制台，保持原有运行行为。（A1）

### Scenario: 从桌面启动并运行后台任务

- **GIVEN** 用户通过 MSI 安装 Windows release 版本
- **WHEN** 从桌面启动 Halo，随后执行进程监测、watcher/Halo 生命周期管理和 Plugin 操作
- **THEN** 主程序与 watcher 的 PE Subsystem 为 `2`，启动和后台操作均无伴随或闪现的控制台
- **AND** Halo 界面、托盘、叠加层与既有监测/生命周期行为正常

## Requirement: 调试与 Hook 通信兼容

窗口隐藏仅作用于需要隐藏的 Windows 运行路径，必须保留 debug 调试输出及 Hook 的现有输入、输出、退出码和信任契约。（A2）

### Scenario: 调试或通过管道调用 Hook

- **WHEN** 运行 debug 程序，或通过标准输入/输出管道调用 Hook
- **THEN** 调试输出保持可用，Hook 接收原有输入并产生协议规定的输出与退出码
- **AND** 无窗口设置不截断管道，不改变 Hook 的信任要求

## Requirement: Windows 桌面 CLI 发现

CLI 发现必须保留 `CODEX_BIN`、`PATH` 优先顺序与现有非 Windows 兼容行为，再从已知 Windows 桌面安装目录发现实际可启动的 CLI。不得硬编码版本/hash、扫描整个磁盘、改系统 `PATH`、安装额外 CLI、提权或改 ACL。（A3）

### Scenario: 普通桌面环境没有 Codex PATH

- **GIVEN** 持久化 User + Machine `PATH` 找不到 `codex`，Windows Codex 桌面安装目录存在可启动的版本化 CLI
- **WHEN** 用户触发 Plugin 操作
- **THEN** 自动发现并使用该 CLI，目录升级或路径含空格时仍能执行
- **AND** 已提供且可启动的 `CODEX_BIN` 或 `PATH` 候选仍优先

### Scenario: 候选存在但不能启动

- **GIVEN** 某候选不存在、无权执行或不能启动，另有可启动候选
- **WHEN** 查找 CLI
- **THEN** 继续检查后续候选；WindowsApps 的拒绝访问不阻断可用用户目录候选
- **AND** 全部候选不可用时返回安全的 CLI 不可用错误；已启动的 Plugin 命令失败时，不切换候选重复执行写操作

## Requirement: 使用 MSI 资源安装插件

安装版必须使用打包的完整市场与 Plugin 资源，按既有标识和 CLI 参数完成安装；重复操作或可恢复失败后的重试必须可用。（A4）

### Scenario: 安装与重试

- **GIVEN** MSI 内插件资源完整，可用 CLI 支持 Plugin，配置可写且不存在同名外部市场冲突
- **WHEN** 在普通桌面环境打开设置页集成并安装 Plugin，或解除上次失败条件后重试
- **THEN** 安装成功，CLI 查询确认 `codex-halo@codex-halo` 已安装，设置页显示成功结果
- **AND** 再次安装仍能成功，不要求用户配置 CLI 路径

## Requirement: 安全且可恢复的错误反馈

设置页必须将已知后端安全错误映射为当前语言的可辨别提示，未知错误使用通用提示；不得直接展示 CLI 原始输出、未知异常内容或敏感路径。（A5）

### Scenario: 操作失败后重试

- **WHEN** 出现 CLI 不可用、命令超时、已知安装步骤失败或市场冲突
- **THEN** 中英文界面分别显示对应安全原因，未知错误仍显示通用操作失败提示
- **AND** 操作按钮恢复可用，既有状态区可感知错误，用户可在条件解除后重试

## Requirement: 保留插件写入保护

安装/卸载必须沿用现有全局操作锁、30 秒命令超时、失败回滚、市场归属保护及 Hook 信任行为，不扩大写入范围。（A6）

### Scenario: 并发、失败或外部同名市场

- **WHEN** 安装/卸载重叠、命令超过超时、Plugin 安装失败，或发现属于其他根目录的同名市场
- **THEN** 写操作继续互斥，超时仍有界；安装失败仅尝试回滚本次新增市场
- **AND** 外部同名市场不得被覆盖或删除；已有市场、其他插件与 Hook 信任状态不因本次修复被重置
