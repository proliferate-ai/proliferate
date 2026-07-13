/**
 * Tier-3 local-runtime world: provisioner + the LOCAL-2 managed-gateway
 * vertical slice, built against the frozen foundation contracts.
 */

export { LocalRuntimeWorldProvisioner } from "./provisioner.js";
export type { LocalRuntimeProvisionerOptions } from "./provisioner.js";
export { runLocal2Cell, local2CellIdentity } from "./local-2.js";
export type { Local2Options } from "./local-2.js";
export {
  chooseCheapestEligibleModel,
  DEFAULT_QUALIFICATION_ALLOWLIST,
  NoEligibleModelError,
  isBareNativeSelector,
  cheapnessRank,
} from "./model-selection.js";
export type { EligibleModelChoice, QualificationAllowlist } from "./model-selection.js";
export { loadReleaseEnvironment, parseReleaseEnvironmentFile } from "./env.js";
export { redactSecrets, redactValue } from "./redaction.js";
