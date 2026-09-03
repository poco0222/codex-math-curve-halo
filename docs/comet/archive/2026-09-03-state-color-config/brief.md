# 目标

为 Codex Halo 增加颜色配置。六个已有生命周期状态可分别保存并使用独立颜色；设置页提供用户给出的预置颜色。

# 范围

- 扩展现有 `AppSettings` JSON 合同，持久化六个状态颜色：`idle`、`thinking`、`executing`、`input_needed`、`completed`、`compacting`。
- 设置页新增状态颜色区域。每个状态单独显示当前颜色，可从预置色中选择；颜色保存复用现有 `save_settings`、串行队列和 `settings-changed` 事件。
- `src/halo.js` 使用设置中的状态颜色渲染光环；保留现有透明度、粒子、运动参数和 `420ms` 状态过渡。
- 旧版 `settings.json` 缺少新字段时自动补齐，现有默认视觉颜色不变。
- 预置色只作为程序内数据，不打包截图文件；显示十六进制值，按截图来源分组。

## Source coverage

来源状态：`complete`。已读取用户指定目录中的全部 10 张 PNG，并覆盖其中可执行的颜色数据；目录本身不作为运行时依赖。

来源目录：`/Users/PopoY/Documents/Documents/截图`

已读取文件及色值（每组 7 个，共 70 个）：

- `CleanShot 2026-09-03 at 10.04.27@2x.png`: `#A4CAB6`, `#69A794`, `#5DBE8A`, `#41B349`, `#2C9678`, `#428675`, `#248067`
- `CleanShot 2026-09-03 at 10.05.02@2x.png`: `#BACCD9`, `#8FB2C9`, `#8ABCD1`, `#10AEC2`, `#158BB8`, `#4E7CA1`, `#2775B6`
- `CleanShot 2026-09-03 at 10.05.19@2x.png`: `#F03752`, `#EE2746`, `#C21F30`, `#EE3F4D`, `#BF3553`, `#A7535A`, `#82111F`
- `CleanShot 2026-09-03 at 10.05.28@2x.png`: `#FED71A`, `#F9D770`, `#ECCB16`, `#FCC307`, `#FEBA07`, `#F9A633`, `#DAA45A`
- `CleanShot 2026-09-03 at 10.05.37@2x.png`: `#F0C9CF`, `#F0A1A8`, `#E77C8E`, `#EC8AA4`, `#EC7696`, `#EA517F`, `#DE3F7C`
- `CleanShot 2026-09-03 at 10.05.46@2x.png`: `#E9CCD3`, `#C08EAF`, `#C06F98`, `#806D9E`, `#815C94`, `#813C85`, `#4D1018`
- `CleanShot 2026-09-03 at 10.05.55@2x.png`: `#F18F60`, `#EE781F`, `#E97040`, `#EA5532`, `#DC541B`, `#EA5514`, `#B55336`
- `CleanShot 2026-09-03 at 10.06.04@2x.png`: `#E7A23F`, `#DE7622`, `#673424`, `#5C1E19`, `#652B1C`, `#592620`, `#482522`
- `CleanShot 2026-09-03 at 10.06.15@2x.png`: `#3E3B31`, `#31322C`, `#39363F`, `#353538`, `#2D2D30`, `#2E282E`, `#000013`
- `CleanShot 2026-09-03 at 10.06.22@2x.png`: `#E4DFD7`, `#CFCCC9`, `#D4C4B7`, `#BDAEAD`, `#B6A476`, `#9FA39A`, `#847C74`

来源覆盖映射：上述 70 个色值进入 `specs/state-color-config/spec.md` 的预置色集合，并由 A3（预置色可见且可选）覆盖；原始需求“增加颜色配置、预置颜色、按状态分别配置”进入目标、完整 Spec、验收和约束。

逐图覆盖：以上每个 PNG 来源单元均为 `complete`，保留其 7 个色值，映射至 `specs/state-color-config/spec.md` 的“Configure colors from the settings window”要求，验收 ID 为 A3，状态为 `covered`；截图文件只作来源证据，不进入运行时。

# 非目标

- 不修改状态数量、状态优先级、状态名称或生命周期逻辑。
- 不增加云同步、主题系统、预置色编辑/删除、截图导入或导出。
- 不为每个状态新增独立透明度、动画、粒子或曲线配置。
- 不要求用户目录中的截图随应用发布。

# 验收示例

- Scenario: 首次启动或旧配置缺少颜色字段时，六个状态使用当前已有默认颜色，且设置文件包含完整六色合同。

- Scenario: 用户在设置页为一个状态选择预置色并保存后，只有该状态的颜色改变；其他状态保持原值，重启后仍保持。

- Scenario: 设置页展示全部 70 个预置十六进制值，按来源分组，点击任一色值即可应用到当前状态并触发已有设置同步。

- Scenario: 运行中的光环切换到任一状态时使用该状态已保存的颜色，状态切换仍完成现有 `420ms` 颜色过渡。

- Scenario: 非法颜色值不会写入设置文件，也不会使渲染器产生无效 CSS/RGB 值。

# 约束与不变量

- 前后端字段名、默认值和序列化格式一致；新字段必须有旧配置默认值。
- 颜色边界在 Rust 持久化入口校验，接受 `#RRGGBB`（大小写均可），保存为规范格式；前端控件不得绕过校验。
- 状态颜色只影响颜色；现有 alpha、半径、速度、旋转和粒子行为保持不变。
- 继续通过 `settings-changed` 同步 settings window 与 overlay；不新增并行存储。
- 不记录 prompt、transcript、路径或其他诊断敏感信息。

# 决策

- 使用现有六个 `HaloState` 状态，不新增状态。
- 初始状态颜色保留当前 `src/halo.js` 的六个默认值，避免升级后突然改变外观；70 个色值作为可选预置色。
- 预置色按 10 张来源截图分组，色值以固定程序数据提供。
- 采用原生 HTML color control 和现有 vanilla JavaScript；不新增依赖。
- 允许预置色之外的自定义颜色；使用原生颜色选择器和 `#RRGGBB` 文本输入，提交前后均执行格式校验。

# 待解决问题

- [blocking] CONFIRM：确认六个状态独立颜色配置；预置 70 个截图色值；支持原生颜色选择器和 `#RRGGBB` 自定义输入；保留当前默认状态色；旧配置自动补齐；不增加主题、同步、预置色管理和截图导入导出。

# 验证预期

- `node --test src/app.test.mjs`
- `npm run check:renderer`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --bins`
- `git diff --check`，并显式检查未跟踪文件。
- 进行设置页静态检查，并用真实渲染验证六个状态颜色和过渡。
