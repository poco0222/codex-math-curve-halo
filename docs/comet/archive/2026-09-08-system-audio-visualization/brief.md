# Outcome

为现有数学曲线方案加入系统音频可视化，让系统播放声音驱动曲线动画。用户所说的音频识别按其后续说明理解为音频特征分析。

# Scope

- 原始需求：我想加入音频识别功能；音频可视化，使用系统音频为曲线方案添加动画效果。
- 核查平台原生系统输出采集、实时特征分析、现有 Canvas renderer 的响应层、设置控制与故障状态。
- 项目采用 Tauri 2 + Rust，前端原生 HTML/CSS/JS；本次新增 macOS 与 Windows 音频采集及分析。
- 首版同时支持 macOS 与 Windows；动效采用低频伸缩、中高频粒子与细节联动，提供强度滑块，保留原曲线辨识度。完整方案已由用户最终确认。
- 用户明确限定本轮运行验收为 macOS；Windows 保留完整实现范围，因暂无验收条件而延期运行验收。

# Non-goals

- 不含语音转文字、歌曲识别、麦克风输入、音频录制或上传。
- 首版不包含应用级音源选择、多输出设备合并、逐状态音频配置、手动频段映射和 macOS 13～14.1 音频采集兼容层。
- 不重写前端框架，不改变数学曲线目录、会话语义或现有状态颜色。
- 不将浏览器模拟证明当作真实系统音频采集验收。

# Acceptance examples

以下 A1～A10 中涉及原生运行、系统音频、权限、设备与生命周期的实际验收仅要求 macOS；共用逻辑及 UI 按现有本机工具验证。Windows 不进入本轮运行验收门禁，其未验收状态必须保留在交付说明中。

用户进一步明确接受将 A2 的真实悬浮层直接观察及 A6 的 macOS 权限/设备/睡眠真机交互延期。本轮 A2、A6 按下述证据范围验收，延期项目仍为 NOT RUN / deferred，不宣称真机通过，不阻塞本轮交付；完整功能目标保留在 Spec。

- A1：首次打开及加载旧配置时，音频开关默认关闭、强度默认 50%；未开启前不采集、不请求音频权限。保存开启后重启，在平台支持、权限允许且悬浮层显示时恢复采集。
- A2：macOS 真实采集能取得系统播放的频段特征，真实 App 能反映播放/静音状态；事件接线复核及受控 renderer 检查确认特征进入曲线响应。真实悬浮层播放/停播直接对照观察经用户接受延期，保留 NOT RUN / deferred，不将链路分段证据描述为原生视觉端到端验收。
- A3：分别输入低频、中频、高频测试信号时，低频主要改变曲线围绕中心的尺度，中频主要改变粒子行进速度，高频主要改变有界细节；全目录曲线保持辨识度、边界内绘制及粒子贴合路径。
- A4：强度滑块为 0～100%，默认 50%；0% 不叠加音频动效，100% 仍不裁切、闪烁或改变状态色。连续拖动不造成相位跳变或覆盖原始动画参数。
- A5：静音或音频帧超过 500 ms 未更新时，旧特征失效，额外动效在随后 1 秒内平滑归零。关闭、隐藏悬浮层、应用退出均释放采集资源；重新显示按已保存意图恢复，不重复创建采集器。
- A6：受控测试及代码复核覆盖权限/不支持/故障状态区分、拒绝后阻断重复请求、适用帮助及重试、输出切换/睡眠后的有界重连。macOS 真实权限拒绝/撤销、物理输出切换/拔插及系统睡眠唤醒经用户接受延期，保留 NOT RUN / deferred，不把受控证据描述为这些 OS 交互已实测。
- A7：Appearance 的 Renderer 区域新增音频子区，包含开关、强度和真实状态/音量反馈；沿用既有严格单 View 挂载、完整 settingsStore 和串行保存。切页、切换曲线、重启以及两个既有重置动作均保留音频配置和其他未涉及设置。
- A8：新增 UI 支持 en/zh-CN、键盘、清晰焦点和 390px 窄窗口；实时读数不高频播报。减少动态效果时停止新增音频动效并明确提示，仍可关闭功能。
- A9：音频开启时，现有主会话/子代理的颜色、数量、生命周期和状态过渡语义保持有效；不因音乐产生新的会话或虚假工作状态。
- A10：采集只用于本机内存内短时特征分析，无音频文件、上传或原始音频日志；停止后不再发出旧运行的特征，后到的过期回调不得重新启用响应。

# Constraints and invariants

- 保留现有共享 settingsStore、串行保存、局部 settings-changed 合并和严格单 View 挂载。
- 保留现有深色中性界面、橙色交互强调、系统字体及无外框 fieldset；不新增主题或 UI 库。
- 设计模式：设置为 Operate，曲线为 Experience。DESIGN_VARIANCE=3，VISUAL_DENSITY=6；设置动效 MOTION_INTENSITY=3，曲线音频 MOTION_INTENSITY=6，通过强度控制约束。
- 音频帧属于瞬时运行数据，不进入持久化设置或日志；展示状态应与实际采集状态区分。
- 现有状态颜色与全局透明度继续表达其原有语义；音频不驱动窗口位置。

# Decisions

- 已确定：使用项目配置选择的 Comet Native；当前目录在创建前干净，沿用 main 和当前工作目录。
- 已确定：音频来源为系统播放声音，目标为既有曲线方案的动画反馈。
- 已确定：用户明确要求双平台都支持，首版同时包含 macOS 与 Windows，不以单平台实现或另一平台占位替代。
- 已确定：用户明确要求“验收只保持mac, Windows暂不具备验收条件”。本轮原生运行验收只覆盖 macOS；Windows 实现仍须完成并接受代码复核，Windows 运行验收记为 NOT RUN / deferred，不因缺少 Windows 环境阻塞本轮交付，且不得宣称 Windows 验收通过。
- 已确定：用户选择低频驱动曲线伸缩，中高频驱动粒子与细节，提供强度滑块，保留原曲线辨识度。
- 已确定：在获知独立验收 8/10 通过、A2/A6 缺少真机证据后，用户明确回复“接受”，同意将这两项剩余 macOS 验收延期；本轮按已完成证据交付，未执行部分继续记录 NOT RUN / deferred。此决定只调整证据门禁，不删除或缩减功能目标。
- 已确认：全局音频开关默认关闭；强度 0～100%、默认 50%；平滑在内部统一处理，首版只暴露一个强度滑块。
- 已确认：直接扩展 Appearance 中 Renderer 的音频子区，保留当前导航与视觉体系。音频作用于当前曲线及其全部会话流，不增加逐状态配置矩阵。
- 已确认：macOS 14.2+ 与 Windows 10 1703+/Windows 11；低于音频能力最低版本时应用原有功能继续运行，新功能显示不支持。
- 已确认：跟随默认输出设备，切换或睡眠恢复时重连；悬浮层隐藏时暂停采集，恢复显示后按配置恢复。权限拒绝不自动循环请求。
- 单一 change：采集、瞬时特征传输和 renderer 响应需共同验收，暂不拆 Supervisor Change。
- 独立设计复核已完成（audio_shape_review）：纳入等比伸缩、普通/多会话两条绘制路径、隐藏原因提示、采集唯一性及过期帧隔离。0% 采用保留采集和真实音量反馈的方案，便于辨别有输入但零动效；停止采集使用明确的关闭开关。

## 平台事实与建议

- macOS 建议使用 14.2+ 的 Core Audio taps，声明 NSAudioCaptureUsageDescription；首次实际启动采集由系统请求音频权限。该最低版本只约束新增音频能力，不应静默提高整个应用的最低版本。官方：[API](https://developer.apple.com/documentation/coreaudio/audiohardwarecreateprocesstap(_:_:))、[示例与权限](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps)。
- 若要兼容 macOS 13～14.1，需要另行纳入 ScreenCaptureKit 音频和屏幕录制权限路线。官方：[capturesAudio](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/capturesaudio)。
- Windows 建议使用默认输出设备的 WASAPI shared-mode loopback；Windows 10 1703+ 支持事件驱动回环。范围是所选输出设备的混音，不是同时捕获全部输出设备；受保护内容可能不可捕获。官方：[Loopback Recording](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording)。
- 已由独立只读调查复核以上平台和依赖事实；未触发采集或权限，也未安装依赖。

# Open questions

- 无。用户已确认完整功能方案，并明确接受 Windows 及 A2/A6 指定真机部分延期；沿用当前实现和已完成证据继续验收与收尾。

# Verification expectations

- 实现阶段覆盖特征归一化/平滑、静音和断流归零、配置兼容、renderer 响应和原有会话显示回归。
- 浏览器检查真实曲线渲染、两种语言、窄窗口、键盘、减少动态效果和切页保存。
- macOS 验收记录编译、真实系统音频、授权拒绝、输出切换、睡眠恢复及资源释放。共用逻辑和 UI 使用本机测试及浏览器验证。
- 当前已完成双平台实现和 Builder 代码复核；正在按 macOS 验收范围提交候选，不把开发期检查自动当作最终验收结论。
- 实现范围：新增 Rust 音频采集/分析模块和必要的平台 API 绑定；扩展 AppSettings、原生生命周期和瞬时事件；更新 src/app.js、src/halo.js、设置模板/控制器/store/本地化及针对性测试。复用原生 API 与现有工具链，不升级 Comet 或替换 UI 框架。
- Windows 保留原生采集与完整功能实现，并由代码复核检查平台 API 使用、条件编译边界和共享契约。本轮不要求 Windows 真机、远程执行或 Windows 编译环境，不为验收额外安装/配置工具。Windows 运行验收统一标记 NOT RUN / deferred，注明用户已接受延期；它不产生本轮阻塞项，不计作通过。现有条件下如顺带完成 Windows 静态/编译检查，仅报告该实际检查范围。
- macOS 仅 A2/A6 中明确列出的真机部分由用户接受延期，其余验收仍按真实覆盖判断；延期不是实测通过。已有 macOS 真实系统采集证据保留，编译或合成信号不能替代它。
- 工具检查限制：`comet native check system-audio-visualization --json` 返回 `Unsupported Native change schema comet.native.v4 for runtime protocol 3`；后续 `status` 正常，仍为 Shape。`check --help` 返回 `Unknown Native help topic: check`。不将该检查计为通过，不升级工具或改写 Runtime 状态。

## 开发期证据与明确缺口

- Node 全量检查：134 passed；Rust 全量：149 passed、1 个需明确启动的真实采集测试 ignored；该真实采集测试随后单独执行通过。
- 当前代码的 macOS 真实采集检测到低中高频，停止后 Core Audio 对象列表在 25 ms 内确认 tap/aggregate 注销；不依赖立即读取对象列表判断泄漏。
- 隔离 debug App 真实 UI 已观察到静音等待、延迟播放后自动采集、停止播放后归零、强度 76% 保存及重启保留、隐藏暂停与恢复、关闭功能。测试 App 已退出。
- 修复静音时正常等待首个 tap 被误判断线的问题；修复重连退避忙等、Windows COM 早退释放顺序及异常 IOProc 注销的回调生命周期边界。
- 浏览器中英文 1130px/390px、控制/切页/重置/键盘/错误反馈和全曲线渲染检查通过，证据明确为隔离 IPC 与合成频段，不能替代原生采集。
- macOS 真实权限拒绝/撤销、物理输出切换和系统睡眠唤醒尚未执行；已有受控状态测试与代码复核，不冒充这些 OS 交互的真机验收。
- 本地证据在 `.comet/runtime/audio-qa/`：node-tests.txt、rust-tests.txt、native-capture.txt、native-observations.json、browser-report.json 及截图。独立 Verifier 按实际覆盖及用户明确接受的延期范围判定，其余未确认缺口不豁免。

- 补充真机证据：在 macOS 系统设置中将“减弱动态效果”由 off 改为 on，真实 QA App 显示 Paused、音量 0 和减少动态效果说明，强度 76% 保留；恢复 off 后自动回到等待系统音频。已确认系统偏好恢复原值。
