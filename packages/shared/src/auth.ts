import { type JWTPayload, SignJWT, jwtVerify } from "jose";

export interface TokenPayload extends JWTPayload {
	sub: string;
	email?: string;
	orgId?: string;
	role?: string;
	service?: boolean;
}

/**
 * Verify a JWT token (HS256 only).
 *
 * Returns the payload if valid, null if invalid.
 */
export async function verifyToken(token: string, jwtSecret: string): Promise<TokenPayload | null> {
	try {
		const secretKey = new TextEncoder().encode(jwtSecret);
		const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] });

		if (!payload.sub) {
			return null;
		}

		return payload as TokenPayload;
	} catch {
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
