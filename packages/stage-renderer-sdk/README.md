# @proj-airi/stage-renderer-sdk

Contract between AIRI and a **stage renderer plugin** (VRM / Live2D / Spine / MMD
today, anything else later).

> **Status: types only.** No runtime code, no integration. Nothing in this
> workspace imports this package yet — it exists so the renderer boundary can be
> reviewed before any existing code moves behind it. See "Deliberate non-goals".

## The rule

**AIRI owns references. The renderer owns assets.**

AIRI stores *names*: the reference id a character card points at, the catalogue
row, tags and groups, the user's capability labels and every ACT mapping, plus a
preview snapshot for when the owning renderer is not available.

The renderer owns *things*: the bytes, its format's validation and repair, its
preview generation, and its capability enumeration.

Corollary: **AIRI must never assume that two renderers understand each other's
assets.** Two renderers may declare the same asset kind and be interchangeable;
that is an explicit declaration, never a default.

| Concern | Owner | Where it lives today |
| :--- | :--- | :--- |
| Reference id, card binding, orphan state | AIRI | `airi-card.ts` `displayModelId`, `settings/stage-model.ts` |
| Asset bytes, storage layout, repair | Renderer | host-side `display-models.ts` + localforage `display-model-<nanoid>` |
| Asset presentation and relationships between assets | Renderer | today a host-built `model-selector.vue` + per-format settings panels |
| Preview generation | Renderer | each renderer's `utils/*-preview.ts`, invoked by the host |
| Capability *discovery* | Renderer | duplicated: host parses zips/skeletons, renderer introspects runtime |
| Capability records: labels, `usable`, favourites, idle selection, ACT mappings | Renderer (AIRI keeps only a read-only vocabulary snapshot) | today AIRI's `ModelCapabilityItem`, `emotionMappings`, `vfxMappings`, `outfits` |
| Runtime cues (emotion / expression / motion / vfx / mesh / parameter / selection / preset / viseme / gaze / view / reset / reload) | AIRI sends, renderer handles | four per-renderer stores + three `BroadcastChannel`s |
| Pause / visibility decisions | AIRI | window lifecycle store; renderers only receive a prop |
| Renderer settings and all per-model renderer state (incl. position/scale) | Renderer (declared; stored opaquely by AIRI) | 60+ raw `localStorage` keys, a host `usePositioningStore`, two writers on `settings/mmd/scale` |
| Cloud backup of asset payloads | AIRI orchestrates, renderer produces opaque bundles | `sync-engine.ts` + `display-models.ts` |

## File map

| File | Implements | Purpose |
| :--- | :--- | :--- |
| `src/contract/shared.ts` | both | ids, result envelope, failure codes, readiness, geometry |
| `src/contract/manifest.ts` | renderer | what a renderer declares: id, kinds, features, requirements, entry points |
| `src/contract/host-services.ts` | AIRI | the service container injected at activation (log, storage, cues, audio, theme, runtime facts, bridge) |
| `src/contract/assets.ts` | renderer | asset provider: probe / list / read / write / remove / preview / export-import |
| `src/contract/capabilities.ts` | renderer | capability kinds, the renderer's descriptors, and the vocabulary snapshot AIRI reads |
| `src/contract/stage.ts` | renderer | the mounted stage component: props, emits, exposed methods, readiness |
| `src/contract/cues.ts` | both | one transactional cue vocabulary and one ack shape for everything the avatar is asked to do |
| `src/contract/persistence.ts` | both | ownership and declaration of persisted state, host model record, per-model renderer snapshot, conflict resolution |
| `src/contract/lifecycle.ts` | both | activation, degradation reporting, stage lifecycle events, host registry |
| `src/contract/references.ts` | AIRI | references, availability, and the resolution/orphan state machine |

## Reading order

1. `shared.ts` — the vocabulary.
2. `manifest.ts` — what a plugin is.
3. `assets.ts` — what a plugin owns.
4. `capabilities.ts` + `cues.ts` — what a plugin can be asked to do.
5. `stage.ts` — how it is mounted.
6. `host-services.ts` + `persistence.ts` — what AIRI must provide and remember.
7. `references.ts` + `lifecycle.ts` — how AIRI finds, resolves and supervises it.

## Concepts worth reviewing first

- **`AssetKind` is opaque.** It replaces `DisplayModelFormat`. AIRI may display
  and route it, never switch on it. Same for `RendererAssetId` and every `meta`
  field in this package.
- **Two shapes for a payload, never three.** Required companions (an MMD model and
  the textures its materials reference) are part of the payload `read()` returns
  and have no id of their own. Everything else is an independent asset with its own
  id, `kind` and lifecycle. AIRI does not model relationships between assets at
  all — presentation and invocation belong to the renderer, and whatever links an
  asset to another asset, to a model or to an outfit travels in the opaque `meta`
  bag or stays inside the renderer's own storage. For the same reason AIRI needs no
  notion of a "bindable" asset: the renderer's own selector decides what may be
  picked for a card. There is no "attached sidecar" shape either; see the header of
  `src/contract/assets.ts` for the cost of the one we removed.
- **`probe` keeps unified import working.** Once per-format detection leaves the
  host, the only way to keep "drop a file, AIRI figures out what it is" is to ask
  every enabled renderer and arbitrate by confidence.
- **The renderer owns the capability record; AIRI owns one projection of it.**
  Labels, the `usable`/favourite toggles, idle-cycle selection, every ACT mapping
  and the UI for all of them belong to the renderer, because only it knows how
  capabilities combine. AIRI keeps a read-only `RendererVocabularySnapshot` in the
  per-model state, because prompts are built while nothing is mounted — chat and
  the autonomous Director run with the stage closed, and a renderer like VRM only
  knows its expressions after the model loads.
- **`CapabilityDiscoveryMode`** (`static` / `runtime` / `none`) is a real
  difference: Live2D and Spine can be enumerated from the package, VRM only after
  the model is loaded, and a renderer with no capability model at all says `none`.
- **Orphan states are normal, not errors.** A reference may be
  `renderer-disabled`, `renderer-missing`, `kind-unsupported` or `asset-missing`.
  Today all of these collapse into "model not found" plus a preset fallback.
- **`export` / `import` must round-trip `assetId`.** The host's references point
  at `(rendererId, assetId)`; a device restore must not mint new ids.
- **Handles have an explicit lifetime.** `StageAssetHandle.release()` replaces
  today's timer-based blob URL revocation.
- **`openness` is normalized 0..1.** One renderer currently takes 0..100 and the
  scaling differs three ways across renderers.
- **An envelope is a transaction.** Its cues are applied together, never in
  sequence, and `CueAck.reason` reports per-slot outcomes aligned by index, so a
  half-applied multi-part change stops being possible. `handled: false` means
  "not every slot landed", never "nothing happened".
- **Preview is a qualifier, not a cue kind.** `persistent: false` applies a change
  transiently — never saved, never bumping the snapshot — and the host routes it
  only to the targeted `surface`, so a settings preview cannot animate the live
  stage.
- **Repetition is one number.** `repeat` (`-1` / `1` / `n`, or absent = honour the
  asset's own declaration) replaces both the `loop` boolean and the `oneShot`
  flag, which contradict each other today.
- **What AIRI cannot read, it forwards.** An outfit is a renderer-managed preset,
  so `PresetCue` hands the renderer's own opaque body back to it instead of AIRI
  pretending to understand it.
- **Per-model state is a snapshot the renderer writes.** `values` (transform,
  selection, morph overrides) is opaque to AIRI and revision-guarded by the host;
  `vocabulary` is the only part AIRI reads, and restoring a snapshot hands it back
  to the renderer to merge. Only the **mounted** instance publishes it — a
  settings panel edits the renderer's own store and lets the mount write, so two
  windows never race `revision`.
- **The panel is the renderer's, the frame is the host's.** A renderer declares N
  panels (array on the runtime object, optional `surfaces` filter, lazy component
  factory) and one component is reused across surfaces via `surface`. When the
  renderer is unavailable the host does not mount the panel at all: it says so and
  appends a read-only list built from the snapshot's `vocabulary`.

## Deliberate non-goals

- No runtime, no dependency-injection container, no plugin loader — the existing
  plugin host owns discovery, enable/disable and load/unload.
- No format constants and no `live2d` / `vrm` / `spine` / `mmd` strings.
- No integration with `display-models.ts` or `RendererStage.vue` yet.
- No decision about *where* renderer state is physically stored; only about who
  owns it and how it is declared.

## Validation

```bash
pnpm -F @proj-airi/stage-renderer-sdk typecheck
```

`tsc --noEmit` only; there is no runtime to test.

## Open questions

- Should `AssetKind` be a registry with declared cross-renderer compatibility
  ("I can read kind X"), or is `kinds: string[]` enough?
- Cross-*transaction* ordering: one envelope is applied atomically, but does the
  host need a queue across envelopes (emotion, then motion), or is
  fire-and-forget with an ack enough?
- Should `StageRendererProps.settings` go too? It forwards renderer-owned settings
  the renderer now owns outright; `mouth` and `focusAt` stay because they are
  continuous streams.
- Should `RendererHostServices` include a shared parsed-asset cache so two
  renderers can reuse one parse?
