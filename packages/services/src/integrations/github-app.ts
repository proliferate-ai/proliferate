/**
 * GitHub App token utilities.
 *
 * Get installation access tokens for GitHub App integrations.
 */

import { env } from "@proliferate/environment/server";
import { SignJWT } from "jose";

// ============================================
// Private Key Import
// ============================================

async function importPrivateKey(pem: string): Promise<CryptoKey> {
	const pemContents = pem
		.replace(/-----BEGIN RSA PRIVATE KEY-----/, "")
		.replace(/-----END RSA PRIVATE KEY-----/, "")
		.replace(/-----BEGIN PRIVATE KEY-----/, "")
		.replace(/-----END PRIVATE KEY-----/, "")
		.replace(/\s/g, "");

	const binaryDer = Buffer.from(pemContents, "base64");

	try {
		return await crypto.subtle.importKey(
			"pkcs8",
			binaryDer,
			{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
			true,
			["sign"],
		);
	} catch {
		const pkcs8Der = convertPKCS1ToPKCS8(binaryDer);
		const arrayBuffer = new ArrayBuffer(pkcs8Der.byteLength);
		new Uint8Array(arrayBuffer).set(pkcs8Der);
		return await crypto.subtle.importKey(
			"pkcs8",
			arrayBuffer,
			{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
			true,
			["sign"],
		);
	}
}

function convertPKCS1ToPKCS8(pkcs1: Uint8Array): Uint8Array {
	const pkcs8Header = new Uint8Array([
		0x30, 0x82, 0x00, 0x00, 0x02, 0x01, 0x00, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7,
		0x0d, 0x01, 0x01, 0x01, 0x05, 0x00, 0x04, 0x82, 0x00, 0x00,
	]);

	const pkcs1Length = pkcs1.length;
	const totalLength = pkcs8Header.length + pkcs1Length - 4;

	const header = new Uint8Array(pkcs8Header);
	header[2] = (totalLength >> 8) & 0xff;
	header[3] = totalLength & 0xff;
	header[header.length - 2] = (pkcs1Length >> 8) & 0xff;
	header[header.length - 1] = pkcs1Length & 0xff;

	const result = new Uint8Array(header.length + pkcs1.length);
	result.set(header, 0);
	result.set(pkcs1, header.length);
	return result;
}

// ============================================
// JWT Generation
// ============================================

async function generateAppJWT(): Promise<string> {
	if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
		throw new Error("Missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY");
	}

	const privateKey = env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");

	return new SignJWT({})
		.setProtectedHeader({ alg: "RS256" })
		.setIssuedAt()
		.setIssuer(env.GITHUB_APP_ID)
		.setExpirationTime("10m")
		.sign(await importPrivateKey(privateKey));
}

// ============================================
// Token Cache
// ============================================

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const TOKEN_CACHE_DURATION_MS = 50 * 60 * 1000; // 50 minutes

// ============================================
// Public API
// ============================================

/**
 * Get an installation access token for a GitHub App installation.
 * Tokens are cached for 50 minutes (they expire after 1 hour).
 */
export async function getInstallationToken(installationId: string): Promise<string> {
	const cached = tokenCache.get(installationId);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.token;
	}

	const jwt = await generateAppJWT();

	const response = await fetch(
		`https://api.github.com/app/installations/${installationId}/access_tokens`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${jwt}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
		},
	);

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Failed to get installation token: ${error}`);
	}

	const data = await response.json();
	const token = data.token;

	tokenCache.set(installationId, {
		token,
		expiresAt: Date.now() + TOKEN_CACHE_DURATION_MS,
	});

	return token;
}
