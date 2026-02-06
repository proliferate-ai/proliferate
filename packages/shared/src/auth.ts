import { type JWTPayload, SignJWT, decodeJwt, importJWK, jwtVerify } from "jose";

export interface TokenPayload extends JWTPayload {
	sub: string;
	email?: string;
	role?: string;
	service?: boolean;
}

interface JWK {
	kty: string;
	crv?: string;
	x?: string;
	y?: string;
	kid?: string;
	alg?: string;
	use?: string;
}

interface JWKS {
	keys: JWK[];
}

/**
 * Verify a JWT token (ES256 or HS256)
 * Returns the payload if valid, null if invalid
 *
 * For ES256 tokens, fetches public keys from the JWKS endpoint.
 * For HS256 tokens, uses the provided secret directly.
 */
export async function verifyToken(token: string, jwtSecret: string): Promise<TokenPayload | null> {
	try {
		// First, decode without verification to check the algorithm
		const decoded = decodeJwt(token);

		if (!decoded.sub) {
			console.log("No sub in token");
			return null;
		}

		// Check if this is an ES256 token (requires JWKS verification)
		const header = JSON.parse(atob(token.split(".")[0]));
		console.log("JWT header:", header);

		if (header.alg === "ES256") {
			// For ES256, we need to verify using the JWKS endpoint
			const issuer = decoded.iss as string;
			console.log("JWT issuer:", issuer);

			if (!issuer) {
				console.log("No issuer in token");
				return null;
			}

			// Fetch JWKS directly
			const jwksUrl = `${issuer}/.well-known/jwks.json`;
			console.log("Fetching JWKS from:", jwksUrl);

			const jwksResponse = await fetch(jwksUrl);
			if (!jwksResponse.ok) {
				console.log("Failed to fetch JWKS:", jwksResponse.status);
				return null;
			}

			const jwks = (await jwksResponse.json()) as JWKS;
			console.log("JWKS keys count:", jwks.keys?.length);

			// Find the key that matches the kid
			const key = jwks.keys.find((k) => k.kid === header.kid);
			if (!key) {
				console.log("No matching key found for kid:", header.kid);
				return null;
			}

			// Import the key
			const publicKey = await importJWK(key, "ES256");

			// Verify the token
			const { payload } = await jwtVerify(token, publicKey, {
				issuer,
				audience: "authenticated",
			});

			console.log("Token verified successfully, sub:", payload.sub);
			return payload as TokenPayload;
		}
		// For HS256, use the secret directly
		const secretKey = new TextEncoder().encode(jwtSecret);
		const { payload } = await jwtVerify(token, secretKey);

		if (!payload.sub) {
			return null;
		}

		return payload as TokenPayload;
	} catch (err) {
		console.error("JWT verification error:", err instanceof Error ? err.message : err);
		return null;
	}
}

/**
 * Verify an internal service token
 * Used for sandbox -> Gateway and API -> Gateway communication
 */
export function verifyInternalToken(authHeader: string | null, expectedSecret: string): boolean {
	if (!authHeader) {
		return false;
	}

	const token = authHeader.replace("Bearer ", "");
	return token === expectedSecret;
}

/**
 * Sign a service-to-service JWT token
 * Used for worker -> Gateway authentication
 *
 * @param serviceName - Identifier for the calling service (e.g., "slack-worker")
 * @param jwtSecret - The shared secret used for HS256 signing
 * @param expiresIn - Token expiration (default: "1h")
 */
export async function signServiceToken(
	serviceName: string,
	jwtSecret: string,
	expiresIn = "1h",
): Promise<string> {
	const secretKey = new TextEncoder().encode(jwtSecret);

	return await new SignJWT({
		sub: serviceName,
		service: true,
	})
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setExpirationTime(expiresIn)
		.sign(secretKey);
}
