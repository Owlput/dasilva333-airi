# Design Proposal: External Model Catalog & On-Demand Ingestion (HTTP Repository)

## 1. Overview & Context

AIRI currently manages avatar models through two distinct subsystems:
1. **Local Library (`displayModelsStore` / `localforage` IndexedDB)**: Models are stored as individual binary objects keyed by `display-model-<nanoid>` with cached WebP thumbnails and metadata.
2. **BYOS Cloud Sync (`sync-engine.ts`)**: Two-way synchronization across devices (S3/R2 or Electron local filesystem) using `assets/models/manifest.json` and `assets/models/${id}.bin` payloads.

### The Problem
Power users with large avatar collections (e.g., 22,000+ VRM, Live2D, Spine, and MMD models) face critical architectural barriers when attempting to use AIRI's existing model management:
- **Forced Renaming & Binary Wrapper**: AIRI's BYOS pipeline renames models into synthetic nanoid `.bin` payloads (`assets/models/${id}.bin`), destroying standard filesystem file naming (`.vrm`, `.zip`).
- **Heavy Two-Way Reconciliation Loop**: AIRI's `reconcileModels()` engine performs bidirectional diffing (groups, tags, capabilities, deletions) and rewrites `manifest.json`. Running this on 22,000 models would parse and serialize a 30MB–60MB JSON file on every periodic sync pass, exhausting CPU and freezing the UI thread.
- **Client Storage & Memory Exhaustion**: Caching 22,000 models into IndexedDB (`local:display-models/metadata-cache`) with inline thumbnails exhausts browser storage quotas and degrades Pinia reactivity.
- **Redundant Pre-Indexing**: Users with large collections frequently already maintain external indices (tag databases, pre-rendered thumbnails, categorization) outside of AIRI.

### The Proposal
Introduce an **External HTTP Model Catalog** adapter: a lightweight, read-only remote repository interface that:
- Connects directly to an external HTTP/HTTPS catalog URL.
- Renders remote models in the existing **Cloud** tab in `model-selector.vue` using virtualized pagination.
- Retains original files on the remote server without requiring `.bin` conversion.
- Downloads individual models on demand and ingests them directly into AIRI's local model store (`localforage`).

---

## 2. Core Architecture

```
┌─────────────────────────────────────────────────────────────┐
│               External Remote Server / CDN                  │
│  - Serves catalog.json (metadata, tags, preview URLs)       │
│  - Serves static previews: /previews/*.webp                 │
│  - Serves native binaries: /models/*.vrm, *.zip, etc.       │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP GET catalog.json
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 AIRI External Catalog Store                 │
│  - Key: settings/models/external-catalog-url (localStorage) │
│  - In-memory array of remote model descriptors              │
│  - Pure Read-Only (no outbox, no reconcile loop)            │
└──────────────────────────────┬──────────────────────────────┘
                               │ Reactive Feed
                               ▼
┌─────────────────────────────────────────────────────────────┐
│        model-selector.vue (Cloud Tab -> External)           │
│  - 100-item virtual scroll pagination (IntersectionObserver)│
│  - Format filters (VRM, Live2D, Spine, MMD)                 │
│  - Search query over pre-indexed tags & names               │
│  - Standard <img> tags resolving remote preview URLs        │
└──────────────────────────────┬──────────────────────────────┘
                               │ Click "Download" (On-Demand)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│            On-Demand Ingestion Pipeline                     │
│  1. Fetch model binary stream (native .vrm / .zip)          │
│  2. Fetch pre-existing preview WebP (skips WebGL snapshot)  │
│  3. Persist to localforage (displayModelsStore)             │
│  4. Immediately select / bind to active character card      │
└─────────────────────────────────────────────────────────────┘
```

### Key Differences from Standard BYOS Sync
| Dimension | Standard BYOS Sync (`s3` / `local-fs`) | External HTTP Catalog (`external-http`) |
|---|---|---|
| **Sync Direction** | Bidirectional (local mutations mirror to remote) | Unidirectional / Read-Only (AIRI never writes to remote) |
| **Storage Format** | Wrapped `assets/models/${id}.bin` | Native files (`.vrm`, `.zip`, `.pmx`) |
| **Manifest Parsing** | Re-read & rewritten every sync cycle | Fetched on demand or when user clicks "Refresh" |
| **Outbox Enqueueing** | Yes (all mutations queued in `outbox:queue/*`) | No (completely bypasses outbox) |
| **Thumbnail Storage** | Sidecar `${id}-preview.png` via base64 | Direct HTTP URL (no base64 overhead in manifest) |
| **Ingestion Trigger** | Bulk / Selective sync during onboarding & sync cycle | Explicit on-demand user click |

---

## 3. UI & User Experience

### 1. Cloud Tab Integration (`model-selector.vue`)
In `model-selector.vue`, the Cloud tab dropdown is updated to include the external catalog source:
```html
<select v-model="selectedSourceProvider" title="Cloud Source Adapter">
  <option value="s3">S3 Cloud</option>
  <option value="local-fs">Local FS</option>
  <option value="external-http">External Catalog</option>
</select>
```

### 2. Inline Catalog URL Configuration
Directly adjacent to the source dropdown, an edit/settings button (e.g. `i-solar:settings-linear` or `i-solar:link-circle-bold`) allows the user to paste their catalog URL without leaving the modal:
- A compact popover or input prompt: `Catalog URL: https://models.example.com/catalog.json`.
- Automatically persists to `localStorage.getItem('settings/models/external-catalog-url')`.
- Displays connection status (loading spinner, item count badge, or error toast).

### 3. Browsing & Filtering 22,000 Models Safely
- **Incremental Rendering**: The existing `PAGE_SIZE = 100` with `IntersectionObserver` sentinel prevents DOM overload.
- **Zero Base64 Memory Bloat**: Thumbnail images are rendered via standard `<img :src="model.previewUrl" loading="lazy">`. Browsers handle caching and decode recycling naturally.
- **Instant Search**: During catalog ingestion, a lightweight search string `_searchKey` (`${name} ${tags.join(' ')} ${groups.join(' ')}`.toLowerCase()) is attached, allowing sub-5ms substring filtering across 22,000 records.

### 4. Single-Click Download & Stage
When the user clicks the cloud download icon:
1. Displays progress indicator (`downloadingModelId === model.id`).
2. Fetches the binary via `fetch(model.downloadUrl)`.
3. Fetches the thumbnail from `model.previewUrl` (or uses the already-cached browser image).
4. Calls `displayModelsStore.addDisplayModelDirectly({ ... })` to write cleanly to `localforage` without re-running expensive offscreen WebGL thumbnail generators.
5. Emits `pick`, seamlessly staging the downloaded character.

---

## 4. Baseline Catalog Schema

```json
{
  "$schema": "https://airi.moeru.ai/schemas/model-catalog-v1.json",
  "version": 1,
  "name": "Personal Archive",
  "description": "22K External Avatar Repository",
  "baseUrl": "https://models.my-server.local/",
  "models": [
    {
      "id": "ext-keqing-opulent",
      "name": "Keqing (Opulent Splendor)",
      "format": "vrm",
      "downloadUrl": "vrm/keqing_opulent.vrm",
      "previewUrl": "previews/keqing_opulent.webp",
      "sizeBytes": 28419200,
      "tags": ["genshin-impact", "keqing", "dress"],
      "groups": ["Genshin Impact"],
      "nsfw": false,
      "author": "miHoYo / Hoyoverse"
    }
  ]
}
```

### Supported Formats
- `vrm` (.vrm 3D humanoid avatar)
- `live2d-zip` (Cubism 3/4 packaged zip containing .model3.json)
- `spine-zip` (Spine 3.8/4.x skeletal zip containing .skel/.json and atlas)
- `pmx-zip` (MMD model package zip)

---

## 5. Security & Network Considerations

- **CORS Handling**:
  - In desktop Electron (`apps/stage-tamagotchi`), Electron net / IPC bypasses browser CORS restrictions, allowing local LAN or NAS URLs without special headers.
  - In browser/web stage (`apps/stage-web`), the external server must serve `Access-Control-Allow-Origin: *` headers, or pass through the AIRI Cloudflare CORS proxy.
- **Stream Safety**:
  - Models should be downloaded with abortable `fetch()` requests (`AbortController`) to handle user cancellations.
- **Storage Limits**:
  - Only models the user explicitly clicks "Download" on consume local space in IndexedDB / `localforage`. The rest remain remote metadata pointers.

---

## 6. Implementation Stages (Draft)

1. **Phase 1: Catalog Schema & Store**:
   - Create `packages/stage-ui/src/stores/external-model-catalog.ts`.
   - Store catalog URL in `settings/models/external-catalog-url`.
   - Implement `fetchExternalCatalog(url)` with cache and validation.
2. **Phase 2: UI Integration in `model-selector.vue`**:
   - Add `external-http` option to the Cloud source selector.
   - Add inline URL popover/input for catalog URL configuration.
   - Wire `remoteModelsCatalog` to consume the external catalog when selected.
3. **Phase 3: Download & Direct Ingestion**:
   - Implement `downloadExternalModel(model)`: stream binary, fetch thumbnail blob, persist directly to `localforage` without re-running preview rendering.
   - Verify selection and stage binding on download.
