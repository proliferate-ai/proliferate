/**
 * Hub Types
 *
 * Types specific to the hub module.
 */

import type { ClientSource } from "@proliferate/shared";

/**
 * Options for sending a prompt
 */
export interface PromptOptions {
	images?: Array<{ data: string; mediaType: string }>;
	source?: ClientSource;
}

/**
 * Migration state for sandbox lifecycle
 */
export type MigrationState = "normal" | "migrating";

/**
 * Migration configuration
 */
export const MigrationConfig = {
	/** Time before expiration to start migration */
	GRACE_MS: 5 * 60 * 1000, // 5 minutes

	/** How often to check for migration need */
	CHECK_INTERVAL_MS: 30_000, // 30 seconds

	/** How long to wait for message completion before migrating */
	MESSAGE_COMPLETE_TIMEOUT_MS: 30_000, // 30 seconds
} as const;
