/**
 * Encryption utilities for secrets.
 *
 * Uses AES-256-GCM for secure encryption.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { env } from "@proliferate/environment/server";

/**
 * Encrypt a string using AES-256-GCM.
 * Returns format: iv:authTag:encryptedText (all hex encoded)
 */
export function encrypt(text: string, keyHex: string): string {
	const key = Buffer.from(keyHex, "hex");
	const iv = randomBytes(16);
	const cipher = createCipheriv("aes-256-gcm", key, iv);

	let encrypted = cipher.update(text, "utf8", "hex");
	encrypted += cipher.final("hex");
	const authTag = cipher.getAuthTag().toString("hex");

	return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a string encrypted with encrypt().
 * Expects format: iv:authTag:encryptedText (all hex encoded)
 */
export function decrypt(encrypted: string, keyHex: string): string {
	const [ivHex, authTagHex, encryptedText] = encrypted.split(":");
	if (!ivHex || !authTagHex || !encryptedText) {
		throw new Error("Invalid encrypted format");
	}

	const key = Buffer.from(keyHex, "hex");
	const iv = Buffer.from(ivHex, "hex");
	const authTag = Buffer.from(authTagHex, "hex");

	const decipher = createDecipheriv("aes-256-gcm", key, iv);
	decipher.setAuthTag(authTag);

	let decrypted = decipher.update(encryptedText, "hex", "utf8");
	decrypted += decipher.final("utf8");

	return decrypted;
}

/**
 * Get the encryption key from environment.
 * Throws if not configured.
 */
export function getEncryptionKey(): string {
	const key = env.USER_SECRETS_ENCRYPTION_KEY;
	if (!key) {
		throw new Error("USER_SECRETS_ENCRYPTION_KEY not configured");
	}
	if (key.length !== 64) {
		throw new Error("USER_SECRETS_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
	}
	return key;
}
