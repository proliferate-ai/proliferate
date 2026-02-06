import { Nango } from "@nangohq/node";
import { SignJWT } from "jose";
import type { GatewayEnv } from "./env";

export interface GitHubIntegration {
	id: string;
	github_installation_id: string | null;
	connection_id: string | null;
	created_by?: string | null;
	status?: string | null;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const tokenCacheDurationMs = 50 * 60 * 1000;

let cachedNango: Nango | null = null;

function getNangoClient(env: GatewayEnv): Nango {
	if (!cachedNango) {
		if (!env.nangoSecretKey) {
			throw new Error("NANGO_SECRET_KEY is required for Nango auth");
		}
		cachedNango = new Nango({
			secretKey: env.nangoSecretKey,
		});
	}
	return cachedNango;
}

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
		const pkcs8Der = convertPkcs1ToPkcs8(binaryDer);
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

function convertPkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
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

async function generateAppJwt(env: GatewayEnv): Promise<string> {
	if (!env.githubAppId || !env.githubAppPrivateKey) {
		throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required for GitHub App auth");
	}

	const privateKey = env.githubAppPrivateKey.replace(/\\n/g, "\n");

	return new SignJWT({})
		.setProtectedHeader({ alg: "RS256" })
		.setIssuedAt()
		.setIssuer(env.githubAppId)
		.setExpirationTime("10m")
		.sign(await importPrivateKey(privateKey));
}

async function getInstallationToken(env: GatewayEnv, installationId: string): Promise<string> {
	const cached = tokenCache.get(installationId);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.token;
	}

	const jwt = await generateAppJwt(env);
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

	const data = (await response.json()) as { token: string };
	const token = data.token;

	tokenCache.set(installationId, {
		token,
		expiresAt: Date.now() + tokenCacheDurationMs,
	});

	return token;
}

export async function getGitHubTokenForIntegration(
	env: GatewayEnv,
	integration: GitHubIntegration,
): Promise<string> {
	if (integration.github_installation_id) {
		return getInstallationToken(env, integration.github_installation_id);
	}

	if (integration.connection_id) {
		const nango = getNangoClient(env);
		if (!env.nangoGithubIntegrationId) {
			throw new Error("Nango GitHub integration ID is not configured");
		}
		const connection = await nango.getConnection(
			env.nangoGithubIntegrationId,
			integration.connection_id,
		);

		const credentials = connection.credentials as { access_token?: string };
		if (!credentials.access_token) {
			throw new Error("No access token available from Nango connection");
		}

		return credentials.access_token;
	}

	throw new Error("No GitHub credentials available for integration");
}

export async function getNangoConnectionToken(
	env: GatewayEnv,
	integrationId: string,
	connectionId: string,
): Promise<string> {
	const nango = getNangoClient(env);
	const connection = await nango.getConnection(integrationId, connectionId);
	const credentials = connection.credentials as {
		access_token?: string;
		accessToken?: string;
		token?: string;
	};

	const token = credentials.access_token ?? credentials.accessToken ?? credentials.token;
	if (!token) {
		throw new Error("No access token available from Nango connection");
	}

	return token;
}
