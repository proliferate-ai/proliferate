import { sourceReads } from "@proliferate/services";
import { ApiError } from "../../../../../middleware/errors";

export function mapSourceReadError(error: unknown): never {
	if (error instanceof sourceReads.BindingNotFoundError) {
		throw new ApiError(404, error.message);
	}
	if (error instanceof sourceReads.CredentialMissingError) {
		throw new ApiError(502, error.message, { code: error.code });
	}
	if (error instanceof sourceReads.SourceTypeUnsupportedError) {
		throw new ApiError(400, error.message, { code: error.code });
	}
	throw error;
}
