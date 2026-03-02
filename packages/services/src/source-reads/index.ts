/**
 * Source reads module.
 *
 * Public API for source-read operations.
 */

export {
	listBindings,
	querySource,
	getSourceItem,
	CredentialMissingError,
	IntegrationRevokedError,
	SourceTypeUnsupportedError,
	BindingNotFoundError,
	type SourceBinding,
} from "./service";

export type {
	NormalizedSourceItem,
	SourceQueryResult,
	SourceType,
} from "./normalizers";

export { SUPPORTED_SOURCE_TYPES, getNormalizer } from "./normalizers";
