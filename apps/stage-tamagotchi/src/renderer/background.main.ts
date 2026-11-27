/**
 * The background window's entry (§4.1, D11).
 *
 * It starts the model-driver adapter and nothing else. The window is hidden and never shown; what it exists for
 * is that a manager's `requestRenderer` has somewhere to run when no visible window can serve it, and that the
 * process keeps a normal frame budget while it does (`backgroundThrottling: false` is set by main).
 */
import { bootstrapModelDriverAdapter } from './libs/model-drivers'

void bootstrapModelDriverAdapter()
