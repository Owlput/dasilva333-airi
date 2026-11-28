/**
 * The mount entry: what the renderer's loader table resolves for `@proj-airi/model-driver-live2d/mount`.
 *
 * A module whose default export is the component, exactly as `RendererMountComponentModule` requires. Kept apart
 * from the provider so starting a driver entry never imports Pixi or a `.vue` file.
 */
import Live2DMount from './Live2DMount.vue'

export default Live2DMount
