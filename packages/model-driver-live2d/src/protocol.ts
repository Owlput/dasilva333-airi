/**
 * The Live2D driver's private channel protocol.
 *
 * The host never parses these messages: `ManagerChannel` carries `unknown` from the manager in main to the
 * provider entry in a renderer, and the shape below is this driver's own convention (plan §4.3, stub-driver
 * `call`/`result`). Keeping the types in one module means the manager (DOM-free) and the provider (renderer)
 * cannot drift, and neither has to import the other half.
 */
import type {
  ContractFailure,
  CueEnvelope,
  CueWithdrawalReport,
  CueWithdrawalRequest,
  ModelSummary,
  MountCommand,
  MountCommandAnswer,
  MountQuery,
  MountQueryAnswer,
  MountSelection,
} from '@proj-airi/stage-renderer-sdk'

/** One call from the manager (main) to the provider entry (a renderer window). */
export type Live2DManagerCall
  = | { type: 'call', id: number, method: 'list-models' }
    | { type: 'call', id: number, method: 'deliver', envelope: CueEnvelope }
    | { type: 'call', id: number, method: 'withdraw', request: CueWithdrawalRequest }
    | { type: 'call', id: number, method: 'query-mount', selection: MountSelection, query: MountQuery }
    | { type: 'call', id: number, method: 'command-mount', selection: MountSelection, command: MountCommand }

/** One answer, or one nudge, from the provider entry back to the manager. */
export type Live2DProviderReply
  = | { type: 'result', id: number, value: unknown }
    | { type: 'error', id: number, error: ContractFailure }
  /** "Read the authority again" — never the rows themselves (plan §4.3, `onModelsChanged`). */
    | { type: 'notify', method: 'models-changed' }

/** The value the manager receives for a `list-models` call. */
export type Live2DListModelsValue = ModelSummary[]
export type Live2DWithdrawValue = CueWithdrawalReport
export type Live2DQueryValue = MountQueryAnswer[]
export type Live2DCommandValue = MountCommandAnswer[]

export function isLive2DManagerCall(message: unknown): message is Live2DManagerCall {
  return typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === 'call'
    && typeof (message as { id?: unknown }).id === 'number'
}

export function isLive2DProviderReply(message: unknown): message is Live2DProviderReply {
  if (typeof message !== 'object' || message === null)
    return false
  const reply = message as { type?: unknown, id?: unknown, method?: unknown }
  if (reply.type === 'notify')
    return reply.method === 'models-changed'
  return (reply.type === 'result' || reply.type === 'error') && typeof reply.id === 'number'
}
