import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getProliferateDir } from "../state/config.ts";
import { getDeviceId } from "./device.ts";

const SSH_KEY_PATH = join(getProliferateDir(), "id_ed25519");
const SSH_KEY_PUB_PATH = `${SSH_KEY_PATH}.pub`;

export interface SSHKeyInfo {
	privateKeyPath: string;
	publicKeyPath: string;
	publicKey: string;
	fingerprint: string;
}

// Check if SSH key exists
export function hasSSHKey(): boolean {
	return existsSync(SSH_KEY_PATH) && existsSync(SSH_KEY_PUB_PATH);
}

// Generate SSH key pair
export function generateSSHKey(): SSHKeyInfo {
	if (hasSSHKey()) {
		return getSSHKeyInfo();
	}

	// Generate ed25519 key with no passphrase
	execSync(`ssh-keygen -t ed25519 -f "${SSH_KEY_PATH}" -N "" -C "proliferate-cli"`, {
		stdio: "pipe",
	});

	return getSSHKeyInfo();
}

// Get SSH key info
export function getSSHKeyInfo(): SSHKeyInfo {
	if (!hasSSHKey()) {
		throw new Error("SSH key does not exist. Run generateSSHKey() first.");
	}

	const publicKey = readFileSync(SSH_KEY_PUB_PATH, "utf-8").trim();

	// Get fingerprint using ssh-keygen
	const fingerprint = execSync(`ssh-keygen -lf "${SSH_KEY_PUB_PATH}"`, {
		encoding: "utf-8",
	})
		.trim()
		.split(" ")[1]; // Format: "256 SHA256:xxx comment (ED25519)"

	return {
		privateKeyPath: SSH_KEY_PATH,
		publicKeyPath: SSH_KEY_PUB_PATH,
		publicKey,
		fingerprint,
	};
}

// Hash the current directory path for session matching
export function hashLocalPath(path: string): string {
	return createHash("sha256").update(path).digest("hex").slice(0, 16);
}

/**
 * Hash for device-scoped prebuilds.
 * Includes device ID so same path on different machines gets different prebuilds.
 */
export function hashPrebuildPath(path: string): string {
	const deviceId = getDeviceId();
	const input = `${deviceId}::${path}`;
	return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
