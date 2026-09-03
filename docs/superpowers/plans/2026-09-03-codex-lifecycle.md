# Codex 生命周期联动实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加 `follow_codex_lifecycle` 设置，用独立 watcher 在 Codex CLI 或桌面 App 出现时启动 Codex Halo，并在所有支持的 Codex 进程退出后关闭自动管理的 Halo。

**Architecture:** 新增 `codex-halo-watch` native sidecar。它在 macOS LaunchAgent 或 Windows `HKCU` Run 项中登录启动，读取私有 `lifecycle.json`，轮询平台进程列表，并维护独立的 owned child 与 adopted PID 状态。CLI 与桌面 App 使用一个 combined active set；现有 `start_at_login` 与 Codex 生命周期联动完全分开。

**Tech Stack:** Rust 2021、Tauri 2、`serde`/`serde_json`、现有 `windows-sys` Registry API、Vanilla JavaScript、Node built-in test runner。

**Spec:** `docs/superpowers/specs/2026-09-03-codex-lifecycle-design.md`

## Global Constraints

- `follow_codex_lifecycle` 默认值必须为 `false`，旧 `settings.json` 缺少该字段时正常加载。
- CLI 匹配 `codex` / `codex.exe`；桌面匹配 `ChatGPT` / `ChatGPT.exe` / `Codex` / `Codex.exe`。
- CLI 与桌面 App 共享一个 combined active set；所有支持的匹配进程退出后才关闭自动 Halo。
- `lifecycle.json` 的 `managed_pid` 记录当前 Halo App PID；旧 config 缺字段按 `None` 兼容，disabled config 清除该字段。
- watcher 只关闭自己 spawn 的 Halo；手动启动的 Halo 不被强制关闭。
- watcher 只有在 Codex active、没有 owned child、且发现 Halo 时才接管 `managed_pid`；收尾时通过直接 `--lifecycle-stop <pid>` 定向关闭 adopted Halo。
- single-instance callback 仅在目标 PID 等于当前 App PID 时退出；普通重复启动打开设置；无现有实例的 stop 首实例在 setup 直接退出且不显示 UI。
- 不读取或记录 Codex 命令行参数、prompt、transcript、路径内容；不使用 shell 拼接执行控制命令。
- macOS 和 Windows 实现真实启用；其他平台返回 `codex-lifecycle:unsupported`。
- 不新增 crate；优先使用现有 `std`、`serde`、`windows-sys` 和当前构建链。
- 每个行为先写失败测试并确认失败，再写最小生产代码。
- 不暂存或修改现有未跟踪的 `docs/comet/`。
- 提交信息使用中文。

## 文件边界

### 新增

- `src-tauri/src/lifecycle.rs`：生命周期配置、进程列表解析、watcher 循环、Halo 子进程管理。
- `src-tauri/src/bin/codex-halo-watch.rs`：解析 `--config`，调用 `lifecycle::run`。
- `docs/superpowers/plans/2026-09-03-codex-lifecycle.md`：本计划。

### 修改

- `src-tauri/src/state.rs`：`AppSettings` 字段和默认值。
- `src-tauri/src/main.rs`：sidecar 安装、配置同步、设置事务接入。
- `src-tauri/src/platform.rs`：进程查询、macOS LaunchAgent、Windows Run 项和安全错误类别。
- `src-tauri/src/hook_protocol.rs`：安装第二个私有 sidecar。
- `src-tauri/src/lib.rs`：导出 `lifecycle`。
- `src-tauri/Cargo.toml`：注册 watcher binary。
- `src-tauri/tauri.conf.json`：加入第二个 `externalBin`。
- `scripts/build-sidecar.mjs`、`scripts/build-sidecar.test.mjs`：构建和验证两个 sidecar。
- `src/settings.html`、`src/settings.js`、`src/i18n.js`：checkbox、读写和翻译。
- `src/app.test.mjs`：前端设置契约和安全错误格式化测试。
- `README.md`、`README.zh-CN.md`、`plugins/codex-halo/README.md`：使用和边界说明。

---

### Task 1: 扩展设置契约和 UI

**Files:**
- Modify: `src/app.test.mjs`
- Modify: `src-tauri/src/state.rs:162-227`
- Modify: `src/app.js:9-23`
- Modify: `src/settings.html:10-105`
- Modify: `src/settings.js:53-69`
- Modify: `src/i18n.js:12-104`

**Interfaces:**
- Produces `AppSettings.follow_codex_lifecycle: bool`。
- Produces frontend key `follow_codex_lifecycle` and DOM id `follow-codex-lifecycle`。
- Produces translation key `settings.followCodexLifecycle`。

- [ ] **Step 1: Write the failing tests.**

在 `src/app.test.mjs` 的设置页契约测试中加入：

```js
assert.match(html, /id="follow-codex-lifecycle"/);
assert.match(html, /data-i18n="settings\.followCodexLifecycle"/);
assert.match(source, /follow_codex_lifecycle: control\('follow_codex_lifecycle'\)\.checked/);
assert.match(i18n, /settings\.followCodexLifecycle/);
```

在默认值测试对象中加入：

```js
follow_codex_lifecycle: false,
```

在 `src-tauri/src/state.rs` 测试模块加入旧配置兼容断言：

```rust
#[test]
fn missing_lifecycle_flag_uses_disabled_default() {
    let settings: AppSettings = serde_json::from_str("{}").unwrap();
    assert!(!settings.follow_codex_lifecycle);
}
```

- [ ] **Step 2: Run the tests and verify RED.**

Run: `node --test src/app.test.mjs`

Expected: FAIL because the new DOM id, source field, translation, and default property do not exist。

- [ ] **Step 3: Implement the minimum contract.**

在 `AppSettings` 增加字段并在 `Default` 设为 `false`：

```rust
pub follow_codex_lifecycle: bool,
```

在 `DEFAULT_APP_SETTINGS`、`readSettings` 和 `settings.html` 增加同名字段。将 checkbox 放在现有 `start_at_login` 附近：

```html
<label class="switch-row" for="follow-codex-lifecycle">
  <span data-i18n="settings.followCodexLifecycle">Follow Codex lifecycle</span>
  <input id="follow-codex-lifecycle" name="follow_codex_lifecycle" type="checkbox" />
</label>
```

在英文和简体中文字典中分别加入 `Follow Codex lifecycle` 和 `随 Codex 启停`。

- [ ] **Step 4: Run the tests and verify GREEN.**

Run: `node --test src/app.test.mjs`

Expected: PASS。

- [ ] **Step 5: Commit.**

```bash
git add src/app.test.mjs src-tauri/src/state.rs src/app.js src/settings.html src/settings.js src/i18n.js
git commit -m "功能: 增加 Codex 生命周期设置"
```

### Task 2: 建立 watcher 纯逻辑和配置模型

**Files:**
- Create: `src-tauri/src/lifecycle.rs`
- Create: `src-tauri/src/bin/codex-halo-watch.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- `LifecycleConfig { enabled: bool, halo_path: PathBuf, managed_pid: Option<u32> }`
- `parse_config(bytes: &[u8]) -> Result<LifecycleConfig, LifecycleError>`
- `parse_config_path(args: impl IntoIterator<Item = OsString>) -> Option<PathBuf>`
- `parse_lifecycle_stop_pid(args: impl IntoIterator<Item = String>) -> Option<u32>`
- `lifecycle_stop_targets(args, current_pid) -> bool`
- `codex_processes_present_from_listing(listing: &str) -> bool`
- `process_name_matches(value: &str, names: &[&str]) -> bool`
- `should_spawn_halo(codex_active: bool, halo_exists: bool, owned_child_exists: bool) -> bool`
- `run(config_path: PathBuf) -> Result<(), LifecycleError>`

- [ ] **Step 1: Write failing unit tests.**

先在新 `src-tauri/src/lifecycle.rs` 中写测试模块，覆盖配置兼容、参数解析、进程名边界和状态边沿：

```rust
#[test]
fn missing_enabled_field_defaults_to_disabled() {
    let config = parse_config(br#"{"halo_path":"/tmp/codex-halo"}"#).unwrap();
    assert!(!config.enabled);
}

#[test]
fn watcher_accepts_only_config_pair() {
    let path = PathBuf::from("/tmp/lifecycle.json");
    assert_eq!(parse_config_path(["--config", "/tmp/lifecycle.json"].map(OsString::from)), Some(path));
    assert_eq!(parse_config_path(["--config"].map(OsString::from)), None);
    assert_eq!(parse_config_path(["--other", "/tmp/lifecycle.json"].map(OsString::from)), None);
}

#[test]
fn process_matching_is_exact_and_case_insensitive() {
    assert!(process_name_matches("/Applications/Codex.app/Contents/MacOS/Codex", &["codex"]));
    assert!(process_name_matches("CHATGPT.EXE", &["chatgpt.exe"]));
    assert!(!process_name_matches("codex-halo-watch", &["codex", "codex.exe"]));
}

#[test]
fn process_listing_requires_a_codex_name() {
    assert!(codex_processes_present_from_listing("/usr/bin/codex\n"));
    assert!(codex_processes_present_from_listing("ChatGPT\n"));
    assert!(!codex_processes_present_from_listing("codex-halo\ncodex-halo-watch\n"));
}

#[test]
fn spawn_only_when_codex_is_active_and_no_halo_exists() {
    assert!(should_spawn_halo(true, false, false));
    assert!(!should_spawn_halo(false, false, false));
    assert!(!should_spawn_halo(true, true, false));
    assert!(!should_spawn_halo(true, false, true));
}
```

- [ ] **Step 2: Run the focused Rust test and verify RED.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml lifecycle::tests`

Expected: FAIL to compile because the lifecycle functions and module export are not implemented。

- [ ] **Step 3: Implement the pure model and binary entry.**

在 `src-tauri/src/lib.rs` 增加：

```rust
pub mod lifecycle;
```

在 `lifecycle.rs` 使用 `#[serde(default)]` 配置结构；`parse_config` 只接受 JSON 对象和非空 `halo_path`。`process_name_matches` 取 basename、去除 Windows `.exe` 差异并做 ASCII 小写精确比较；不能用 `contains`，避免 `codex-halo` 误匹配。

`codex-halo-watch.rs` 只做参数解析和运行：

```rust
fn main() {
    let Some(config_path) = lifecycle::parse_config_path(std::env::args_os().skip(1)) else {
        return;
    };
    let _ = lifecycle::run(config_path);
}
```

watcher 每 500ms 读取一次配置和进程状态。配置缺失/disabled 时先 kill 自己 spawn 的 child，
或通过 `managed_pid` 对 adopted Halo 发定向 `--lifecycle-stop <pid>`，再退出。Codex active
且没有 owned child 时：无 Halo 则 spawn；已有 Halo 且 config 有 `managed_pid` 则 adoption。
`stdin`、`stdout`、`stderr` 使用 `Stdio::null()`。

在循环中使用 `Child::try_wait` 回收异常退出的 child；下一轮在 Codex 仍 active 时允许重新启动。只记录固定错误类别，不输出路径和命令行。

- [ ] **Step 4: Run the focused tests and verify GREEN.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml lifecycle::tests`

Expected: PASS。

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/lifecycle.rs src-tauri/src/bin/codex-halo-watch.rs src-tauri/src/lib.rs
git commit -m "功能: 增加 Codex 生命周期 watcher"
```

### Task 3: 增加 sidecar 构建和私有安装

**Files:**
- Modify: `src-tauri/src/hook_protocol.rs:131-153`
- Modify: `src-tauri/src/hooks.rs:98-123`
- Modify: `src-tauri/src/main.rs:910-916`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `scripts/build-sidecar.mjs`
- Modify: `scripts/build-sidecar.test.mjs`

**Interfaces:**
- `hook_protocol::install_binary(source, runtime_root, filename)`。
- `hook_protocol::install_bundled_watcher(runtime_root)`。
- `hooks::runtime_watcher_path() -> Result<PathBuf, HookError>`。
- 构建脚本保留 `sidecarFilename(targetTriple)` 兼容现有调用，并支持 `sidecarFilename(targetTriple, binaryName)`。

- [ ] **Step 1: Write failing sidecar and install tests.**

在 `scripts/build-sidecar.test.mjs` 加入：

```js
assert.equal(
  sidecarFilename('aarch64-apple-darwin', 'codex-halo-watch'),
  'codex-halo-watch-aarch64-apple-darwin',
);
assert.equal(
  sidecarOutputPath('/repo', 'x86_64-pc-windows-msvc', 'codex-halo-watch'),
  '/repo/src-tauri/binaries/codex-halo-watch-x86_64-pc-windows-msvc.exe',
);
```

在 `src-tauri/src/hook_protocol.rs` 测试中增加第二个 bundled filename 的安装断言。

测试使用通用安装函数，避免依赖运行时 executable 位置：

```rust
#[test]
fn installs_the_bundled_watcher_at_a_stable_private_path() {
    let root = temp_path("watcher");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("bundled-watcher");
    let runtime_root = root.join("runtime");
    fs::write(&source, b"watcher-v1").unwrap();

    let installed = install_binary(&source, &runtime_root, WATCHER_FILENAME).unwrap();

    assert_eq!(installed, runtime_root.join(WATCHER_FILENAME));
    assert_eq!(fs::read(&installed).unwrap(), b"watcher-v1");
    fs::remove_dir_all(root).unwrap();
}
```

- [ ] **Step 2: Run RED checks.**

Run: `npm run test:build-sidecar`

Expected: FAIL because the build helper accepts only the old single sidecar shape。

Run: `cargo test --manifest-path src-tauri/Cargo.toml hook_protocol::tests::installs_the_bundled_watcher`

Expected: FAIL to compile because watcher install symbols do not exist。

- [ ] **Step 3: Implement the second sidecar with shared copy logic.**

将 `install_helper` 改为调用通用 `install_binary`，保留相同的私有目录、临时文件、权限和原子替换行为。新增 watcher filename 常量和路径函数；不要复制一套文件权限代码。

在 `Cargo.toml` 注册：

```toml
[[bin]]
name = "codex-halo-watch"
path = "src/bin/codex-halo-watch.rs"
```

在 `tauri.conf.json` 使用：

```json
"externalBin": ["binaries/codex-halo-hook", "binaries/codex-halo-watch"]
```

构建脚本使用固定数组 `['codex-halo-hook', 'codex-halo-watch']`，对每个 binary 执行同一套 `cargo build --bin`、目标后缀复制和 POSIX `chmod`。

`build_windows` 在安装 hook helper 后 best effort 安装 watcher：

```rust
if let Some(helper_dir) = hooks::runtime_root().ok() {
    helper_setup_best_effort(|| hook_protocol::install_bundled_helper(&helper_dir).map(|_| ()));
    helper_setup_best_effort(|| hook_protocol::install_bundled_watcher(&helper_dir).map(|_| ()));
}
```

- [ ] **Step 4: Run GREEN checks.**

Run: `npm run test:build-sidecar`

Expected: PASS。

Run: `cargo test --manifest-path src-tauri/Cargo.toml hook_protocol::tests`

Expected: PASS。

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/hook_protocol.rs src-tauri/src/hooks.rs src-tauri/src/main.rs src-tauri/Cargo.toml src-tauri/tauri.conf.json scripts/build-sidecar.mjs scripts/build-sidecar.test.mjs
git commit -m "构建: 打包 Codex 生命周期 watcher"
```

### Task 4: 实现平台进程检测和登录启动项

**Files:**
- Modify: `src-tauri/src/platform.rs:22-172`
- Modify: `src-tauri/src/lifecycle.rs`
- Modify: `src/app.test.mjs`
- Modify: `src/i18n.js`

**Interfaces:**
- `platform::codex_processes_present() -> io::Result<bool>`。
- `platform::halo_process_present() -> io::Result<bool>`。
- `platform::set_codex_lifecycle_at_login(watcher, config, enabled) -> Result<(), AutostartError>`。
- 新错误格式：`codex-lifecycle:permission|launch-agent|registry|unsupported`。

- [ ] **Step 1: Write failing tests.**

在 `src-tauri/src/platform.rs` 的测试模块加入纯函数断言：

```rust
#[test]
fn lifecycle_windows_command_quotes_watcher_and_config() {
    assert_eq!(
        lifecycle_windows_command(
            Path::new(r#"C:\Program Files\Codex Halo\codex-halo-watch.exe"#),
            Path::new(r#"C:\Users\User Name\.codex\codex-halo\lifecycle.json"#),
        ),
        r#""C:\Program Files\Codex Halo\codex-halo-watch.exe" --config "C:\Users\User Name\.codex\codex-halo\lifecycle.json""#,
    );
}

#[test]
fn lifecycle_plist_escapes_xml_values() {
    let plist = lifecycle_plist(Path::new("/tmp/a&b"), Path::new("/tmp/c<d"));
    assert!(plist.contains("/tmp/a&amp;b"));
    assert!(plist.contains("/tmp/c&lt;d"));
}

#[test]
fn lifecycle_errors_use_a_separate_safe_prefix() {
    assert_eq!(AutostartError::LifecyclePermission.to_string(), "codex-lifecycle:permission");
    assert_eq!(AutostartError::LifecycleLaunchAgent.to_string(), "codex-lifecycle:launch-agent");
}
```

`lifecycle_windows_command` 和 `lifecycle_plist` 保持为无平台副作用的纯格式化函数，
因此这些测试在 macOS 和 Windows 都可编译；只有真正写 Registry、调用 `launchctl` 的
函数使用目标平台 `cfg`。

在 `src/app.test.mjs` 增加：

```js
assert.equal(
  formatSetupError('save_settings', 'codex-lifecycle:registry'),
  'Codex lifecycle setup failed (registry)',
);
assert.equal(
  formatLocalizedSetupError('save_settings', 'codex-lifecycle:permission', 'zh-CN'),
  'Codex 生命周期设置失败（权限）',
);
```

- [ ] **Step 2: Run RED checks.**

Run: `node --test src/app.test.mjs`

Expected: FAIL because lifecycle error categories are not accepted。

Run: `cargo test --manifest-path src-tauri/Cargo.toml platform::tests::lifecycle_`

Expected: FAIL because platform lifecycle helpers do not exist。

- [ ] **Step 3: Implement platform behavior.**

在 `AutostartError` 增加四个 lifecycle variant；保留已有 `start-at-login:*` variant 不变。前端安全正则扩展为两个固定前缀，禁止显示原始 `io::Error` 文本。

macOS：

- `ps -axo comm=` 取进程名列表，只传 `stdout` 给纯解析函数；失败返回 lifecycle 固定类别。
- 写 `~/Library/LaunchAgents/com.codex-halo.lifecycle.plist`，`ProgramArguments` 为 watcher、`--config`、config path。
- 启用前调用 `launchctl bootout` 清理旧项，再 `bootstrap` 当前用户；禁用时 `bootout` 后删除 plist。
- XML 值经过 `&`、`<`、`>`、`"`、`'` 转义。

Windows：

- `tasklist /FO CSV /NH` 只解析第一列进程名。
- 复用现有 `windows-sys` Registry 打开 `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`。
- 值名固定为 `Codex Halo Lifecycle`；值为 `lifecycle_windows_command(watcher, config)`。
- 删除不存在的值视为成功；错误只映射为 permission 或 registry。

进程名检测使用精确 basename 比较；`codex-halo` 和 `codex-halo-watch` 不可命中 Codex 名称。其他平台的两个查询函数返回 `Unsupported` 对应的 `io::Error` 或固定 false，不能报告已启用。

- [ ] **Step 4: Run GREEN checks.**

Run: `node --test src/app.test.mjs`

Expected: PASS。

Run: `cargo test --manifest-path src-tauri/Cargo.toml platform::tests`

Expected: PASS。

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/platform.rs src-tauri/src/lifecycle.rs src/app.test.mjs src/i18n.js
git commit -m "功能: 增加跨平台 Codex 进程检测"
```

### Task 5: 接入生命周期配置、设置事务和 watcher 启停

**Files:**
- Modify: `src-tauri/src/main.rs:252-311,910-956`
- Modify: `src-tauri/src/lifecycle.rs`
- Modify: `src/app.test.mjs`

**Interfaces:**
- `lifecycle::write_config(path, &LifecycleConfig) -> Result<(), LifecycleError>`，配置兼容
  `managed_pid: Option<u32>`。
- `lifecycle::sync_app(app, enabled) -> Result<(), String>`。
- `save_settings_transaction` 同时回滚 `start_at_login` 和 `follow_codex_lifecycle` 两组副作用。

- [ ] **Step 1: Write failing transaction tests.**

在 `main.rs` 测试模块增加三个事务场景：生命周期启用成功、生命周期注册失败恢复旧值、设置写入失败同时恢复两个外部开关。测试使用闭包记录顺序，不 mock 业务行为。

```rust
#[test]
fn settings_transaction_rolls_back_lifecycle_when_write_fails() {
    let current = AppSettings::default();
    let mut next = current.clone();
    next.follow_codex_lifecycle = true;
    let mut calls = Vec::new();

    let result = save_settings_transaction(
        &current,
        &next,
        |_settings| Err("write failed".to_owned()),
        |enabled| {
            calls.push(format!("login:{enabled}"));
            Ok(())
        },
        |enabled| {
            calls.push(format!("lifecycle:{enabled}"));
            Ok(())
        },
    );

    assert_eq!(result, Err("write failed".to_owned()));
    assert_eq!(calls, ["lifecycle:true", "lifecycle:false"]);
}
```

再加入 lifecycle callback 失败和双副作用回滚的具体断言：

```rust
#[test]
fn settings_transaction_does_not_write_when_lifecycle_setup_fails() {
    let current = AppSettings::default();
    let mut next = current.clone();
    next.follow_codex_lifecycle = true;
    let mut wrote = false;

    let result = save_settings_transaction(
        &current,
        &next,
        |_settings| {
            wrote = true;
            Ok(())
        },
        |_enabled| Ok(()),
        |_enabled| Err("codex-lifecycle:registry".to_owned()),
    );

    assert_eq!(result, Err("codex-lifecycle:registry".to_owned()));
    assert!(!wrote);
}

#[test]
fn settings_transaction_restores_both_side_effects_after_write_failure() {
    let current = AppSettings::default();
    let mut next = current.clone();
    next.start_at_login = true;
    next.follow_codex_lifecycle = true;
    let mut calls = Vec::new();

    let result = save_settings_transaction(
        &current,
        &next,
        |_settings| Err("write failed".to_owned()),
        |enabled| {
            calls.push(format!("login:{enabled}"));
            Ok(())
        },
        |enabled| {
            calls.push(format!("lifecycle:{enabled}"));
            Ok(())
        },
    );

    assert_eq!(result, Err("write failed".to_owned()));
    assert_eq!(calls, ["login:true", "lifecycle:true", "lifecycle:false", "login:false"]);
}
```

在 `src/app.test.mjs` 增加源码契约：`lifecycle::sync_app` 在启动和保存路径出现，`follow_codex_lifecycle` 被纳入 transaction。

- [ ] **Step 2: Run RED checks.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml main::tests::settings_transaction_`

Expected: FAIL to compile because transaction signature没有 lifecycle callback。

Run: `node --test src/app.test.mjs`

Expected: FAIL because main source has no lifecycle integration。

- [ ] **Step 3: Implement atomic lifecycle sync.**

`sync_app` 的启用流程：

1. 得到 `hooks::runtime_root()`、watcher path、config path 和 `std::env::current_exe()`。
2. 写 `{ enabled: true, halo_path }` 到私有 `lifecycle.json`。
3. 调用 `platform::set_codex_lifecycle_at_login(watcher, config, true)`。
4. 检查 watcher 是否已存在；不存在则 detached spawn `watcher --config <path>`。

禁用流程：

1. 写 `{ enabled: false, halo_path }`，让现有 watcher 在下一轮关闭 owned child 并退出。
2. 调用 `set_codex_lifecycle_at_login(..., false)`。
3. 保留 disabled config，便于旧 watcher安全退出和下次原子覆盖。

启动时 `build_windows` 在读取 settings 后调用 `sync_app`；失败只输出 `Codex Halo: codex lifecycle setup failed (<fixed category>)`，不阻塞窗口和托盘。

扩展 `save_settings_transaction` 为三个闭包：写设置、现有 login autostart、lifecycle sync。只对发生变化的字段执行 callback；任一步失败，按逆序恢复已成功的副作用。恢复失败统一返回 `start-at-login:reconciliation`，避免暴露路径或系统错误。

`save_settings_unlocked` 在写入设置前调用 transaction，成功后继续现有 `apply_settings_to_overlay`；不改变已有 overlay、tray、language 行为。

watcher 是否已存在只通过精确进程名检查，不用 shell。启动失败可在下一次设置保存或登录启动时重试；不影响 Codex。

- [ ] **Step 4: Run GREEN checks.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml main::tests::settings_transaction_`

Expected: PASS。

Run: `node --test src/app.test.mjs`

Expected: PASS。

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/main.rs src-tauri/src/lifecycle.rs src/app.test.mjs
git commit -m "功能: 接入 Codex 生命周期设置事务"
```

### Task 6: 更新文档并执行完整验证

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `plugins/codex-halo/README.md`
- Modify: `src/app.test.mjs`

- [ ] **Step 1: Write documentation contract tests.**

在 `src/app.test.mjs` 加入固定断言：英文 README 包含 `Follow Codex lifecycle`，中文 README 包含 `随 Codex 启停`，Plugin README 包含 `codex-halo-watch`，且三个文档都不把 Plugin hooks 描述为 App 启停控制器；先运行确认旧文档失败。

Run: `node --test src/app.test.mjs`

Expected: FAIL only on new documentation assertions。

- [ ] **Step 2: Update documentation.**

英文文档说明：`Follow Codex lifecycle` 启用 watcher；CLI 和桌面 App 使用 combined active
set，所有支持的 Codex 进程退出后才收尾；手动 Halo 不被关闭。

中文文档说明：`随 Codex 启停` 的同样语义，并保留现有 `start_at_login` 的独立含义。

Plugin README 只说明 watcher 由原生 App 管理；不声称 Plugin hooks 负责启动/关闭 App。

- [ ] **Step 3: Run the complete JavaScript verification.**

Run: `node --test src/app.test.mjs scripts/build-sidecar.test.mjs scripts/plugin-package.test.mjs scripts/vscode-launch.test.mjs`

Expected: PASS。

- [ ] **Step 4: Run renderer and Rust verification.**

Run: `npm run check:renderer`

Expected: PASS。

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS。

Run: `cargo check --manifest-path src-tauri/Cargo.toml --bins`

Expected: PASS。

- [ ] **Step 5: Verify sidecar build output.**

Run: `npm run build:sidecar -- --target aarch64-apple-darwin`

Expected: `src-tauri/binaries/codex-halo-hook-aarch64-apple-darwin` and `src-tauri/binaries/codex-halo-watch-aarch64-apple-darwin` exist and are executable。生成物按仓库策略处理，不自动加入提交。

- [ ] **Step 6: Run diff and inspect untracked files.**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors；只出现本次明确修改和原有 `docs/comet/`，不出现强制加入的测试或 sidecar 生成物。

- [ ] **Step 7: Commit documentation and final changes.**

```bash
git add README.md README.zh-CN.md plugins/codex-halo/README.md src/app.test.mjs
git commit -m "文档: 说明 Codex 生命周期联动"
```

## 手动验收清单

- [ ] macOS：无 Codex 时 watcher 不启动 Halo。
- [ ] macOS：启动一个 `codex` CLI，500ms 级别内出现 Halo；启动第二个 CLI 后关闭其中一个，Halo 仍在；关闭最后一个，自动 Halo 退出。
- [ ] macOS：启动 ChatGPT/Codex 桌面 App，Halo 出现；只结束内部会话不退出；退出桌面进程后 Halo 退出。
- [ ] macOS：取消勾选后 LaunchAgent 被移除，watcher 和自动 Halo 退出。
- [ ] Windows runner：重复 CLI/桌面场景，并检查 `HKCU` Run 的 `Codex Halo Lifecycle` 值。
- [ ] 手动启动 Halo 后退出 Codex，手动实例仍在。
- [ ] 现有 `start_at_login` 单独开关行为不变。
- [ ] Plugin 未安装时，生命周期 watcher 仍能管理 Halo 进程；Plugin hooks 仍只负责状态快照。

## 已知验证边界

- macOS 本机结果不能证明 Windows Registry、进程列表和打包运行时行为。
- 如果当前环境没有 Windows runner，Windows 项目验证必须标记 `NOT RUN`，不能写成通过。
- 进程轮询是 500ms 的最小实现；只有确认性能问题后，才考虑原生进程通知或新依赖。
