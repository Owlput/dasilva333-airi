/**
 * The picker entry (RFC 0002 §11, §5.6).
 *
 * The module's default export is what the host mounts, exactly as a mount module's is: `ModelPickerComponentModule`
 * is `{ default }`, so this file stays a re-export rather than a second component that could drift from the `.vue`.
 */
export { default } from './Live2DPicker.vue'
