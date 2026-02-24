/**
 * Finalize setup handler — thin wrapper that delegates to configurations service.
 */

import { ORPCError } from "@orpc/server";
import { configurations } from "@proliferate/services";

export type FinalizeSetupInput = configurations.FinalizeSetupInput;
export type FinalizeSetupResult = configurations.FinalizeSetupResult;

export async function finalizeSetupHandler(
	input: FinalizeSetupInput,
): Promise<FinalizeSetupResult> {
	try {
		return await configurations.finalizeSetup(input);
	} catch (err) {
		if (err instanceof configurations.SessionNotFoundError) {
			throw new ORPCError("NOT_FOUND", { message: err.message });
		}
		if (err instanceof configurations.SetupSessionRequiredError) {
			throw new ORPCError("BAD_REQUEST", { message: err.message });
		}
		if (err instanceof configurations.NoSandboxError) {
			throw new ORPCError("BAD_REQUEST", { message: err.message });
		}
		if (
			err instanceof configurations.RepoIdRequiredError ||
			err instanceof configurations.AmbiguousRepoError
		) {
			throw new ORPCError("BAD_REQUEST", { message: err.message });
		}
		if (err instanceof configurations.SnapshotFailedError) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: err.message });
		}
		if (err instanceof configurations.RepoNotFoundError) {
			throw new ORPCError("NOT_FOUND", { message: err.message });
		}
		if (err instanceof configurations.SessionRepoMismatchError) {
			throw new ORPCError("NOT_FOUND", { message: err.message });
		}
		throw err;
	}
}
