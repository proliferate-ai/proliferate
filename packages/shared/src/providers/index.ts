/**
 * Sandbox Provider Factory
 *
 * Creates provider instances based on type or environment config.
 */

import { env } from "@proliferate/environment/server";
import type { SandboxProvider, SandboxProviderType } from "./contract";
import { E2BProvider } from "./e2b";
import { ModalLibmodalProvider } from "./modal-libmodal";

// Provider factory functions
const providers: Record<SandboxProviderType, () => SandboxProvider> = {
	modal: () => new ModalLibmodalProvider(),
	e2b: () => new E2BProvider(),
};

/**
 * Get a sandbox provider instance.
 *
 * @param type - Provider type. If not specified, uses DEFAULT_SANDBOX_PROVIDER env var, defaulting to 'modal'.
 * @returns SandboxProvider instance
 * @throws Error if provider type is unknown
 */
export function getSandboxProvider(type?: SandboxProviderType): SandboxProvider {
	const providerType = type ?? (env.DEFAULT_SANDBOX_PROVIDER as SandboxProviderType | undefined);
	if (!providerType) {
		throw new Error("DEFAULT_SANDBOX_PROVIDER is required when no provider type is supplied");
	}

	const factory = providers[providerType];
	if (!factory) {
		throw new Error(`Unknown sandbox provider: ${providerType}`);
	}

	return factory();
}

// Re-export provider classes for direct instantiation if needed
export { ModalLibmodalProvider, getModalAppName } from "./modal-libmodal";
export { E2BProvider } from "./e2b";

// Re-export types
export type { SandboxProvider, SandboxProviderType } from "./contract";
