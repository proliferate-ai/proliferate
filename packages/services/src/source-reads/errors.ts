/**
 * Source reads error classes.
 *
 * Typed errors thrown by the source-reads service, each carrying a
 * machine-readable `code` field for downstream error mapping.
 */

export class CredentialMissingError extends Error {
	readonly code = "CREDENTIAL_MISSING";

	constructor(sourceType: string, bindingId: string) {
		super(`No credential available for source ${sourceType} (binding: ${bindingId})`);
	}
}

export class IntegrationRevokedError extends Error {
	readonly code = "INTEGRATION_REVOKED";

	constructor(integrationId: string) {
		super(`Integration ${integrationId} is not active`);
	}
}

export class SourceTypeUnsupportedError extends Error {
	readonly code = "SOURCE_TYPE_UNSUPPORTED";

	constructor(sourceType: string) {
		super(`Unsupported source type: ${sourceType}`);
	}
}

export class BindingNotFoundError extends Error {
	readonly code = "BINDING_NOT_FOUND";

	constructor(bindingId: string) {
		super(`Source binding not found: ${bindingId}`);
	}
}
