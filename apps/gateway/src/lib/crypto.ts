import { createDecipheriv } from "crypto";

export function decryptSecret(encrypted: string, keyHex: string): string {
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
