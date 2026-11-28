/**
 * The stub fixture's renderer entry modules, as the loader table resolves them.
 *
 * A fourth subpath (`./testing/components`) rather than part of `./testing` for one reason: these import `vue`,
 * and the harness (`./testing`) is imported by suites that run in plain Node with no Vue at all. Keeping them
 * apart means the fixture's protocol half stays runnable everywhere and its component half is loaded only by a
 * window that will actually mount it.
 */
import type { ModelPickerComponentModule } from '../../contract/components'
import type { RendererMountComponentModule } from '../../contract/renderer-mount'
import type { DriverPanelsModule } from '../loaders'

import { STUB_PANEL_DECLARATIONS, StubMountComponent, StubPickerComponent } from './stub-components'

/** What `STUB_MOUNT_SPECIFIER` resolves to: the mount component the host mounts. */
export const stubMountModule: RendererMountComponentModule = { default: StubMountComponent }

/** What `STUB_PANEL_SPECIFIER` resolves to. */
export const stubPanelsModule: DriverPanelsModule = { declarations: () => STUB_PANEL_DECLARATIONS }

/** What `STUB_PICKER_SPECIFIER` resolves to. */
export const stubPickerModule: ModelPickerComponentModule = { default: StubPickerComponent }

export { STUB_PANEL_DECLARATIONS, StubMountComponent, StubPanelComponent, StubPickerComponent } from './stub-components'
