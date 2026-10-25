# Stage Renderer SDK 迁移问题清单与解决方案

> **状态：审阅稿 + 已锁定决策 R1–R19（2026-10-21）。** Wave 0 契约已进 SDK 0.2：`INVALID_ENVELOPE`、`timeoutMs`、capture 空 payload、`mountId` 全局唯一、`MODEL_ID_CONFLICT` 无 details、`purge`、`authorIcon`（目标替换为 `ModelAuthor` 结构）、单 mount ack 与 nonce 注释。剩余 speech 传输注释与 broker/registry 运行时在 Stage 1–2。本文仍是设计/实现前 spec，没有修改应用运行时。
>
> **2026-10-25 修订：** 架构改为 main Registry/Manager + renderer Adapter/Runtime；取消 `stateScope`/snapshot；存储隔离上移到 driver；driver 自己提供 settings/modelPicker/panels 与每模型 prompt；ID 由 Adapter 创建。prompt 历史按 `modelId` 存 driver 侧，character card 只存当前模型；模型只有未导入 / driver builtin / 已导入三态，character card 导入与迁移必须同步导入模型并产生 `modelId` + `profileId`（card 允许无模型）；preset 按 builtin 处理且在 runtime 使用前必须先导入；V-HACK/L-HACK 进入 driver 实现；模型作者信息用完整 `ModelAuthor` 结构随模型保存。R9/R12/R17 取消，R5/R10/R11/R16/R19 改写，R7 由 Adapter 解决。详细决策已并入 §1–§9，§0.5 只留摘要。
>
> **编号约定（本版重写，用于消除旧版同名冲突）：**
>
> - 本文的决策是 **R1–R19**（Review decisions）。
> - **迁移 Dn** 指 [迁移计划](./design-stage-renderer-migration.md) §1 的 D1–D19。旧版本文也用 D1–D19 命名，与迁移计划大量重名但含义不同；本版已全部改为 R 编号，引用迁移计划时必须带“迁移”前缀。
> - **迁移 Phase n** 指迁移计划 “Order of work” 的 1–7（Phase 2 = Spine，Phase 3 = MMD，Phase 4 = Live2D，Phase 5 = VRM，Phase 6 = shared deletions，Phase 7 = first-party packaging）。本文自己的推进顺序叫 **Stage 1–7**，映射见 §8，不再使用裸 “Phase 6” 指代两件事。
> - 旧版 §9.2 的两条“必须修正的冲突”（R6 × 迁移 D13、R3 × `CueAck`）已经落地，本版把它们移入“已解决”，只保留结论。
>
> **2026-10-21 版修正的文档矛盾（历史）：** 决策编号冲突；Stage/Phase 编号冲突；“文档状态”列混用三种语义；已解决的冲突仍写成“必须修”；`nonce` 铸造归属；speech frame 方向；`mountId` 铸造与唯一性；scope fan-out 的多目标 ack；capture 的 FIFO 与失败语义；`includeBackground` 放在 cue 里；P1-1 残留 BroadcastChannel 备选；`writeSnapshot` 写入者；preview scope 例子；preset 的 driver-builtin ID；P1-12 兜底默认；`ContractFailure.details` 的 opaque 冲突；以及 contractVersion/文件数/RFC 9.13 状态等过期引用。
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
> 1. **契约隐含“单窗口宿主”假设，而现有 Electron 是 main + actor + chat/settings 多窗口。** 音频、capture、cue ack、readiness、prompt、driver panel 六条链路都要跨窗口，契约需要 broker/mount registry。
> 2. **driver 的进程位置与现有 plugin host 不匹配。** 现有 host 在 Electron main 里跑 Node，不能提供 Vue/DOM/AudioContext。
> 3. **迁移数据闭环不完整。** 重导入幂等、多模型 ID、outfits/card 数据/presets/custom assets/旧云备份/删除持久性都没有完整通道。
>
> **建议：** 按 §8 的 Stage 1 先做“可用实现”（eventa 合同 + main broker + `RendererStage` 注册 + 口型帧），跑通跨窗口矩阵后再进 Stage 2；**Spine 是迁移 Phase 2，不是本文 Stage 2**。

> **2026-10-25 追加：** 架构更新已并入正文，§0.5 只是摘要。与旧 R 决策冲突时，以正文的 2026-10-25 修订为准；R1–R4、R6、R8、R13、R15、R18 不变。

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
- 2026-10-25 架构修订只改本文；SDK 契约改动尚未应用，也没有重新跑 typecheck。

---

## 0.5 2026-10-25 修订摘要

> 详细决策已并入 §1–§9；与旧 R 决策冲突时，以正文的 2026-10-25 修订为准。本节只留摘要。

- 控制面在 main（Registry / Manager），数据面与 driver 代码在 renderer（Adapter / Provider / Runtime）。
- 启动/挂载顺序：AIRI 启动扫 manifest 注册 driver → 界面创建 Adapter、经 Adapter 向 Registry 表达 mount 意图并解析组件 → 组件挂载、收 props services 与 `LoadCue` 后渲染。
- 取消 `stateScope` 与 snapshot；prompt 由 driver 提供、每模型一份，历史按 `modelId` 存 driver 侧；AIRI 只把当前模型 prompt 写入 character card，chat 读取。
- 模型只有未导入 / driver builtin / 已导入三态；`pending-import` 只是导入事务中的瞬时态，必须在同一事务内收敛为未导入（丢弃）或已导入。
- character card 导入时同步导入其携带的模型（产生 `modelId` + `profileId`）；迁移时同步导入模型并产生 `modelId` + `profileId`；两者都需要用户确认，不能在 card/binding 中留下 AIRI-only 引用。character card 允许无模型，且这是正常状态。
- 存储隔离上移到 driver；每 mount 一个 handle；key/values/migration 归 driver。
- driver 自己提供 settings / modelPicker / panels；模型选择只 emit 已导入模型的 `{ modelId, profileId }`；profile 修改由 driver 自行实现；AIRI 负责绑定/替换/fallback。
- preset 按 driver builtin 处理：driver 可枚举/引用，AIRI 不可枚举/引用；builtin 必须先导入才能通过 runtime 预览或被 card 引用；迁移时同步导入并产生 `modelId` + `profileId`。模型作者信息用 `ModelAuthor` 结构随模型保存，不再只存 `authorIcon`。
- V-HACK / L-HACK 进入 VRM / Live2D driver 实现，host 不提供 raw model bytes 通道。
- ID 由 Adapter 创建并保证不冲突；Adapter 是 AIRI 实现细节。
- R1–R4、R6、R8、R13、R15、R18 保留；R5/R10/R11/R16/R19 改写；R9/R12/R17 取消；R7 由 Adapter 解决。
- 新增 P1-16：character 引用未知/未安装/已禁用 driver 时的 AIRI fallback。

---

## 1. 执行摘要

迁移计划的 per-renderer 顺序（Spine → MMD → Live2D → VRM，即迁移 Phase 2–5）是合理的，但它假设：

> 一个宿主进程持有 mount，并且这个宿主同时拥有 Vue、DOM、AudioContext、mount 引用、所有调用方。

现有 Electron 不满足这个假设：

- 主窗口 `ControlStripHost` 负责控制条和 TTS 播放，Electron 下**不渲染模型**（[ControlStripHost.vue](../packages/stage-ui/src/components/scenes/ControlStripHost.vue#L1955-L2018)）；
- 真正的舞台模型在独立 actor 窗口（[actor.vue](../apps/stage-tamagotchi/src/renderer/pages/actor.vue#L561-L582)）；
- chat / rehearsal / settings 又各自挂载 `RendererStage`（[chat.vue](../apps/stage-tamagotchi/src/renderer/pages/chat.vue#L1963-L1976)、[chat_rehearsal.vue](../apps/stage-tamagotchi/src/renderer/components/chat/chat_rehearsal.vue#L1329-L1342)）。

因此优先级是：

1. **先落地跨窗口 registry/broker（R1/R4）**：Electron main 持有 mount registry + cue broker；每窗口一个 Adapter 注册/收发；speech 作为插件级能力，capture 作为 cue。
2. **再定 driver 进程位置（R5/R19，2026-10-25 改写）**：main 有 driver Manager（生命周期/列表），renderer 的 Adapter 托管 provider/runtime；Manager 通过 Registry 拿 adapter 通道；IPC 走 `@moeru/eventa`。
3. **再定状态语义（R9/R16/R17，2026-10-25 改写）**：取消 `stateScope`/snapshot；prompt 由 driver 提供、每模型一份，历史按 `modelId` 存 driver 侧；AIRI 只把当前模型 prompt 存 character card；存储隔离上移到 driver，每 mount 一个 handle。
4. **再定选择/迁移语义（R6/R7/R8/R10）**：existing modelId 默认拒绝覆盖；多模型两阶段导入；driver 提供 `modelPicker`，AIRI 负责 binding/替换/fallback；preset 作为 driver builtin 必须先导入，迁移同步产生 `modelId` + `profileId`；删除写 tombstone。
5. 最后才是 per-renderer 的 cue/panel 迁移、CalibrationStudio 拆分和 SDK 打包。

“先形成可用实现，再优化”的具体含义见 §8：Stage 1 用现有的 host-computed 口型标量 + 内存 registry 跑通两窗口；插件 analyzer、持久化、重连和性能优化放到后续 Stage。

---

## 2. 清单总表

| ID | 级别 | 问题 | 决策 / 建议 | 决策 | 覆盖 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P0-1** | P0 | 缺少跨窗口 mount registry / host 拓扑 | main 作 registry/broker；Manager per driver；Adapter 每窗口一个；mount descriptor 去 `stateScope` | R1 保留 / R5 改写 | 已覆盖 |
| **P0-2** | P0 | 跨窗口口型同步（speech `AudioNode` 不能跨 realm） | 口型移出 driver 契约，改为插件级 analyzer；Stage 1 先用 host 标量 | R2 已锁定 | 部分覆盖 |
| **P0-3** | P0 | 跨窗口 `captureFrame` / selfie 不可达 | `capture` 成为空 payload cue；删除 exposed `captureFrame`；capture 单独成包 | R3 已锁定 | 部分覆盖 |
| **P0-4** | P0 | cue ack / FIFO / nonce / readiness 跨窗口未定义 | main broker 持全局 nonce + per-mount FIFO + pending 表；只做单 mount；target 只有 `mountId` | R4 已锁定 | 部分覆盖 |
| **P0-5** | P0 | 现有 plugin host 在 main，不能提供 Vue/DOM renderer | main 有 Manager（生命周期/列表）；界面创建 renderer Adapter，经 Adapter 向 Registry 表达 mount 意图并解析组件；Manager 经 Registry 取 adapter 通道 | R5/R19 改写 | 已覆盖 |
| **P0-6** | P0 | 重复 modelId 的拒绝/覆盖语义与迁移 marker（front door 见 P1-5） | 默认拒绝覆盖；仅显式 `overwrite` + migration marker 允许；普通导入走 `confirmImport` | R6 已锁定 | 已覆盖 |
| **P0-7** | P0 | 多模型包导入没有 ID 铸造回调 | 两阶段；`probe` 返回 `parts`，UI 选择后 `confirmImport` 带 Adapter-minted ID | R7 已锁定（Adapter） | 已覆盖 |
| **P0-8** | P0 | 删除 legacy key/blob 不持久，重启/云端会复活 | tombstone + dump/restore 剪枝 + 远端 sidecar 删除 | R8 已锁定 | 部分覆盖 |
| **P1-1** | P1 | snapshot / prompt 只写 actor 窗口，main 读不到 | 取消 snapshot；prompt 由 driver 提供、每模型一份，历史按 `modelId` 存 driver；AIRI 只把当前模型 prompt 写 character card，chat 读取 | R9 取消 | 已覆盖 |
| **P1-2** | P1 | driver panel 缺少 model/profile/mount 上下文；跨窗口实时设置失效 | panel props 用 model/profile/mount/services；settings 与 modelPicker 分离；storage watch | R10 改写 | 已覆盖 |
| **P1-3** | P1 | Card editor Acting tab / acting studio / AI curation 是未列出的消费者 | CalibrationStudio 拆进各 driver panel；preview 用独立 mount 且只接受已导入模型；禁止写全局 stage selection | R11 改写 | 已覆盖 |
| **P1-4** | P1 | chat 右侧舞台是第二个真实 mount；`stagePaused` 没传给 actor | chat 与 actor 是独立 mount；cue 按 `mountId` 逐个发；两者都接收 lifecycle pause | R12 取消 | 已覆盖 |
| **P1-5** | P1 | public front door 仍 mint 新 ID；统一导入入口未走 probe/confirmImport | `files` only 已落地；front door、card import、迁移都同步走 probe/confirmImport；ID 由 Adapter mint | R13 已锁定 | 部分覆盖 |
| **P1-6** | P1 | Outfit→profile 没有 AIRI-minted profileId；retry 用实时 selectedModelId | saveProfile 只要求 driver 已注册；选择事件带 profileId；替换模型/配置；冻结 selectedModelId | R14 已锁定 | 已覆盖 |
| **P1-7** | P1 | presets 必须先导入；作者信息丢失 | preset 是 driver builtin：driver 可枚举/引用，AIRI 不可；必须先导入产生 `modelId` + `profileId`，迁移同步导入；`ModelAuthor` 替代 `authorIcon` | 2026-10-25 已锁定 | 部分覆盖 |
| **P1-8** | P1 | custom motions/VRMA 无 import/list API；selective sync 无法枚举；clear data 无法 purge | 非模型资产走 driver 通道；增加 `ModelDriverRuntime.purge()`；selective sync 仍待定 | 未决（R13 部分） | 部分覆盖 |
| **P1-9** | P1 | 旧云备份/force restore 与新 driver storage 不兼容 | 保留一个 release 的 legacy backup reader；恢复顺序 + tombstone | 未决 | 未覆盖 |
| **P1-10** | P1 | 混合迁移期没有双模型存储 / 导入仲裁设计 | `LegacyModel \| DriverModel` 联合；逐 driver feature flag；UI 用 driverHint | 未决 | 未覆盖 |
| **P1-11** | P1 | V-HACK / L-HACK 需要 raw model bytes，与“host 不碰 renderer”冲突 | 进入 VRM / Live2D driver 实现：driver 自己持有 bytes、提供 panel 与导出，host 不提供 raw 通道 | 2026-10-25 已锁定 | 部分覆盖 |
| **P1-12** | P1 | 头挂字幕/宿主 overlay 与 CaptionCue 所有权矛盾 | `CaptionCue` 可选，声明 `caption` 的 driver 渲染；删除 `HeadPose`；host 可自行 overlay，但非 head-tethered | R15 已锁定 | 已覆盖 |
| **P1-13** | P1 | SDK `Component<Props, Exposed>` 用错泛型；emits 未进入类型；capability 与成员无校验 | `DefineComponent`/`ComponentExposed`；runtime validators；correlated union | 未决 | 未覆盖 |
| **P1-14** | P1 | SDK `private` + source-only，外部 driver 无法消费 | 本 release 只支持 first-party static import；第三方发布推迟 | R18 已锁定 | 已覆盖 |
| **P1-15** | P1 | 第三方 driver 的 bridge/storage 权限边界未定义 | driver 级存储隔离；bridge allowlist；无 scope/readSnapshot | R16 改写 | 已覆盖 |
| **P1-16** | P1 | character 引用未知/未安装/已禁用 driver 时无展示组件 | AIRI `UnavailableModelView` + 缓存 + DriverInfo 状态；启用/换模型/清除 | 2026-10-25 新增 | 未覆盖 |
| **P2-1** | P2 | scope 只有一个 modelId；切换模型/多 mount revision 冲突未定义 | 取消 scope；每个 mount 独立；切换模型走 character binding 替换 | R17 取消 | 已覆盖 |
| **P2-2** | P2 | `interactionMode` 仍存在 VRM key，host 通过 `useModelStore()` 写 | 移到 host store；mount prop 下发（迁移 D5 说“已是 prop”，代码不是） | 未决 | 部分覆盖 |
| **P2-3** | P2 | cue 细节缺口：ack 长度、invalid payload、animation-finished index、timeout | 增加校验/原因/索引/超时；capture 混包用 `INVALID_ENVELOPE` | 未决 | 部分覆盖 |
| **P2-4** | P2 | `ModelDescriptor.profiles` 与 `listProfiles` 双源 | `ModelSummary` 走 per-profile 轻量行；listProfiles 为 driver 内部权威；descriptor 只留摘要/去掉 profiles | 未决 | 未覆盖 |
| **P2-5** | P2 | preview data URL 体积/同步路径 | `ModelSummary.preview` 只允许轻量 URL/小 data URL；AIRI 缓存；不批量传 Blob | 未决 | 部分覆盖 |
| **P2-6** | P2 | contractVersion 兼容规则未定义 | 0.x 精确 minor；加 validator；1.0 后声明区间 | 未决 | 未覆盖 |
| **P2-7** | P2 | 文档漂移/不一致 | 统一 reset 表、迁移 D11 重试次数、R18 与“packaging”、引用锚点 | 未决 | 部分覆盖 |

---

## 3. P0：必须先决策

### P0-1 缺少跨窗口 mount registry / host 拓扑

**证据**

- 主窗口 Electron 下只渲染控制条，不渲染模型：`isElectron` 时 `ControlStripHost` 不挂 `RendererStage`，并把 `state` 直接标成 `mounted`（[ControlStripHost.vue](../packages/stage-ui/src/components/scenes/ControlStripHost.vue#L2003-L2018)、[同文件](../packages/stage-ui/src/components/scenes/ControlStripHost.vue#L1955-L1958)）。
- actor 窗口挂载真正的 `RendererStage`（[actor.vue](../apps/stage-tamagotchi/src/renderer/pages/actor.vue#L561-L582)）。
- chat / rehearsal / settings 各自挂载 `RendererStage`。
- 旧契约只定义了 `RendererMountProps.mountId` 和 `stateScope`（`stateScope` 已在 2026-10-25 删除），没有“谁持有所有 mount、如何查询/定位一个 mount”的接口。

**影响**

- `CueChannel.send` 的 `target.mountId` 无法从 main 窗口解析到 actor mount。
- `capture`、`stopAll`、`dispose` 等方法只对持有 mount 引用的窗口可用。
- readiness、character/model binding、prompt 归属都缺少中心。
- 多个 `stage` mount 时，“哪个是 live stage”是歧义；现在用 `surface` + `purpose` 区分，不再靠 scope。

**决策（R1 + 2026-10-25 拓扑，已锁定）**

main 继续做 mount registry + cue broker，但拓扑改为：

- **Registry（main）**：driver manifest、每个 driver 的 Manager、mount descriptor、cue broker。
- **Manager（driver，main）**：driver 生命周期与模型列表；通过 Registry 拿 adapter 通道。
- **Adapter（AIRI，renderer，每窗口一个）**：解析 driver 组件、创建 services、托管 mount/轻量 provider 实例；不拥有 Vue 树。
- **Runtime（driver，renderer，per mount）**：驱动 renderer；`values` 对 AIRI opaque。

```ts
interface RendererMountDescriptor {
  mountId: string
  modelDriverId: string
  modelId?: string
  characterId?: string
  profileId?: string
  surface: RendererMountSurfaceKind
  purpose: 'stage' | 'actor' | 'chat' | 'rehearsal' | 'preview'
  windowId: string
  readiness: RendererMountReadinessState
  updatedAt: number
}

/** mountId 由 mount wrapper 在 mount 前铸成 UUID；windowId 由 main 从 sender 填。没有 stateScope。 */
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

- 实现位置不变：main 的 registry/broker + renderer thin client；web/pocket 同进程实现。
- **mountId 仍由 wrapper 铸 UUID**，registry 查重；main 不生成、不改写。
- **不再有 `stateScope`**：actor/chat 各自独立 mount；需要同时控制时按 `mountId` 逐个发（见 P1-4）。
- **prompt/state 不经 registry**：prompt 由 driver 推给 adapter，AIRI 写入 character card（P1-1）；registry 只持有 mount 事实。
- 先实现 `register/update/unregister/list/onChanged` + 窗口销毁清理；FIFO/重连在 R4 broker 里做。
- chat 右侧舞台用 `surface` + `purpose` 区分，不能靠“第几个 stage”猜（见 P1-4）。
- `lifecycle.ts` 的 descriptor 删除 `stateScope`，加 `characterId`/`profileId?`/`purpose`；`RendererMountProps` 删除 `stateScope`、加 `characterId`/`purpose`；`RendererMountQuery` 删除 `stateScope`。

**需要注意的边界：** “main 进程”是 Electron 主进程（Node，无 DOM/AudioContext），不是主窗口 renderer。mount registry/cue broker 可以住主进程；**音频播放图和 analyzer 不能**（见 P0-2）。两者不要混为“main 侧”。

**验收**

- 同时打开 actor + chat + settings，三者 mount 都出现在 registry；`surface`/`purpose` 可区分。
- 每个 mount 的 `mountId` 在 `register` 时与 prop 完全一致；重复 UUID 被拒。
- 关闭 actor 窗口后对应 mount 被移除，发往它的 cue 返回 `no-model`/`renderer-not-ready`，不挂起。
- 同一 surface 两个 mount 的 cue 只命中 `target.mountId`。
- actor 刷新后旧 descriptor 不残留（按 `webContents.id` 清理）。
- 任何 descriptor 都不含 `stateScope`。

**覆盖：** 已覆盖（RFC 5.10）；SDK 的 descriptor 需按本节删除 `stateScope`。

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
- 旧版 scope fan-out 需要多个回答者；2026-10-25 已取消 scope，target 只支持 `mountId`，需要同时控制时由调用方逐个发。

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
- **target 只有 `mountId`：** `stateScope` 已从契约删除；任何 scope 字段都不再存在。需要同时控制 actor + chat 的调用方，逐个 `mountId` 发；不做隐式聚合。
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
- 不存在 `target.stateScope`；缺少 `target.mountId` 返回 `INVALID_ENVELOPE`，不隐式选 mount。
- 目标 mount 不在时，`dropIfNotReady: true` 立即返回 `renderer-not-ready`；默认在 `timeoutMs` 后返回，不挂起。
- actor 重启/崩溃后，旧 pending send 以 `ABORTED` 结束，registry 无残留。
- 从 chat 窗口伪造 actor 的 `mountId` 发 ack 会被 main 拒绝。
- 没有任何 ack 走 BroadcastChannel。

**覆盖：** 部分覆盖（RFC 5.10 有 broker/registry；单 mount ack 已写进 SDK 注释；scope 已取消）。

---

### P0-5 现有 plugin host 在 main，不能提供 Vue/DOM renderer

**证据**

- `setupPluginHost()` 在 Electron main 创建 `new PluginHost({ runtime: 'electron' })`（[plugins/index.ts](../apps/stage-tamagotchi/src/main/services/airi/plugins/index.ts#L163-L177)）。
- `ManifestV1` 只有 `apiVersion/kind/name/entrypoints`（[core.ts](../packages/plugin-sdk/src/plugin-host/core.ts#L428-L450)）。
- `FileSystemLoader` 在 main 里 `import(entrypoint)`（[core.ts](../packages/plugin-sdk/src/plugin-host/core.ts#L1042-L1122)）。
- 只支持 in-memory transport（[core.ts](../packages/plugin-sdk/src/plugin-host/core.ts#L542-L553)）。
- 契约要求 `resolveMountComponent()` / `panels` 返回 Vue component（旧 `renderer.ts`，已删除；[renderer-mount.ts](../packages/stage-renderer-sdk/src/contract/renderer-mount.ts#L320-L346)），以及 `requirements.webgl/dom/audioContext`（[manifest.ts](../packages/stage-renderer-sdk/src/contract/manifest.ts#L160-L185)）。
- `ModelDriverManifest` 与 `ManifestV1` 是两种 shape；`entry.runtime` 又在 manifest 里（[manifest.ts](../packages/stage-renderer-sdk/src/contract/manifest.ts#L187-L203)），host 要先读 manifest 才能加载 runtime，存在循环。
- `ModelDriverHostRegistry` 没有 activate/deactivate/status（[lifecycle.ts](../packages/stage-renderer-sdk/src/contract/lifecycle.ts#L167-L191)）。

**影响**

- 外部 driver 不能通过现有 host 激活/mount；本 release 也不承诺支持。
- 迁移计划 Phase 7 “driver 可以活在 monorepo 外” 没有 artifact；SDK 还是 `private` + source-only（见 P1-14），第三方引用推迟到稳定后。
- main 里的 plugin host 无法检查 `requirements` 的真实可用性，也无法提供 Vue/AudioContext；它只能读 manifest hint。

**决策（R5 + R19 + 2026-10-25 修订，已锁定）**

- 进程分层：**main 有 manifest registry + 每个 driver 的 Manager（driver 的 main 侧代码）；renderer 有 Adapter（通用宿主）和 provider/runtime（driver 代码）。** main 不 import runtime，也不回答 capabilities。
- **先有 manifest，再有 Manager/runtime。** 静态 driver manifest 是独立的第一阶段输入；main 读它、建立 Manager；provider/runtime 的加载和 `activate()` 只在 renderer 发生。
- **Manager 不是 runtime。** 它持有 driver 生命周期和模型列表；通过 Registry 拿到 adapter 通道，再和 adapter 里的 provider/runtime 实例通信。Manager 不直接读 OPFS/IndexedDB。
- **Adapter 是通用宿主，不是 driver 专属。** 每个窗口一个，由该窗口第一个需要渲染模型的界面创建，不是 main 预建；创建者已经知道 `driverId` 和 mount 的 `purpose`（chat/actor/rehearsal/preview 等），并把它们作为每次 mount 意图的参数交给 Adapter。Adapter 解析 mount/settings/modelPicker/panels 组件、创建 services、托管 mount 或轻量 provider 实例，并把 Registry 通道提供给 AIRI renderer；它不拥有 Vue 树，也不决定可见性。
- **挂载顺序（2026-10-25 锁定）：**
  1. AIRI 启动时扫描 driver manifest，在 Registry 注册 driver（状态、enable/disable、Manager 索引）。
  2. 用户或 AIRI 打开一个需要渲染模型的界面；界面创建该窗口的 Adapter，并通过 Adapter 向 Registry 表达创建 mount 的意图（`driverId`、`purpose`、wrapper 铸的 `mountId`），从 manifest entry 解析相应组件，然后挂载组件。
  3. 组件被挂载后，通过 props 收到 services，接受 `LoadCue`，启动渲染；Adapter 负责把该 mount 的注册/ready/ack 通道接到 Registry。
- Registry 与 Adapter 之间的发现/启用/状态走 `@moeru/eventa`；Manager 只拿按 adapter 限定的通道，不自己写 IPC。
- **本 release 只支持第一方**：第一方 driver 走静态 import / workspace package；第三方引用等契约与运行时完全稳定后再释出。

**建议方案**

- 明确分层：
  - **main manifest registry + Manager**：发现静态 manifest、持久化 enable/disable、创建 driver Manager；Manager 负责生命周期与模型列表。main **不**持有 `ModelDriverRuntime`，也不缓存 `rendererCapabilities()`。
  - **renderer Adapter**：按窗口一个，由该窗口第一个需要渲染的界面创建；先读 manifest，再动态 import 组件/provider，创建 services，托管 mount/轻量 provider；Adapter 的 DriverContext 实例只存在于这个窗口。界面通过 Adapter 表达 mount 意图，而不是自己 import driver 组件。
- 定义**静态 driver manifest 文件**（JSON/`driver.manifest.json`）：`id`、`contractVersion`、`entrypoints`（`manager`/`provider`/`mount`/`settings?`/`modelPicker?`/`panels?`）、`requirements`、`capabilities` hint。它和 runtime 的 `manifest` 分开，且必须先于 runtime 读取。
- renderer loader 用 Vite `import.meta.glob` / import map / 预打包 registry；共享 Vue/Three/Pixi（externals 或 peerDependencies），避免两份 Vue。
- **provider 属于 driver**：每个 mount 或一个只读写状态的轻量实例持有自己的 provider；怎么创建、怎么和 Manager 通信，是 driver 内部实现。Adapter 只提供 services 和宿主。
- **`activate`/`deactivate`/`getStatus` 在 renderer 的 Adapter/DriverContext**，不在 main；main 的 Manager 通过 adapter 通道触发。
- **本 release 明确只做 first-party**：保留 static imports，SDK 保持 `private` + source-only；第三方 dist/publish/loader 不作为本 release 承诺，等稳定后再拆。

**验收**

- 一个 stub driver 在 renderer 先读 manifest、再激活、mount、收到 cue、通过 `capture` cue 返回字节；main 只负责 manifest registry、Manager 生命周期和 adapter 通道。
- 启动后 Registry 先有 driver 记录；界面创建 Adapter 并发出 mount 意图后才出现 mount；组件先收到 services props，再由 `LoadCue` 启动渲染。未注册 driver 或未创建 Adapter 时不能直接 mount。
- main 不出现 runtime、`rendererCapabilities()` 结果或 window 专属 state；Manager 只通过 adapter 通道访问 renderer。
- 禁用 driver 后，mount 被卸载，pending cue 以 `renderer-unavailable`/`aborted` 结束。
- 旧版 manifest 被拒绝并给出可读错误；contractVersion 不兼容不会被激活。

**覆盖：** 已覆盖（RFC 5.2 + 迁移 D18/D19）；2026-10-25 拓扑与挂载时序修订见本节。

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
- 冲突错误必须可判别，但**不需要 payload**：`ContractFailureCode.MODEL_ID_CONFLICT`，`details` 保持 opaque。调用方知道自己发出的 `modelId`，用它在 AIRI 模型摘要/记录里查现有模型即可；多选时逐个查，不依赖 driver 回传 `existingName`。
- `overwrite` 的语义是“替换模型 payload，保留 profiles/settings，除非同时 `resetProfiles: true`”；写入必须原子：先写新 payload 到临时 key，再切换指针，最后清旧资产；中途崩溃不能留下半替换状态。
- 迁移专用：调用前写 marker（`modelId` + `driverId` + `payloadHash` + `legacySourceId`，状态 `pending`）；`confirmImport({ overwrite: true, migration })` 成功且资产落盘后改为 `done`，再删 legacy blob；`done` 时重试 no-op，`pending` 时用同一 `payloadHash` 重放。
- **普通导入与迁移重放是两条明确路径**：迁移走 marker + overwrite，普通导入只走 conflict。
- 普通导入 UI（drop/file picker、card package）必须走 `confirmImport` 且在 confirm 前由 Adapter mint id；这一条与 P1-5 是同一处实现，不在本 finding 重复展开。

**验收**

- 普通导入一个与现有 `modelId` 相同的文件：返回 `MODEL_ID_CONFLICT`，现有模型、profiles、设置不变；UI 用 attempted `modelId` 在模型摘要/记录里找到现有模型并让用户选择改名/取消。
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

- 拆分出来的第 2..N 个模型没有 Adapter-minted id；driver 不能发明 id，host 也没有回调分配。
- 这些模型无法被卡片引用、无法删除/预览/加 profile。
- 迁移对多模型 legacy zip 会丢失子模型的可寻址性。

**决策（R7，已锁定：两阶段 + Adapter mint）**

改成**两阶段**：driver 只负责“包里有哪几个模型”，Adapter 负责“每个模型用什么 ID”。ID 由 **Adapter** 创建并保证不出现冲突；Adapter 是 AIRI 实现细节，driver 只接收传入的 ID、不得改写。

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
      /** Adapter mint 后传入；driver 不得改写 */
      modelId: ModelId
      /** 可选；不传则由 Adapter mint 默认 profile */
      profileId?: ModelProfileId
    }>
    overwrite?: boolean
    migration?: ModelImportMigration
  }) => Promise<ContractResult<ModelDescriptor[]>>
}
```

- `probe` 返回 `Array<{ name, meta }>` 的语义，实际类型用 `parts: ModelImportPart[]`，每项至少含 `name` + `meta`。
- UI 展示这些 part，让用户勾选/改名；确认时 Adapter 为每个选中项生成 `modelId`（以及可选 `profileId`），再一次性调用 `confirmImport`。
- **Adapter 保证唯一性**：ID 由 Adapter 使用 UUID 创建，并在 driver 存储锁内查重；Adapter 是 AIRI 实现细节，driver 不需要知道冲突解决过程。
- `confirmImport` 必须校验：`partIndex` 在范围内且不重复、每个 `modelId` 由 AIRI 提供、`modelId` 不与现有冲突（除非 `overwrite`）、返回的 descriptor 的 `modelId` 必须与传入一致（driver 改写即报错）。
- 取消选择时 `probe` 不写任何资产；只有 `confirmImport` 成功才落盘。
- 迁移多模型 legacy zip 走同一路径：probe 出 parts，Adapter mint 稳定 ID 并写 migration marker；重试时复用 marker 里的映射，不重新 mint。

**验收**

- 一个包含 3 个 Live2D 模型的 zip：UI 显示 3 项，取消 1 项后只导入 2 项；两个 modelId 都可寻址、可删除、可预览、有默认 profile。
- 两个窗口同时导入：Adapter 保证 ID 不重复；后写入者遇到冲突时得到明确错误。
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

### P1-1 prompt 由 driver 提供、每模型一份；AIRI 只把当前模型写入 character card

**决策（R9 取消，2026-10-25 修订）**

- **不再有 `state`/snapshot。** `HostStateTransferPort`、`ModelScopedState`、`HostServices.state`、`writeSnapshot/readSnapshot` 全部删除。
- prompt 由 **driver 提供，每个模型一份**；driver 以 `modelId` 为 key 保存该模型的历史 prompt，由 driver 自己管理。
- 模型切换或 prompt 更新时，driver 把**当前模型**的 prompt 推给 AIRI。
- AIRI 只把当前模型的 prompt 存入 **character card** 的 `modelPrompt`（先按纯字符串），不保存历史；chat 从 card 读取。
- 模型切换时 AIRI 清掉 card 里旧模型的 prompt，等待新 driver 推送；切回旧模型时 driver 从自己的存储按 `modelId` 重推。
- mount 卸载不清 prompt；prompt 更新不要求 mount 存在（driver 已注册即可推送）。

**证据**

- 旧契约的 `state.writeSnapshot` / `prompt.publish` 只允许 mounted instance 调用（[persistence.ts](../packages/stage-renderer-sdk/src/contract/persistence.ts#L119-L151)、[host-services.ts](../packages/stage-renderer-sdk/src/contract/host-services.ts#L337-L357)）；2026-10-25 已决定删除 `persistence.ts` 的 state 部分。
- actor mount 在 actor 窗口；chat/prompt 在 main 窗口（[ControlStripHost.vue](../packages/stage-ui/src/components/scenes/ControlStripHost.vue#L1955-L1958)）。
- 现有 `createExpressionsContext` 从 renderer store 读（[expressions.ts](../packages/stage-ui/src/stores/chat/context-providers/expressions.ts#L14-L51)）。

**方案（本版收口）**

- Adapter 提供 prompt channel；driver 推送当前模型的 `{ modelDriverId, modelId, prompt, updatedAt }`（prompt 先按字符串；历史由 driver 按 `modelId` 保存，不进 payload）。
- AIRI 收到后只把**当前模型**的 prompt 写入当前 character card 的 `modelPrompt` 字段；chat 只读 card，不读 driver 历史。
- 模型切换：persist binding → dispose old mount → 清 card 的旧 `modelPrompt` → mount new；新 driver 推送后写入。切回旧模型时由 driver 按 `modelId` 重推。
- prompt 更新：driver 直接推，AIRI 覆盖 card；不需要 mount 参与。
- 如果新 driver 没有推送，card 没有 prompt；fallback/chat 显示明确的空状态，不回退到旧模型 prompt。

**验收：** 切换模型后 card 里是新模型的 prompt；driver 更新 prompt 后 card 立即更新；切回旧模型时 driver 按 `modelId` 重推该模型历史 prompt；card 不包含其他模型的 prompt；mount 卸载后 prompt 保留；不存在 snapshot/activeKeys/revision；旧模型 prompt 不会残留到新模型。

**覆盖：** 已覆盖（RFC 5.6 + 迁移 D10 的 prompt 部分；state/snapshot 部分取消，历史 prompt 归 driver）。

---

### P1-2 driver panel 缺少 model/profile/mount 上下文；settings/modelPicker 分离

**证据**

- 旧 `ModelDriverPanelProps` 带 `stateScope`/`mountId?`/`currentProfileId?`/`hostSurface`；`stateScope` 已按 2026-10-25 修订删除（[components.ts](../packages/stage-renderer-sdk/src/contract/components.ts)）。
- panel 没有 storage change 订阅；`HostStorageInterface.watch` 已加入（[host-services.ts](../packages/stage-renderer-sdk/src/contract/host-services.ts#L46-L59)）。
- control strip 的 expression/motion/wardrobe picker 是 host 组件（[ControlStrip.vue](../packages/stage-ui/src/components/scenarios/layout/ControlStrip.vue#L949-L1035)），panel 契约是 settings tab 形态（title/tabs/scrolling），没有 popover/anchor。
- settings/customizer 窗口与 actor mount 是不同进程。

**决策（R10 + 2026-10-25 修订）**

- **control strip 的 expression/motion/wardrobe picker 由 driver 提供 panel 组件**；host 只提供 popover 外壳、锚点、尺寸和关闭行为。
- `ModelDriverPanelProps` 改为：`modelId`、`profileId?`、`mountId?`、`surface`、`hostSurface`、`readiness`、`readOnly?`、`services`；**没有 `stateScope`**。
- `ModelDriverPanelDeclaration.hostSurfaces?: ModelDriverPanelHostSurface[]`（`'settings' | 'popover' | 'inline'`，省略 = settings only）；control strip 只列出声明了 `popover`/`inline` 的 panel。
- **settings 与 modelPicker 分离**：settings 组件只负责 driver 内部设置，挂载即用；模型选择是独立的 `modelPicker` 组件（见 P1-6 与 §6.7）。panel 不再承担“选模型”。
- panel 不写 AIRI state/snapshot（已取消）；写操作走 driver 自己的 storage 或 cue。`HostStorageInterface.watch(key, cb)` 让 panel 改设置后 live mount 能收到。
- 未声明 `popover`/`inline` 的 driver：host 显示明确的 unavailable，**不回退到内置 picker**。

**验收：** 在 settings 窗口改 physics/render scale，actor live mount 立即生效；control strip 的 expression/wardrobe picker 由 driver panel 渲染，不依赖 `useModelStore`/`useLive2d`；模型选择由 driver 的 modelPicker 渲染并只 emit 已导入模型的 `{ modelId, profileId }`；driver 不提供 popover panel 时 host 显示 unavailable。

**覆盖：** 已覆盖（迁移 D7 + components.ts）；`stateScope` 部分取消。

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
- 预览使用 settings 窗口里的**独立 preview mount**，`purpose: 'preview'`；每个 preview 用 `mountId` 区分，不再有 `preview:<...>` scope key，也不与其他 preview 共享 draft。
- **runtime preview 只接受已导入模型。** 内置模型必须先导入并产生 `modelId` + `profileId`，才能用 `LoadCue` 在 preview mount 上加载；preview 仍走普通 `LoadCue`，profile 修改由 driver 自行实现。
- `EmotionCalibrationStudio` 现有的“先切模型再校准”拆成两步：host 打开 driver 的 `modelPicker` + driver 的 calibration panel；切模型只影响 preview mount。
- Card editor 的 Acting tab / `useActingCapabilities` 仍由 host 渲染，但数据源改为 `ModelProvider.modelCapabilities()` 或 driver 的 vocabulary projection，不再 import 四个 renderer store。
- `useExpressionCuration` / `ExpressionCurationModal` 走 preview mount + cue，不再写 `displayModelsStore.expressionCapabilities`。
- 四个第一方 driver 可以共享一个 `@proj-airi/stage-renderer-calibration-ui` 组件库来避免四份重复实现，但**入口和 panel 注册归 driver**，host 不知道校准细节。

**验收**

- 在 calibration panel 里切模型/改参数，actor 舞台的模型与 `stageModelSelected` 都不变（没有 live snapshot）。
- builtin 未导入时不能通过 runtime preview；导入后 `LoadCue` 正常加载，只有这一条路径。
- card editor 的 picker 在 driver 未 mount 时仍能从 `modelCapabilities()` 显示（或显示明确的空状态），不依赖 renderer store。
- 同时打开 settings 与 card editor 的 preview，两个 preview 的 `mountId` 不同，draft 不串。
- 关闭 settings 窗口后 preview mount 注销，registry 无残留。
- 每个提供 calibration 的 driver 在 settings 里可见；不提供的 driver 不显示空 tab。

**覆盖：** 已覆盖（迁移 D7）；preview 只接受已导入模型。

---

### P1-4 chat 右侧舞台是第二个真实 mount；`stagePaused` 没传给 actor（2026-10-25：不共享 scope）

**证据**

- chat 窗口挂 `RendererStage`（[chat.vue](../apps/stage-tamagotchi/src/renderer/pages/chat.vue#L1963-L1976)），actor 窗口也挂（[actor.vue](../apps/stage-tamagotchi/src/renderer/pages/actor.vue#L561-L568)）。
- 主窗口 `stagePaused` 传给非渲染的 `ControlStripHost`（[index.vue](../apps/stage-tamagotchi/src/renderer/pages/index.vue#L948-L959)），actor 只传 `!stageEnabled || !showModelLayer`，不读 `stagePaused`（[stage-window-lifecycle.ts](../apps/stage-tamagotchi/src/renderer/stores/stage-window-lifecycle.ts#L42)）。
- 迁移计划 §8.1 只列 “live stage + settings preview”，没有 chat mount。

**决策（R12 取消，2026-10-25 修订）**

- chat 右侧舞台和 actor 是**两个独立 live mount**，不是 `preview`；没有共享 `stateScope`，没有共享 snapshot/prompt。
- `target.mountId` 是唯一 cue 路由；需要同时控制 actor + chat 的调用方，逐个 `mountId` 发，不做隐式 fan-out。
- 每个 mount 独立维护自己的 runtime 状态；prompt 是每模型一份、存 character card，与 mount 无关。
- lifecycle `stagePaused` 由 AIRI host 分别传给 actor 与 chat 的 mount；窗口隐藏/最小化/锁屏时两个 mount 都暂停渲染。这个不需要 cue 路由。

**验收：** actor + chat 同时打开时，两者各自 mount、各自 `mountId`；按 `mountId` 发 cue 只命中目标；没有 `stateScope` 字段；窗口最小化后两个 mount 都停止渲染循环；prompt 来自 character card，不由 mount 合并。

**覆盖：** 已覆盖（mount registry + 迁移 D12）；共享 scope 部分取消。

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
- **AIRI 的统一导入只处理模型。** motion、VRMA、纹理替换等非模型资产不走 `probe`/`confirmImport`，由 driver 自己的 panel/通道导入和管理；AIRI 不为它们发 id、不建 catalog、不做备份枚举。preset 是 builtin 模型，也必须先通过导入变成 imported（P1-7）。
- 两个模型导入 UI 都改为 `probe` → `confirmImport`；新导入的 id 由 Adapter 在 confirm 前 mint；legacy id 只用于迁移 marker/overwrite，不作为新 `modelId`。
- **character card 导入同步导入模型：** 解析 card 的模型引用 → 用户确认待导入模型 → 对每个模型 `probe`/`confirmImport`，产生 `modelId` + `profileId` → 再提交 card。模型导入失败/被拒绝时 card 以无模型形式正常导入；禁止先写 card/binding、后异步补模型。
- **迁移同步导入模型：** 迁移事务内对模型执行同样的确认 + `probe`/`confirmImport`，同步产生 `modelId` + `profileId`，由迁移 marker 覆盖；拒绝/失败按丢弃处理，不留下 `pending-import`。

**验收：** MMD 带纹理导入后纹理可用（作为同一 `files` 集合的一部分）；card package 导入后卡片指向新 model id；card 允许无模型导入，且不进入 fallback；旧 front door 也走 `probe` → `confirmImport`，不再自行 mint；迁移 marker 保留 legacy source id，新 `modelId`/`profileId` 同步产生；自定义 motion 只能从 driver panel 进入；preset 不作为 AIRI 导入项直接出现，必须先导入；card/迁移结束后不存在 AIRI-only 模型引用。

**覆盖：** 部分覆盖（provider.ts + 迁移 D13）；card import/迁移的同步导入入口未改。

---

### P1-6 Outfit→profile 没有稳定 profileId；retry 用实时 selectedModelId

**证据**

- `ModelDriverMigrationInput` 只有 `entries` + `selectedModelId`（旧 `renderer.ts`，已删除）。
- `HostModelProfileRecord.profileId` 必须由 Adapter mint（[references.ts](../packages/stage-renderer-sdk/src/contract/references.ts#L76-L84)、[model.ts](../packages/stage-renderer-sdk/src/contract/model.ts#L16-L23)）。
- `saveProfile` 已改为不要求 mount，只要求 driver 已注册（[provider.ts](../packages/stage-renderer-sdk/src/contract/provider.ts#L125-L137)）。
- 迁移 D15 的全局 Live2D emotion map 应用到 `selectedModelId`，该值来自实时 `settings/stage/model`（[stage-model.ts](../packages/stage-ui/src/stores/settings/stage-model.ts#L25)）。

**决策（R14 + 2026-10-25 选择修订）**

- `ModelProvider.saveProfile` 不再以“必须有 live mount”为前提：driver 已 `activate` 就能保存它当前持有的 profile 状态；provider 在 renderer，Manager 经 adapter 通道转发。
- **选择事件带 `profileId`**：driver 的 `modelPicker` 可以把同一模型的不同 profile 单独列出，emit 已导入模型的 `{ modelId, profileId }`；AIRI 存 `CharacterModelBinding`。
- **profile 修改由 driver 自行实现**：AIRI 不提供通用 profile 编辑器；driver panel/picker 负责 profile 的增删改，AIRI 只 mint `profileId`、存 binding/record。
- character 已有 model/profile 时走替换：persist new binding → dispose old mount → 清 card 的旧 `modelPrompt` → mount new；失败进入 fallback，不回滚。
- `ModelDriverMigrationInput` 的结构**暂不锁定**。本轮不加入 `models.profileMappings` 之类的形状；`entries`/`selectedModelId` 只是当前过渡形态。
- 可以确定的部分：Adapter mint `profileId`；host 在迁移开始时冻结 `selectedModelId` 并写 marker，重试不读实时 key；driver 报告未使用的 outfit。

**验收：** driver 已注册但未 mount 时 `saveProfile` 成功；`HostModelProfileRecord` 与 driver profile 一一对应；选择事件带 `profileId`；已有 binding 时走替换；profile 增删改由 driver 自己完成，AIRI 不提供通用编辑器；迁移输入未定稿前不实现字段级映射。

**覆盖：** 已覆盖（provider.ts + 迁移 D12）；选择/profile 部分为 2026-10-25 新增。

---

### P1-7 presets 必须先导入；作者信息只有 authorIcon

**证据**

- 四个 preset 是 URL 模型，`previewImage`/`authorIcon` 是 `new URL(...).href`（[display-models.ts](../packages/stage-ui/src/stores/display-models.ts#L112-L117)）。
- `ModelPreview.dataUrl` 要求 data URL（[shared.ts](../packages/stage-renderer-sdk/src/contract/shared.ts#L208-L214)）。
- 迁移 D14 现在明确：legacy preview 只有“已经是 data URL”时才复制，asset URL/path 必须 fetch 或跳过并告警。
- preset 是默认模型/onboarding/卡片默认（[stage-model.ts](../packages/stage-ui/src/stores/settings/stage-model.ts#L25)、[character-defaults.ts](../packages/stage-ui/src/constants/prompts/character-defaults.ts#L190-L238)）。
- `authorIcon` 在 `DisplayModel`（[display-models.ts](../packages/stage-ui/src/stores/display-models.ts#L46-L99)），`CharacterAvatar` 依赖它（[CharacterAvatar.vue](../packages/stage-ui/src/components/misc/CharacterAvatar.vue#L49-L63)）；AIRI record 只有单个 `authorIcon` 预留位，没有作者名/链接结构。

**影响**

- preset 是 URL 模型，无法按“复制 data URL”迁移；清空数据/onboarding/卡片默认会失配。
- `authorIcon` 丢失会让 `CharacterAvatar` 退化；只有图标也缺少作者名/链接，无法在无 driver 时正确署名。

**决策（2026-10-25 修订：builtin 必须先导入；迁移同步导入）**

- preset 是 **driver builtin**：driver 可以枚举/引用，AIRI 不可枚举/不可引用；不进入 AIRI catalog、不参与 `MODEL_ID_CONFLICT`、不能被 AIRI 直接绑定。
- **强制先导入**：builtin 不能通过 runtime 预览，也不能被 card/default/onboarding 直接引用；必须先经过 `probe` → `confirmImport` 变成 `imported`，产生 AIRI `modelId` + `profileId`。
- 导入后的 preset 就是普通 imported 模型；builtin 本身仍留在 driver 内部，不能作为 AIRI 的引用目标。
- 迁移：旧 `DisplayModel` 的 preset 引用在迁移事务内同步导入，产生 `modelId` + `profileId`；需要用户确认；不再创建“builtin profile”，也不把 builtin key 写进 AIRI。
- 未确认/失败/取消：按 §6.8 丢弃为 `unimported`，不留下 AIRI-only binding；不能先写 card 再异步补模型。
- builtin 的 `preview`/`author` 由 driver 随列表返回，供 driver 自己的导入 UI 显示；AIRI 不持久化 builtin 条目。
- **作者信息：** 用完整 `ModelAuthor`（`name`、`icon?`、`url?`）由 driver 随模型保存（`ModelDescriptor.author`），AIRI record/summary 缓存副本供离线显示，替代单一 `authorIcon`；迁移把旧 `authorIcon` 归一化到 `author.icon`（URL 先 fetch 成 data URL，失败则告警跳过）。
- preview 归一化保留：URL preview 先 fetch → data URL，或把 `ModelPreview` 扩展为 `{ dataUrl } | { url, cachedDataUrl? }`。
- 不要让迁移 Phase 6 删除 `DisplayModel` 时被 preset 卡住。

**验收：** 未导入的 builtin 不出现在 AIRI 模型列表、不能被 card 绑定、不能 runtime preview；导入后产生 `modelId` + `profileId` 并正常预览；迁移同步导入且只产生 imported 模型；重复迁移按 marker 不重复 `modelId`/`profileId`；builtin 不能被普通导入覆盖/删除；author 离线可见；迁移 Phase 6 后没有 `DisplayModelFormat` 依赖。

**覆盖：** 部分覆盖（builtin 导入、迁移同步和 `ModelAuthor` 还需 SDK + 迁移计划落地）。

---

### P1-8 custom motions/VRMA 无 API；selective sync 无法枚举；clear data 无法 purge

**证据**

- MMD `customMotions` 在 localforage（[mmd.ts](../packages/stage-ui-mmd/src/stores/mmd.ts#L104-L147)），VRM custom VRMA 也在 localforage（[sync-engine.ts](../packages/stage-ui/src/stores/sync-engine.ts#L1666-L1764)）。
- `selective-sync-panel.vue` 直接读 `mmdStore.customMotions`（[selective-sync-panel.vue](../packages/stage-ui/src/components/scenarios/providers/selective-sync-panel.vue#L378-L461)）。
- `ModelProvider` 只有模型/portal 操作，没有 asset 操作（[provider.ts](../packages/stage-renderer-sdk/src/contract/provider.ts#L28-L153)）。
- `deleteAllData` 只 reset Live2D store；driver storage 没有 purge API（[use-data-maintenance.ts](../packages/stage-ui/src/composables/use-data-maintenance.ts#L780-L787)）。
- `forceRestoreFromRemote` 直接 `localforage.clear()`（[sync-engine.ts](../packages/stage-ui/src/stores/sync-engine.ts#L3349-L3350)）。

**决策（R13 的一部分 + 未决）：非模型资产走 driver 自己的通道，不进 `ModelProvider`。**

- custom motion/VRMA/纹理的导入、枚举、删除都由 driver panel/bridge 提供；preset 是 builtin，必须先导入才进 AIRI（P1-7）。AIRI 不为它们 mint id、不建 catalog、不做 per-asset 备份枚举。
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
- 恢复顺序：先 host records/preview，再 driver bundles/model bytes；或反过来但要保证引用可解析。模型必须在恢复事务内 `probe`/`confirmImport`，产生 `modelId`/`profileId`；不能先写 host record/binding 再异步补模型。
- 不清空 `driver-migration/*` marker；或把 marker 存在不会被 restore 覆盖的命名空间。
- 对旧 custom VRMA/MMD motion 通过 driver 自己的 legacy asset 通道移交，不由 AIRI catalog 导入。
- 验收：旧备份恢复到 clean profile 后，模型/设置/自定义动作都在。

**覆盖：** 未覆盖（迁移计划 Phase 1 只提“backup visibility”，没有 legacy reader）。

---

### P1-10 混合迁移期没有双模型存储 / 导入仲裁

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
- card import/迁移在提交前完成模型导入，不允许只写 legacy `DisplayModel` 或 AIRI-only 引用、等待后续补模型；混合期只读旧数据，不新增 legacy 记录。
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

**决策（2026-10-25 已锁定：进入 driver 实现）**

- V-HACK 属于 VRM driver，L-HACK 属于 Live2D driver；面板、二进制读取、材质/纹理修改、zip 读取和导出都在 driver 包内实现。
- driver 从自己的 provider/runtime 拿 raw bytes，不再依赖 `stageModelSelectedUrl`；需要 live 实例时由 driver panel 通过 Adapter 创建该 driver 的 preview mount，host 只负责挂载 panel。
- host 不增加 `ModelProvider.exportRaw`/`getBinary`，也不保留 debug-only raw 通道；跨 driver 的 raw bytes API 会破坏封装，不进入契约。
- 迁移时把 `vrm-vhack` / `live2d-lhack` 组件和 `vhack.ts` 状态迁入对应 driver；host 删除这些面板与 URL 取字节路径。

**验收：** V-HACK 在 VRM driver 内读取/修改/导出 VRM；LHACK 在 Live2D driver 内读 zip buffer；host 没有 raw bytes 成员；不再依赖 `stageModelSelectedUrl`。

**覆盖：** 部分覆盖（决策已锁定；迁移 D17 只保留 driver-id 判断，数据路径和 panel 归属需补）。

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
- 旧 `state.readSnapshot(scope)` 已随 2026-10-25 的 snapshot 取消而删除，不再有跨 scope 读取。

**决策（R16 + 2026-10-25 修订）**

- **隔离粒度是 driver，不是 scope。** `HostStorageInterface` 的实现强制 driver namespace：driver 传入的 key 是相对 key，host 在读写时加上 driver 前缀；`keys()` 只返回该 driver 的 key。
- 同一 driver 的 mount/settings/panel/轻量实例共享命名空间；key 怎么划分、`values` 什么格式、怎么迁移，都是 driver 内部实现。
- `bridge` 改成 host 侧 allowlist（channel + payload schema），driver 只看到被授予的通道。
- 不再有 `readSnapshot`/scope；panel 直接通过 storage/service 读取 driver 自己的数据。
- 第三方 driver 的 manifest 声明 permissions；loader 展示给用户。其他权限边界按建议方案执行。

**验收：** 恶意/错误的 driver 不能读别的 driver storage 或任意 IPC channel；driver 代码里不出现 host 的 namespace 前缀；不存在 `stateScope`/`readSnapshot` 路径。

**覆盖：** 已覆盖（迁移 D16 + host-services 注释）；scope 部分取消。

---

### P1-16 导入的 character 引用未知/未安装/已禁用 driver 时没有展示组件

**问题**

- character card 可能引用 `modelDriverId`/`modelId`，但 Registry 没有对应 Manager，driver 提供的 settings/modelPicker 无法加载。
- 没有 fallback 时 stage 空白、设置页打不开、模型选择无法进入。

**决策（2026-10-25）**

- AIRI 提供 `UnavailableModelView`（stage-ui），不属于 driver SDK。
- 数据：`CharacterModelBinding` + AIRI 缓存 + `DriverInfo` 状态。
- 状态：`driver-unknown` / `driver-disabled` / `driver-error` / `model-missing` / `runtime-error`。
- 动作：启用 driver、安装 driver（如果有安装源）、选择其他模型、清除绑定。
- stage 非 ok 时用占位头像/缓存预览，不空白；点击进入 character 设置里的 fallback。
- **card import 阶段 driver 未知/禁用不能进入 `pending-import`**：card 以无模型形式导入（正常状态），或先安装/启用 driver 后重试；不允许把 AIRI-only 引用写进 card。
- 导入卡片只有 `displayModelId` 时，用 `findAcrossDrivers(modelId)` 反查；唯一匹配补全 driver，多个让用户选，找不到走 `driver-unknown`。
- 恢复：fallback → 选择其他模型 → AIRI driver 选择器 → 该 driver 的 `modelPicker` → 选择 → 替换。

**验收：** 导入引用缺失 driver 的卡片不崩溃、不空白；无模型 card 正常保存；显示缓存或 ID + 状态；能通过换模型恢复；driver 禁用/卸载后已有 character 进入 fallback，重新启用后恢复；card import 遇到缺失 driver 时不会写出 AIRI-only binding。

**覆盖：** 未覆盖（2026-10-25 新增）。

---

## 5. P2：整理与一致性

### P2-1 切换模型与多 mount 状态（2026-10-25：取消 scope）

**决策（R17 取消，2026-10-25 修订）**

- **没有 `stateScope`。** 每个 mount 独立；runtime 只写自己的 driver storage，AIRI 不合并 mount 状态。
- **切换模型 = character binding 替换**：持久化新 binding → dispose 旧 mount → 清 card 的旧 `modelPrompt` → mount 新。失败不回滚，进入 fallback。
- 同一 character 不允许并存不同 model；只换 profile 也先按完整替换实现，后续再评估 runtime 内切换。
- 多 mount（actor/chat）不共享 snapshot/revision；prompt 是每模型一份的 card 字段，不是 mount 合并点。
- `surface` 只是 descriptor 标签，不是 key，也不能用来反推唯一 mount。

### P2-2 `interactionMode` 仍存在 VRM key

`interactionMode` 是 `settings/stage-ui-three/interaction-mode`（[model-store.ts](../packages/stage-ui-three/src/stores/model-store.ts#L310)），control strip 通过 `useModelStore()` 写（[use-control-strip-action.ts](../packages/stage-ui/src/composables/use-control-strip-action.ts#L40-L97)）。**迁移 D5** 说它“已经是 host prop”，但代码不是。建议移到 host store（`settings/control-strip` 或新 mount settings），通过 `RendererMountProps.interactionMode` 下发。

### P2-3 cue 细节

- `CueAck.results` 的“长度等于 `cues.length`”已经写进契约注释，但缺 runtime 校验；`handled` 也可能被错误构造。建议 host 校验 `results.length === cues.length` 并重算 `handled`。
- `animation-finished` 只带 nonce；一个 envelope 里多个 motion 无法区分（[renderer-mount.ts](../packages/stage-renderer-sdk/src/contract/renderer-mount.ts#L190-L210)）。建议带 cue index。
- `CueRejected` 没有 invalid-payload；无效 payload 目前只能落到 `unsupported-cue` 或整包错误。建议增加一个明确的 reason。
- `CueSendOptions.timeoutMs` 已加入 SDK；`dropIfNotReady` 默认仍等待，由调用方显式设 deadline。
- 含 `capture` 且 `cues.length > 1` 的 envelope 用 `ContractFailureCode.INVALID_ENVELOPE` 拒绝（R3）。

### P2-4 `ModelDescriptor.profiles` 与 `listProfiles` 双源

旧 `ModelDescriptor.profiles` required（[provider.ts](../packages/stage-renderer-sdk/src/contract/provider.ts#L328-L356)），`listProfiles` 又是独立方法（[provider.ts](../packages/stage-renderer-sdk/src/contract/provider.ts#L103-L123)）。两者可能不一致。2026-10-25 后 AIRI 的选择/缓存走 `ModelSummary`（per-profile 轻量行），不再依赖 `ModelDescriptor.profiles`；建议 `listProfiles` 为 driver 内部权威，descriptor 只留摘要或去掉 `profiles`。

### P2-5 preview data URL 体积/同步路径

`ModelPreview.dataUrl` 是持久化 data URL（[shared.ts](../packages/stage-renderer-sdk/src/contract/shared.ts#L208-L214)）。`provider.list` 若给每个模型都带 preview，列表会很大；现有 sync-engine 会把 `data:` preview 移到 sidecar（[sync-engine.ts](../packages/stage-ui/src/stores/sync-engine.ts#L943-L956)）。2026-10-25 的 `ModelSummary.preview` 只允许轻量 URL/小 data URL；AIRI 缓存也是可选，不批量传 Blob。

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
  characterId?: string
  profileId?: string
  surface: RendererMountSurfaceKind
  purpose: 'stage' | 'actor' | 'chat' | 'rehearsal' | 'preview'
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
- **ack：** 只做单 mount；`mountId` + `requestId` 在 broker 路径必填，一个请求一个回答者。`target` 只有 `mountId`；没有 scope fan-out。
- **prompt：** 不走 registry；driver 推给 adapter，AIRI 写入 character card（P1-1）。
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
  profileId?: ModelProfileId
  mountId?: string
  surface: RendererMountSurfaceKind
  hostSurface: ModelDriverPanelHostSurface
  readiness: RendererMountReadinessState
  readOnly?: boolean
  services: PanelServices
}
```

- `ModelDriverPanelDeclaration.hostSurfaces?: ModelDriverPanelHostSurface[]`（`settings`/`popover`/`inline`，省略 = settings only）；control strip 只列出声明了 `popover` 或 `inline` 的 panel。
- `readiness` 允许 `UNMOUNTED`；panel 在无 mount 时也能读 capability/vocabulary。
- `services.storage.watch(key, cb)` 让 settings 窗口的修改实时到达 actor；storage 是 driver 级命名空间，panel 和 mount 共用。
- **control strip 的 expression/motion/wardrobe picker 是 driver panel，不是 host 内置组件。** host 提供 popover 外壳、锚点、尺寸和关闭行为；driver 组件自己读取 vocabulary、写 storage 或发 cue。
- **模型选择不是 panel。** 独立 `modelPicker` 组件负责；host 只嵌它并接收已导入模型的 `{ modelId, profileId }`。
- calibration 作为 driver 自己的 panel tab 注册（R11）；host 只渲染通用 panel 容器，不内置任何 renderer 专属校准 UI。
- 第一方 driver 可共享 `@proj-airi/stage-renderer-calibration-ui`，但注册和写路径归 driver；panel 禁止写全局 `stageModelSelected`。
- preview 用独立 preview mount（`purpose: 'preview'`），每个 preview 以 `mountId` 区分；没有 scope key。

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
- `modelId`/`profileId` 由 Adapter 在 confirm 前 mint；Adapter 保证唯一性（UUID + driver 存储锁查重），driver 不得改写。
- 默认拒绝已存在 ID，返回 `MODEL_ID_CONFLICT`，**不带 details**；调用方用 attempted `modelId` 在 driver 模型存储/AIRI summary 里查现有模型。只有 `overwrite: true` 允许替换。
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

### 6.7 Model selection / list / fallback（2026-10-25）

```ts
interface ModelPickerProps {
  characterId?: CharacterId
  currentModelId?: ModelId
  currentProfileId?: ModelProfileId
  services: DriverServices
}

interface ModelSelection {
  modelId: ModelId
  profileId: ModelProfileId
}

interface ModelPrompt {
  modelDriverId: ModelDriverId
  modelId: ModelId
  prompt: string
  updatedAt: number
}

/** 随模型保存的作者信息；替代单一 `authorIcon`。 */
interface ModelAuthor {
  name: string
  /** 与 `ModelPreview` 同形；离线时随模型记录一起显示。 */
  icon?: ModelPreview
  /** 作者主页/来源链接。 */
  url?: string
}

interface ModelSummary {
  modelDriverId: ModelDriverId
  modelId: ModelId
  profileId: ModelProfileId
  name: string
  profileName?: string
  preview?: string
  author?: ModelAuthor
  byteSize?: number
  importedAt?: number
}

interface CharacterModelBinding {
  modelDriverId: ModelDriverId
  modelId: ModelId
  profileId: ModelProfileId
  boundAt: number
}

type DriverStatus = 'enabled' | 'disabled' | 'not-installed' | 'error'

interface DriverInfo {
  driverId: ModelDriverId
  name: string
  version?: string
  status: DriverStatus
  hasManager: boolean
}
```

- `modelPicker` 是独立 entry；driver 自己列模型/profile、渲染、导入；host 只挂载并接收已导入模型的 `{ modelId, profileId }`。
- `prompt` 由 driver 推 `ModelPrompt`；driver 按 `modelId` 保存历史，AIRI 只把当前模型写入 character card 的 `modelPrompt`，chat 读取；切换/更新时覆盖。
- `ModelSummary` 是 Manager→Registry 的轻量列表；AIRI 缓存用于 character card/库存/导入反查/fallback，不作为 picker 数据源；`author` 随 summary 一起缓存。
- preset 是 driver builtin：driver 可枚举/引用，AIRI 不可；必须先导入产生 `modelId` + `profileId`，之后走 imported 路径；迁移同步导入。
- 选择即替换：persist binding → dispose old mount → 清 card 的旧 `modelPrompt` → mount new；失败进入 fallback，不回滚。
- fallback 是 AIRI 组件：binding + AIRI cache + driver status；状态 `driver-unknown`/`driver-disabled`/`driver-error`/`model-missing`/`runtime-error`。

### 6.8 模型三态与导入时机（2026-10-25）

```ts
type ModelState
  = | 'unimported' // AIRI/driver 都不可枚举、不可引用
    | 'builtin' // driver 可枚举/引用；AIRI 不可
    | 'imported' // 双方可枚举/引用
    | 'pending-import' // 瞬时：AIRI 可枚举/引用，driver 不可；必须收敛
```

| 状态 | AIRI 枚举 | AIRI 引用 | driver 枚举 | driver 引用 | 持久化 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `unimported` | 否 | 否 | 否 | 否 | 稳定 |
| `builtin` | 否 | 否 | 是 | 是 | 稳定（driver） |
| `imported` | 是 | 是 | 是 | 是 | 稳定（双方） |
| `pending-import` | 是 | 是 | 否 | 否 | 不落盘；仅导入事务内瞬时 |

- `pending-import` 只来自 character card 导入或迁移输入；它只存在于确认/导入事务中，不允许写进 card、binding、catalog 或 AIRI 持久化记录。
- **character card 允许无模型，且这是正常状态**：card 不要求必须有 binding，也不因缺少模型进入 fallback；fallback 只用于“曾经有 binding、但 driver/模型现在不可用”的情况。
- 用户确认且导入成功 → `imported`：同一事务内产生 `modelId` + `profileId`，card/binding 只引用这两个值。
- 用户拒绝、取消或导入失败 → `unimported`：丢弃该引用；card 仍以无模型形式正常导入，不写 binding，catalog 不写记录，不留下 AIRI-only 引用。
- character card 导入：先解析 card 里的模型引用，展示待导入模型并让用户确认；对每个模型走 `probe` → `confirmImport`，产生 `modelId` + `profileId` 后再提交 card。模型导入失败/被拒绝不阻塞 card 本身，card 以无模型保存。禁止先写 card、后异步补模型。
- 迁移：每个迁移模型同样在迁移事务内确认并导入，产生 `modelId` + `profileId`；迁移 marker 覆盖模型导入；未确认/失败的模型按丢弃处理，不留下 pending。
- builtin 只能由 driver 枚举/引用；AIRI 不列出、不绑定、不 runtime preview。driver picker 可以列出 builtin，但选择时必须先导入，完成后只向 AIRI 发 imported 的 `modelId`/`profileId`；此后走普通 imported 模型路径。
- Manager→Registry 的模型列表只收 `imported`；driver `list()` 里没有 AIRI `modelId` 的行（builtin）不进入 AIRI summary/catalog。
- 不存在第四种持久状态；driver 卸载/禁用导致的“AIRI 有记录、driver 暂时不可枚举”仍属于 `imported` 的 availability 问题，由 P1-16 fallback 处理，不改模型状态。

---

## 7. 验收矩阵

> 每个 Stage 至少跑对应行；Stage 1 的 stub 也要跑跨窗口列。

| 场景 | 覆盖问题 | 期望 |
| :--- | :--- | :--- |
| 启动后打开 chat 界面 | P0-5 | manifest 已注册；界面创建 Adapter；mount 意图后组件挂载；props services + `LoadCue` 后渲染 |
| 同一窗口 load/cue/ack（in-process broker） | R4 | `results` 槽与 cue 索引对齐，FIFO 顺序正确 |
| actor + main 两窗口 load/cue/ack（eventa） | R1/R4 | 目标 mount 收到；调用方拿到 ack；无串 ack |
| mountId 重复 / 被别的窗口冒用 | R1 | `register` 拒绝；不产生 registry 行 |
| chat 冒充 actor 的 mountId 发 ack | R4 | main 按 `webContents.id` 拒绝 |
| actor 窗口关闭/崩溃 | R1/R4 | registry 清理；pending 以 `ABORTED` 结束 |
| actor + chat 同时挂载 | R1 | 两个独立 mount 出现；没有 `stateScope`；按 `mountId` 发时只有目标响应 |
| `target` 缺少 `mountId` | R4 | 返回 `INVALID_ENVELOPE`，不隐式选 mount |
| control strip 打开 driver picker | R10 | 组件来自 driver；host 不内置 vocabulary；关闭后无残留 |
| driver 未声明 popover panel | R10 | host 显示 unavailable，不回退内置 picker |
| driver 已注册但未 mount 时 `saveProfile` | R14 | 成功；profile 内容来自 driver 最后状态 |
| TTS 播放 + actor 口型（Stage 1 标量） | R2 | actor 有口型；停止归零；帧流 ~30Hz 无 ack |
| 插件 analyzer register/unregister（Stage 4） | R2 | 结果帧生效；禁用后闭嘴；无 `AudioNode` 进 IPC |
| selfie | R3 | 只生成一条；cue 是空 payload；返回当前 canvas 的字节 |
| capture 与 expression 同包 | R3 | `INVALID_ENVELOPE`，不产生部分写入 |
| capture 与 expression 并发（不同包） | R3 | expression 不被 capture 阻塞 |
| prompt 推送 + card 写入 | R9（取消） | driver 推送当前模型后 character card 立即更新；切回旧模型 driver 重推历史；card 不含其他模型 prompt；mount 卸载不清空 |
| settings 改 physics/render scale | R10 | actor 立即生效（storage watch） |
| calibration panel 切模型 | R11 | 只影响 preview mount；全局 `stageModelSelected` 不变 |
| 两个 preview 同时打开 | R11 | `mountId` 不同；draft 不串 |
| card editor picker（driver 未 mount） | R11 | 从 `modelCapabilities()` 显示或明确空状态 |
| 窗口最小化/锁屏 | R12 | actor 与 chat 都暂停渲染 |
| 多模型 zip 导入（取消一项） | R7 | 只导入选中项；ID 可寻址、可删除、有默认 profile |
| 重复 modelId 普通导入 | R6 | `MODEL_ID_CONFLICT`，现有数据不变；调用方用 attempted id 查现有模型 |
| character card 导入携带模型 | P1-5/§6.8 | 同步确认并导入，产生 `modelId` + `profileId`；拒绝/失败则不写 binding，card 以无模型正常导入 |
| builtin 未导入时 runtime preview | P1-7 | 不允许；先导入成 imported，再用 `LoadCue` 加载 |
| 迁移模型 | P1-5/§6.8 | 迁移事务内同步产生 `modelId` + `profileId`；不留下 `pending-import` |
| 迁移中断/重启（overwrite + marker） | R6/R8 | `pending` 重放成功、`done` no-op、不复活 |
| 两个窗口并发导入 | R7 | Adapter 保证 ID 不重复 |
| 已导入 character 的 driver 后来缺失/禁用 | P1-16 | AIRI fallback 显示缓存/ID 与状态，不崩溃、不空白；card import 阶段则不得写 binding |
| clean-profile restore | P1-9 | 旧备份可恢复；新 driver 不空 |
| 两个模型 + outfits + crash-retry | R14 | profileId 正确；selectedModelId 冻结 |
| preset 默认/onboarding/卡片 | P1-7 | builtin 未导入不可见/不可绑定；导入后产生 `modelId` + `profileId`；迁移同步导入；preview/author 离线可见 |
| 模型作者信息 | P1-7 | `ModelAuthor` 随模型保存；旧 `authorIcon` 归一到 `author.icon`；无 driver 时仍可显示 |
| custom motion/VRMA + selective sync | P1-8 | 可导入/备份/恢复/删除 |
| V-HACK / L-HACK | P1-11 | 在 VRM/Live2D driver 内读/改/导出 raw bytes；host 无 raw 通道；不依赖 `stageModelSelectedUrl` |
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

Stage 1 的“可用”定义：actor + chat 同时打开时 registry 能看到两个独立 mount；按 `mountId` 发 cue 只有目标应用；没有 `stateScope`；prompt 由 driver 推送并写入 character card，chat 可读；TTS 播放时 actor 有口型；关掉 actor 后 registry 清空、pending 不挂起。

### Stage 2：契约收敛

- **Wave 0 已进 SDK：** `CueSendOptions.timeoutMs`、`INVALID_ENVELOPE`、`CaptureCue` 空 payload + 单包规则、`mountId` 全局唯一/wrapper 铸、`MODEL_ID_CONFLICT` 无 details、`ModelDriverRuntime.purge` + capability、`HostAnnotationFields.authorIcon`（目标替换为 `ModelAuthor`）、`CueAck` 单 mount 文档、`OperationNonce` 全局注释。
- 剩下要改的：speech 的 BroadcastChannel 事件形状写进契约注释；`CueAck.requestId` 保持 optional 但注明 broker 路径必填（已写）。
- **2026-10-25 契约收敛：** 删除 `stateScope`/`persistence.ts`/`HostStateTransferPort`/`HostServices.state`；`RendererMountDescriptor` 去 `stateScope`，加 `characterId`/`profileId?`/`purpose`；prompt 改为 driver 推、历史归 driver、AIRI 只写当前模型到 character card；`ModelAuthor` 替换 `authorIcon`；`ModelDriverPanelProps` 去 `stateScope`，settings/modelPicker 分离。
- `ModelDriverPanelProps` / `hostSurfaces` / `HostStorageInterface.watch` 已在 0.2，但 panel props 需按上面再改一次。
- 删除 `HeadPose`/`getHeadPose`/`headPose`；`CaptionCue` 保持可选。

### Stage 3：迁移数据层

- 重复 ID 拒绝 + 显式 overwrite + migration marker（R6）。
- 多模型两阶段导入 + ID mint（R7：Adapter 创建 ID 并保证不冲突）。
- outfits/profile 映射、preset builtin 导入与迁移同步产生 `modelId`/`profileId`、`ModelAuthor`/旧 `authorIcon` 归一化、custom assets、legacy tombstone（R14/P1-7/P1-8/R8）；`saveProfile` 只依赖 driver 已注册，`MigrationInput` 定稿后再补字段。
- character card import 与迁移在同一事务内完成模型导入：先确认，再 `probe`/`confirmImport`，产生 `modelId` + `profileId`，最后提交 card；`pending-import` 不落盘。
- preset 是 builtin，必须先走 `probe`/`confirmImport` 变成 imported 才能被 AIRI 引用；imported 后才进 AIRI 模型摘要/备份枚举。motion/VRMA/纹理等非模型资产仍只走 driver 自己的导入通道。
- `ModelDriverRuntime.purge()` 已加入 SDK（capability 为 `purge`），Stage 3 接 `deleteAllData`。
- 旧云备份 reader / clean-profile 恢复顺序（P1-9）。

### Stage 4：Adapter-hosted provider + 插件 analyzer

- **没有单独的 driver host。** Adapter 是 renderer 端通用宿主：静态 manifest 校验、组件/provider 加载、mount/轻量 provider 生命周期；Manager 在 main 负责生命周期/模型列表。
- Manager 通过 Registry 拿 adapter 通道；provider 属于 driver，随 mount 或轻量 state 实例创建。
- 插件 analyzer：`register/unregister`，在音频窗口加载模块，结果接 `SpeechAnalysisFrame`。
- external driver 不在本 release：只做第一方 static import。第三方 dist/loader/publish 推迟（R18）。

### Stage 5：CalibrationStudio 拆分 + control strip panel

- 每个 driver 提供 calibration panel；host 只渲染通用容器。preview 只加载已导入模型，仍走 `LoadCue`。
- control strip 的 expression/motion/wardrobe picker 改为 driver panel（`hostSurfaces` 含 `popover`/`inline`）；host 只保留 popover 外壳和锚点，删除内置 picker。
- **settings 与 modelPicker 分离**：settings 只挂载；模型选择由独立 `modelPicker` 组件提供，只 emit 已导入模型的 `{ modelId, profileId }`。
- 删除 `EmotionCalibrationStudio` 的全局 `stageModelSelected` 写入；card editor/curation 改走 `modelCapabilities()` + preview mount。

### Stage 6：Per-renderer

- Spine → MMD → Live2D → VRM；对应**迁移 Phase 2 → 5**。每个 phase 带自己的 legacy 删除 tombstone、消费者迁移和 §7 对应行。
- Live2D/VRM phase 同时把 L-HACK/V-HACK panel、`vhack.ts` 和 raw bytes 路径迁入对应 driver；host 删除这些面板与 `stageModelSelectedUrl` 取字节路径。
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

### 9.1 决策状态（R1–R19 + 2026-10-25 修订）

| ID | 决策 | 2026-10-25 状态 | 落地位置 / 必须同时处理 |
| :--- | :--- | :--- | :--- |
| R1 | mount registry 由 **Electron main 进程**的实例作中心 broker；`mountId` 由 mount wrapper 铸 UUID，registry 全局查重，不生成也不改写 | 保留 | `apps/stage-tamagotchi/src/main/services/stage-renderer/`；窗口销毁清理；main 进程 ≠ main 窗口 |
| R2 | 口型同步移出 driver 契约，改为**插件级能力**；帧走 eventa BroadcastChannel，不经过 main broker | 保留 | `HostSpeechAnalyzerService` + 主窗口音频服务；analyzer 必须在持有 AudioContext 的窗口 |
| R3 | `captureFrame` 成为 **空 payload cue**；renderer 返回当前 canvas 全部内容；capture 单独成包 | 保留 | `CueKind.CAPTURE` + `CueAck.results`；timeout/`CAPTURE_FAILED`/`INVALID_ENVELOPE` |
| R4 | IPC 统一使用 **`@moeru/eventa`**；broker 铸全局 nonce、per-mount FIFO；**只做单 mount ack** | 保留 | `target` 只有 `mountId`；`stateScope` 已删除；泛型顺序 `<Response, Request>` |
| R5 | main 只做 manifest registry/enable；renderer 做 runtime 激活/mount | **改写** | main 还有 driver Manager（生命周期/列表）；renderer 有 Adapter（界面首次渲染时创建）+ provider/runtime；main 不 import runtime |
| R6 | **拒绝**为已存在 ID 导入模型，除非显式 `overwrite`；迁移走 marker | 保留 | `confirmImport` + `MODEL_ID_CONFLICT`；冲突查 driver 模型存储/AIRI summary |
| R7 | 多模型包返回 `parts` 供 AIRI 选择；`confirmImport` 传 ID；Adapter 保证唯一 | **已锁定（Adapter）** | 两阶段保留；ID 由 Adapter 创建并查重，driver 只接收 |
| R8 | legacy 删除写 tombstone，并让 dump/restore/远端 sidecar 都尊重它 | 保留 | sync-engine + 迁移数据层；driver purge 仍由 driver 实现 |
| R9 | `state`/`prompt` 的权威副本放 main；actor 通过 eventa 写，main 广播 revision | **取消** | 没有 snapshot/state；prompt 由 driver 提供、每模型一份，历史按 `modelId` 存 driver，AIRI 只把当前模型存 character card；切换模型时清旧值 |
| R10 | control strip 的 picker 由 **driver 提供组件**，host 只给 popover 外壳 | **部分改** | driver 组件保留；模型选择独立成 `modelPicker`；panel props 去 `stateScope` |
| R11 | CalibrationStudio 分散进各 driver；preview scope 每 mount 唯一 | **部分改** | calibration panel 保留；preview 用独立 mount，无 scope key，只加载已导入模型 |
| R12 | chat 与 actor **共享 `stateScope`**，不是 preview；cue 先按 `mountId` 逐个发，fan-out 暂缓 | **取消** | 两个独立 mount；没有共享 snapshot/prompt；cue 只按 `mountId` |
| R13 | 模型导入统一用 `files`，不区分 companion；AIRI 只负责模型导入 | 保留 | `ModelProbeInput` + driver panel；非模型资产走 driver 通道 |
| R14 | `saveProfile` 只要求 driver 已注册，不要求 mount；`MigrationInput` 形状待定 | 保留 | provider 在 renderer；Manager 经 adapter 通道转发；冻结 selectedModelId |
| R15 | head-tethered caption 渲染迁入 driver；`CaptionCue` 可选；host 兜底可选且非 head-tethered | 保留 | 删除 `HeadPose`/`getHeadPose`/`headPose` |
| R16 | namespace 隔离由 AIRI 实现，driver 不可知；bridge allowlist | **改写** | 隔离粒度是 driver；每 mount 一个 storage handle；key/values/migration 归 driver |
| R17 | scope 有语义；除 preview 外均复用 scope | **取消** | 没有 scope；mount 状态独立 |
| R18 | **本 release 只支持第一方**；第三方引用等完全稳定后再释出 | 保留 | SDK 保持 `private` + source-only |
| R19 | **先 manifest 再 runtime**；main 的 registry 只持有 manifest 信息 | **改写** | main 有 Manager（driver main 代码，生命周期/列表）；main 仍不持有 runtime/能力探测 |

**2026-10-25 补充锁定（非 R 编号）：**

| 项 | 决策 | 落地位置 / 必须同时处理 |
| :--- | :--- | :--- |
| 模型三态 | `unimported` / `builtin` / `imported`；`pending-import` 仅导入事务内瞬时，必须收敛；无模型 card 正常 | §6.8；card import/迁移同一事务内完成导入 |
| prompt 历史 | driver 按 `modelId` 保存每个模型的历史；character card 只存当前模型 prompt（纯字符串），chat 读 card | P1-1；切换模型清旧值，切回旧模型由 driver 重推 |
| preset / builtin | preset 是 driver builtin：driver 可枚举/引用，AIRI 不可；必须先导入产生 `modelId` + `profileId`；迁移同步导入 | P1-7；builtin key 只在 driver 内部，AIRI 只引用 imported 模型 |
| 模型作者信息 | 用 `ModelAuthor { name, icon?, url? }` 随模型保存，替代单一 `authorIcon` | P1-7；`ModelDescriptor`/`ModelSummary`/AIRI record 同步 |
| V-HACK / L-HACK | 进入 VRM/Live2D driver 实现；driver 持 raw bytes、panel 和导出，host 不提供 raw 通道 | P1-11；迁移时把 `vrm-vhack`/`live2d-lhack` 与 `vhack.ts` 迁入 driver |

### 9.2 落地时必须保持的约束（不是可选优化）

1. **R6 × 迁移 D13**：迁移必须用 `overwrite: true` + `pending`/`done` marker；普通导入永远不传 `overwrite`。这个冲突已经在迁移 D13 解决，实现时不要退回“同 ID upsert”。
2. **R2 × Electron 架构**：`AudioContext` 在主窗口 renderer（`ControlStripHost`），不在 Electron main 进程；analyzer 必须在音频窗口加载。把 analyzer 放进 main 在技术上不可行（Node 没有 Web Audio/DOM）。
3. **R3 × `CueAck`**：capture 的结果已经能放进 `CueAck.results`（`CueResolved.value`）；cue 是空 payload，renderer 自己决定格式；因为 capture 独占一包，编码失败走 `CAPTURE_FAILED` 不会丢别的槽位。不要再退回“整包 `reason[]`”。
4. **R7 × 并发**：ID 由 Adapter 创建并保证不冲突；driver 只接收传入的 ID，不能自己 `crypto.randomUUID()`。
5. **R3 × FIFO**：capture 编码可达数百 ms；broker 只保证投递顺序，不等待完成，否则 selfie 会阻塞 expression/motion。
6. **R11 × 实现成本**：四个 renderer 各有一套校准 vocabulary，拆进 driver 意味着四份 UI；可以共享 `@proj-airi/stage-renderer-calibration-ui`，但注册与写路径必须留在 driver。
7. **R2 × 首版可用性**：插件 analyzer 依赖 renderer-side loader + 模块加载/CSP；Stage 1 先复用主窗口 `mouthOpenSize` 标量，Stage 4 再接 analyzer。
8. **无 scope（2026-10-25）**：`stateScope` 从契约删除；actor/chat 各自独立 mount；需要同时控制时按 `mountId` 逐个发，不做隐式 fan-out。
9. **无 snapshot（2026-10-25）**：`persistence.ts` 的 state 部分、`HostStateTransferPort`、`HostServices.state` 删除；prompt 由 driver 提供、每模型一份，历史按 `modelId` 归 driver，AIRI 只把当前模型存 character card，不按 mount 恢复。
10. **存储隔离（2026-10-25）**：粒度是 driver；每 mount 一个 handle；key/values/migration 归 driver，AIRI 不解释、不恢复。
11. **模型选择（2026-10-25）**：driver 提供 `modelPicker`，只 emit 已导入模型的 `{ modelId, profileId }`；builtin 由 driver 自己的入口先导入，AIRI 不接收 builtin key；AIRI 负责 binding/替换/fallback；Manager 的列表只做轻量 summary。
12. **R15 × host overlay**：host overlay 是可选的，但一旦实现就不能依赖 `HeadPose`，也不能声称是 driver caption。
13. **prompt 历史（2026-10-25）**：历史按 `modelId` 存 driver；AIRI 的 character card 只保存当前模型 prompt，不复制历史。切换模型时清旧值，切回旧模型由 driver 重推。
14. **preset builtin（2026-10-25）**：preset 是 driver builtin，driver 可枚举/引用、AIRI 不可；必须先导入产生 `modelId` + `profileId` 才能被 card 引用或 runtime preview。迁移在事务内同步导入；未确认/失败按丢弃处理。AIRI 不持有 builtin key。
15. **V-HACK/L-HACK（2026-10-25）**：属于 VRM/Live2D driver；host 不增加 raw bytes API，也不保留 `stageModelSelectedUrl` 路径。
16. **作者信息（2026-10-25）**：用 `ModelAuthor` 随模型保存，不再只存 `authorIcon`；迁移把旧图标归一到 `author.icon`。
17. **模型三态（2026-10-25）**：`pending-import` 只存在于 card import/迁移事务内，不写 card/binding/catalog；事务结束必须是 `imported` 或丢弃为 `unimported`。无模型 character card 是正常状态，不进入 fallback。

### 9.3 仍未决（需要 reviewer 下一轮回答）

1. **`CharacterModelBinding` 存哪**：character card extension 还是 AIRI host record？影响导出/导入可移植性。
2. **只换 profile**：也走完整替换（dispose + mount），还是 runtime 内切换？先按替换实现。
3. **fallback 的“安装 driver”**：是否真的有安装源？没有就只保留启用/换模型/清除。
4. **AIRI 缓存策略**：淘汰、持久化位置、是否预取；AIRI 内部实现。
5. **`ModelSummary.preview` 上限**：尺寸/格式，避免主进程 IPC 过大。
6. **custom motion/VRMA 的 selective sync**：保留 per-asset，还是改为 model 级？
7. **旧云备份**：保留一个 release 的 legacy reader，还是要求用户先升级再备份？
8. **P1-10 双模型存储**：混合期用联合 + feature flag，还是等所有 renderer 一次切换？

P2-2–P2-7 是低优先级契约/文档建议，不阻塞 Stage 1–3；按 §5 逐条决定即可。

已关闭：外部 driver（R18）；head-tethered caption（R15）；files-only 导入（R13）；saveProfile 无 mount（R14）；capture cue（R3）；口型 analyzer（R2）；重复 ID（R6）；多模型两阶段 + Adapter mint（R7）；tombstone（R8）；prompt 历史形状（driver 侧按 `modelId`）；preset 迁移（builtin 先导入 + 迁移同步产生 `modelId`/`profileId`）；V-HACK/L-HACK 归属（driver 实现）。

2026-10-25 取消：R9（main 权威 state/snapshot）、R12（chat/actor 共享 scope）、R17（scope 语义）。

2026-10-25 改写：R5/R19（main Manager + renderer Adapter/provider）、R10（settings/modelPicker 分离）、R11（preview mount）、R16（driver 级存储隔离）。

### 9.4 如果下一轮不回答，建议默认

- 只换 profile：先按完整替换（dispose + mount），后续再评估 runtime 内切换。
- fallback 安装：没有安装源就不显示“安装”，只保留启用/换模型/清除。
- selective sync：先按 model 级备份（整包），per-asset 作为后续增强。
- builtin：必须先导入产生 `modelId` + `profileId`；AIRI 不引用 builtin，导入后按普通 imported 模型处理。
- modelPicker：只列已导入模型；builtin 由 driver 自己的入口先导入，AIRI 只接收 imported 结果。
- 无模型 card：正常状态，允许导入/保存，不进入 fallback；迁移中拒绝单个模型则跳过并报告，不产生 pending。
- 旧云备份：保留一个 release 的 legacy reader，恢复后写 tombstone，再删除旧数据。
- 双模型存储：联合 + 逐 driver feature flag，最后再删 legacy。

---

## 附录 A：消费者清单（新增/未覆盖）

| 文件/区域 | 当前行为 | 迁移归宿 | 状态 |
| :--- | :--- | :--- | :--- |
| [ControlStrip.vue](../packages/stage-ui/src/components/scenarios/layout/ControlStrip.vue#L949-L1035) | 读四个 store，写 card idle/motion | driver 提供的 popover/inline panel；host 只给外壳 | R10 已改写 |
| [ModelCustomizer.vue](../packages/stage-ui/src/components/scenarios/settings/model-settings/ModelCustomizer.vue#L350-L449) | 读 store，触发 preview | driver settings/modelPicker + preview mount | R11 已改写 |
| [EmotionCalibrationStudio.vue](../packages/stage-ui/src/components/scenarios/acting/EmotionCalibrationStudio.vue#L213-L220) | 写全局 `stageModelSelected`，触发 store | driver calibration panel + preview mount | R11 已改写 |
| [useExpressionCuration.ts](../packages/stage-ui/src/composables/use-expression-curation.ts#L281-L324) | 触发四个 renderer preview | preview mount + cues | R11 已改写 |
| [ExpressionCurationModal.vue](../packages/stage-ui/src/components/scenarios/dialogs/ExpressionCurationModal.vue) | 调 curation preview | preview mount + cues | R11 已改写 |
| [useActingCapabilities.ts](../packages/stage-pages/src/pages/settings/airi-card/composables/useActingCapabilities.ts#L100-L155) | 从 store/format 推导 picker | `modelCapabilities()`/driver panel | 未决 |
| [CardEditorForm.vue](../packages/stage-pages/src/pages/settings/airi-card/components/CardEditorForm.vue#L125-L167) | 复制格式分支 | 同上 | 未决 |
| [use-idle-animations.ts](../packages/stage-ui/src/composables/use-idle-animations.ts#L6-L41) | 读 format/capabilities/custom motions | driver idle selection | 未决 |
| [discord.ts](../packages/stage-ui/src/stores/modules/discord.ts#L1547-L1567) | format switch + store trigger + capture | ACT cue + `capture` cue | R3 已锁定 |
| [use-data-maintenance.ts](../packages/stage-ui/src/composables/use-data-maintenance.ts#L780-L787) | `live2dStore.resetState()` | driver purge/reset | P1-8 未决 |
| [model-selector.vue](../packages/stage-ui/src/components/scenarios/dialogs/model-selector/model-selector.vue#L472-L474) | format 检测 + 新 id | driver `modelPicker` + probe/confirmImport；只 emit 已导入模型的 `{ modelId, profileId }` | R13 已锁定 |
| [step-finale.vue](../packages/stage-ui/src/components/scenarios/dialogs/onboarding/v3/steps/step-finale.vue#L51-L93) | `modelStore.triggerMotion` | preview mount + MotionCue | 未决 |
| [selective-sync-panel.vue](../packages/stage-ui/src/components/scenarios/providers/selective-sync-panel.vue#L378-L461) | 读 `mmdStore.customMotions` | driver asset API / model bundle | 未决 |
| [ViewControls/Inputs.vue](../packages/stage-layouts/src/components/Layouts/ViewControls/Inputs.vue#L238) | 按 `stageModelRenderer` 显示 Z | renderer transform/panel | 未决 |
| [runtime.ts](../packages/stage-ui/src/components/scenes/runtime.ts#L8-L10) | Live2D lip-sync loop 判断 | 插件级 speech frames | R2 已锁定 |
| [stage-three-transparency.ts](../apps/stage-tamagotchi/src/renderer/utils/stage-three-transparency.ts#L5-L15) | 仅 VRM 采样透明 | `occupiesPoint` per driver | 部分覆盖（迁移 §8.2） |
| [HackerPanel.vue](../packages/stage-ui/src/components/scenarios/settings/model-settings/vrm-vhack/HackerPanel.vue#L735-L737) | 从 URL 取 VRM bytes | 迁入 VRM driver；driver 内读/改/导出 | P1-11 已锁定 |
| [LHackerPanel.vue](../packages/stage-ui/src/components/scenarios/settings/model-settings/live2d-lhack/LHackerPanel.vue#L21-L24) | watch URL 取 zip | 迁入 Live2D driver；driver 内读/改/导出 | P1-11 已锁定 |
| [CharacterAvatar.vue](../packages/stage-ui/src/components/misc/CharacterAvatar.vue#L49-L63) | 读 `authorIcon` | `ModelAuthor.icon` + `author.name`；随模型记录缓存 | P1-7 已锁定 |
| [stage-model.ts](../packages/stage-ui/src/stores/settings/stage-model.ts#L25) | preset URL 作为默认模型 | driver builtin 先导入；迁移同步产生 `modelId`/`profileId` | P1-7 已锁定 |
| [chat.vue](../apps/stage-tamagotchi/src/renderer/pages/chat.vue#L1963-L1976) | 第二个 stage mount | 独立 live mount（各自 `mountId`，无 `stateScope`） | R12 已取消 |
| **新增：`UnavailableModelView`** | 当前无 | driver 未知/未安装/已禁用时的 AIRI fallback；读 binding + AIRI cache + driver status | 2026-10-25 新增 P1-16 |
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
