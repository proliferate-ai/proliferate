import { requireAuth } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { cli } from "@proliferate/services";
import { NextResponse } from "next/server";

const log = logger.child({ route: "cli/ssh-keys" });

interface SshKeyBody {
	publicKey?: unknown;
	name?: unknown;
}

function parseBody(body: unknown): { publicKey: string; name?: string } | null {
	if (!body || typeof body !== "object") {
		return null;
	}
	const parsed = body as SshKeyBody;
	if (typeof parsed.publicKey !== "string" || parsed.publicKey.trim().length === 0) {
		return null;
	}
	const name = typeof parsed.name === "string" ? parsed.name : undefined;
	return { publicKey: parsed.publicKey, name };
}

export async function POST(request: Request) {
	const authResult = await requireAuth();
	if ("error" in authResult) {
		return NextResponse.json({ error: authResult.error }, { status: authResult.status });
	}

	let parsed: { publicKey: string; name?: string } | null = null;
	try {
		parsed = parseBody(await request.json());
	} catch {
		return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
	}

	if (!parsed) {
		return NextResponse.json({ error: "publicKey is required" }, { status: 400 });
	}

	try {
		const key = await cli.createSshKey(authResult.session.user.id, parsed.publicKey, parsed.name);
		return NextResponse.json({ key });
	} catch (err) {
		const code = (err as { code?: string })?.code;
		if (code === "23505") {
			return NextResponse.json({ error: "SSH key already registered" }, { status: 409 });
		}
		if (err instanceof Error && err.message.includes("Invalid SSH")) {
			return NextResponse.json({ error: err.message }, { status: 400 });
		}
		log.error({ err }, "Failed to create SSH key");
		return NextResponse.json({ error: "Failed to store SSH key" }, { status: 500 });
	}
}
