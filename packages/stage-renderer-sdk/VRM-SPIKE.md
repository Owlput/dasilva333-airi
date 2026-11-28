# VRM architecture spike — Phase 2 gate report

| Field | Value |
| :--- | :--- |
| Route | `apps/stage-tamagotchi/src/renderer/pages/devtools/model-driver-vrm-spike.vue` (`/devtools/model-driver-vrm-spike`, development builds only) |
| Gates | Phase 3. No format ships until this report's five VRM-specific shapes are confirmed |
| Deleted in | Phase 6, with the rest of the VRM host path |
| Run | **Pressed by hand on 2026-11-28**, Electron 45.5.0 development build, five surfaces in one window (`Start adapter`, then `Run spike`). Every check the fixture can answer came back `pass`; the two it cannot are `attention` (§3). Registry-issued ids that run: `mount_11`…`mount_15` |
| Verdict | **Pass**, on the page's own evidence and not only the suites'. Two driver obligations (D-2, D-3) remain unexercised by the fixture and are carried to Phase 6's harness. The first press also found a real host bug (§6) |

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
| 1 | **Profiles as outfits** | Confirmed expressible | A `ProfileCue` addressed at the mount settles `handled: true` (run: `handled=true`, nonce 20); the profile's body is driver storage and the host never reads it. Legacy `AiriOutfit` conversion is driver work (D-14, D-9) and needs no host field. |
| 2 | **Capture** | Confirmed | The capture cue settles with `mime`, `width`, `height` and bytes in the ack — no handle, no second window. The run's ack: `image/png`, `2×2`, `16` bytes. |
| 3 | **`occupiesPoint`** | Confirmed, and called | A synchronous member on the mounted component, reached through the host's own handle and answered on the spot: `(12,24)=true`, `(-1,24)=false`. The negative control is the evidence — an answer that is always `true` would pass the first call alone. The stub answers from a rectangle; VRM answers from its render target, which is a driver-internal difference. |
| 4 | **`hitTest`** | Confirmed, and called | Same route and same control: `head/Head` inside the box, `null` outside it, as a declared `{ areaId, name }`. |
| 5 | **Prompt publication** | Confirmed | The fixture publishes on activation, the pair lands in the window's prompt store, and a card-only snapshot seeds it and reaches the driver's history (`P2-D2`). The run enumerated one row and found the pair in the store. |

**The mandatory two-mount case** — `acting` + `preview`, one model, both live — passed on the page as well as in the
fixture's suite: a load addressed at `acting/acting` alone settled `handled: true` with `acting` receiving one
envelope and `preview` receiving none. `stub-driver.test.ts` pins the same obligation headlessly; the page adds the
part only a real window has — two `MountHost`s, two registry-issued ids and one adapter.

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
| D-4 | `occupiesPoint` | **Reachable and called** (run: `(12,24)=true`, `(-1,24)=false`). VRM is the only format that answers it today, which makes VRM the first real user rather than a special case. |
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

## 6. The 2026-11-28 run

| Check | State | What the page showed |
| :--- | :--- | :--- |
| D-1 | `pass` | Five mounts in one window, five registry-issued ids: `acting:mount_11`, `stage:mount_12`, `chat:mount_13`, `rehearsal:mount_14`, `preview:mount_15`. Ids are issued per registration and never reused — the previous run's were `mount_6`…`mount_10`. |
| D-1b | `pass` | `handled=true nonce=21; acting received 1 envelope(s), preview 0 (of 1 already)`. |
| D-4 | `pass` | `occupiesPoint (12,24)=true, (-1,24)=false`. |
| D-4b | `pass` | `hitTest inside=head/Head, outside=null`. |
| D-9 | `pass` | `handled=true nonce=20`. |
| D-10 | `pass` | `1 row(s) enumerated`; the window's prompt store holds the published pair. |
| D-13 | `pass` | `handled=true nonce=19; image/png 2×2, 16 byte(s) in the ack`. |
| D-2 | `attention` | The fixture finishes no motion, so there is no completion to correlate (§3). |
| D-3 | `attention` | The fixture emits no region change under a still pointer (§3). |

### What the first press found

The runs before this one were worth as much as the passing one, because the page was doing the work §5.8 gives it:

1. **A real host bug.** `MountHost` held the resolved driver component in a deep `ref`, so the definition reached
   `<component :is>` as a reactive proxy — Vue's "component made reactive" warning, with the invalidation cost that
   comes with it. It is a `shallowRef` now, matching `DriverPanelHost`/`DriverPickerHost`, which had it right. No
   surface had ever rendered a driver mount before this page, so the host's own mount component was unexercised.
2. **Three of the page's own checks were not evidence.** D-1b was declared and never marked, so it could only ever
   read `pending`; D-4/D-4b reported "the route exists" instead of calling it, though `defineExpose` is exactly the
   handle; D-13 counted bytes and ignored the `mime`/`width`/`height` the same ack carries. All three assert now.
3. **Two probe mistakes**, both instructive: a function ref that wrote reactive state (Vue's "maximum recursive
   updates exceeded" — a function ref runs on every patch, so it fed the render that invoked it), and a D-1b probe
   that used a model id the fixture does not enumerate, which the *driver* refuses as `ASSET_MISSING` before the
   addressing question is ever asked. The second is the one worth remembering: a probe whose observable cannot
   change measures nothing, however green it looks.

