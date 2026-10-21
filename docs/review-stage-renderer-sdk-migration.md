# Stage Renderer SDK 迁移问题清单与解决方案

> **状态：审阅稿 + 已锁定决策 R1–R19（2026-10-21）。** Wave 0 契约已进 SDK 0.2：`INVALID_ENVELOPE`、`timeoutMs`、capture 空 payload、`mountId` 全局唯一、`MODEL_ID_CONFLICT` 无 details、`purge`、`authorIcon`、单 mount ack 与 nonce 注释。剩余 speech 传输注释与 broker/registry 运行时在 Stage 1–2。本文仍是设计/实现前 spec，没有修改应用运行时。
>
> **编号约定（本版重写，用于消除旧版同名冲突）：**
>
> - 本文的决策是 **R1–R19**（Review decisions）。
> - **迁移 Dn** 指 [迁移计划](./design-stage-renderer-migration.md) §1 的 D1–D19。旧版本文也用 D1–D19 命名，与迁移计划大量重名但含义不同；本版已全部改为 R 编号，引用迁移计划时必须带“迁移”前缀。
> - **迁移 Phase n** 指迁移计划 “Order of work” 的 1–7（Phase 2 = Spine，Phase 3 = MMD，Phase 4 = Live2D，Phase 5 = VRM，Phase 6 = shared deletions，Phase 7 = first-party packaging）。本文自己的推进顺序叫 **Stage 1–7**，映射见 §8，不再使用裸 “Phase 6” 指代两件事。
> - 旧版 §9.2 的两条“必须修正的冲突”（R6 × 迁移 D13、R3 × `CueAck`）已经落地，本版把它们移入“已解决”，只保留结论。
>
> **本版修正的文档矛盾：** 决策编号冲突；Stage/Phase 编号冲突；“文档状态”列混用三种语义；已解决的冲突仍写成“必须修”；`nonce` 铸造归属；speech frame 方向；`mountId` 铸造与唯一性；scope fan-out 的多目标 ack；capture 的 FIFO 与失败语义；`includeBackground` 放在 cue 里；P1-1 残留 BroadcastChannel 备选；`writeSnapshot` 写入者；preview scope 例子；preset 的 driver-builtin ID；P1-12 兜底默认；`ContractFailure.details` 的 opaque 冲突；以及 contractVersion/文件数/RFC 9.13 状态等过期引用。
>
> **审查对象：**
>
> - [`packages/stage-renderer-sdk/`](../packages/stage-renderer-sdk/)（12 个 contract 文件 + `index.ts`，纯类型契约）
> - [`docs/rfcs/0001-stage-renderer-plugin-contract.md`](./rfcs/0001-stage-renderer-plugin-contract.md)（RFC rev 0.2）
> - [`docs/design-stage-renderer-migration.md`](./design-stage-renderer-migration.md)（fork 迁移计划 rev 2026-10-21）
> - 现有实现：`RendererStage`、`ControlStripHost`、actor/chat/settings 窗口、`display-models`、`sync-engine`、Electron plugin host、card editor / acting studio 等
>
> **结论先行：** per-renderer 的 key 映射和 R1–R19 已经比较完整；真正还没有闭环的是三类问题：
>
> 1. **契约隐含“单窗口宿主”假设，而现有 Electron 是 main + actor + chat/settings 多窗口。** 音频、capture、cue ack、readiness、snapshot/prompt、driver panel 六条链路都要跨窗口，契约需要 broker/mount registry。
> 2. **driver 的进程位置与现有 plugin host 不匹配。** 现有 host 在 Electron main 里跑 Node，不能提供 Vue/DOM/AudioContext。
> 3. **迁移数据闭环不完整。** 重导入幂等、多模型 ID、outfits/card 数据/presets/custom assets/旧云备份/删除持久性都没有完整通道。
>
> **建议：** 按 §8 的 Stage 1 先做“可用实现”（eventa 合同 + main broker + `RendererStage` 注册 + 口型帧），跑通跨窗口矩阵后再进 Stage 2；**Spine 是迁移 Phase 2，不是本文 Stage 2**。

---

## 0. 读法

- **P0 = blocker**：不解决就无法可靠迁移，或会造成数据丢失/主流程回归。
- **P1 = high**：不阻塞第一阶段，但会在对应 renderer 迁移或迁移 Phase 6 删除时集中爆发。
- **P2 = medium/low**：契约一致性、类型/发布、文档或边界问题。
- 每条包含：**证据（代码路径）→ 影响 → 决策/建议 → 验收 → 覆盖**。
- **决策状态**只有两种：
  - `已锁定`：reviewer 已拍板，对应 R 编号；
  - `未决`：本文只给建议，需要 reviewer 回答。
- **文档覆盖**只有三种：
  - `已覆盖`：当前 RFC/迁移计划已经明确处理；
  - `部分覆盖`：文档提到但没有闭环；
  - `未覆盖`：文档没有列出或与代码冲突。
- 行号是审查时的锚点，代码移动后应以符号/文件为准；SDK 的锚点以本版重写时的文件为准。

**基线验证：**

- `tsc -p packages/stage-renderer-sdk/tsconfig.json` 通过（无输出）。
- `pnpm -F @proj-airi/stage-renderer-sdk typecheck` 未能执行：pnpm store 在 workspace 外，被当前 sandbox 拒绝；改用本地 `tsc`。
- 审查与本文重写期间没有修改应用代码。
- 契约包没有运行时，未做真实跨窗口 runtime 验证。

---

## 1. 执行摘要

迁移计划的 per-renderer 顺序（Spine → MMD → Live2D → VRM，即迁移 Phase 2–5）是合理的，但它假设：

> 一个宿主进程持有 mount，并且这个宿主同时拥有 Vue、DOM、AudioContext、mount 引用、所有调用方。

现有 Electron 不满足这个假设：

- 主窗口 `ControlStripHost` 负责控制条和 TTS 播放，Electron 下**不渲染模型**（[ControlStripHost.vue](../packages/stage-ui/src/components/scenes/ControlStripHost.vue#L1955-L2018)）；
- 真正的舞台模型在独立 actor 窗口（[actor.vue](../apps/stage-tamagotchi/src/renderer/pages/actor.vue#L561-L582)）；
- chat / rehearsal / settings 又各自挂载 `RendererStage`（[chat.vue](../apps/stage-tamagotchi/src/renderer/pages/chat.vue#L1963-L1976)、[chat_rehearsal.vue](../apps/stage-tamagotchi/src/renderer/components/chat/chat_rehearsal.vue#L1329-L1342)）。

因此优先级是：

1. **先落地跨窗口 host（R1/R4）**：Electron main 持有 mount registry + cue broker，renderer 只注册/收发；speech 作为插件级能力，capture 作为 cue。
2. **再定 driver 进程位置（R5/R19）**：main 发现/启用，renderer 激活/mount；IPC 走 `@moeru/eventa`。
3. **再定迁移数据语义（R6/R7/R8）**：existing modelId 默认拒绝覆盖；多模型两阶段导入由 AIRI 铸 ID；删除写 tombstone。
4. 最后才是 per-renderer 的 cue/panel 迁移、CalibrationStudio 拆分和 SDK 打包。

“先形成可用实现，再优化”的具体含义见 §8：Stage 1 用现有的 host-computed 口型标量 + 内存 registry 跑通两窗口；插件 analyzer、持久化、重连和性能优化放到后续 Stage。

---

## 2. 清单总表

| ID | 级别 | 问题 | 决策 / 建议 | 决策 | 覆盖 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P0-1** | P0 | 缺少跨窗口 mount registry / host 拓扑 | main 进程作中心 broker；renderer 用 eventa 注册/注销/查询；先内存实现 | R1 已锁定 | 已覆盖 |
| **P0-2** | P0 | 跨窗口口型同步（speech `AudioNode` 不能跨 realm） | 口型移出 driver 契约，改为插件级 analyzer；Stage 1 先用 host 标量 | R2 已锁定 | 部分覆盖 |
| **P0-3** | P0 | 跨窗口 `captureFrame` / selfie 不可达 | `capture` 成为空 payload cue；删除 exposed `captureFrame`；capture 单独成包 | R3 已锁定 | 部分覆盖 |
| **P0-4** | P0 | cue ack / FIFO / nonce / readiness 跨窗口未定义 | main broker 持全局 nonce + per-mount FIFO + pending 表；eventa invoke 回 ack；只做单 mount | R4 已锁定 | 部分覆盖 |
| **P0-5** | P0 | 现有 plugin host 在 main，不能提供 Vue/DOM renderer | manifest 先行；main 只做 manifest registry/enable，renderer 实例化 runtime 并回答 capabilities；first-party only | R5/R19 已锁定 | 已覆盖 |
| **P0-6** | P0 | 重复 modelId 的拒绝/覆盖语义与迁移 marker（front door 见 P1-5） | 默认拒绝覆盖；仅显式 `overwrite` + migration marker 允许；普通导入走 `confirmImport` | R6 已锁定 | 已覆盖 |
| **P0-7** | P0 | 多模型包导入没有 ID 铸造回调 | 两阶段；`probe` 返回 `parts`，UI 选择后 `confirmImport` 带 AIRI-minted ID | R7 已锁定 | 已覆盖 |
| **P0-8** | P0 | 删除 legacy key/blob 不持久，重启/云端会复活 | tombstone + dump/restore 剪枝 + 远端 sidecar 删除 | R8 已锁定 | 部分覆盖 |
| **P1-1** | P1 | snapshot / prompt 只写 actor 窗口，main 读不到 | 权威副本放 main；actor 经 eventa 写；main 广播 revision；卸载清 prompt | R9 已锁定 | 已覆盖 |
| **P1-2** | P1 | driver panel 缺少 scope/mount/profile 上下文；跨窗口实时设置失效 | panel props 增加 scope/mount/profile/hostSurface；storage watch；control strip 由 driver 提供组件 | R10 已锁定 | 已覆盖 |
| **P1-3** | P1 | Card editor Acting tab / acting studio / AI curation 是未列出的消费者 | CalibrationStudio 拆进各 driver panel；禁止写全局 stage selection | R11 已锁定 | 已覆盖 |
| **P1-4** | P1 | chat 右侧舞台是第二个真实 mount；`stagePaused` 没传给 actor | chat 与 actor 共享 scope；cue 先按 `mountId` 逐个发，fan-out 暂缓；actor 接收 lifecycle pause | R12 已锁定 | 已覆盖 |
| **P1-5** | P1 | public front door 仍 mint 新 ID；统一导入入口未走 probe/confirmImport | `files` only 已落地；front door 改走 probe/confirmImport，ID 由 AIRI mint | R13 已锁定 | 已覆盖 |
| **P1-6** | P1 | Outfit→profile 没有 AIRI-minted profileId；retry 用实时 selectedModelId | saveProfile 只要求 driver 已注册；MigrationInput 形状待定；冻结 selectedModelId | R14 已锁定 | 已覆盖 |
| **P1-7** | P1 | presets 没有迁移路径；authorIcon 丢失 | preset 两种互斥方案（driver builtin / 首次启动导入）；`ModelPreview` 归一化；补 `authorIcon` | 未决 | 部分覆盖 |
| **P1-8** | P1 | custom motions/VRMA 无 import/list API；selective sync 无法枚举；clear data 无法 purge | 非模型资产走 driver 通道；增加 `ModelDriverRuntime.purge()`；selective sync 仍待定 | 未决（R13 部分） | 部分覆盖 |
| **P1-9** | P1 | 旧云备份/force restore 与新 driver storage 不兼容 | 保留一个 release 的 legacy backup reader；恢复顺序 + tombstone | 未决 | 未覆盖 |
| **P1-10** | P1 | 混合迁移期没有双 catalog / 导入仲裁设计 | `LegacyModel \| DriverModel` 联合；逐 driver feature flag；UI 用 driverHint | 未决 | 未覆盖 |
| **P1-11** | P1 | V-HACK / L-HACK 需要 raw model bytes，与“host 不碰 renderer”冲突 | 移入 driver panel，或增加 debug-only raw export | 未决 | 部分覆盖 |
| **P1-12** | P1 | 头挂字幕/宿主 overlay 与 CaptionCue 所有权矛盾 | `CaptionCue` 可选，声明 `caption` 的 driver 渲染；删除 `HeadPose`；host 可自行 overlay，但非 head-tethered | R15 已锁定 | 已覆盖 |
| **P1-13** | P1 | SDK `Component<Props, Exposed>` 用错泛型；emits 未进入类型；capability 与成员无校验 | `DefineComponent`/`ComponentExposed`；runtime validators；correlated union | 未决 | 未覆盖 |
| **P1-14** | P1 | SDK `private` + source-only，外部 driver 无法消费 | 本 release 只支持 first-party static import；第三方发布推迟 | R18 已锁定 | 已覆盖 |
| **P1-15** | P1 | 第三方 driver 的 bridge/storage 权限边界未定义 | namespace 隔离由 AIRI 实现，driver 不可知；bridge allowlist/scope 校验 | R16 已锁定 | 已覆盖 |
| **P2-1** | P2 | scope 只有一个 modelId；切换模型/多 mount revision 冲突未定义 | scope 有语义；除 preview 外复用，不把 modelId 放进 key；scope 投递 | R17 已锁定 | 已覆盖 |
| **P2-2** | P2 | `interactionMode` 仍存在 VRM key，host 通过 `useModelStore()` 写 | 移到 host store；mount prop 下发（迁移 D5 说“已是 prop”，代码不是） | 未决 | 部分覆盖 |
| **P2-3** | P2 | cue 细节缺口：ack 长度、invalid payload、animation-finished index、timeout | 增加校验/原因/索引/超时；capture 混包用 `INVALID_ENVELOPE` | 未决 | 部分覆盖 |
| **P2-4** | P2 | `ModelDescriptor.profiles` 与 `listProfiles` 双源 | 明确 descriptor 为快照、listProfiles 为权威，或去掉一个 | 未决 | 未覆盖 |
| **P2-5** | P2 | preview data URL 体积/同步路径 | 限制尺寸、压缩、sidecar；catalog 不批量返回大图 | 未决 | 部分覆盖 |
| **P2-6** | P2 | contractVersion 兼容规则未定义 | 0.x 精确 minor；加 validator；1.0 后声明区间 | 未决 | 未覆盖 |
| **P2-7** | P2 | 文档漂移/不一致 | 统一 reset 表、迁移 D11 重试次数、R18 与“packaging”、引用锚点 | 未决 | 部分覆盖 |

---

## 3. P0：必须先决策

### P0-1 缺少跨窗口 mount registry / host 拓扑

**证据**

- 主窗口 Electron 下只渲染控制条，不渲染模型：`isElectron` 时 `ControlStripHost` 不挂 `RendererStage`，并把 `state` 直接标成 `mounted`（[ControlStripHost.vue](../packages/stage-ui/src/components/scenes/ControlStripHost.vue#L2003-L2018)、[同文件](../packages/stage-ui/src/components/scenes/ControlStripHost.vue#L1955-L1958)）。
- actor 窗口挂载真正的 `RendererStage`（[actor.vue](../apps/stage-tamagotchi/src/renderer/pages/actor.vue#L561-L582)）。
- chat / rehearsal / settings 各自挂载 `RendererStage`。
- 契约只定义了 `RendererMountProps.mountId` 和 `stateScope`（[renderer-mount.ts](../packages/stage-renderer-sdk/src/contract/renderer-mount.ts#L119-L130)），没有“谁持有所有 mount、如何查询/定位一个 mount”的接口。

**影响**

- `CueChannel.send` 的 `target.mountId` 无法从 main 窗口解析到 actor mount。
- `capture`、`stopAll`、`dispose` 等方法只对持有 mount 引用的窗口可用。
- readiness、scope minting、prompt/snapshot 复制都缺少中心。
- 多个 `stage` mount 时，“live stage 的 first scope”是歧义。

**决策（R1，已锁定）**

在 **Electron main 进程**放一个中心 broker 实例，持有全部 mount 的 descriptor 和 cue 路由；renderer 侧只保留一个薄 client。先做“可用实现”，不追求持久化/重连/负载均衡：

```ts
// packages/stage-renderer-sdk/src/contract/lifecycle.ts（当前形状）
interface RendererMountDescriptor {
  mountId: string
  modelDriverId: string
  modelId?: string
  surface: RendererMountSurfaceKind
  stateScope: string
  windowId: string
  readiness: RendererMountReadinessState
  updatedAt: number
}

/** mountId 由 mount wrapper 在 mount 前铸成 UUID；stateScope 由 host 铸；windowId 由 main 从 sender 填。 */
type RendererMountRegistration = Omit<RendererMountDescriptor, 'updatedAt' | 'windowId'> & {
  windowId?: string
}

interface ModelDriverMountRegistry {
  register: (descriptor: RendererMountRegistration) => Promise<ContractResult<RendererMountDescriptor>>
  update: (mountId: string, patch: Partial<Omit<RendererMountDescriptor, 'mountId' | 'windowId' | 'updatedAt'>>) => Promise<ContractResult<RendererMountDescriptor>>
  unregister: (mountId: string) => Promise<ContractResult<void>>
  list: () => Promise<RendererMountDescriptor[]>
  findBy: (query: RendererMountQuery) => Promise<RendererMountDescriptor[]>
  onChanged: (handler: (mounts: RendererMountDescriptor[]) => void) => Unsubscribe
}
```

- 实现位置：`apps/stage-tamagotchi/src/main/services/stage-renderer/registry.ts`；renderer client 在 `packages/stage-ui/src/services/stage-renderer/`，web/pocket 用同进程实现（无 IPC）。
- **`mountId` 只需要全局唯一，不需要 main 生成。** mount wrapper（`RendererStage`）在 mount 前用 `crypto.randomUUID()` 铸 `mountId`，作为 prop 交给 mount，并在 `register` 时提交同一个值；registry 全局查重，重复就拒绝注册、wrapper 重新铸。没有 `allocate` 通道，main 也不改写 id。
- **真正要定的是知情范围**：main registry/broker 知道全部；mount wrapper（`RendererStage`）知道自己的；cue 调用方只在点名单个 mount 时从 registry 查；内层 format component（`Live2D.vue` 等）第一版不接收 `mountId`，pointer 迁移时再决定传 opaque id 还是注入 per-mount service；panel 只在配对时拿到 `mountId?`；model/profile 记录永远不存它。
- `windowId` 由 main 从 sender 填，renderer 不能自造跨窗口 id。
- 先只实现 `register/update/unregister/list/onChanged` 和“窗口销毁时清理”两条路径；FIFO、重连、健康检查在 R4 的 broker 里一起做。
- 关闭 actor 窗口的 `webContents` 销毁事件必须触发 registry 清理，否则 cue 会永久挂起。
- chat 右侧舞台必须显式声明 `surface`/`stateScope`，不能靠“第几个 stage”猜（见 P1-4）。
- `lifecycle.ts` 的 register 已改为“全局唯一”，mountId 注释已改为“wrapper 铸 UUID、registry 不重写”。

**需要注意的边界：** “main 进程”是 Electron 主进程（Node，无 DOM/AudioContext），不是主窗口 renderer。mount registry/cue broker 可以住主进程；**音频播放图和 analyzer 不能**（见 P0-2）。两者不要混为“main 侧”。

**验收**

- 同时打开 actor + chat + settings，三者的 mount 都出现在 registry；`surface`/`scope` 可区分。
- 每个 mount 的 `mountId` 在 `register` 时与 prop 完全一致；重复的 UUID 在 `register` 被拒，不产生第二行。
- 关闭 actor 窗口后，registry 中对应 mount 被移除，发往它的 cue 返回 `no-model`/`renderer-not-ready`，而不是挂起。
- 同一 surface 两个 mount 的 cue 可以只命中 `target.mountId` 指定的那个。
- actor 刷新（HMR/reload）后旧 descriptor 不残留（按 `webContents.id` 清理）。
- mount wrapper 的 props 里有 `mountId`；内层 format component 的 props 里没有（第一版），模型记录里也没有。

**覆盖：** 已覆盖（RFC 5.10）；SDK 的 register/mountId 注释已按本版更新。

---

### P0-2 跨窗口口型同步

**证据**

- `ControlStripHost` 在主窗口创建 `AudioContext`、播放 TTS，并广播 `mouthOpenSize`（[ControlStripHost.vue](../packages/stage-ui/src/components/scenes/ControlStripHost.vue#L754-L841)、[同文件](../packages/stage-ui/src/components/scenes/ControlStripHost.vue#L182-L190)）。
- actor 窗口只接收 `airi-speaking-state`，把 `mouthOpenSize` 作为 prop 传给模型（[actor.vue](../apps/stage-tamagotchi/src/renderer/pages/actor.vue#L92-L102)）。
- chat / rehearsal 同样使用 `speakingState?.mouthOpenSize`（[chat.vue](../apps/stage-tamagotchi/src/renderer/pages/chat.vue#L1972-L1974)）。
- **决策前**契约曾让 renderer 从 `HostAudioInterface.getSpeechStream()` 取 `AudioNode` 自己测；该接口已删除（[host-services.ts](../packages/stage-renderer-sdk/src/contract/host-services.ts#L61-L111) 现在只有 `SpeechAnalysisFrame` / `HostSpeechAnalyzerService`）。
- 契约明确 `AudioNode` 不能跨 realm（[host-services.ts](../packages/stage-renderer-sdk/src/contract/host-services.ts#L88-L96)）。

**影响**

- actor（Electron 的真实舞台）和 chat/rehearsal 没有主窗口的 speech node，`getSpeechStream()` 只能返回 `undefined`。
- 删除 `mouthOpenSize` 后，这四个窗口的口型会退化/消失。
- 迁移计划 §8.6 只说明“host 不再计算 envelope”，跨窗口信号来源需要 R2 这条通道。

**决策（R2，已锁定）**

口型同步移出 model driver 契约，改为**插件级能力**：driver 不再声明/实现“怎么测音频”，也不接收 `AudioNode`。插件向 host 注册 analyzer，host 把 analyzer 的结果以低频帧广播给各 mount。

契约层面的改动：

- `ModelDriverHostServices` 不包含音频图；`HostAudioInterface` 已删除。
- 新增**不属于** driver mount 契约的插件级服务（`host-services.ts` 独立导出）：

```ts
interface SpeechAnalysisFrame {
  at: number
  /** 0..1，分析器给出的嘴部开合；没有嘴部概念时可为 undefined */
  mouthOpen?: number
  rms: number
  viseme?: string
}

interface HostSpeechAnalyzerService {
  /** 插件注册自己的 analyzer；analyzer 模块在“拥有 AudioContext 的窗口”里加载 */
  register: (input: {
    pluginId: string
    entry: string
    options?: Record<string, unknown>
  }) => Promise<ContractResult<{ analyzerId: string }>>
  unregister: (analyzerId: string) => Promise<void>
  /** 所有 mount/消费者共用的结果流；低频、latest-wins、不是 cue */
  subscribe: (handler: (frame: SpeechAnalysisFrame) => void) => Unsubscribe
}
```

**传输（本版收口）：** speech frame 是 **observer-style 广播，不是 IPC 请求/应答**。它走 eventa 的 BroadcastChannel adapter（与 `stage-three-runtime-trace` 同一模式），频道 `airi::stage-renderer-speech`，事件定义仍放在 `apps/stage-tamagotchi/src/shared/eventa.ts`：

- 发布者：**持有 `AudioContext` 的窗口 renderer**（当前是主窗口的 `ControlStripHost`）；
- 订阅者：actor / chat / rehearsal / 任何 mount；
- 约 30 Hz、latest-wins、无 ack、不经过 main broker；main 进程不参与转发。
- 不新增裸 `ipcRenderer`；也不把帧塞进 `CueEnvelope`，否则违反 `cues.ts` 的 per-frame 禁令。

这样 P0-4 的“IPC 全部走 eventa”仍然成立（这里不是 IPC），也不需要一条 30 Hz 的 renderer→main→all 中继。若以后 main 需要观察帧，再由 main 订阅同一频道，不改契约。

**分两步落地：**

1. **Stage 1（可用实现）**：复用主窗口 `ControlStripHost` 现有的 analyser/`mouthOpenSize`，在主窗口 renderer 里算 `mouthOpen`，发布到 `airi::stage-renderer-speech`；actor/chat/rehearsal 收到后驱动各自模型。插件 API 可以只留类型和空实现。
2. **Stage 4（插件 analyzer）**：插件在 `activate()` 里 `register()` 一个 analyzer 模块；host 在音频图所在窗口 dynamic import 该模块，输入 `AnalyserNode`（或 PCM tap），输出 `SpeechAnalysisFrame`；禁用插件/卸载时 `unregister()`，帧流停止并归零。

**必须说清的边界（否则这条决策落地会失败）：**

- `AudioNode` 不能跨 realm，也不能过 contextBridge；analyzer **必须运行在持有 `AudioContext` 的窗口 renderer**（当前是主窗口的 `ControlStripHost`），不能运行在 Electron main 进程。main 进程只做 registry/broker（R1）。
- 如果分析器一定要跑在 actor（例如插件只加载在 actor），host 只能把 PCM 分片（约 100ms/批）送过去，再由插件返回结果；这是备选方案，延迟和带宽都更差。
- 插件 analyzer 模块的加载需要 loader/CSP 支持；第一方 driver 可以先只提供内置 analyzer id，外部模块加载放到 Stage 4 后段。
- “谁拥有口型”仍是插件：VRM 有 `aa`/`oh` 等 viseme，Live2D 有 `ParamMouthOpenY`，MMD 有 morph；host 只给归一化 `mouthOpen`/`rms`/可选 `viseme`，映射在插件内。

**验收**

- actor + chat + rehearsal 三个窗口同时播放同一句 TTS，各自模型都有口型；暂停/停止时归零。
- 没有 speech 时 `undefined` 与“静音但仍在播”可区分（不要用 0 混淆两种状态）。
- 帧流 30Hz 左右，不产生 `CueAck`，不会因为某个 mount 慢而阻塞 cue FIFO。
- 禁用/卸载提供 analyzer 的插件后，帧流停止，所有模型闭嘴。
- 没有任何 `AudioNode` 出现在 IPC/BroadcastChannel payload 里。

**覆盖：** 部分覆盖（RFC 5.11 有 analyzer 语义，未写传输方向与发布者）。

---

### P0-3 跨窗口 `captureFrame` / selfie 不可达

**证据**

- **决策前** `captureFrame` 是 mount 的 exposed 方法；当前 SDK 已删除（[renderer-mount.ts](../packages/stage-renderer-sdk/src/contract/renderer-mount.ts) 不再有该成员）。
- selfie/Discord 的触发点在主窗口/chat（[discord.ts](../packages/stage-ui/src/stores/modules/discord.ts#L1547-L1567)、[ControlStrip.vue](../packages/stage-ui/src/components/scenarios/layout/ControlStrip.vue#L556-L580)）。
- 现有实现靠 `airi:stage-capture` 广播，所有 `RendererStage` 监听并执行（[RendererStage.vue](../packages/stage-ui/src/components/scenes/RendererStage.vue#L292-L356)）。
- 迁移计划 §4.2 删除本地 broadcast capture 路径；§8.7 只描述结果形状。

**影响**

- main/chat 不持有 actor mount 引用，函数不能跨 BroadcastChannel，selfie 无法调用。
- 多个 `RendererStage` 同时监听 `airi:stage-capture`，actor + chat 都开着时可能生成重复 selfie。

**决策（R3，已锁定）**

`captureFrame` 从 `RendererMountExposed` 删除，改为 **cue**。capture 是“对一个 mount 的一次离散请求”，正好符合 cue 的事务语义；exposed 方法只对持有组件引用的窗口可用，跨窗口必然失败。

契约形状：

```ts
enum CueKind {
  // ...
  CAPTURE = 'capture',
}

interface CaptureCue {
  kind: CueKind.CAPTURE
}

interface CaptureResult {
  kind: CueKind.CAPTURE
  mime: string
  data: ArrayBuffer
  width: number
  height: number
}
```

**本版收口（与旧版不同）：**

- **`CaptureCue` 是空 payload。** 它只表示“把当前 renderer canvas 的内容给我”；不指定背景、格式、质量或宽度。renderer 返回它实际画布的全部内容，并在 `CaptureResult` 里带上真实 `mime`/尺寸。发起者不需要知道画布里有什么，也不能要求只取其中一部分。
- **capture 必须单独成包。** capture 是慢操作（编码几十到几百 ms），且编码失败走 `ContractResult` 错误分支（`CAPTURE_FAILED`）。如果它和别的 cue 同包，整包失败会丢掉其他槽位已经应用的结果，违反“每槽 settled”。broker 对“包含 capture 且 `cues.length > 1`”的 envelope 直接返回 `ContractFailureCode.INVALID_ENVELOPE`，不投递。
- 发送方必须带 `timeoutMs`（建议默认 5000），超时返回 `TIMEOUT` 而不是挂起。
- **FIFO 只保证投递顺序，不等待完成。** capture 未完成不能阻塞后续 expression/motion 的投递；broker 投递下一个 envelope 时不等上一个 ack。删除旧版“capture 会占住该 mount 的 FIFO 槽位”的说法。
- 失败语义：目标 mount 不支持 → `results[0] = { status: 'rejected', reason: CueRejection.UNSUPPORTED_CUE }`；mount 不在 → `NO_MODEL`；编码失败 → `CAPTURE_FAILED`；超时 → `TIMEOUT`。
- 同窗口调用也走同一个 cue（in-process 短路），不再保留两条路径。

**验收**

- 主窗口触发 selfie，只有 actor mount 响应；chat 面板开着时不生成重复记录。
- 返回的字节就是 renderer canvas 的内容；cue 里没有 `includeBackground`/`mime`/`quality`/`maxWidth`，发起方也不假设背景是否包含。
- capture 进行中再发 expression cue，expression 不被 capture 阻塞。
- capture 与别的 cue 同包 → `INVALID_ENVELOPE`，不产生部分写入。
- mount 不存在/正在卸载/编码失败时都有确定错误，不挂起。
- 没有 handler 的旧 `airi:stage-capture` 广播路径被删除。

**覆盖：** 部分覆盖（RFC 5.5/8.7 有 capture cue，未写空 payload 与单包规则）；SDK 已按空 payload 更新。

---

### P0-4 cue ack / FIFO / nonce / readiness 跨窗口未定义

**证据**

- `CueChannel.send` 返回 `Promise<ContractResult<CueAck>>`，注释说总线可以是 in-process、BroadcastChannel、IPC（[cues.ts](../packages/stage-renderer-sdk/src/contract/cues.ts#L290-L315)）。
- “across envelopes the host owes FIFO per addressed mount”（[cues.ts](../packages/stage-renderer-sdk/src/contract/cues.ts#L88-L96)）。
- `OperationNonce` 注释写“单调计数器，每次 mount/load attempt 递增”（[shared.ts](../packages/stage-renderer-sdk/src/contract/shared.ts#L16-L21)），但 broker 方案需要一个全局 nonce；两处语义不一致。
- `CueAck` 的 `mountId`/`requestId` 在类型上仍是 optional（[cues.ts](../packages/stage-renderer-sdk/src/contract/cues.ts#L239-L270)）；本版已把 broker 路径的必填语义写进注释，in-process 直连才可省略。
- 现有跨窗口触发是 fire-and-forget BroadcastChannel（[model-store.ts](../packages/stage-ui-three/src/stores/model-store.ts#L103-L130)）。
- 现有 readiness 是 `airi-stage-model-ready` 的查询/广播握手（[App.vue](../apps/stage-tamagotchi/src/renderer/App.vue#L321-L347)），契约没有对应 query。

**影响**

- BroadcastChannel 没有 request/reply；ack 找不到回程。
- 两个窗口各自 mint nonce，可能碰撞；ack 没有 sender/request id，调用方可能匹配错。
- 多 sender 时 per-mount FIFO 无法保证；`dropIfNotReady`/`no-model` 无法由非 mount 窗口回答。
- Stage 1 的 “cue round-trip, ack reasons” 对 actor mount 不可实现。
- scope fan-out 需要多个回答者，但本版只做单 mount；先把单 mount 的 ack 做对，再谈聚合。

**决策（R4，已锁定）**

- **Electron main 进程**实现 `CueBroker`：mount registry（R1）+ 全局 nonce + per-mount FIFO + `PendingRequest` 表 + timeout。
- **IPC 全部走 `@moeru/eventa`**，不新增裸 `ipcRenderer.invoke`/`ipcMain.handle`，也不用 BroadcastChannel 承担 ack（speech frame 是 observer 广播，不是 IPC；见 R2/P0-2）：

| 通道 | 方向 | 类型 | 用途 |
| :--- | :--- | :--- | :--- |
| `stageRendererMountRegister` | renderer → main | `defineInvokeEventa<ContractResult<RendererMountDescriptor>, RendererMountRegistration>` | 注册 mount（id 由 wrapper 铸好） |
| `stageRendererMountUpdate` | renderer → main | `defineInvokeEventa<ContractResult<RendererMountDescriptor>, { mountId, patch }>` | readiness/modelId 变化 |
| `stageRendererMountUnregister` | renderer → main | `defineInvokeEventa<ContractResult<void>, { mountId }>` | 卸载/窗口关闭 |
| `stageRendererMountList` | renderer → main | `defineInvokeEventa<RendererMountDescriptor[]>` | 查询（picker、prompt、capture 定位） |
| `stageRendererMountChanged` | main → all | `defineEventa<RendererMountDescriptor[]>` | registry 变化广播（observer） |
| `stageRendererCueSend` | renderer → main | `defineInvokeEventa<ContractResult<CueAck>, CueEnvelopeInput>` | 发送 cue，等 ack |
| `stageRendererCueDeliver` | main → target | `defineEventa<CueEnvelope>` | 投递到目标窗口 |
| `stageRendererCueAck` | target → main | `defineInvokeEventa<void, { mountId, ack: CueAck }>` | 回传 ack；`ack.requestId` 在 broker 路径必填 |

- **nonce 归属收口：** broker 铸造全局单调 nonce；`CueEnvelopeInput.nonce` 只用于调用方“钉住一个自己已经跟踪的值”。renderer 只在**同一个 mount 上**比较收到的 nonce 判定 stale，不再说“每次 mount/load attempt 由 renderer 递增”。
- **mountId 归属收口：** wrapper 在 mount 前铸 UUID，`register` 提交同一个值；broker 只用它路由和校验 ack 来源，不生成、不改写。全局唯一由 registry 查重保证。
- **只做单 mount ack（本版范围）：** 每个 `CueEnvelope.target` 必须带 `mountId`；`requestId` + `mountId` 是 broker 路径上的必填关联键。一个请求只有一个回答者，`CueAck.mountId` 必填，不存在汇总。
- **scope fan-out 暂不支持：** `target.stateScope` 在 broker 返回 `ContractFailureCode.INVALID_ENVELOPE`，不投递。需要同时控制 actor + chat 的调用方，暂时逐个 `mountId` 发；等单 mount 稳定后再做聚合。
- `CueSendOptions.timeoutMs` 已加入 SDK（默认由调用方决定，capture 建议 5s）。
- `dropIfNotReady` 由 broker 在投递前回答 `renderer-not-ready`。
- 窗口销毁 / `webContents` crash → 该窗口所有 pending send 以 `ABORTED` 结束，registry 清空。
- web/pocket 单进程场景用同一个 broker 的内存实现，只是传输换成函数直调；不要维护两套语义。

**eventa 合同注意：**

- `defineInvokeEventa<Response, Request>` 的泛型顺序是“响应在前”，写反是常见 bug。
- payload 必须可结构化克隆：`CueEnvelope` 是纯数据；capture 的 `ArrayBuffer` 也可以，但不要放 Vue proxy/`Blob`/类实例。
- main 的 handler 必须校验 `options.raw.ipcMainEvent.sender.id` 与注册 mount 的 `windowId` 一致，防止 chat 窗口冒充 actor 的 mount 发 ack。

**验收**

- actor 与 main 同时向同一 mount 发 cue，ack 按发送顺序返回，`requestId`/nonce 不混。
- `target.mountId` 缺失时返回 `INVALID_ENVELOPE`，不隐式选一个 mount。
- `target.stateScope` 返回 `INVALID_ENVELOPE`，不部分投递。
- 目标 mount 不在时，`dropIfNotReady: true` 立即返回 `renderer-not-ready`；默认在 `timeoutMs` 后返回，不挂起。
- actor 重启/崩溃后，旧 pending send 以 `ABORTED` 结束，registry 无残留。
- 从 chat 窗口伪造 actor 的 `mountId` 发 ack 会被 main 拒绝。
- 没有任何 ack 走 BroadcastChannel。

**覆盖：** 部分覆盖（RFC 5.10 有 broker/registry；单 mount ack 已写进 SDK 注释，scope fan-out 明确暂不支持）。

---

### P0-5 现有 plugin host 在 main，不能提供 Vue/DOM renderer

**证据**

- `setupPluginHost()` 在 Electron main 创建 `new PluginHost({ runtime: 'electron' })`（[plugins/index.ts](../apps/stage-tamagotchi/src/main/services/airi/plugins/index.ts#L163-L177)）。
- `ManifestV1` 只有 `apiVersion/kind/name/entrypoints`（[core.ts](../packages/plugin-sdk/src/plugin-host/core.ts#L428-L450)）。
- `FileSystemLoader` 在 main 里 `import(entrypoint)`（[core.ts](../packages/plugin-sdk/src/plugin-host/core.ts#L1042-L1122)）。
- 只支持 in-memory transport（[core.ts](../packages/plugin-sdk/src/plugin-host/core.ts#L542-L553)）。
- 契约要求 `resolveMountComponent()` / `panels` 返回 Vue component（[renderer.ts](../packages/stage-renderer-sdk/src/contract/renderer.ts#L27-L67)、[renderer-mount.ts](../packages/stage-renderer-sdk/src/contract/renderer-mount.ts#L320-L346)），以及 `requirements.webgl/dom/audioContext`（[manifest.ts](../packages/stage-renderer-sdk/src/contract/manifest.ts#L160-L185)）。
- `ModelDriverManifest` 与 `ManifestV1` 是两种 shape；`entry.runtime` 又在 manifest 里（[manifest.ts](../packages/stage-renderer-sdk/src/contract/manifest.ts#L187-L203)），host 要先读 manifest 才能加载 runtime，存在循环。
- `ModelDriverHostRegistry` 没有 activate/deactivate/status（[lifecycle.ts](../packages/stage-renderer-sdk/src/contract/lifecycle.ts#L167-L191)）。

**影响**

- 外部 driver 不能通过现有 host 激活/mount；本 release 也不承诺支持。
- 迁移计划 Phase 7 “driver 可以活在 monorepo 外” 没有 artifact；SDK 还是 `private` + source-only（见 P1-14），第三方引用推迟到稳定后。
- main 里的 plugin host 无法检查 `requirements` 的真实可用性，也无法提供 Vue/AudioContext；它只能读 manifest hint。

**决策（R5 + R19，已锁定）**

- 进程分层确定：**main 只做发现、enable/disable、静态 manifest 校验和 manifest registry 广播；renderer 做 runtime 激活、mount、provider 实例和 Vue/DOM/AudioContext。**
- **先有 manifest，再有 runtime。** 静态 driver manifest 是独立的第一阶段输入；main 只读它，runtime 的加载和 `activate()` 只在 renderer 发生，避免 bootstrap 循环。
- **main 的 registry 与 manifest 信息等价。** 它只持有 driver id、静态 capability hint、requirements、entrypoints 和 enabled 状态；不持有 runtime，也不声称知道真实 capabilities。`rendererCapabilities()` 必须由一个在 renderer 窗口中的 driver 实例回答，因为需要真实 DOM/WebGL/AudioContext。
- main↔renderer 的发现/启用/状态全部走 `@moeru/eventa`（与 R1/R4 共用 `shared/eventa.ts`），不在 main 里 `import()` 渲染器 runtime。
- **本 release 只支持第一方**：第一方 driver 走静态 import / workspace package；第三方引用等契约与运行时完全稳定后再释出。

**建议方案**

- 明确分层：
  - **main manifest registry**：发现静态 manifest、持久化 enable/disable、向 renderer 广播 manifest 变化。它**不**持有 `ModelDriverRuntime`，也不缓存 `rendererCapabilities()` 结果。
  - **renderer driver host**：先读 manifest，再动态 import runtime、调用 `activate`、mount、持有 provider；`ModelDriverHostRegistry.get()` 返回的 runtime 只存在于这个窗口。
- 定义**静态 driver manifest 文件**（JSON/`driver.manifest.json`）：`id`、`contractVersion`、`entrypoints`、`requirements`、`capabilities` hint。它和 runtime 的 `manifest` 分开，且必须先于 runtime 读取。
- renderer loader 用 Vite `import.meta.glob` / import map / 预打包 registry；共享 Vue/Three/Pixi（externals 或 peerDependencies），避免两份 Vue。
- **`ModelDriverHostRegistry` 的 `activate`/`deactivate`/`getStatus` 放在 renderer host**，不放在 main；main 只广播 manifest/enabled 变化。
- **本 release 明确只做 first-party**：保留 static imports，SDK 保持 `private` + source-only；第三方 dist/publish/loader 不作为本 release 承诺，等稳定后再拆。

**验收**

- 一个 stub driver 在 renderer 先读 manifest、再激活、mount、收到 cue、通过 `capture` cue 返回字节；main 只负责 manifest registry 和 enable/disable。
- main 的 registry 只含 manifest/enabled 信息，不出现 runtime、`rendererCapabilities()` 结果或 window 专属状态。
- 禁用 driver 后，mount 被卸载，pending cue 以 `renderer-unavailable`/`aborted` 结束。
- 旧版 manifest 被拒绝并给出可读错误；contractVersion 不兼容不会被激活。

**覆盖：** 已覆盖（RFC 5.2 + 迁移 D18/D19）。

---

### P0-6 重复 modelId 的拒绝/覆盖语义与迁移 marker

**证据**

- RFC 9.13 现在是 `closed`（[RFC 9.13](./rfcs/0001-stage-renderer-plugin-contract.md#L1781)）：existing id 不是 upsert，只有显式 overwrite + migration marker 才允许重入。
- 迁移 D13 已经写成显式 overwrite（[迁移 D13](./design-stage-renderer-migration.md#L86)）。
- `ModelConfirmOptions` 现在是 `overwrite` / `resetProfiles` / `migration`（[provider.ts](../packages/stage-renderer-sdk/src/contract/provider.ts#L228-L248)）。
- 旧版 §9.2 说的“R6 × 迁移 D13 冲突”已不存在；剩下的只是**普通导入 UI 仍 mint 新 id**。

**影响**

- 如果普通导入绕过 `confirmImport`，仍会产生重复 id 或静默覆盖。
- 如果 `overwrite` 语义不明确，迁移可能清掉用户的 profiles。

**决策（R6，已锁定）**

- **默认拒绝**为已存在的 `modelId` 导入模型：`confirmImport` 发现 `(modelDriverId, modelId)` 已存在时返回 `MODEL_ID_CONFLICT`，不覆盖、不合并、不追加。
- 只有调用方显式传 `overwrite: true` 才允许替换；UI 的普通导入/拖放/卡片包导入**永远不传**这个参数。
- 冲突错误必须可判别，但**不需要 payload**：`ContractFailureCode.MODEL_ID_CONFLICT`，`details` 保持 opaque。调用方知道自己发出的 `modelId`，用它在 AIRI catalog 里查现有模型即可；多选时逐个查，不依赖 driver 回传 `existingName`。
- `overwrite` 的语义是“替换模型 payload，保留 profiles/settings，除非同时 `resetProfiles: true`”；写入必须原子：先写新 payload 到临时 key，再切换指针，最后清旧资产；中途崩溃不能留下半替换状态。
- 迁移专用：调用前写 marker（`modelId` + `driverId` + `payloadHash` + `legacySourceId`，状态 `pending`）；`confirmImport({ overwrite: true, migration })` 成功且资产落盘后改为 `done`，再删 legacy blob；`done` 时重试 no-op，`pending` 时用同一 `payloadHash` 重放。
- **普通导入与迁移重放是两条明确路径**：迁移走 marker + overwrite，普通导入只走 conflict。
- 普通导入 UI（drop/file picker、card package）必须走 `confirmImport` 且在 confirm 前由 AIRI mint id；这一条与 P1-5 是同一处实现，不在本 finding 重复展开。

**验收**

- 普通导入一个与现有 `modelId` 相同的文件：返回 `MODEL_ID_CONFLICT`，现有模型、profiles、设置不变；UI 用 attempted `modelId` 在 catalog 找到现有模型并让用户选择改名/取消。
- 显式 `overwrite: true`：payload 替换，profiles/settings 保留；`resetProfiles: true` 才清空。
- 迁移中断后重启：marker 为 `pending` 时重放成功且不重复；`done` 时 no-op。
- 在 `confirmImport` 成功后、删除 legacy blob 前杀进程，重启后不重复导入、不复活旧 key。

**覆盖：** 已覆盖（RFC 9.13 closed + 迁移 D13 + provider.ts）。

---

### P0-7 多模型包导入没有 ID 铸造回调

**证据**

- `ModelProbeInput` 现在只有 `files`/`fileNames`/`url`（[provider.ts](../packages/stage-renderer-sdk/src/contract/provider.ts#L160-L178)）。
- `confirmImport` 允许返回多个 `ModelDescriptor`（[provider.ts](../packages/stage-renderer-sdk/src/contract/provider.ts#L278-L290)）。
- `ModelDescriptor.modelId` 缺失的行不可寻址（[provider.ts](../packages/stage-renderer-sdk/src/contract/provider.ts#L328-L356)）。
- 现有 Live2D 多模型 zip 修复会拆成多个子模型，每个都 `addDisplayModel` 生成新 id（[display-models.ts](../packages/stage-ui/src/stores/display-models.ts#L1067-L1152)）。

**影响**

- 拆分出来的第 2..N 个模型没有 AIRI-minted id；driver 不能发明 id，host 也没有回调分配。
- 这些模型无法被卡片引用、无法删除/预览/加 profile。
- 迁移对多模型 legacy zip 会丢失子模型的可寻址性。

**决策（R7，已锁定）**

改成**两阶段**：driver 只负责“包里有哪几个模型”，AIRI 负责“每个模型用什么 ID”。

```ts
/** probe 阶段：只读，不落盘 */
interface ModelImportPart {
  /** 在本次 probe 结果内稳定；confirm 时用它定位 part */
  partIndex: number
  name: string
  meta: {
    format: string
    /** 可选的轻量预览（data URL，限尺寸）；不要塞原始模型 bytes */
    previewDataUrl?: string
    suggestedProfileName?: string
    sizeBytes?: number
  }
}

interface ModelProbeResult {
  /** 单模型包也有且只有 1 项；不再同时维护单/多两套 shape */
  parts: ModelImportPart[]
  confirmImport: (options: {
    selections: Array<{
      partIndex: number
      /** AIRI mint 后传入；driver 不得改写 */
      modelId: ModelId
      /** 可选；不传则由 AIRI mint 默认 profile */
      profileId?: ModelProfileId
    }>
    overwrite?: boolean
    migration?: ModelImportMigration
  }) => Promise<ContractResult<ModelDescriptor[]>>
}
```

- `probe` 返回 `Array<{ name, meta }>` 的语义，实际类型用 `parts: ModelImportPart[]`，每项至少含 `name` + `meta`。
- UI 展示这些 part，让用户勾选/改名；确认时 AIRI 为每个选中项生成 `modelId`（以及可选 `profileId`），再一次性调用 `confirmImport`。
- **AIRI 保证唯一性**：ID 铸造在 main 进程/单一 store 锁内完成，先查 catalog + pending reservation，再写入；使用 `crypto.randomUUID()` 或 ULID，并在同一事务里登记 reservation。这样“已生成的 ID 在导入后永远不会冲突”，并发导入也不会。
- `confirmImport` 必须校验：`partIndex` 在范围内且不重复、每个 `modelId` 由 AIRI 提供、`modelId` 不与现有冲突（除非 `overwrite`）、返回的 descriptor 的 `modelId` 必须与传入一致（driver 改写即报错）。
- 取消选择时 `probe` 不写任何资产；只有 `confirmImport` 成功才落盘。
- 迁移多模型 legacy zip 走同一路径：probe 出 parts，AIRI mint 稳定 ID 并写 migration marker；重试时复用 marker 里的映射，不重新 mint。

**验收**

- 一个包含 3 个 Live2D 模型的 zip：UI 显示 3 项，取消 1 项后只导入 2 项；两个 modelId 都可寻址、可删除、可预览、有默认 profile。
- 两个窗口同时导入：生成的 ID 不重复；后写入者遇到冲突时得到明确错误（或由 main 串行化 mint）。
- 取消/关闭选择对话框：catalog、localforage、profiles 均无变化。
- 断点重试：不产生重复 part，ID 与首次选择一致。
- driver 返回的 descriptor 改写了传入的 modelId：`confirmImport` 拒绝并给出可读错误。

**覆盖：** 已覆盖（provider.ts + RFC 5.5）。

---

### P0-8 删除 legacy key/blob 不持久，重启/云端会复活

**决策（R8，已锁定）**

每个删除动作写 tombstone（`deleted-localstorage/<key>`、`deleted-models/<id>`、custom VRMA/MMD marker）；`dumpLocalStorageToIndexedDb` 剪掉“localStorage 已不存在且有 tombstone”的条目；`restore*` 跳过 tombstone；迁移在第一次 dump/reconcile 前完成，并删除远端 legacy model/纹理 sidecar。把 “reboot + clean-profile restore” 加入验收。

**证据**

- `dumpLocalStorageToIndexedDb()` 只写当前 key，从不清理 `local:localstorage/*` 中已删除的条目（[sync-engine.ts](../packages/stage-ui/src/stores/sync-engine.ts#L3000-L3033)）。
- 启动 `restoreLocalStorageFromIndexedDbSafe()` 会把 IDB 缓存中“localStorage 当前不存在”的 key 写回（[sync-engine.ts](../packages/stage-ui/src/stores/sync-engine.ts#L3088-L3128)）。
- 全量 `restoreLocalStorageFromIndexedDb()` 会覆盖写回（[sync-engine.ts](../packages/stage-ui/src/stores/sync-engine.ts#L3036-L3086)）。
- 迁移删除 localforage model blob 时没有写 `local:sync-metadata/deleted-models/<id>`；`reconcileModels` 只按 tombstone 删除远端（[sync-engine.ts](../packages/stage-ui/src/stores/sync-engine.ts#L959-L984)、[同文件](../packages/stage-ui/src/stores/sync-engine.ts#L1071)）。
- custom VRMA / MMD motion 也是同样模式（[sync-engine.ts](../packages/stage-ui/src/stores/sync-engine.ts#L1405-L1765)）。

**影响**

- 迁移成功后删除的 `settings/live2d/*`、`settings/mmd/*` 等 key，下一次启动会从 IDB 缓存恢复；用户会看到“删了又回来”。
- clean-profile restore 会把旧模型 blob 重新下载到同一个 id，和 driver 资产并存；卡片可能指回旧数据。
- custom motions 也可能复活或重复。

**建议方案**

- 每个删除动作写 tombstone：`local:sync-metadata/deleted-localstorage/<key>`、`local:sync-metadata/deleted-models/<id>`、custom VRMA/MMD 删除 marker。
- `dumpLocalStorageToIndexedDb` 删除“localStorage 已不存在且有 tombstone”的 `local:localstorage/*`；`restore*` 跳过 tombstone。
- 迁移在第一次 dump/reconcile 之前完成，或迁移后主动清理 IDB/远端 sidecar。
- 删除远端 legacy model 文件/纹理 sidecar；不要只删本地。
- 把 “reboot + clean-profile restore” 加入验收。

**验收**

- migrate 删除 key 后重启两次，key 不复活。
- clean-profile restore 后，旧模型不在 catalog，driver 模型只有一份。
- custom VRMA/MMD motion 不会重复。

**覆盖：** 部分覆盖（迁移计划 Phase 1 有 tombstone 目标，sync-engine 细节未写）。

---

## 4. P1：对应 renderer 迁移前要处理

### P1-1 snapshot / prompt 只写 actor 窗口，main 读不到

**决策（R9，已锁定）：** `state`/`prompt` 的权威副本放 main（单一 coordinator）；actor 通过 eventa IPC 写，main 广播 revision；`prompt` 在 mount 卸载时清空；加两窗口测试。

**证据**

- `state.writeSnapshot` / `prompt.publish` 只允许 mounted instance 调用（[persistence.ts](../packages/stage-renderer-sdk/src/contract/persistence.ts#L119-L151)、[host-services.ts](../packages/stage-renderer-sdk/src/contract/host-services.ts#L337-L357)）。
- actor mount 在 actor 窗口；chat/prompt 在 main 窗口（[ControlStripHost.vue](../packages/stage-ui/src/components/scenes/ControlStripHost.vue#L1955-L1958)）。
- 现有 `createExpressionsContext` 从 renderer store 读（[expressions.ts](../packages/stage-ui/src/stores/chat/context-providers/expressions.ts#L14-L51)）。
- 迁移计划风险登记只说“scope 没有发布就不加行”，没有定义跨窗口复制。

**方案（本版收口）**

- 权威副本放 main；actor 是**唯一生产者**，通过 eventa 把 `writeSnapshot`/`prompt.publish` 送到 main；main 只保存和广播 accepted revision，**不自己写 snapshot**。
- **不再保留 BroadcastChannel 备选。** 旧版写的“或 BroadcastChannel 按 `stateScope` 复制”与 R9、R4 的 eventa 决策冲突，删除。
- `prompt` 在 mount 卸载时由 host 清空（否则 prompt 会保留旧 activeKeys）。
- 加两窗口测试：actor 发布 → main 的 prompt builder 立即看到；actor 关闭 → 行消失。

**验收：** 上述两窗口测试；scope 无发布时明确“无行”，不是空字符串/旧值；关掉 actor 后 main 的 snapshot 不再被旧窗口覆盖。

**覆盖：** 已覆盖（RFC 5.6 + 迁移 D10）。

---

### P1-2 driver panel 缺少 scope/mount/profile 上下文；跨窗口实时设置失效

**证据**

- `ModelDriverPanelProps` 已补 `stateScope`/`mountId?`/`currentProfileId?`/`hostSurface`（[renderer.ts](../packages/stage-renderer-sdk/src/contract/renderer.ts#L85-L132)）。
- panel 不能写 snapshot（只有 mount 能写），也没有 storage change 订阅；`HostStorageInterface.watch` 已加入（[host-services.ts](../packages/stage-renderer-sdk/src/contract/host-services.ts#L46-L59)）。
- control strip 的 expression/motion/wardrobe picker 是 host 组件（[ControlStrip.vue](../packages/stage-ui/src/components/scenarios/layout/ControlStrip.vue#L949-L1035)），panel 契约是 settings tab 形态（title/tabs/scrolling），没有 popover/anchor。
- settings/customizer 窗口与 actor mount 是不同进程。

**决策（R10，已锁定）：control strip 需要 driver 提供组件。**

- control strip 的 expression/motion/wardrobe picker **不再由 host 内置**；driver 在 `panels` 里提供一个可嵌入的 panel 组件，host 只提供 popover 外壳、锚点和尺寸。
- `ModelDriverPanelDeclaration` 增加 `hostSurfaces?: ModelDriverPanelHostSurface[]`（`'settings' | 'popover' | 'inline'`，省略 = 只支持 settings）；`ModelDriverPanelProps` 增加 `hostSurface`，并保留 `stateScope`、`mountId?`、`currentProfileId?`。`readiness` 允许 `UNMOUNTED`。
- host 不解释 vocabulary，也不替 driver 写 store；panel 的写操作走 driver 自己的 storage 或 cue。control strip 关闭后面板卸载，不能留下未被 driver 清理的编辑器状态。
- `HostStorageInterface` 的 `watch(key, cb)` 让 panel 改设置后 live mount 能收到。如果 panel 和 mount 不同窗口，panel 的 `services.state.writeSnapshot` 仍应被 host 拒绝，由 mount 代写。
- 未声明 `popover`/`inline` 的 driver：host 显示明确的 unavailable，**不回退到内置 picker**。

**验收：** 在 settings 窗口改 physics/render scale，actor live mount 立即生效；control strip 的 expression/wardrobe picker 由 driver 组件渲染，不依赖 `useModelStore`/`useLive2d`；driver 不提供 popover panel 时 host 显示 unavailable，而不是内置 picker。

**覆盖：** 已覆盖（迁移 D7 + renderer.ts）。

---

### P1-3 Card editor Acting tab / acting studio / AI curation 是未列出的消费者

**证据**

- `useActingCapabilities.ts` import 四个 renderer store，并从 `availableExpressions`/`availableMorphs`/`availableMotions`/`animationOptions`/`DisplayModelFormat` 推导选项（[useActingCapabilities.ts](../packages/stage-pages/src/pages/settings/airi-card/composables/useActingCapabilities.ts#L4-L7)、[同文件](../packages/stage-pages/src/pages/settings/airi-card/composables/useActingCapabilities.ts#L52-L67)、[同文件](../packages/stage-pages/src/pages/settings/airi-card/composables/useActingCapabilities.ts#L100-L155)）。
- `CardEditorForm.vue` 复制同样的格式分支（[CardEditorForm.vue](../packages/stage-pages/src/pages/settings/airi-card/components/CardEditorForm.vue#L125-L167)）。
- `EmotionCalibrationStudio.vue` 直接写全局 `settingsStore.stageModelSelected = props.modelId` 再 `updateStageModel()`（[EmotionCalibrationStudio.vue](../packages/stage-ui/src/components/scenarios/acting/EmotionCalibrationStudio.vue#L213-L220)），并调四个 store 的 trigger（[同文件](../packages/stage-ui/src/components/scenarios/acting/EmotionCalibrationStudio.vue#L349-L378)）。
- `useExpressionCuration.ts` 同样 import store 并调 `triggerEmotion`/`previewExpression`/`selectVariantAndSkin`（[use-expression-curation.ts](../packages/stage-ui/src/composables/use-expression-curation.ts#L64-L67)、[同文件](../packages/stage-ui/src/composables/use-expression-curation.ts#L281-L324)）。
- 迁移计划 §9.1 没有列这些 route；迁移 D7 已把 calibration 归入 driver panel。

**影响**

- 迁移后 card editor 失去 emotion/motion/idle picker。
- calibration studio 的“预览”会改真实舞台模型（因为 `settings/stage/model` 是共享 key）。
- AI curation 的 preview 失效。

**决策（R11，已锁定）**

CalibrationStudio **不再作为全局组件存在**，拆进各 driver 自己的 panel 实现。理由：校准的对象是 driver 的私有 vocabulary（Live2D 参数、VRM blendshape、MMD morph、Spine skin/attachment），host 不可能用一套通用 UI 表达；放在全局还会写 `stageModelSelected`，污染真实舞台。

落地形状：

- 每个 driver 在自己的 `panels` 里提供一个 `calibration` tab；是否提供由 driver 决定，`ModelDriverCapabilities.panels` 已经能表达。
- 校准写操作走 driver 自己的 `HostStorageInterface` 命名空间或 `ExpressionCue`/`MotionCue`，**禁止**写 `settings/stage/model`、`stageModelSelected` 或任何全局 store。
- 预览使用 settings 窗口里的**独立 preview mount**，scope 必须**每个 mount 唯一**（例如 `preview:<driverId>:<mountId>`，不要用旧版的 `preview:calibration:<driverId>`，否则同一 driver 的 settings preview 和 card editor preview 会共享 draft）。
- `EmotionCalibrationStudio` 现有的“先切模型再校准”拆成两步：host 的模型 picker（只读 catalog）+ driver 的 calibration panel；切模型只影响 preview mount。
- Card editor 的 Acting tab / `useActingCapabilities` 仍由 host 渲染，但数据源改为 `ModelProvider.modelCapabilities()` 或 driver 的 vocabulary projection，不再 import 四个 renderer store。
- `useExpressionCuration` / `ExpressionCurationModal` 走 preview mount + cue，不再写 `displayModelsStore.expressionCapabilities`。
- 四个第一方 driver 可以共享一个 `@proj-airi/stage-renderer-calibration-ui` 组件库来避免四份重复实现，但**入口和 panel 注册归 driver**，host 不知道校准细节。

**验收**

- 在 calibration panel 里切模型/改参数，actor 舞台的模型、`stageModelSelected`、live snapshot 都不变。
- card editor 的 picker 在 driver 未 mount 时仍能从 `modelCapabilities()` 显示（或显示明确的空状态），不依赖 renderer store。
- 同时打开 settings 与 card editor 的 preview，两个 preview 的 scope 不同，draft 不串。
- 关闭 settings 窗口后 preview mount 注销，registry 无残留。
- 每个提供 calibration 的 driver 在 settings 里可见；不提供的 driver 不显示空 tab。

**覆盖：** 已覆盖（迁移 D7）。

---

### P1-4 chat 右侧舞台是第二个真实 mount；`stagePaused` 没传给 actor

**证据**

- chat 窗口挂 `RendererStage`（[chat.vue](../apps/stage-tamagotchi/src/renderer/pages/chat.vue#L1963-L1976)），actor 窗口也挂（[actor.vue](../apps/stage-tamagotchi/src/renderer/pages/actor.vue#L561-L568)）。
- 主窗口 `stagePaused` 传给非渲染的 `ControlStripHost`（[index.vue](../apps/stage-tamagotchi/src/renderer/pages/index.vue#L948-L959)），actor 只传 `!stageEnabled || !showModelLayer`，不读 `stagePaused`（[stage-window-lifecycle.ts](../apps/stage-tamagotchi/src/renderer/stores/stage-window-lifecycle.ts#L42)）。
- 迁移计划 §8.1 只列 “live stage + settings preview”，没有 chat mount。

**决策（R12，已锁定）：chat 与 actor 共享 scope；cue fan-out 稍后。**

- chat 右侧舞台不是 `preview`：它和 actor 使用**同一个 `stateScope`**，两者都是 live mount，读同一份 snapshot/prompt。
- `CueEnvelope.target.stateScope` 仍在契约里，但**本版 broker 不支持**（见 R4）：它返回 `INVALID_ENVELOPE`。需要同时控制 actor + chat 的调用方，先按 `mountId` 逐个发；等单 mount ack 稳定后再做 scope fan-out 与汇总。
- `target.mountId` 是第一版唯一支持的 cue 路由；单 mount 调试/预览也继续用它，不要用“第几个 stage”猜。
- 给所有 scope 内 mount 传 lifecycle `stagePaused`；窗口隐藏/最小化/锁屏时 actor 与 chat 都暂停渲染。这个不需要 cue 路由。

**验收：** actor + chat 同时打开时，两者共享同一个 `stateScope`，读到同一份 snapshot/prompt；按 `mountId` 发 cue 只命中目标；`stateScope` target 返回 `INVALID_ENVELOPE`；窗口最小化后两个 mount 都停止渲染循环。fan-out 的“两边都应用 + 汇总 ack”留到后续阶段验收。

**覆盖：** 已覆盖（cues.ts `stateScope` + 迁移 D12）。

---

### P1-5 public front door 仍 mint 新 ID

**证据**

- `ModelProbeInput` 现在只有 `files`/`fileNames`/`url`（[provider.ts](../packages/stage-renderer-sdk/src/contract/provider.ts#L160-L178)）；旧的 `file` + companion 冲突已消除，迁移 D13 也已改成同一 `files` 集合。
- `model-selector.vue` 的 drop 导入仍 `addDisplayModel`/`addDisplayModelWithTextures`，mint 新 id（[model-selector.vue](../packages/stage-ui/src/components/scenarios/dialogs/model-selector/model-selector.vue#L472-L474)、[同文件](../packages/stage-ui/src/components/scenarios/dialogs/model-selector/model-selector.vue#L776-L786)）。
- `use-data-maintenance` 的 card package 导入同样按 format 调 `addDisplayModel`（[use-data-maintenance.ts](../packages/stage-ui/src/composables/use-data-maintenance.ts#L607-L614)）。

**影响**

- 即使契约已经是两阶段导入，应用侧仍绕过 `probe/confirmImport`，重复 id、不可寻址、迁移覆盖语义都会在真实入口复现。

**决策（R13，已锁定）：统一 `files`，不区分 companion；AIRI 只负责模型导入。**

- 模型文件、纹理和其他随模型交付的文件全部放 `files`，`fileNames` 与之一一对应；`url` 仍作为远程输入。单文件就是 `files.length === 1`。
- 模型包内的文件由 driver 在 `probe` 里自行识别；AIRI 不区分“主文件/配套文件”，也不为配套文件 mint id。
- **AIRI 的统一导入只处理模型。** motion、VRMA、preset、纹理替换等非模型资产不走 `probe`/`confirmImport`，由 driver 自己的 panel/通道导入和管理；AIRI 不为它们发 id、不建 catalog、不做备份枚举。
- 两个模型导入 UI 都改为 `probe` → `confirmImport`；新导入的 id 由 AIRI 在 confirm 前 mint；legacy id 只用于迁移的 `overwrite` 路径。

**验收：** MMD 带纹理导入后纹理可用（作为同一 `files` 集合的一部分）；card package 导入后卡片指向新 model id；旧 front door 也走 `probe` → `confirmImport`，不再自行 mint；迁移导入保留旧 id；自定义 motion/preset 只能从 driver panel 进入，AIRI catalog 不出现对应行。

**覆盖：** 已覆盖（provider.ts + 迁移 D13）；应用入口未改。

---

### P1-6 Outfit→profile 没有稳定 profileId；retry 用实时 selectedModelId

**证据**

- `ModelDriverMigrationInput` 只有 `entries` + `selectedModelId`（[renderer.ts](../packages/stage-renderer-sdk/src/contract/renderer.ts#L164-L199)）。
- `HostModelProfileRecord.profileId` 必须 AIRI mint（[references.ts](../packages/stage-renderer-sdk/src/contract/references.ts#L76-L84)、[model.ts](../packages/stage-renderer-sdk/src/contract/model.ts#L16-L23)）。
- `saveProfile` 已改为不要求 mount，只要求 driver 已注册（[provider.ts](../packages/stage-renderer-sdk/src/contract/provider.ts#L125-L137)）。
- 迁移 D15 的全局 Live2D emotion map 应用到 `selectedModelId`，该值来自实时 `settings/stage/model`（[stage-model.ts](../packages/stage-ui/src/stores/settings/stage-model.ts#L25)）。

**决策（R14，已锁定）：`saveProfile` 只要求 driver 已注册，不要求存在 mount；`MigrationInput` 形状待定。**

- `ModelProvider.saveProfile` 不再以“必须有 live mount”为前提：driver 已 `activate` 就能保存它当前持有的 profile 状态，没有 mount 时由 driver 从自己的 storage 读取最后状态。
- `ModelDriverMigrationInput` 的结构**暂不锁定**。本轮不加入 `models.profileMappings` 之类的形状；`entries`/`selectedModelId` 只是当前过渡形态，后续由 host 与 driver 一起定，不能把它当成最终契约。
- 可以确定的部分：AIRI mint `profileId`；host 在迁移开始时冻结 `selectedModelId` 并写 marker，重试不读实时 key；driver 报告未使用的 outfit。
- 验收覆盖两个模型、各两个 outfit、切换选择后 crash-retry；profile 映射的具体字段等 `MigrationInput` 定稿后补。

**验收：** driver 已注册但未 mount 时 `saveProfile` 成功；`HostModelProfileRecord` 与 driver profile 一一对应；迁移输入未定稿前不实现字段级映射。

**覆盖：** 已覆盖（provider.ts + 迁移 D12）。

---

### P1-7 presets 没有迁移路径；authorIcon 丢失

**证据**

- 四个 preset 是 URL 模型，`previewImage`/`authorIcon` 是 `new URL(...).href`（[display-models.ts](../packages/stage-ui/src/stores/display-models.ts#L112-L117)）。
- `ModelPreview.dataUrl` 要求 data URL（[shared.ts](../packages/stage-renderer-sdk/src/contract/shared.ts#L208-L214)）。
- 迁移 D14 现在明确：legacy preview 只有“已经是 data URL”时才复制，asset URL/path 必须 fetch 或跳过并告警。
- preset 是默认模型/onboarding/卡片默认（[stage-model.ts](../packages/stage-ui/src/stores/settings/stage-model.ts#L25)、[character-defaults.ts](../packages/stage-ui/src/constants/prompts/character-defaults.ts#L190-L238)）。
- `authorIcon` 在 `DisplayModel`（[display-models.ts](../packages/stage-ui/src/stores/display-models.ts#L46-L99)），`CharacterAvatar` 依赖它（[CharacterAvatar.vue](../packages/stage-ui/src/components/misc/CharacterAvatar.vue#L49-L63)），但 `HostAnnotationFields` 没有（[references.ts](../packages/stage-renderer-sdk/src/contract/references.ts#L22-L43)）。

**影响**

- preset 是 URL 模型，无法按“复制 data URL”迁移；清空数据/onboarding/卡片默认会失配。
- `authorIcon` 丢失会让 `CharacterAvatar` 退化。

**方案（未决：两条互斥路径，只能选一条）**

1. **driver builtin**：`ModelProvider.list()` 返回稳定 `modelId`（例如 `builtin:ai.moeru.airi.stage.live2d:preset-1`），`LoadCue` 能加载 bundled asset。此时这些 ID 属于 **driver-owned `builtin:` 命名空间**，不由 AIRI mint、不参与 `MODEL_ID_CONFLICT`、不可被普通导入覆盖；host 记录 `source: builtin`。
2. **首次启动导入**：host 在首次启动时用 `probe` → `confirmImport` 把 preset 导入 driver storage，ID 由 AIRI mint 并持久化，之后与普通模型同权。

两条路径不能同时存在；选择前不要写死 `preset-*` 的归属。
**验收：** 新装/清空数据后默认模型、onboarding、卡片默认仍是同一个 preset 身份；离线时 preview/authorIcon 可见；迁移 Phase 6 后没有 `DisplayModelFormat` 依赖。

**其他修正**

- preview 归一化：URL preview 先 fetch → data URL，或把 `ModelPreview` 扩展为 `{ dataUrl } | { url, cachedDataUrl? }`。
- `HostAnnotationFields` 增加 `authorIcon?: ModelPreview`（或单独 `authorIconDataUrl`），迁移 D12 复制。
- 不要让迁移 Phase 6 删除 `DisplayModel` 时被 preset 卡住。

**覆盖：** 部分覆盖（迁移 D14 已修正 data URL 假设；preset/authorIcon 仍未决）。

---

### P1-8 custom motions/VRMA 无 API；selective sync 无法枚举；clear data 无法 purge

**证据**

- MMD `customMotions` 在 localforage（[mmd.ts](../packages/stage-ui-mmd/src/stores/mmd.ts#L104-L147)），VRM custom VRMA 也在 localforage（[sync-engine.ts](../packages/stage-ui/src/stores/sync-engine.ts#L1666-L1764)）。
- `selective-sync-panel.vue` 直接读 `mmdStore.customMotions`（[selective-sync-panel.vue](../packages/stage-ui/src/components/scenarios/providers/selective-sync-panel.vue#L378-L461)）。
- `ModelProvider` 只有模型/portal 操作，没有 asset 操作（[provider.ts](../packages/stage-renderer-sdk/src/contract/provider.ts#L28-L153)）。
- `deleteAllData` 只 reset Live2D store；driver storage 没有 purge API（[use-data-maintenance.ts](../packages/stage-ui/src/composables/use-data-maintenance.ts#L780-L787)）。
- `forceRestoreFromRemote` 直接 `localforage.clear()`（[sync-engine.ts](../packages/stage-ui/src/stores/sync-engine.ts#L3349-L3350)）。

**决策（R13 的一部分 + 未决）：非模型资产走 driver 自己的通道，不进 `ModelProvider`。**

- custom motion/VRMA/preset 的导入、枚举、删除都由 driver panel/bridge 提供；AIRI 不为它们 mint id、不建 catalog、不做 per-asset 备份枚举。
- 短期把 custom assets 作为 driver bundle 的一部分，`ModelDriverRuntime.export/import` 带走；selective sync 是否保留仍按 §9.3 的问题决定。
- 长期若需要 per-asset sync，由 driver 自己暴露 asset API；它是 driver 通道，不是 AIRI 的模型 API。
- 增加 `ModelDriverRuntime.purge()`（或 `clearStorage`）供 “delete all data”/uninstall 调用；host 不能直接枚举 driver keys。当前 SDK 没有这个成员，属于 Stage 3 的契约补充。
- 更新 `forceRestore`：先恢复 driver bundle，或保留 driver namespace 不 clear。

**验收：** 删除所有数据后 driver storage 为空；custom motion 仍可选择性备份/恢复；MMD VMD 导入仍可用。

**覆盖：** 部分覆盖（迁移 D13 已定“非模型资产归 driver 通道”；purge/selective sync 未定）。

---

### P1-9 旧云备份/force restore 与新 driver storage 不兼容

**证据**

- `forceRestoreFromRemote` 清空 `local:`、`localStorage`、`localforage`（[sync-engine.ts](../packages/stage-ui/src/stores/sync-engine.ts#L3284-L3350)），然后按旧 `manifest.json` + 模型文件恢复。
- `reconcileModels`/`reconcileMmdMotions`/custom VRMA 使用旧 `DisplayModel` 字段（[sync-engine.ts](../packages/stage-ui/src/stores/sync-engine.ts#L595-L618)、[同文件](../packages/stage-ui/src/stores/sync-engine.ts#L1223-L1240)）。
- 迁移 Phase 6 删除 legacy sync 后，旧远程备份没有 reader。

**方案（未决）**

- 保留一个 release 的 **legacy backup reader**：把旧 manifest 转成 `HostNamedModelRecord` + 逐 model `ModelProbeInput`/`confirmImport`；写 migration marker。
- 恢复顺序：先 host records/preview，再 driver bundles/model bytes；或反过来但要保证引用可解析。
- 不清空 `driver-migration/*` marker；或把 marker 存在不会被 restore 覆盖的命名空间。
- 对旧 custom VRMA/MMD motion 通过 driver 自己的 legacy asset 通道移交，不由 AIRI catalog 导入。
- 验收：旧备份恢复到 clean profile 后，模型/设置/自定义动作都在。

**覆盖：** 未覆盖（迁移计划 Phase 1 只提“backup visibility”，没有 legacy reader）。

---

### P1-10 混合迁移期没有双 catalog / 导入仲裁

**证据**

- per-renderer 分阶段意味着 legacy `DisplayModel` 和 driver 记录共存。
- `DisplayModelFormat` 仍驱动 `stage-model.ts` 的 switch（[stage-model.ts](../packages/stage-ui/src/stores/settings/stage-model.ts#L129-L164)）、`RendererStage` 的静态组件选择（[RendererStage.vue](../packages/stage-ui/src/components/scenes/RendererStage.vue#L454-L555)）、model-selector 的筛选/计数（[model-selector.vue](../packages/stage-ui/src/components/scenarios/dialogs/model-selector/model-selector.vue#L66-L104)）。
- 统一导入目前只有 legacy 检测；driver `probe` 是新增路径，二者没有仲裁。

**方案（未决）**

- host model store 用联合：

  ```ts
  type HostModel = LegacyDisplayModel | DriverBackedModel
  ```

  带 `source`/`driverId`/`format`（legacy only）。
- 导入流程：先问所有 enabled driver `probe`；如果没有高置信度，再走 legacy detection；记录 `importedBy`。
- UI：`modelDriverHint`/`ModelDriverManifest.name` 替代 `DisplayModelFormat`；格式筛选可暂时映射 driver name，迁移 Phase 6 后移除。
- 每个 renderer 一个 feature flag；legacy 路径只处理未迁移格式。
- 迁移 Phase 6 的 grep 标准升级为“无 host 文件读 renderer store/format”，并补一个混合模式 e2e。

**覆盖：** 未覆盖

---

### P1-11 V-HACK / L-HACK 需要 raw model bytes，与“host 不碰 renderer”冲突

**证据**

- `HackerPanel` 从 `stageModelSelectedUrl` fetch VRM 二进制（[HackerPanel.vue](../packages/stage-ui/src/components/scenarios/settings/model-settings/vrm-vhack/HackerPanel.vue#L735-L737)）。
- `LHackerPanel` watch 同一 URL（[LHackerPanel.vue](../packages/stage-ui/src/components/scenarios/settings/model-settings/live2d-lhack/LHackerPanel.vue#L21-L24)）。
- `vhackStore.sourceArrayBuffer` 来自 `binaryLoaded`（[vhack.ts](../packages/stage-ui/src/stores/vhack.ts#L17)）。
- 契约把 raw model/viewport 划给 driver；`ModelProvider.export` 是 opaque bundle（[provider.ts](../packages/stage-renderer-sdk/src/contract/provider.ts#L140-L153)）。

**方案（未决）**

- 把 V-HACK/L-HACK 做成 VRM/Live2D driver 的 dev panel：driver 在自己的实例上提供二进制/材质/纹理操作，host 只挂载 panel。
- 或增加一个 debug-only `ModelProvider.exportRaw`/`getBinary`（明确不稳定、仅 first-party dev tool），并接受它破坏封装。
- 不要保留 host 通过 `stageModelSelectedUrl` 直接取 bytes 的路径；迁移后 URL 不存在。

**验收：** V-HACK 能读取/修改/导出 VRM；LHACK 能读 zip buffer；不再依赖 `stageModelSelectedUrl`。

**覆盖：** 部分覆盖（迁移 D17 只保留 driver-id 判断，没有数据路径）。

---

### P1-12 头挂字幕/宿主 overlay 与 CaptionCue 所有权

**证据**

- `HeadTetheredCanvas2D` 用 `getHeadPose()` 定位独立 2D canvas，并监听 `airi-caption-overlay`（[HeadTetheredCanvas2D.vue](../packages/stage-ui/src/components/scenes/HeadTetheredCanvas2D.vue#L35-L48)、[同文件](../packages/stage-ui/src/components/scenes/HeadTetheredCanvas2D.vue#L68-L107)）。
- RFC 9.4 说 caption 完全归 renderer，host 不再在 renderer canvas 内绘制。
- 旧 SDK 还有 `getHeadPose` 和 `ModelDriverCapabilities.headPose`，注释说用于 tether captions/radial menu；当前已删除。
- `CaptionCue` 现在是可选能力（[cues.ts](../packages/stage-renderer-sdk/src/contract/cues.ts#L522-L564)、[manifest.ts](../packages/stage-renderer-sdk/src/contract/manifest.ts#L100-L111)）。

**决策（R15，已锁定）：head-tethered caption 渲染迁移进 driver。**

- `CaptionCue`（text、segments、utteranceId、elapsedMs）是**可选能力**：driver 在 `ModelDriverCapabilities.cues` 中声明 `caption` 才实现并负责自己的 head-tethered 呈现；不声明就是明确不支持，host 不发该 cue。
- **host 兜底是可选策略，只有一个默认：** AIRI 可以自己实现一个 overlay 兜底，也可以不实现。不实现时，未声明 `caption` 的 driver 就是没有 caption，这是可接受结果——删除旧版“不要同时删除 host overlay、又不给 driver caption”的反向要求，它把“可选”变成了强制。
- 该 overlay 不能依赖 driver 的 `HeadPose`，因此**不能是 head-tethered**；它只能是 host 自己布局的屏幕层（例如底部/顶部）。
- 从 SDK 删除 `HeadPose`、`RendererMountExposed.getHeadPose` 和 `ModelDriverCapabilities.headPose`；AIRI 不再向 mount 要头部位姿。
- AIRI 仍可以在舞台 DOM 上添加任意 layer（caption 以外的 overlay、菜单、调试层等）并显示任意内容；这些 layer 不依赖 driver 的 head pose，由 host 自己定位和渲染。`HeadTetheredRadialMenu` 因此不再跟随头部，改为 host 自己的布局/锚点，不再读 renderer。
- host overlay 与 driver caption 的边界：driver 只画自己 canvas 内的 caption；host 只画 canvas 外的 layer，两者不共享坐标，也不互相伪装。
- 迁移清单：VRM/MMD/Spine 的 grow 列表按 driver 是否声明 `caption` 决定是否补；Live2D 的现有 bubble 从 host composable 移入 driver（若该 driver 声明 caption）。

**验收：** 声明 `caption` 的 driver 能渲染 CaptionCue；未声明的 driver 不被 host 发送，误发时返回 `unsupported-cue`；AIRI 可以选择实现或不实现 host overlay，但都不得依赖 `headPose`，也不得把它伪装成 driver caption；AIRI 侧 grep 不到 `getHeadPose`/`HeadPose`；host 添加任意 layer 不依赖 renderer，也不受 caption 迁移影响。

**覆盖：** 已覆盖（迁移 D4/D15 + cues.ts）。

---

### P1-13 SDK 类型/校验缺口

**证据**

- `RendererMountComponent = Component<Props, Exposed>`（[renderer-mount.ts](../packages/stage-renderer-sdk/src/contract/renderer-mount.ts#L320-L346)）；Vue 的 `Component` 第二个泛型是 `RawBindings`，不是 `expose()` 的结果。
- `RendererMountEmits` 没有进入 `Component` 类型（[renderer-mount.ts](../packages/stage-renderer-sdk/src/contract/renderer-mount.ts#L169-L210)）。
- `ModelDriverCapabilities` 是独立布尔值集合，optional 成员没有 correlated type/validator（[manifest.ts](../packages/stage-renderer-sdk/src/contract/manifest.ts#L62-L137)、[provider.ts](../packages/stage-renderer-sdk/src/contract/provider.ts#L49-L152)）。
- `manifest.contractVersion` 只有类型，没有兼容规则（[manifest.ts](../packages/stage-renderer-sdk/src/contract/manifest.ts#L16-L22)、[shared.ts](../packages/stage-renderer-sdk/src/contract/shared.ts#L34)）。

**方案（未决）**

- 用 `DefineComponent`/`ComponentExposed` 或自定义 `RendererMountInstance` 表达 exposed；将 `E` 泛型传入 emits。
- 提供 runtime validators：`assertDriverManifest`、`assertDriverCapabilities`、`assertRendererMountComponent`；first-party 和 loader 都调用。
- 能力与成员用 mapped type/validator 绑定；缺失成员在 loader 阶段拒绝。
- 版本规则：0.x 采用精确 minor（host 只接受自己实现的 minor），1.0 后再定兼容区间；写进 loader。
- 加负向测试：缺 `cues`/`capture` 处理/`first-frame`；声明了 `caption` 但 sink 没处理应返回 `unsupported-cue`，未声明 `caption` 则不应被发送。

**验收：** 上述负向测试在 typecheck 或 first-party loader 阶段失败；未来第三方 loader 接入时，manifest 被拒绝要有可读原因。

**覆盖：** 未覆盖

---

### P1-14 SDK `private` + source-only，外部 driver 无法消费

**证据**

- `package.json` `"private": true`，`exports: { ".": "./src/index.ts" }`，没有 `build`/`main`/`types`/`files`/`peerDependencies`（[package.json](../packages/stage-renderer-sdk/package.json#L17-L25)）。
- 对比 `plugin-sdk` 有 dist exports/build/files（[plugin-sdk/package.json](../packages/plugin-sdk/package.json#L18-L41)）。
- 旧版 RFC §8 step 7 / 迁移 §5 曾承诺 driver 可以活在 monorepo 外；现在明确推迟。

**决策（R18，已锁定）：本 release 只支持 first-party。**

- SDK 保持 `private` + source-only，不做 `dist`/publish/postinstall 承诺；第一方 driver 继续通过 workspace 静态 import 消费。
- 不把“第三方可以装 SDK”写进本 release 的验收或 release notes；只保留为稳定后的路线图。
- 等契约、renderer host、manifest/loader 稳定后再做第三方释出：移除 `private`，加 tsdown build（`dist` JS + `.d.ts`）、`files`、`peerDependencies.vue`、版本号与 publish workflow。届时 `vue` 必须是 peerDependency，避免两份 Vue。
- 现在可以先把 `vue` 作为 peerDependency 作为未来准备，但不把它作为本轮已实现的发布能力。

**验收：** 第一方 workspace driver 能 import SDK 并 typecheck；文档明确本 release 不承诺第三方安装。

**覆盖：** 已覆盖（迁移 D18）。

---

### P1-15 第三方 driver 的 bridge/storage 权限边界未定义

**证据**

- `HostBridge.send/invoke` 接受任意 channel（[host-services.ts](../packages/stage-renderer-sdk/src/contract/host-services.ts#L286-L296)）。
- `HostStorageInterface.keys()` 是 driver 自己的 namespace，但没有 host 侧强制（[host-services.ts](../packages/stage-renderer-sdk/src/contract/host-services.ts#L31-L59)）。
- `state.readSnapshot(scope)` 可传任意 scope；契约只说“mount 不读别的 scope”，没有 host 校验（[persistence.ts](../packages/stage-renderer-sdk/src/contract/persistence.ts#L119-L151)）。

**决策（R16，已锁定）：namespace 隔离由 AIRI 实现，driver 不可知；其他接受。**

- `HostStorageInterface` 的实现强制 driver namespace：driver 传入的 key 是相对 key，host 在读写时加上自己的前缀；`keys()` 只返回该 driver 的 key，driver 不需要知道前缀，也不能通过前缀逃逸。
- `bridge` 改成 host 侧 allowlist（channel + payload schema），driver 只看到被授予的通道。
- `readSnapshot` 只允许 mount 自己的 scope；panel 通过显式 host API 读取。
- 第三方 driver 的 manifest 声明 permissions；loader 展示给用户。其他权限边界按建议方案执行。

**验收：** 恶意/错误的 driver 不能读别的 driver storage 或任意 IPC channel；driver 代码里不出现 host 的 namespace 前缀。

**覆盖：** 已覆盖（迁移 D16 + host-services 注释）。

---

## 5. P2：整理与一致性

### P2-1 scope 语义、切换模型与多 mount revision

**决策（R17，已锁定）：scope 有语义；除 preview 外均复用 scope。**

- scope **不是** `(surface, modelId)` 的拼接，也不把 `modelId` 放进 key。scope 是 host 定义的语义共享单元：actor、chat、rehearsal 等非 preview mount 复用同一个共享 scope，切换模型只更新 snapshot 里的 `modelId`，不换 scope。
- 唯一例外是 `preview`：每个 preview mount 使用自己的 scope，**名字必须包含 mountId**（例如 `preview:<driverId>:<mountId>`），不继承共享状态，也不与其他 preview 共用。
- cue 可以按 `stateScope` 投递，broker 对该 scope 下所有 mount 同时应用（P1-4）；这是“chat 和 actor 共享 scope 同时控制”的长期方向，**第一版只支持 `mountId`**。
- **写入者：** renderer 是唯一生产者（mounted instance 调用 `writeSnapshot`/`prompt.publish`）；main 是唯一保存/广播点，忽略不比当前 revision 新的写入。不要写成“host 是唯一写入点”。
- 同一 scope 的多个 mount 发布相同状态时，revision 较大的胜出。本轮不改 `writeSnapshot` 签名，accepted revision 作为后续可选增强。
- `ModelScopedState.surface` 继续只是标签，不是 key；一个 scope 可以对应多个 mount，不能再用 surface 反推唯一 mount。

### P2-2 `interactionMode` 仍存在 VRM key

`interactionMode` 是 `settings/stage-ui-three/interaction-mode`（[model-store.ts](../packages/stage-ui-three/src/stores/model-store.ts#L310)），control strip 通过 `useModelStore()` 写（[use-control-strip-action.ts](../packages/stage-ui/src/composables/use-control-strip-action.ts#L40-L97)）。**迁移 D5** 说它“已经是 host prop”，但代码不是。建议移到 host store（`settings/control-strip` 或新 mount settings），通过 `RendererMountProps.interactionMode` 下发。

### P2-3 cue 细节

- `CueAck.results` 的“长度等于 `cues.length`”已经写进契约注释，但缺 runtime 校验；`handled` 也可能被错误构造。建议 host 校验 `results.length === cues.length` 并重算 `handled`。
- `animation-finished` 只带 nonce；一个 envelope 里多个 motion 无法区分（[renderer-mount.ts](../packages/stage-renderer-sdk/src/contract/renderer-mount.ts#L190-L210)）。建议带 cue index。
- `CueRejected` 没有 invalid-payload；无效 payload 目前只能落到 `unsupported-cue` 或整包错误。建议增加一个明确的 reason。
- `CueSendOptions.timeoutMs` 已加入 SDK；`dropIfNotReady` 默认仍等待，由调用方显式设 deadline。
- 含 `capture` 且 `cues.length > 1` 的 envelope 用 `ContractFailureCode.INVALID_ENVELOPE` 拒绝（R3）。

### P2-4 `ModelDescriptor.profiles` 与 `listProfiles` 双源

`ModelDescriptor.profiles` required（[provider.ts](../packages/stage-renderer-sdk/src/contract/provider.ts#L328-L356)），`listProfiles` 又是独立方法（[provider.ts](../packages/stage-renderer-sdk/src/contract/provider.ts#L103-L123)）。两者可能不一致。建议：descriptor 只带摘要/数量，`listProfiles` 为权威；或去掉 descriptor.profiles。

### P2-5 preview data URL 体积/同步路径

`ModelPreview.dataUrl` 是持久化 data URL（[shared.ts](../packages/stage-renderer-sdk/src/contract/shared.ts#L208-L214)）。`provider.list` 若给每个模型都带 preview，catalog 会很大；现有 sync-engine 会把 `data:` preview 移到 sidecar（[sync-engine.ts](../packages/stage-ui/src/stores/sync-engine.ts#L943-L956)）。建议：descriptor preview 只给缩略图；host 记录按需存储；继续用 sidecar/压缩；限制尺寸。

### P2-6 contractVersion 兼容规则

`MODEL_DRIVER_CONTRACT_VERSION` 是 **0.2**（[shared.ts](../packages/stage-renderer-sdk/src/contract/shared.ts#L34)），没有“host 接受哪些版本”的规则。建议 0.x 精确 minor；1.0 后声明区间 + feature negotiation；loader 拒绝时给 readable error。

### P2-7 文档漂移/不一致

- RFC §5.4 的 `ResetCue` scope 表还没有 `transform`，但 `shared.ts`/`cues.ts` 有 `ResetScope.TRANSFORM`，迁移 D5 也用到它（[cues.ts](../packages/stage-renderer-sdk/src/contract/cues.ts#L577-L592)）。
- 迁移 D11 说失败重试三次，RFC 5.9 说“offers it once, then never again”（[RFC 5.9](./rfcs/0001-stage-renderer-plugin-contract.md#L1169)）；风险登记又说保留一个 release。三处需要统一。
- RFC §8 Phase 7 叫“First-party packaging”，但 R18 说本 release 不做 dist/publish；“packaging”应明确为“workspace 内打包/启用”，不是发布。
- 本文旧版说的 13 个 contract 文件、0.1 版本、RFC 9.13 open 均已过时：现在是 **12 个文件**、**0.2**、**9.13 closed**；RFC §9 的 open 项是 9.9 和 9.14（[RFC §9 status](./rfcs/0001-stage-renderer-plugin-contract.md#L1391)）。
- `docs/rosetta-stone.md` 等索引若仍把 `HeadPose`/`getHeadPose` 当现行概念，需要跟随 R15 更新。

---

## 6. 对契约的具体修改建议（目标形状）

> 以下是**已锁定决策 + 本版收口**对应的目标形状。Wave 0 的契约项已经进 SDK 0.2；Stage 2 只剩 speech 注释、`CueAck.requestId` 的 broker 约束说明和运行时实现。命名/放置可以在实现时微调，但语义不再变。

### 6.1 Mount registry + cue broker（main 进程，eventa）

```ts
interface RendererMountDescriptor {
  mountId: string
  modelDriverId: string
  modelId?: string
  surface: RendererMountSurfaceKind
  stateScope: string
  windowId: string
  readiness: RendererMountReadinessState
  updatedAt: number
}

/** mountId 由 mount wrapper 在 mount 前铸成 UUID；windowId 由 main 从 sender 填。 */
type RendererMountRegistration = Omit<RendererMountDescriptor, 'updatedAt' | 'windowId'> & {
  windowId?: string
}

interface ModelDriverMountRegistry {
  register: (descriptor: RendererMountRegistration) => Promise<ContractResult<RendererMountDescriptor>>
  update: (mountId: string, patch: Partial<Omit<RendererMountDescriptor, 'mountId' | 'windowId' | 'updatedAt'>>) => Promise<ContractResult<RendererMountDescriptor>>
  unregister: (mountId: string) => Promise<ContractResult<void>>
  list: () => Promise<RendererMountDescriptor[]>
  findBy: (query: RendererMountQuery) => Promise<RendererMountDescriptor[]>
  onChanged: (handler: (mounts: RendererMountDescriptor[]) => void) => Unsubscribe
}

interface CueBroker {
  send: (input: CueEnvelopeInput, options?: CueSendOptions) => Promise<ContractResult<CueAck>>
}
```

通道表见 P0-4（`register/update/unregister/list/changed` + `cueSend/Deliver/Ack`）。规则：

- **nonce：** broker 铸全局单调值；renderer 只在同一 mount 内比较 stale；`CueEnvelopeInput.nonce` 只用于调用方钉值。
- **mountId：** wrapper 在 mount 前铸 UUID，`register` 提交同一个值；broker 不生成、不改写，registry 全局查重。
- **FIFO：** 只保证投递顺序，不等待完成；同一 mount 上两个 envelope 可以同时在飞。
- **ack：** 只做单 mount；`mountId` + `requestId` 在 broker 路径必填，一个请求一个回答者。`target.stateScope` 返回 `INVALID_ENVELOPE`，fan-out 后续再说。
- **readiness：** `dropIfNotReady` 由 broker 在投递前回答；`timeoutMs` 后 `TIMEOUT`（capture 建议 5s），不永久挂起。
- **清理：** 窗口 `closed`/`render-process-gone` → 清 registry，所有 pending 以 `ABORTED` 结束。
- **web/pocket：** 内存 broker 复用同一套语义，不维护第二套 FIFO。

### 6.2 Speech analyzer（插件级，不属于 driver 契约）

```ts
interface SpeechAnalysisFrame {
  at: number
  rms: number
  mouthOpen?: number
  viseme?: string
}

interface HostSpeechAnalyzerService {
  register: (input: {
    pluginId: string
    entry: string
    options?: Record<string, unknown>
  }) => Promise<ContractResult<{ analyzerId: string }>>
  unregister: (analyzerId: string) => Promise<void>
  subscribe: (handler: (frame: SpeechAnalysisFrame) => void) => Unsubscribe
}
```

- 从 `ModelDriverHostServices` 删除 `HostAudioInterface`；driver 不再接触 `AudioContext`/`AudioNode`。
- analyzer 在**持有 AudioContext 的窗口 renderer**（当前是主窗口 `ControlStripHost`）加载并运行；Electron main 进程没有 Web Audio。
- 帧走 eventa 的 BroadcastChannel adapter（频道 `airi::stage-renderer-speech`），约 30Hz、latest-wins、无 ack，不是 cue，也不经过 main broker。
- Stage 1：复用现有 `mouthOpenSize` 生成帧，不加载插件模块；Stage 4：插件 `register()` analyzer 模块，`unregister()` 停止并归零。
- 插件 analyzer 若只能跑在 actor，host 退化为按 ~100ms 批发送 PCM；这是备选，不作为默认路径。

### 6.3 Capture cue

```ts
enum CueKind {
  // ...
  CAPTURE = 'capture',
}

interface CaptureCue {
  kind: CueKind.CAPTURE
}

interface CaptureResult {
  kind: CueKind.CAPTURE
  mime: string
  data: ArrayBuffer
  width: number
  height: number
}
```

- `CaptureCue` 是空 payload；renderer 返回当前 canvas 的全部内容，`CaptureResult` 带实际格式/尺寸。发起方不指定背景、格式、质量或宽度。
- capture 必须单独成包；含 capture 且 `cues.length > 1` → `INVALID_ENVELOPE`，不投递。
- `CueResolved`/`CueRejected` 仍是唯一结果形状：成功带 `CaptureResult`，拒绝带 `CueRejection`；编码失败是 `ContractResult` 错误 `CAPTURE_FAILED`（因为 capture 独占一包，不会丢别的槽位）。
- `results.length === cues.length` 是硬不变量；`results[0].value.kind === 'capture'`。
- `handled` 是派生值，host 可以重算；不要让它和 `results` 各说各话。

### 6.4 Panels + calibration

```ts
interface ModelDriverPanelProps {
  modelId: ModelId
  stateScope: string
  mountId?: string
  currentProfileId?: ModelProfileId
  surface: RendererMountSurfaceKind
  hostSurface: ModelDriverPanelHostSurface
  readiness: RendererMountReadinessState
  readOnly?: boolean
  services: ModelDriverHostServices
}
```

- `ModelDriverPanelDeclaration.hostSurfaces?: ModelDriverPanelHostSurface[]`（`settings`/`popover`/`inline`，省略 = settings only）；control strip 只列出声明了 `popover` 或 `inline` 的 panel。
- `readiness` 允许 `UNMOUNTED`；panel 在无 mount 时也能读 capability/vocabulary。
- `services.storage.watch(key, cb)` 让 settings 窗口的修改实时到达 actor。
- **control strip 的 picker 是 driver panel，不是 host 内置组件。** host 提供 popover 外壳、锚点、尺寸和关闭行为；driver 组件自己读取 vocabulary、写 storage 或发 cue。
- calibration 作为 driver 自己的 panel tab 注册（R11）；host 只渲染通用 panel 容器，不内置任何 renderer 专属校准 UI。
- 第一方 driver 可共享 `@proj-airi/stage-renderer-calibration-ui`，但注册和写路径归 driver；panel 禁止写全局 `stageModelSelected`。
- preview scope 用 `preview:<driverId>:<mountId>`，每个 preview mount 唯一。

### 6.5 Import / migration

```ts
interface ModelProbeInput {
  files?: File[]
  fileNames?: string[]
  url?: string
}

interface ModelImportPart {
  partIndex: number
  name: string
  meta: {
    format: string
    previewDataUrl?: string
    suggestedProfileName?: string
    sizeBytes?: number
  }
}

interface ModelProbeResult {
  parts: ModelImportPart[]
  confirmImport: (options: {
    selections: Array<{
      partIndex: number
      modelId: ModelId
      profileId?: ModelProfileId
    }>
    overwrite?: boolean
    resetProfiles?: boolean
    migration?: ModelImportMigration
  }) => Promise<ContractResult<ModelDescriptor[]>>
}
```

- `probe` 只读、不落盘；`parts` 单模型也 length 1。
- 模型文件、纹理和随模型交付的文件全部在 `files`，不区分 companion；单文件用 `files.length === 1`。AIRI 不处理非模型资产，那些走 driver 自己的通道。
- `modelId`/`profileId` 由 AIRI 在 confirm 前 mint；main 进程串行化 + reservation 保证唯一，driver 不得改写。
- 默认拒绝已存在 ID，返回 `MODEL_ID_CONFLICT`，**不带 details**；调用方用 attempted `modelId` 在 catalog 查现有模型。只有 `overwrite: true` 允许替换。
- `overwrite` 写入原子：临时 key → 指针切换 → 清旧资产；profiles/settings 默认保留。
- `probe` 取消不产生任何写入；`confirmImport` 失败不留下半写模型。
- 崩溃重试通过 migration marker（`pending`/`done` + `payloadHash`）判定，不靠“同 ID upsert”的隐式语义。

### 6.6 SDK exports / validation

```ts
// runtime validators, not just types
function assertDriverManifest(value: unknown): asserts value is ModelDriverManifest
function assertDriverCapabilities(value: unknown): asserts value is ModelDriverCapabilities
function assertRendererMountComponent(component: unknown): asserts value is RendererMountComponent
```

- `RendererMountComponent` 用 `DefineComponent` + `ComponentExposed`，并把 emits 泛型传入。
- 能力与成员用 mapped type/validator 绑定。
- package：本轮明确 first-party-only，保持 `private` + source-only；`dist`/`.d.ts`/`peerDependencies.vue`/`files` 推迟到第三方释出（R18）。

---

## 7. 验收矩阵

> 每个 Stage 至少跑对应行；Stage 1 的 stub 也要跑跨窗口列。

| 场景 | 覆盖问题 | 期望 |
| :--- | :--- | :--- |
| 同一窗口 load/cue/ack（in-process broker） | R4 | `results` 槽与 cue 索引对齐，FIFO 顺序正确 |
| actor + main 两窗口 load/cue/ack（eventa） | R1/R4 | 目标 mount 收到；调用方拿到 ack；无串 ack |
| mountId 重复 / 被别的窗口冒用 | R1 | `register` 拒绝；不产生 registry 行 |
| chat 冒充 actor 的 mountId 发 ack | R4 | main 按 `webContents.id` 拒绝 |
| actor 窗口关闭/崩溃 | R1/R4 | registry 清理；pending 以 `ABORTED` 结束 |
| actor + chat 同时挂载 | R1/R12 | 两个 mount 出现；共享同一个 `stateScope`；按 `mountId` 发时只有目标响应 |
| `target.stateScope` | R4 | 返回 `INVALID_ENVELOPE`，不部分投递 |
| control strip 打开 driver picker | R10 | 组件来自 driver；host 不内置 vocabulary；关闭后无残留 |
| driver 未声明 popover panel | R10 | host 显示 unavailable，不回退内置 picker |
| driver 已注册但未 mount 时 `saveProfile` | R14 | 成功；profile 内容来自 driver 最后状态 |
| TTS 播放 + actor 口型（Stage 1 标量） | R2 | actor 有口型；停止归零；帧流 ~30Hz 无 ack |
| 插件 analyzer register/unregister（Stage 4） | R2 | 结果帧生效；禁用后闭嘴；无 `AudioNode` 进 IPC |
| selfie | R3 | 只生成一条；cue 是空 payload；返回当前 canvas 的字节 |
| capture 与 expression 同包 | R3 | `INVALID_ENVELOPE`，不产生部分写入 |
| capture 与 expression 并发（不同包） | R3 | expression 不被 capture 阻塞 |
| prompt 发布 + main 读取 | R9 | main 立即可见；actor 关闭后清空 |
| settings 改 physics/render scale | R10 | actor 立即生效（storage watch） |
| calibration panel 切模型 | R11 | 只影响 preview mount；全局 `stageModelSelected` 不变 |
| 两个 preview 同时打开 | R11/R17 | scope 不同；draft 不串 |
| card editor picker（driver 未 mount） | R11 | 从 `modelCapabilities()` 显示或明确空状态 |
| 窗口最小化/锁屏 | R12 | actor 与 chat 都暂停渲染 |
| 多模型 zip 导入（取消一项） | R7 | 只导入选中项；ID 可寻址、可删除、有默认 profile |
| 重复 modelId 普通导入 | R6 | `MODEL_ID_CONFLICT`，现有数据不变；调用方用 attempted id 查现有模型 |
| 迁移中断/重启（overwrite + marker） | R6/R8 | `pending` 重放成功、`done` no-op、不复活 |
| 两个窗口并发导入 | R7 | mint 串行化，ID 不重复 |
| clean-profile restore | P1-9 | 旧备份可恢复；新 driver 不空 |
| 两个模型 + outfits + crash-retry | R14 | profileId 正确；selectedModelId 冻结 |
| preset 默认/onboarding/卡片 | P1-7 | 同一个 preset 身份；preview/authorIcon 可见；builtin 与 import 二选一 |
| custom motion/VRMA + selective sync | P1-8 | 可导入/备份/恢复/删除 |
| V-HACK / L-HACK | P1-11 | 能读/改/导出 raw bytes |
| head-tethered caption（四个格式） | R15 | 声明 `caption` 的 driver 实现；未声明的不发送；AIRI 无 `getHeadPose`；host layer 独立 |
| 第三方 manifest 缺成员/不兼容（future） | P1-13/P1-14 | 稳定后 loader 拒绝，错误可读；本 release 不承诺 |

---

## 8. 推进顺序（Stage 1–7）

### Stage 1：可用实现（先把链路跑通，不优化）

1. **eventa 合同**：在 [`apps/stage-tamagotchi/src/shared/eventa.ts`](../apps/stage-tamagotchi/src/shared/eventa.ts) 加 P0-4 的通道表（`mountRegister/Update/Unregister/List/Changed` 和 `cueSend/Deliver/Ack`）与 §6.1 的 registry 接口；speech 用 BroadcastChannel adapter 的 `stageRendererSpeechFrame`。`defineInvokeEventa<Response, Request>` 顺序不要写反。
2. **main broker**：内存 registry + 全局 nonce + per-mount FIFO + pending 表 + timeout + 窗口销毁清理；实现 `register/update/unregister/list/findBy` 和单目标 `send`。
3. **renderer 注册**：`RendererStage` 在 mount 前铸 UUID，mount/unmount 时 register/unregister；只接 actor + chat，preview 先不接；exposed 方法先不迁，只验证 cue capture/reset。
4. **口型**：复用主窗口现有 `mouthOpenSize`，30Hz 发布到 `airi::stage-renderer-speech`，actor/chat 接收；不做插件 analyzer。
5. **一个 stub mount**：用现有某一个 renderer（建议 Live2D，因为它是默认）做最小 adapter，验证“main 发 cue → actor 收 → ack 回 main”；**不开始 per-renderer 迁移**。

Stage 1 的“可用”定义：actor + chat 同时打开时 registry 能看到两个 mount，且它们共享同一个 `stateScope`；按 `mountId` 发 cue 只有目标应用，`stateScope` target 返回 `INVALID_ENVELOPE`；`state`/`prompt` 的权威副本在 main，actor 写入后 main 立即可读；TTS 播放时 actor 有口型；关掉 actor 后 registry 清空、pending 不挂起。

### Stage 2：契约收敛

- **Wave 0 已进 SDK：** `CueSendOptions.timeoutMs`、`INVALID_ENVELOPE`、`CaptureCue` 空 payload + 单包规则、`mountId` 全局唯一/wrapper 铸、`MODEL_ID_CONFLICT` 无 details、`ModelDriverRuntime.purge` + capability、`HostAnnotationFields.authorIcon`、`CueAck` 单 mount 文档、`OperationNonce` 全局注释。
- 剩下要改的：speech 的 BroadcastChannel 事件形状写进契约注释；`CueAck.requestId` 保持 optional 但注明 broker 路径必填（已写）。
- `ModelDriverPanelProps` / `hostSurfaces` / `HostStorageInterface.watch` 已在 0.2，核对即可。
- 删除 `HeadPose`/`getHeadPose`/`headPose`；`CaptionCue` 保持可选。

### Stage 3：迁移数据层

- 重复 ID 拒绝 + 显式 overwrite + migration marker（R6）。
- 多模型两阶段导入 + AIRI mint/reservation（R7）。
- outfits/profile 映射、presets/authorIcon、custom assets、legacy tombstone（R14/P1-7/P1-8/R8）；`saveProfile` 只依赖 driver 已注册，`MigrationInput` 定稿后再补字段。
- 非模型资产（motion/VRMA/preset）只走 driver 自己的导入通道，不进 AIRI catalog/备份枚举。
- `ModelDriverRuntime.purge()` 已加入 SDK（capability 为 `purge`），Stage 3 接 `deleteAllData`。
- 旧云备份 reader / clean-profile 恢复顺序（P1-9）。

### Stage 4：driver host + 插件 analyzer

- renderer-side loader：静态 manifest 校验、runtime 激活、mount/provider 生命周期；main 只做发现/启用。
- 插件 analyzer：`register/unregister`，在音频窗口加载模块，结果接 `SpeechAnalysisFrame`。
- external driver 不在本 release：只做第一方 static import。第三方 dist/loader/publish 推迟（R18）。

### Stage 5：CalibrationStudio 拆分 + control strip panel

- 每个 driver 提供 calibration panel；host 只渲染通用容器。
- control strip 的 expression/motion/wardrobe picker 改为 driver panel（`hostSurfaces` 含 `popover`/`inline`）；host 只保留 popover 外壳和锚点，删除内置 picker。
- 删除 `EmotionCalibrationStudio` 的全局 `stageModelSelected` 写入；card editor/curation 改走 `modelCapabilities()` + preview mount。

### Stage 6：Per-renderer

- Spine → MMD → Live2D → VRM；对应**迁移 Phase 2 → 5**。每个 phase 带自己的 legacy 删除 tombstone、消费者迁移和 §7 对应行。
- 每个 phase 结束都跑一遍跨窗口矩阵，不要只在最后跑。

### Stage 7：删除与打包

- 混合模式 e2e、旧备份恢复、reboot 测试都绿后再删 `DisplayModelFormat`/`DisplayModel`（迁移 Phase 6）。
- 第一方启用/传输/打包（迁移 Phase 7）；SDK build/types/peerDependencies 只有在第三方释出时才做（R18），本 release 不承诺。

**Stage 与迁移计划的映射：**

| 本文 Stage | 迁移计划 |
| :--- | :--- |
| 1 | 迁移 Phase 1（host scaffolding） |
| 2 | 迁移 Phase 1（contract 部分，可与 1 并行收尾） |
| 3 | 迁移 Phase 1 + 各 renderer phase 的数据部分 |
| 4 | 迁移 Phase 1 后段 + 迁移 Phase 7 的第一方启用 |
| 5 | 迁移 D7 的 panel 部分，跨迁移 Phase 2–5 |
| 6 | 迁移 Phase 2–5 |
| 7 | 迁移 Phase 6–7 |

**明确推迟的优化（不要放进 Stage 1）：** registry 持久化/重连、跨窗口健康检查、cue 优先级/背压、capture 并发池、analyzer PCM 跨窗口 fallback、多窗口同时 speech 的漂移校正。先把“能注册、能路由、能 ack、能闭嘴”做对。

**不建议**在 Stage 1–3 完成前开始 Spine 迁移（迁移 Phase 2）；Spine 的“最小表面”仍会踩到 mount routing、state scope、legacy deletion 和 panel context。

---

## 9. Reviewer 决策与剩余问题

### 9.1 已锁定决策（R1–R19）

| ID | 决策 | 落地位置 | 必须同时处理 |
| :--- | :--- | :--- | :--- |
| R1 | mount registry 由 **Electron main 进程**的实例作中心 broker；`mountId` 由 mount wrapper 铸 UUID，registry 全局查重，不生成也不改写 | `apps/stage-tamagotchi/src/main/services/stage-renderer/` | 窗口销毁清理；全局唯一；main 进程 ≠ main 窗口 |
| R2 | 口型同步移出 driver 契约，改为**插件级能力**；帧走 eventa BroadcastChannel，不经过 main broker | `HostSpeechAnalyzerService`（host-services.ts 独立导出）+ 主窗口音频服务 | analyzer 必须跑在持有 AudioContext 的窗口；不是 cue；无 `AudioNode` |
| R3 | `captureFrame` 成为 **空 payload cue**；renderer 返回当前 canvas 全部内容；capture 单独成包 | `CueKind.CAPTURE` + `CueAck.results` | 慢操作要 timeout；编码失败 `CAPTURE_FAILED`；混包 `INVALID_ENVELOPE` |
| R4 | IPC 统一使用 **`@moeru/eventa`**；broker 铸全局 nonce、per-mount FIFO；**只做单 mount ack** | `apps/stage-tamagotchi/src/shared/eventa.ts` | 泛型顺序 `<Response, Request>`；payload 可结构化克隆；`stateScope` target 暂不支持 |
| R5 | main 只做 manifest registry/enable；renderer 做 runtime 激活/mount | main manifest registry + renderer driver host | main 不 import runtime；不回答 capabilities |
| R6 | **拒绝**为已存在 ID 导入模型，除非显式 `overwrite`；迁移走 marker | `confirmImport` + `MODEL_ID_CONFLICT` | 冲突不带 details；调用方用 attempted id 查 catalog；原子替换 |
| R7 | 多模型包返回 `parts` 供 AIRI 选择；`confirmImport` 传 ID；AIRI 保证唯一 | `ModelProbeResult.parts` + `confirmImport(selections)` | ID mint 必须在 main/单一锁内完成，否则并发导入仍会冲突 |
| R8 | legacy 删除写 tombstone，并让 dump/restore/远端 sidecar 都尊重它 | sync-engine + 迁移数据层 | reboot 两次、clean-profile restore 都不能复活 |
| R9 | `state`/`prompt` 的权威副本放 main；actor 通过 eventa 写，main 广播 revision | main coordinator | renderer 是唯一生产者；prompt 在 mount 卸载时清空；不用 BroadcastChannel |
| R10 | control strip 的 picker 由 **driver 提供组件**，host 只给 popover 外壳 | `ModelDriverPanelDeclaration.hostSurfaces` + `ModelDriverPanelProps.hostSurface` | host 不内置 vocabulary picker；未声明就显示 unavailable |
| R11 | CalibrationStudio 分散进各 driver；preview scope 每 mount 唯一 | driver `panels` | 禁止写全局 `stageModelSelected`；`preview:<driverId>:<mountId>` |
| R12 | chat 与 actor **共享 `stateScope`**，不是 preview；cue 先按 `mountId` 逐个发，fan-out 暂缓 | `CueEnvelope.target.stateScope` + broker | 两个 mount 共享 snapshot/prompt；都接收 `stagePaused` |
| R13 | 模型导入统一用 `files`，不区分 companion；AIRI 只负责模型导入 | `ModelProbeInput` + driver panel | 非模型资产走 driver 自己的通道；front door 也走 probe/confirm |
| R14 | `saveProfile` 只要求 driver 已注册，不要求 mount；`MigrationInput` 形状待定 | `ModelProvider.saveProfile` + 迁移计划 | migration 未定稿前不加字段级映射；冻结 selectedModelId |
| R15 | head-tethered caption 渲染迁入 driver；`CaptionCue` 可选；host 兜底可选且非 head-tethered | 删除 `HeadPose`/`getHeadPose`/`headPose` | host 仍可加任意 layer，但不共享 driver 坐标 |
| R16 | namespace 隔离由 AIRI 实现，driver 不可知；bridge allowlist | `HostStorageInterface` 实现 + bridge | driver key 是相对 key，不出现前缀 |
| R17 | scope 有语义；除 preview 外均复用 scope | `persistence.ts` + broker | scope 不含 `modelId`；preview 独立且带 mountId |
| R18 | **本 release 只支持第一方**；第三方引用等完全稳定后再释出 | SDK 保持 `private` + source-only | 不承诺外部安装/dist；稳定后再拆 |
| R19 | **先 manifest 再 runtime**；main 的 registry 只持有 manifest 信息 | main manifest registry + renderer `ModelDriverHost` | main 不持有 runtime/能力探测结果 |

### 9.2 落地时必须保持的约束（不是可选优化）

1. **R6 × 迁移 D13**：迁移必须用 `overwrite: true` + `pending`/`done` marker；普通导入永远不传 `overwrite`。这个冲突已经在迁移 D13 解决，实现时不要退回“同 ID upsert”。
2. **R2 × Electron 架构**：`AudioContext` 在主窗口 renderer（`ControlStripHost`），不在 Electron main 进程；analyzer 必须在音频窗口加载。把 analyzer 放进 main 在技术上不可行（Node 没有 Web Audio/DOM）。
3. **R3 × `CueAck`**：capture 的结果已经能放进 `CueAck.results`（`CueResolved.value`）；cue 是空 payload，renderer 自己决定格式；因为 capture 独占一包，编码失败走 `CAPTURE_FAILED` 不会丢别的槽位。不要再退回“整包 `reason[]`”。
4. **R7 × 并发**：`modelId` 必须由 main 的 reservation/串行队列 mint；UI 各自 `crypto.randomUUID()` 再查重仍会竞态。
5. **R3 × FIFO**：capture 编码可达数百 ms；broker 只保证投递顺序，不等待完成，否则 selfie 会阻塞 expression/motion。
6. **R11 × 实现成本**：四个 renderer 各有一套校准 vocabulary，拆进 driver 意味着四份 UI；可以共享 `@proj-airi/stage-renderer-calibration-ui`，但注册与写路径必须留在 driver。
7. **R2 × 首版可用性**：插件 analyzer 依赖 renderer-side loader + 模块加载/CSP；Stage 1 先复用主窗口 `mouthOpenSize` 标量，Stage 4 再接 analyzer。
8. **R4 × 单 mount**：第一版 `target.stateScope` 返回 `INVALID_ENVELOPE`；fan-out 必须等聚合规则定稿，不能偷偷只投第一个 mount。
9. **R15 × host overlay**：host overlay 是可选的，但一旦实现就不能依赖 `HeadPose`，也不能声称是 driver caption。

### 9.3 仍未决（需要 reviewer 下一轮回答）

1. **custom motion/VRMA 的 selective sync**：保留 per-asset，还是改为 model 级？
2. **preset**：driver builtin（`builtin:` 命名空间）还是首次启动 import？两者都要保留稳定 presets 身份，但不能混用。
3. **旧云备份**：保留一个 release 的 legacy reader，还是要求用户先升级再备份？
4. **V-HACK/L-HACK**：driver dev panel，还是 debug-only `exportRaw`？
5. **P1-10 双 catalog**：混合期用联合 + feature flag，还是等所有 renderer 一次切换？

P2-2–P2-7 是低优先级契约/文档建议，不阻塞 Stage 1–3；按 §5 逐条决定即可。

已关闭：外部 driver（R18）；manifest/runtime 顺序与 main registry 范围（R19）；head-tethered caption（R15）；control strip picker（R10）；files-only 导入（R13）；saveProfile 无 mount（R14）；namespace 隔离（R16）；scope 语义（R17）；capture cue（R3）；口型 analyzer（R2）；重复 ID（R6）；多模型两阶段（R7）；tombstone（R8）；main 权威 state（R9）。

### 9.4 如果下一轮不回答，建议默认

- selective sync：先按 model 级备份（整包），per-asset 作为后续增强。
- preset：driver builtin + `builtin:` 命名空间，不做首次启动导入。
- 旧云备份：保留一个 release 的 legacy reader，恢复后写 tombstone，再删除旧数据。
- V-HACK/L-HACK：driver dev panel 优先，`exportRaw` 只在 dev build 提供。
- 双 catalog：联合 + 逐 driver feature flag，最后再删 legacy。

---

## 附录 A：消费者清单（新增/未覆盖）

| 文件/区域 | 当前行为 | 迁移归宿 | 状态 |
| :--- | :--- | :--- | :--- |
| [ControlStrip.vue](../packages/stage-ui/src/components/scenarios/layout/ControlStrip.vue#L949-L1035) | 读四个 store，写 card idle/motion | driver 提供的 popover/inline panel；host 只给外壳 | R10 已锁定 |
| [ModelCustomizer.vue](../packages/stage-ui/src/components/scenarios/settings/model-settings/ModelCustomizer.vue#L350-L449) | 读 store，触发 preview | driver panel | R11 已锁定 |
| [EmotionCalibrationStudio.vue](../packages/stage-ui/src/components/scenarios/acting/EmotionCalibrationStudio.vue#L213-L220) | 写全局 `stageModelSelected`，触发 store | driver calibration panel + preview mount | R11 已锁定 |
| [useExpressionCuration.ts](../packages/stage-ui/src/composables/use-expression-curation.ts#L281-L324) | 触发四个 renderer preview | preview mount + cues | R11 已锁定 |
| [ExpressionCurationModal.vue](../packages/stage-ui/src/components/scenarios/dialogs/ExpressionCurationModal.vue) | 调 curation preview | preview mount + cues | R11 已锁定 |
| [useActingCapabilities.ts](../packages/stage-pages/src/pages/settings/airi-card/composables/useActingCapabilities.ts#L100-L155) | 从 store/format 推导 picker | `modelCapabilities()`/driver panel | 未决 |
| [CardEditorForm.vue](../packages/stage-pages/src/pages/settings/airi-card/components/CardEditorForm.vue#L125-L167) | 复制格式分支 | 同上 | 未决 |
| [use-idle-animations.ts](../packages/stage-ui/src/composables/use-idle-animations.ts#L6-L41) | 读 format/capabilities/custom motions | driver idle selection | 未决 |
| [discord.ts](../packages/stage-ui/src/stores/modules/discord.ts#L1547-L1567) | format switch + store trigger + capture | ACT cue + `capture` cue | R3 已锁定 |
| [use-data-maintenance.ts](../packages/stage-ui/src/composables/use-data-maintenance.ts#L780-L787) | `live2dStore.resetState()` | driver purge/reset | P1-8 未决 |
| [model-selector.vue](../packages/stage-ui/src/components/scenarios/dialogs/model-selector/model-selector.vue#L472-L474) | format 检测 + 新 id | probe/confirmImport | R13 已锁定 |
| [step-finale.vue](../packages/stage-ui/src/components/scenarios/dialogs/onboarding/v3/steps/step-finale.vue#L51-L93) | `modelStore.triggerMotion` | preview mount + MotionCue | 未决 |
| [selective-sync-panel.vue](../packages/stage-ui/src/components/scenarios/providers/selective-sync-panel.vue#L378-L461) | 读 `mmdStore.customMotions` | driver asset API / model bundle | 未决 |
| [ViewControls/Inputs.vue](../packages/stage-layouts/src/components/Layouts/ViewControls/Inputs.vue#L238) | 按 `stageModelRenderer` 显示 Z | renderer transform/panel | 未决 |
| [runtime.ts](../packages/stage-ui/src/components/scenes/runtime.ts#L8-L10) | Live2D lip-sync loop 判断 | 插件级 speech frames | R2 已锁定 |
| [stage-three-transparency.ts](../apps/stage-tamagotchi/src/renderer/utils/stage-three-transparency.ts#L5-L15) | 仅 VRM 采样透明 | `occupiesPoint` per driver | 部分覆盖（迁移 §8.2） |
| [HackerPanel.vue](../packages/stage-ui/src/components/scenarios/settings/model-settings/vrm-vhack/HackerPanel.vue#L735-L737) | 从 URL 取 VRM bytes | driver dev panel/raw export | P1-11 未决 |
| [LHackerPanel.vue](../packages/stage-ui/src/components/scenarios/settings/model-settings/live2d-lhack/LHackerPanel.vue#L21-L24) | watch URL 取 zip | driver dev panel/raw export | P1-11 未决 |
| [chat.vue](../apps/stage-tamagotchi/src/renderer/pages/chat.vue#L1963-L1976) | 第二个 stage mount | 与 actor 共享 `stateScope` 的 live mount | R12 已锁定 |
| [HeadTetheredCanvas2D.vue](../packages/stage-ui/src/components/scenes/HeadTetheredCanvas2D.vue#L35-L107) | host 2D caption overlay | 声明 `caption` 的 driver 走 `CaptionCue`；host 删除 head pose 依赖 | R15 已锁定 |

## 附录 B：现有文档已覆盖、无需重复讨论的内容

- 迁移 §8.1 VRM/Live2D store singleton（本文 P0-1/P1-4 只补 mount/生命周期部分）。
- 迁移 §8.3 `hit-area-change` edge-triggered。
- 迁移 §8.4 `animation-finished` nonce registry（本文 P2-3 只补 index）。
- 迁移 §8.6 同窗口 lip-sync 设计（本文 P0-2 补跨窗口）。
- 迁移 §8.7 `captureFrame` 失败形状（本文 P0-3 补跨窗口/单包）。
- 迁移 §9.1 prompt/control strip/ModelCustomizer 的部分消费者（本文附录 A 补未列出的）。
- 迁移 §9.2 positioning copies。
- 迁移 §9.3 pose/breath channel。
- RFC 9.13 re-import：已 closed，本文 P0-6 只保留实现要求。
