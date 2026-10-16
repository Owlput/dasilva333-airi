# @proj-airi/stage-renderer-sdk

Contract between AIRI and a **model driver** (VRM / Live2D / Spine / MMD
today, and anything else later).

> **Status: contract only.** No implementation. Nothing in this workspace imports
> this package yet — it exists so the model driver boundary can be reviewed before
> any existing code moves behind it. See "Deliberate non-goals".
>
> This file states the concepts, the ownership and the file map. The reasoning
> behind every shape in the package — what the current tree does instead, what was
> rejected, and what the contract still cannot express — lives in
> [`docs/rfcs/0001-stage-renderer-plugin-contract.md`](../../docs/rfcs/0001-stage-renderer-plugin-contract.md).

## Concepts and responsibilities

| Concept | Owner | What it is |
| :--- | :--- | :--- |
| Character | AIRI | A virtual, "conscious" being, with a "mind" and optionally a "body". |
| Named model | AIRI | A model that a character can reference. |
| Raw model | Model driver | The model itself, its behaviors, parameters, textures, etc. |
| Model | Model driver | What the model driver is ultimately driving. |
| Renderer | Model driver | What the model driver is directly driving. |
| Profile | Model driver | A group of named persistent states of an avatar. |
| User input | AIRI | Cursor, lip-sync audio, cues, ACT tokens, etc. |
| Model capability | Model driver | What kinds of inputs a model driver and its model can respond to. |
| Cue | AIRI | A signal for model driver to perform actions with a vocabulary known at compile time. |
| ACT token | Model driver | A signal for model driver to perform actions with a vocabulary known at runtime. |
| Expression | Model driver | An action performed by an avatar that does not involve animations. |
| Motion | Model driver | An action performed by an avatar that involves animations. |

| Responsibility | Owner |
|:--- |:--- |
| Storage primitives | AIRI |
| User input primitives| AIRI |
| Storage layout | Model driver |
| Data migration | Model driver |
| Rendering | Model driver |
| Model manipulation| Model driver |

The two interfaces that carry the split:

| Interface | Reason |
|:--- | :--- |
| `ModelProvider` | AIRI does not know what a model physically is. |
| `HostStorageInterface` | Model driver does not know where to store the bytes. |

Everything below that level — mount surfaces, panels, host services, readiness, the
failure envelope, the state scope — is a mechanism these concepts are expressed
through, and is described by the file map and the RFC.

## File map

| File | Implements | Purpose |
| :--- | :--- | :--- |
| `src/contract/shared.ts` | both | ids, result envelope, failure codes, readiness, geometry |
| `src/contract/manifest.ts` | driver | what a model driver declares: id, the capability hint (`ModelDriverCapabilities`), requirements, entry points |
| `src/contract/host-services.ts` | AIRI | the service container injected at activation (log, storage primitives, the per-model state channel, cues, audio, the pointer stream, theme, runtime facts, bridge) |
| `src/contract/provider.ts` | driver | model provider: probe + confirmImport / list / remove / preview / modelCapabilities / profiles / model transfer (the host holds the one instance as `ModelDriverRuntime.provider`) |
| `src/contract/capabilities.ts` | driver | capability kinds, the renderer's descriptors, and the vocabulary snapshot AIRI reads |
| `src/contract/renderer-mount.ts` | renderer | one mounted viewport: props, emits, exposed methods (the cue sink, the occlusion query, the interaction hit test), readiness |
| `src/contract/cues.ts` | both | one transactional cue vocabulary and one ack shape for everything the avatar is asked to do |
| `src/contract/persistence.ts` | both | the one model-scoped state channel AIRI holds, partitioned by `stateScope`, and the full-state rule it works by; no storage declarations |
| `src/contract/lifecycle.ts` | both | activation, the runtime object (the `rendererCapabilities()` probe, panels, whole-driver transfer), the requirements report, host registry |
| `src/contract/references.ts` | AIRI | every record AIRI itself keeps — the named model, its profiles and the stored preview they share — on one annotation shape |
| `src/contract/renderer.ts` | driver | driver-level concepts: settings panels, and the opaque bundle that moves a whole driver |
| `src/contract/model.ts` | AIRI | the two identities AIRI mints: the model reference and its profile |

## Deliberate non-goals

- No implementation, no dependency-injection container, no plugin loader — the
  existing plugin host owns discovery, enable/disable and load/unload.
- No format constants and no `live2d` / `vrm` / `spine` / `mmd` strings.
- No integration with `display-models.ts` or `RendererStage.vue` yet.
- No decision about *where* renderer state is physically stored, and no declaration of
  *what* it contains: AIRI provides the primitives and the medium, the model driver owns the
  layout, the versioning and every migration.
- No runtime value that is not a vocabulary a renderer must produce. There are exactly
  two: `MODEL_DRIVER_CONTRACT_VERSION` and the `RendererMountReadinessState` enum. Everything
  else is a type. There is also no `./types` subpath, because `.` is already the whole contract.

## Validation

```bash
pnpm -F @proj-airi/stage-renderer-sdk typecheck
```

`tsc --noEmit` only; there is no runtime to test.
