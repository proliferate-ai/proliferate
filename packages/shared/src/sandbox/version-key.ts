/**
 * Base Snapshot Version Key
 *
 * Computes a deterministic hash of everything createBaseSnapshot() bakes into the
 * sandbox filesystem. When any input changes, a new base snapshot must be built.
 */

import { createHash } from "node:crypto";
import { getDefaultAgentConfig, toOpencodeModelId } from "../agents";
import { DEFAULT_CADDYFILE, PLUGIN_MJS } from "./config";
import { getOpencodeConfig } from "./opencode";

/**
 * Compute a deterministic version key for the base snapshot.
 *
 * Hashes: PLUGIN_MJS + DEFAULT_CADDYFILE + getOpencodeConfig(defaultModelId).
 * These are exactly the files written by ModalLibmodalProvider.createBaseSnapshot().
 */
export function computeBaseSnapshotVersionKey(): string {
	const agentConfig = getDefaultAgentConfig();
	const opencodeModelId = toOpencodeModelId(agentConfig.modelId);
	const opencodeConfig = getOpencodeConfig(opencodeModelId);

	const hash = createHash("sha256");
	hash.update(PLUGIN_MJS);
	hash.update(DEFAULT_CADDYFILE);
	hash.update(opencodeConfig);
	return hash.digest("hex");
}
