import type { ActionDefinition } from "@proliferate/providers";
import { zodToJsonSchema } from "@proliferate/providers/helpers/schema";
import { actions } from "@proliferate/services";
import { ApiError } from "../../../../../middleware/errors";

export function actionToResponse(action: ActionDefinition) {
	return {
		name: action.id,
		description: action.description,
		riskLevel: action.riskLevel,
		params: zodToJsonSchema(action.params),
	};
}

export function mapActionMutationError(error: unknown): never {
	if (error instanceof actions.ActionNotFoundError) throw new ApiError(404, error.message);
	if (error instanceof actions.ActionExpiredError) throw new ApiError(410, error.message);
	if (error instanceof actions.ActionConflictError) throw new ApiError(409, error.message);
	if (error instanceof actions.ApprovalAuthorityError) throw new ApiError(403, error.message);
	throw error;
}

export function mapActionExecutionError(error: unknown): never {
	const message = error instanceof Error ? error.message : String(error);
	throw new ApiError(502, `Action failed: ${message}`);
}
