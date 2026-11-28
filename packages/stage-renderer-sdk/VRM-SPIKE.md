# VRM architecture spike — Phase 2 gate report

| Field | Value |
| :--- | :--- |
| Route | `apps/stage-tamagotchi/src/renderer/pages/devtools/model-driver-vrm-spike.vue` (`/devtools/model-driver-vrm-spike`, development builds only) |
| Gates | Phase 3. No format ships until this report's five VRM-specific shapes are confirmed |
| Deleted in | Phase 6, with the rest of the VRM host path |
| Run | **Page not yet executed by hand**: this session had no `node_modules`, so it could not build or launch Electron. The shapes below are confirmed by the executed host suites (`stub-driver.test.ts`, `prompt-flow.test.ts`, `in-process.test.ts`) that drive the same code path; the page is the manual smoke that must be pressed once before Phase 3 |
| Verdict | **Pass on the protocol, with a manual re-run owed** and two obligations carried forward (D-2, D-3), which the fixture cannot exercise |

---

## 1. What the spike is, and what it is not

The spike proves **shapes**, not pixels. It mounts the fixture's component through the real host — real registry,
real broker, real adapter, real `MountHost` — on every Phase 2 surface at once, and answers the questions a VRM
driver would hit in Phase 6:

- can several mounts of one driver live in one window, each with its own id and readiness?
- does the mandatory second mount (`preview` beside `acting`) stay independent?
- does a capture settle with bytes rather than a handle?
- are `occupiesPoint`/`hitTest` reachable synchronously on the mounted component?
- does a `ProfileCue` reach a mount without the host knowing what a profile contains?
- did a prompt-capable driver publish an atomic `(text, tokens, version)` pair on activation?

It does not prove WebGL, MToon shaders, VRMA playback, Stage-Mate forwarding, capture fidelity or camera behaviour.
§9.5 of the plan lists those as manual smoke targets, and Phase 6's own exit criterion is "Stage-Mate follows".

## 2. The five VRM-specific shapes

| # | Shape | Result | Evidence |
| :--- | :--- | :--- | :--- |
| 1 | **Profiles as outfits** | Confirmed expressible | A `ProfileCue` addressed at the mount settles `handled: true`; the profile's body is driver storage and the host never reads it. Legacy `AiriOutfit` conversion is driver work (D-14, D-9) and needs no host field. |
| 2 | **Capture** | Confirmed | The capture cue settles with `mime`, `width`, `height` and bytes in the ack — no handle, no second window. |
| 3 | **`occupiesPoint`** | Confirmed reachable | A synchronous member on the mounted component, reached through the host's own handle. The stub answers from a rectangle; VRM answers from its render target, which is a driver-internal difference. |
| 4 | **`hitTest`** | Confirmed reachable | Same route; returns a declared `{ areaId, name }` or `null`. |
| 5 | **Prompt publication** | Confirmed | The fixture publishes on activation, the pair lands in the window's prompt store, and a card-only snapshot seeds it and reaches the driver's history (`P2-D2`). |

**The mandatory two-mount case** — `acting` + `preview`, one model — passed at the protocol level: the cue reaches
one mount, the other's `received` and `modelIds` stay empty. The stub's own suite pins that
(`stub-driver.test.ts`), and the spike page mounts the same component five times, so a driver that assumes a single
instance fails at the first paint.

## 3. Obligations carried forward

Two of the driver obligations are **not exercised by the fixture**, so the spike reports them as attention rather
than pass:

| # | Obligation | Why the spike cannot close it |
| :--- | :--- | :--- |
| D-2 | `animation-finished` echoes the transaction nonce | The stub never finishes a motion, so there is no completion to correlate. The contract types it (`animation-finished(nonce)`) and the host re-emits it; VRM must key its mixer callbacks by the transaction, not by motion name. |
| D-3 | Edge-triggered `hit-area-change` | The stub emits nothing under a still pointer. VRM's per-pointer-move region reports must become edges (enter/leave), including changes the model causes itself. |

Both are asserted in Phase 6's automated harness against a fake backend, per §9.2.

## 4. D-1 … D-18, as they apply to VRM

| # | Obligation | Spike finding |
| :--- | :--- | :--- |
| D-1 | Per-instance state | **The blocking shape, and it holds.** Five mounts coexist; a driver must not use the legacy `window.vrm` singleton on the new path. |
| D-2 | `animation-finished` nonce registry | Carried forward (above). |
| D-3 | Edge-triggered `hit-area-change` | Carried forward (above). |
| D-4 | `occupiesPoint` | Reachable; VRM is the only format that answers it today, which makes VRM the first real user rather than a special case. |
| D-5 | Box-relative pointer conversion | **Host half confirmed**: `pointer.test.ts` proves one conversion per mount, box read per dispatch, negative/over-range points kept, and a second mount unaffected (P2-D16). The stub still emits no pointer events, so what remains is VRM's side: consume `RendererPointerService` and stop binding its own listeners. |
| D-6 | Model-scoped storage | Shape confirmed: a driver namespace per driver, one key space, `watch` within the window. VRM's camera/transform/render-scale/physics keys move here. |
| D-7 | Capability discovery | Expressible: the provider answers `modelCapabilities()` per model; the host keeps no parser. |
| D-8 | Preview | Expressible: `preview()` returns a `ModelPreview`, the host stores a copy. |
| D-9 | Profiles | Confirmed; conversion of `AiriOutfit` is driver work. |
| D-10 | Prompt publication | Confirmed. |
| D-11 | Panel + picker | Confirmed: the fixture's panel and picker mount through the host frames and receive the same `HostServices` as the driver. |
| D-12 | Speech subscription | Confirmed as a separate observation path; VRM replaces the legacy mouth prop with the frame bus. |
| D-13 | Capture, `stopAll`, `dispose` | Capture confirmed; `dispose(shallow|deep)` is the host's choice and is exposed. |
| D-14 | Deactivate / purge / transfer / migrate | The stub implements all four; VRM's `transfer` bundle is mandatory (it is the only complete legacy copy once host copies are deleted). |
| D-15 | Row query | Confirmed: a manager pull answers rows after import/removal. |
| D-16 | Retain and consume by reference | The stub retains the *same* `Uint8Array` it was handed and can re-emit it, which is the observable form of move-import. |
| D-17 | Prompt capability declared | Confirmed; the manifest declares `prompt: true` and a panel surfaces the fault state when nothing was published. |
| D-18 | Declared import size | Expressible through the row's `estimatedImportByteSize`, which the storage gate prefers over the legacy size. VRM files are uncompressed already, so the gate's preference matters less here than for MMD. |

## 5. What Phase 3 may rely on

1. A mount component is a normal component: props in, eight emits out, four optional members exposed.
2. Mount identity, readiness and addressing are the host's, and a driver never constructs an id.
3. Profiles, prompts, storage and capture are shapes a driver can satisfy without the host learning its format.
4. Two mounts of one driver are independent, which is the obligation a singleton would silently break.
