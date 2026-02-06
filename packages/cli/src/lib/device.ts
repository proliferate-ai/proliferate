import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, getProliferateDir } from "../state/config.ts";

const DEVICE_ID_FILE = "device-id";

/**
 * Get the device ID for this machine.
 * Generated once and stored in ~/.proliferate/device-id
 * Used to scope prebuilds per device (same path on different machines = different prebuilds)
 */
export function getDeviceId(): string {
	ensureDir();
	const deviceIdPath = join(getProliferateDir(), DEVICE_ID_FILE);

	if (existsSync(deviceIdPath)) {
		return readFileSync(deviceIdPath, "utf-8").trim();
	}

	// Generate device ID: random UUID (8 chars is enough for uniqueness per user)
	const deviceId = randomUUID().slice(0, 8);
	writeFileSync(deviceIdPath, deviceId, { mode: 0o600 });
	return deviceId;
}
