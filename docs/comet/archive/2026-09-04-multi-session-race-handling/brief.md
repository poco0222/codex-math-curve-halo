# 目标

补齐当前遗漏的 Codex Hook 事件映射，并区分正常完成与用户中断。

# 范围

- 新增 `PostToolUse` Hook，映射到 `thinking`。
- 新增 `Interrupt` Hook，映射到新的 `interrupted` 状态。
- 保持 `Stop` 映射到 `completed`。
- 将 `interrupted` 接入 Rust 状态合同、snapshot、reducer、Web 设置颜色、默认配置、标签和测试。
- `interrupted` 默认沿用 `completed` 的 `3s` 展示期限，之后回到 `idle`。

# 非目标

- 不处理多 session 或多线程并发、事件乱序、文件写入竞态。
- 不新增或接入 `SubagentStart`、`SubagentStop`。
- 不新增独立的 `PostToolUseFailure` Hook。
- 不改变现有状态的其他语义、颜色合同和 Plugin 安装边界。

# 验收示例

- `Stop` 产生 `completed`，不产生 `interrupted`。
- `Interrupt` 产生 `interrupted`，并且与 `completed` 使用不同的状态值和颜色配置。
- `PostToolUse` 产生 `thinking`。
- `interrupted` 在 `3s` 后按现有过期规则回到 `idle`。
- 既有状态相关设置、序列化和测试不丢失；新增状态在所有状态列表和颜色配置中完整出现。

# 约束与不变量

- `HaloState` 的 wire value 使用 `interrupted`。
- `SessionEnd` 仍然删除 session snapshot。
- Hook 成功调用继续输出 `{}`，未知事件继续 best-effort 忽略。

# 决策

- 用户要求区分“正常完成”和“用户中断”，因此 `Interrupt` 不映射为 `idle` 或 `completed`，而是新增 `interrupted`。
- 本 change 只解决事件覆盖和状态表达，不处理并发一致性。

# 待解决问题

- 无。

# 验证预期

- Rust 单元测试覆盖事件映射、wire value、过期规则和 reducer。
- Plugin package 测试覆盖新增 Hook 声明及 matcher。
- Web 测试覆盖状态颜色配置、标签和状态列表。
