import { requireAuth } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { SignJWT } from "jose";
import { NextResponse } from "next/server";

const log = logger.child({ route: "verification-media" });

const JWT_SECRET = process.env.GATEWAY_JWT_SECRET;
const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL;
const TOKEN_LIFETIME = "1h";

function extractSessionId(keyOrPrefix: string): string {
	const match = keyOrPrefix.match(/^sessions\/([^/]+)\//);
	if (!match) {
		throw new Error("Invalid key format - cannot extract session ID");
	}
	return match[1];
}

export async function GET(req: Request) {
	const authResult = await requireAuth();
	if ("error" in authResult) {
		return NextResponse.json({ error: authResult.error }, { status: authResult.status });
	}

	if (!JWT_SECRET) {
		log.error("Missing GATEWAY_JWT_SECRET");
		return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
	}

	if (!GATEWAY_URL) {
		log.error("Missing NEXT_PUBLIC_GATEWAY_URL");
		return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
	}

	const { searchParams } = new URL(req.url);
	const key = searchParams.get("key");
	if (!key) {
		return NextResponse.json({ error: "Missing key parameter" }, { status: 400 });
	}

	let sessionId: string;
	try {
		sessionId = extractSessionId(key);
	} catch (error) {
		return NextResponse.json({ error: (error as Error).message }, { status: 400 });
	}

	const userId = authResult.session.user.id;
	const email = authResult.session.user.email || undefined;

	const token = await new SignJWT({ sub: userId, email })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setExpirationTime(TOKEN_LIFETIME)
		.sign(new TextEncoder().encode(JWT_SECRET));

	const baseUrl = GATEWAY_URL.replace(/^ws:\/\//, "http://")
		.replace(/^wss:\/\//, "https://")
		.replace(/\/$/, "");
	const gatewayUrl = `${baseUrl}/proliferate/${sessionId}/verification-media?key=${encodeURIComponent(
		key,
	)}&stream=true`;

	const gatewayResponse = await fetch(gatewayUrl, {
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});

	if (!gatewayResponse.ok) {
		const errorText = await gatewayResponse.text();
		return NextResponse.json(
			{ error: `Gateway error: ${gatewayResponse.status} - ${errorText}` },
			{ status: gatewayResponse.status },
		);
	}

	const headers = new Headers();
	const contentType = gatewayResponse.headers.get("content-type");
	const cacheControl = gatewayResponse.headers.get("cache-control");
	const contentLength = gatewayResponse.headers.get("content-length");

	if (contentType) headers.set("content-type", contentType);
	if (cacheControl) headers.set("cache-control", cacheControl);
	if (contentLength) headers.set("content-length", contentLength);

	return new Response(gatewayResponse.body, {
		status: gatewayResponse.status,
		headers,
	});
}
