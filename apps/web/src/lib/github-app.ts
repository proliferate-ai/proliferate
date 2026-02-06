import { env } from "@proliferate/environment/server";
import { SignJWT } from "jose";

function requireEnvVar(value: string | undefined, name: string): string {
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

// Lazy-loaded to avoid throwing at module load time in non-GitHub contexts
let _appId: string | null = null;
let _privateKey: string | null = null;

function getAppId(): string {
	if (!_appId) {
		_appId = requireEnvVar(env.GITHUB_APP_ID, "GITHUB_APP_ID");
	}
	return _appId;
}

function getPrivateKey(): string {
	if (!_privateKey) {
		_privateKey = requireEnvVar(env.GITHUB_APP_PRIVATE_KEY, "GITHUB_APP_PRIVATE_KEY");
	}
	return _privateKey;
}

// Cache installation tokens (they're valid for 1 hour, we cache for 50 min)
// Note: This in-memory cache doesn't persist across serverless cold starts,
// but still helps reduce GitHub API calls within a single function instance.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const TOKEN_CACHE_DURATION_MS = 50 * 60 * 1000; // 50 minutes

/**
 * Generate a JWT for GitHub App authentication.
 * JWTs are valid for 10 minutes max per GitHub's requirements.
 */
async function generateAppJWT(): Promise<string> {
	const privateKey = getPrivateKey().replace(/\\n/g, "\n");

	const jwt = await new SignJWT({})
		.setProtectedHeader({ alg: "RS256" })
		.setIssuedAt()
		.setIssuer(getAppId())
		.setExpirationTime("10m")
		.sign(await importPrivateKey(privateKey));

	return jwt;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
	// Remove PEM headers and decode
	const pemContents = pem
		.replace(/-----BEGIN RSA PRIVATE KEY-----/, "")
		.replace(/-----END RSA PRIVATE KEY-----/, "")
		.replace(/-----BEGIN PRIVATE KEY-----/, "")
		.replace(/-----END PRIVATE KEY-----/, "")
		.replace(/\s/g, "");

	const binaryDer = Buffer.from(pemContents, "base64");

	// Try PKCS#8 first, fall back to PKCS#1
	try {
		return await crypto.subtle.importKey(
			"pkcs8",
			binaryDer,
			{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
			true,
			["sign"],
		);
	} catch {
		// PKCS#1 format - need to convert to PKCS#8
		// This is common for GitHub App private keys
		const pkcs8Der = convertPKCS1ToPKCS8(binaryDer);
		// Copy to a new ArrayBuffer to ensure compatibility with crypto.subtle.importKey
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
	// PKCS#8 header for RSA
	const pkcs8Header = new Uint8Array([
		0x30,
		0x82, // SEQUENCE
		0x00,
		0x00, // length placeholder (2 bytes)
		0x02,
		0x01,
		0x00, // INTEGER 0 (version)
		0x30,
		0x0d, // SEQUENCE (algorithm identifier)
		0x06,
		0x09,
		0x2a,
		0x86,
		0x48,
		0x86,
		0xf7,
		0x0d,
		0x01,
		0x01,
		0x01, // OID rsaEncryption
		0x05,
		0x00, // NULL
		0x04,
		0x82, // OCTET STRING
		0x00,
		0x00, // length placeholder (2 bytes)
	]);

	// Calculate lengths
	const pkcs1Length = pkcs1.length;
	const totalLength = pkcs8Header.length + pkcs1Length - 4; // -4 for the outer SEQUENCE header

	// Set lengths in header (create a mutable copy)
	const header = new Uint8Array(pkcs8Header);
	header[2] = (totalLength >> 8) & 0xff;
	header[3] = totalLength & 0xff;
	header[header.length - 2] = (pkcs1Length >> 8) & 0xff;
	header[header.length - 1] = pkcs1Length & 0xff;

	// Concatenate header and pkcs1
	const result = new Uint8Array(header.length + pkcs1.length);
	result.set(header, 0);
	result.set(pkcs1, header.length);
	return result;
}

/**
 * Get an installation access token for a GitHub App installation.
 * Tokens are cached for 50 minutes (they expire after 1 hour).
 */
export async function getInstallationToken(installationId: string): Promise<string> {
	// Check cache
	const cached = tokenCache.get(installationId);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.token;
	}

	// Generate new token
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

	// Cache the token
	tokenCache.set(installationId, {
		token,
		expiresAt: Date.now() + TOKEN_CACHE_DURATION_MS,
	});

	return token;
}

/**
 * Verify that a GitHub App installation exists and is accessible.
 */
export async function verifyInstallation(installationId: string): Promise<{
	id: number;
	account: {
		login: string;
		type: string;
	};
}> {
	const jwt = await generateAppJWT();

	const response = await fetch(`https://api.github.com/app/installations/${installationId}`, {
		headers: {
			Authorization: `Bearer ${jwt}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Failed to verify installation: ${error}`);
	}

	return response.json();
}

/**
 * List repositories accessible to an installation.
 */
export async function listInstallationRepos(installationId: string): Promise<{
	repositories: Array<{
		id: number;
		full_name: string;
		private: boolean;
		clone_url: string;
		html_url: string;
		default_branch: string;
	}>;
}> {
	const token = await getInstallationToken(installationId);

	const response = await fetch("https://api.github.com/installation/repositories", {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Failed to list repositories: ${error}`);
	}

	return response.json();
}

/**
 * Get the GitHub App installation URL for the configured app.
 */
export function getInstallationUrl(): string {
	return `https://github.com/apps/${env.NEXT_PUBLIC_GITHUB_APP_SLUG}/installations/new`;
}

/**
 * Get the callback URL for GitHub App installation.
 */
export function getCallbackUrl(): string {
	return `${env.NEXT_PUBLIC_APP_URL}/api/integrations/github/callback`;
}
