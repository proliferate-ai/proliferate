/**
 * Sandbox Provider Factory
 *
 * E2B is the sole sandbox provider.
 */

import type { SandboxProvider, SandboxProviderType } from "./types";
import { E2BProvider } from "./e2b";

/**
 * Get a sandbox provider instance.
 * Always returns E2B — the type parameter exists for DB column compatibility.
 */
export function getSandboxProvider(_type?: SandboxProviderType): SandboxProvider {
	return new E2BProvider();
}

export { E2BProvider } from "./e2b";

export type { SandboxProvider, SandboxProviderType } from "./types";