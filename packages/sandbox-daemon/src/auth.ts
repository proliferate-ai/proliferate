/**
 * Auth — B7: session-scoped bearer token + signature validation.
 *
 * Gateway issues a session-scoped bearer token during boot, injected
 * as PROLIFERATE_SESSION_TOKEN. The daemon validates:
 *   1. Bearer token on all /_proliferate/* requests.
 *   2. X-Proliferate-Sandbox-Signature (HMAC) on gateway-originated requests.
 *
 * Token refresh is daemon-mediated; CLI/harness never hold long-lived
 * refresh credentials.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { NONCE_CACHE_MAX, NONCE_EXPIRY_WINDOW_MS } from "./config.js";

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

let currentToken: string | null = null;
let tokenExpiresAt: number | null = null;

export function setSessionToken(token: string, ttlMinutes: number): void {
	currentToken = token;
	tokenExpiresAt = Date.now() + ttlMinutes * 60_000;
}

export function getSessionToken(): string | null {
	if (currentToken && tokenExpiresAt && Date.now() > tokenExpiresAt) {
		// Token expired — gateway must rotate via refresh
		return null;
	}
	return currentToken;
}

export function isTokenValid(): boolean {
	return getSessionToken() !== null;
}

// ---------------------------------------------------------------------------
// Bearer token validation
// ---------------------------------------------------------------------------

export function validateBearerToken(authHeader: string | undefined): boolean {
	if (!currentToken) {
		// No token configured — allow (dev/testing mode)
		return true;
	}
	if (!authHeader) {
		return false;
	}
	const parts = authHeader.split(" ");
	if (parts.length !== 2 || parts[0] !== "Bearer") {
		return false;
	}
	const provided = Buffer.from(parts[1]);
	const expected = Buffer.from(currentToken);
	if (provided.length !== expected.length) {
		return false;
	}
	return timingSafeEqual(provided, expected);
}

// ---------------------------------------------------------------------------
// HMAC signature validation (gateway -> daemon requests)
// ---------------------------------------------------------------------------

let signatureSecret: string | null = null;

export function setSignatureSecret(secret: string): void {
	signatureSecret = secret;
}

/**
 * Nonce replay cache — bounded LRU-style set.
 * Maps nonce -> timestamp when it was first seen.
 */
const nonceCache = new Map<string, number>();

function pruneNonceCache(): void {
	const now = Date.now();
	// Remove expired entries first
	for (const [nonce, ts] of nonceCache) {
		if (now - ts > NONCE_EXPIRY_WINDOW_MS) {
			nonceCache.delete(nonce);
		}
	}
	// If still over limit, remove oldest
	if (nonceCache.size > NONCE_CACHE_MAX) {
		const entries = [...nonceCache.entries()].sort((a, b) => a[1] - b[1]);
		const toRemove = entries.slice(0, nonceCache.size - NONCE_CACHE_MAX);
		for (const [nonce] of toRemove) {
			nonceCache.delete(nonce);
		}
	}
}

export interface SignatureComponents {
	method: string;
	path: string;
	bodyHash: string;
	expiry: string;
	nonce: string;
	signature: string;
}

/**
 * Parse the X-Proliferate-Sandbox-Signature header.
 * Format: `method=GET,path=/...,body_hash=<sha256>,exp=<epoch_s>,nonce=<uuid>,sig=<hmac_hex>`
 */
export function parseSignatureHeader(header: string): SignatureComponents | null {
	const parts: Record<string, string> = {};
	for (const segment of header.split(",")) {
		const eqIdx = segment.indexOf("=");
		if (eqIdx === -1) continue;
		const key = segment.slice(0, eqIdx).trim();
		const value = segment.slice(eqIdx + 1).trim();
		parts[key] = value;
	}

	if (
		!parts.method ||
		!parts.path ||
		!parts.body_hash ||
		!parts.exp ||
		!parts.nonce ||
		!parts.sig
	) {
		return null;
	}

	return {
		method: parts.method,
		path: parts.path,
		bodyHash: parts.body_hash,
		expiry: parts.exp,
		nonce: parts.nonce,
		signature: parts.sig,
	};
}

export function validateSignature(
	method: string,
	path: string,
	bodyHash: string,
	components: SignatureComponents,
): boolean {
	if (!signatureSecret) {
		return false;
	}

	// Verify method and path match
	if (components.method !== method || components.path !== path) {
		return false;
	}

	// Verify body hash matches
	if (components.bodyHash !== bodyHash) {
		return false;
	}

	// Check expiry
	const expiryEpochS = Number(components.expiry);
	if (Number.isNaN(expiryEpochS) || Date.now() / 1000 > expiryEpochS) {
		return false;
	}

	// Check nonce replay
	if (nonceCache.has(components.nonce)) {
		return false;
	}

	// Verify HMAC
	const message = `${components.method}${components.path}${components.bodyHash}${components.expiry}${components.nonce}`;
	const expectedSig = createHmac("sha256", signatureSecret).update(message).digest("hex");
	const sigA = Buffer.from(components.signature, "hex");
	const sigB = Buffer.from(expectedSig, "hex");
	if (sigA.length !== sigB.length || !timingSafeEqual(sigA, sigB)) {
		return false;
	}

	// Accept nonce
	nonceCache.set(components.nonce, Date.now());
	pruneNonceCache();

	return true;
}

// ---------------------------------------------------------------------------
// HTTP middleware helper
// ---------------------------------------------------------------------------

/**
 * Authenticate an incoming platform transport request.
 * Returns true if request is authorized, false otherwise.
 * Writes 401 response on failure.
 */
export function authenticateRequest(req: IncomingMessage, res: ServerResponse): boolean {
	const authHeader = req.headers.authorization as string | undefined;
	if (validateBearerToken(authHeader)) {
		return true;
	}
	res.writeHead(401, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ error: "Unauthorized" }));
	return false;
}
