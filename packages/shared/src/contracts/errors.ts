/**
 * V1 canonical error taxonomy.
 */

export const V1_ERROR_CODES = [
	"CAPABILITY_NOT_VISIBLE",
	"POLICY_DENIED",
	"APPROVAL_EXPIRED",
	"INTEGRATION_REVOKED",
	"CREDENTIAL_MISSING",
	"CONNECTOR_DISABLED",
	"SANDBOX_RESUME_FAILED",
	"SANDBOX_LOST",
	"BASELINE_STALE",
	"BUDGET_EXHAUSTED",
] as const;
export type V1ErrorCode = (typeof V1_ERROR_CODES)[number];

export function isV1ErrorCode(code: string): code is V1ErrorCode {
	return (V1_ERROR_CODES as readonly string[]).includes(code);
}
