# Codex 生命周期实例身份修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 watcher 的 adopted Halo 身份刷新和 PID reuse 风险，保证快速切换、App 重启和手动 Halo 不会误收尾。

**Architecture:** 在 `lifecycle.json` 中保存稳定的本地实例 token，与 PID 一起组成 managed identity。watcher 每轮读取新 config；PID、token 或 Halo path 变化时先清理旧 adopted identity，再接管新 identity。定向 stop 同时携带 PID 和 token，由 Halo 的 single-instance callback 双重校验。

**Tech Stack:** Rust 2021、Tauri 2、现有 `serde`/`serde_json`/`sha2`、Node built-in tests。

**Spec:** `docs/superpowers/specs/2026-09-03-codex-lifecycle-design.md`

## Global Constraints

- 不新增 crate。
- `managed_pid` 缺失时旧 config 仍可读取；新增 token 缺失时不能自动信任旧 PID。
- PID 只作目标索引；token 才是实例 ownership 的第二个校验。
- watcher 只接管当前 config 的 Halo identity；不能按同名进程批量 kill。
- targeted stop 必须同时校验 PID 和 token；PID 相同但 token 不同不得退出当前 Halo。
- watcher 每轮必须刷新 adopted identity；config 的 PID、token、Halo path 改变后不能继续使用旧目标。
- 缺 token 的旧 config 不接管已存在 Halo，只允许 watcher 自己 spawn 的 child。
- 不读取或记录 Codex 命令行参数、prompt、transcript、路径内容；控制命令使用直接 `Command::new`，不走 shell。
- 保留并发颜色功能、`docs/comet/`、生成 sidecar 等未提交改动，不回滚、不覆盖、不暂存。
- 修改 `main.rs`、`src/app.test.mjs` 时只精确 stage 本任务 hunk。
- TDD：先写可编译 RED 测试，再实现 GREEN。
- 提交信息使用中文。

## 文件边界

- Modify: `src-tauri/src/lifecycle.rs`：token、config、adoption refresh、targeted stop。
- Modify: `src-tauri/src/main.rs`：single-instance callback 传递 token。
- Modify: `src/app.test.mjs`：源码契约和 token/刷新行为测试。
- Modify: `docs/superpowers/specs/2026-09-03-codex-lifecycle-design.md`：补实例身份约束。
- Modify: `docs/superpowers/plans/2026-09-03-codex-lifecycle.md`：同步最终 ownership 约束。

## Task 1: 修复生命周期实例身份

- [ ] **Step 1: Write failing tests.**

在 `lifecycle.rs` 测试中加入：

```rust
#[test]
fn missing_managed_token_is_not_trusted() {
    let config = parse_config(br#"{"enabled":true,"halo_path":"/tmp/codex-halo","managed_pid":42}"#).unwrap();
    assert_eq!(config.managed_pid, Some(42));
    assert_eq!(config.managed_token, None);
}

#[test]
fn stop_target_requires_pid_and_token() {
    let args = ["--lifecycle-stop", "42", "token-a"].map(str::to_owned);
    assert!(lifecycle_stop_targets(args.clone(), 42, "token-a"));
    assert!(!lifecycle_stop_targets(args.clone(), 42, "token-b"));
    assert!(!lifecycle_stop_targets(args, 43, "token-a"));
}

#[test]
fn adopted_identity_refreshes_when_config_changes() {
    let configs = [
        LifecycleConfig {
            enabled: true,
            halo_path: PathBuf::from("/tmp/codex-halo-a"),
            managed_pid: Some(42),
            managed_token: Some("token-a".to_owned()),
        },
        LifecycleConfig {
            enabled: true,
            halo_path: PathBuf::from("/tmp/codex-halo-b"),
            managed_pid: Some(43),
            managed_token: Some("token-b".to_owned()),
        },
    ];
    let config_reads = Cell::new(0);
    let mut owned_child = None;
    let mut adopted_pid = None;
    let mut adopted_token = None;
    let mut adopted_halo_path = None;
    let stop_calls = Rc::new(RefCell::new(Vec::new()));
    let stop_log = stop_calls.clone();

    let result = run_with_adopted(
        Path::new("lifecycle.json"),
        &mut owned_child,
        &mut adopted_pid,
        &mut adopted_token,
        &mut adopted_halo_path,
        |_| {
            let index = config_reads.get();
            config_reads.set(index + 1);
            Ok(configs[index.min(configs.len() - 1)].clone())
        },
        || Ok(ProcessPresence { codex_active: true, halo_exists: true }),
        || {},
        |iteration| iteration == 2,
        |_| panic!("must adopt existing Halo"),
        move |path, pid, token| {
            stop_log
                .borrow_mut()
                .push((path.to_owned(), pid, token.to_owned()));
            Ok(())
        },
        |_| {},
    );

    assert!(result.is_ok());
    assert_eq!(
        stop_calls.borrow().as_slice(),
        &[(PathBuf::from("/tmp/codex-halo-a"), 42, "token-a".to_owned())]
    );
    assert_eq!(adopted_pid, Some(43));
    assert_eq!(adopted_token.as_deref(), Some("token-b"));
    assert_eq!(adopted_halo_path, Some(PathBuf::from("/tmp/codex-halo-b")));
}
```

最后一个测试必须使用现有 `watch_iteration`/`run_with_adopted` 测试 harness，记录 targeted stop 的 `(path, pid, token)`，不能只测试一个新的纯比较函数。

- [ ] **Step 2: Run RED.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml lifecycle::tests::missing_managed_token_is_not_trusted -- --exact`

Expected: compile failure because `managed_token` and token-aware stop API do not exist。

- [ ] **Step 3: Implement minimal identity handling.**

在 `LifecycleConfig` 增加：

```rust
pub managed_token: Option<String>,
```

用现有 `sha2` 和 `SystemTime` 生成进程级稳定 token；同一 Halo 进程多次 `sync_app` 必须复用同一 token，不能每次保存设置都变。enabled 时写入当前 PID/token，disabled 时清空二者。

watcher 的 adopted 状态保存 PID、token、Halo path。每次 `watch_iteration` 开始时，如果当前 config 与 adopted identity 任一字段不同，先用旧 identity targeted stop，再清空旧状态；随后按当前 config 接管新 Halo。缺少 token 时不接管现有 Halo，只允许 watcher 自己 spawn 的 child。

targeted stop 参数改为：

```text
--lifecycle-stop <pid> <token>
```

`main.rs` 的 single-instance callback 只有在 PID 和 token 都匹配当前实例时才 `app.exit(0)`。带 stop marker 的无现有实例仍在 setup 直接退出，不显示 UI；普通重复启动仍打开设置。

Windows/macOS 控制仍用直接 `Command::new` 和 `Stdio::null()`；不打印 token、PID、路径或底层错误。

- [ ] **Step 4: Run GREEN.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml lifecycle::tests`

Expected: lifecycle tests pass。

Run: `node --test src/app.test.mjs`

Expected: frontend/source-contract tests pass。

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`

Expected: exit `0`。

- [ ] **Step 5: Update spec and plan.**

明确写出：PID 只是索引，token 才是实例 ownership 的第二个校验；config refresh 必须替换 adopted identity；缺 token 的旧 config 不接管已存在 Halo。

- [ ] **Step 6: Precise commit.**

```bash
git add -p src-tauri/src/lifecycle.rs src-tauri/src/main.rs src/app.test.mjs
git add docs/superpowers/specs/2026-09-03-codex-lifecycle-design.md docs/superpowers/plans/2026-09-03-codex-lifecycle.md
git diff --cached --check
git commit -m "修复: 校验 Codex Halo 实例身份"
```

## Final Verification

- [ ] `node --test src/app.test.mjs scripts/*.test.mjs`
- [ ] `npm run check:renderer`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml --bins`
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- [ ] `git diff --check`
- [ ] Windows/macOS real lifecycle E2E remains `NOT RUN` unless a matching runner/session is available.
