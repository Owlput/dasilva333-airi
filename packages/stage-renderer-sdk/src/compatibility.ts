/**
 * Contract compatibility: the predicate the host applies when it **reads a declaration**, before any
 * driver code runs (RFC §6.2, C14).
 *
 * Two rules, and they are different rules on purpose:
 *
 *   - **below 1.0** the minor version must match exactly. Everything is still being reshaped, so a
 *     `0.0` driver and a `0.1` host are not two revisions of one contract — they are a draft and a
 *     published shape, and neither side can know what the other means by a field;
 *   - **from 1.0** the major version must match, and a lower minor is accepted: a driver built
 *     against an older minor of the same major runs, offering only what its revision defined
 *     (RFC §6.2). A patch difference is compatible by definition — `ModelDriverContractVersion` has
 *     no patch component, so a patch difference is not expressible and needs no rule.
 *
 * The rejection carries a readable reason rather than a code alone, because it is presented to the
 * user: an incompatible driver is not a crash, it is a driver this build cannot speak to, and the
 * user's action is to update AIRI or the driver.
 */
import type { ContractFailure, ContractResult, ModelDriverContractVersion } from './contract/shared'

import { ContractFailureCode, MODEL_DRIVER_CONTRACT_VERSION } from './contract/shared'

/** `major.minor`, for messages a person reads. */
export function formatContractVersion(version: ModelDriverContractVersion): string {
  return `${version.major}.${version.minor}`
}

/**
 * Whether the host can speak to a driver that declares `declared`.
 *
 * Returns the declared revision on success — the host's own is only the thing it is compared
 * against, and handing back the declaration keeps the caller from restating which version it speaks.
 *
 * `host` exists so the predicate is testable without pretending to be a different build; production
 * leaves it out and compares against `MODEL_DRIVER_CONTRACT_VERSION`.
 */
export function isContractCompatible(
  declared: ModelDriverContractVersion,
  host: ModelDriverContractVersion = MODEL_DRIVER_CONTRACT_VERSION,
): ContractResult<ModelDriverContractVersion> {
  const declaredText = formatContractVersion(declared)
  const hostText = formatContractVersion(host)

  if (declared.major < 1 && host.major < 1) {
    if (declared.minor === host.minor)
      return { ok: true, value: declared }

    return {
      ok: false,
      error: contractMismatch(
        `Contract ${declaredText} is not compatible with this build (${hostText}): below 1.0 the minor version must match exactly. `
        + 'A 0.x driver was built against a draft of the contract and must be rebuilt against the published shape.',
      ),
    }
  }

  if (declared.major >= 1 && host.major >= 1) {
    if (declared.major === host.major && declared.minor <= host.minor)
      return { ok: true, value: declared }

    if (declared.major === host.major) {
      return {
        ok: false,
        error: contractMismatch(
          `Contract ${declaredText} is newer than this build (${hostText}) and uses a minor revision this build does not know. `
          + 'Update AIRI, or install a driver built against a minor revision this build ships.',
        ),
      }
    }

    return {
      ok: false,
      error: contractMismatch(
        `Contract ${declaredText} is not compatible with this build (${hostText}): from 1.0 the major version must match.`,
      ),
    }
  }

  // One side is pre-1.0 and the other is not: there is no crossing rule, and inventing one would
  // mean guessing whether a draft field survived into the published shape.
  return {
    ok: false,
    error: contractMismatch(
      `Contract ${declaredText} is not compatible with this build (${hostText}): a pre-1.0 revision cannot be paired with a 1.0-or-later one.`,
    ),
  }
}

function contractMismatch(message: string): ContractFailure {
  return { code: ContractFailureCode.CONTRACT_VERSION_MISMATCH, message }
}
