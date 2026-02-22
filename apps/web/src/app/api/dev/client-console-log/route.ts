import { appendFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

interface ConsoleLogBody {
	scope?: unknown;
	event?: unknown;
	payload?: unknown;
	timestamp?: unknown;
	href?: unknown;
}

export const runtime = "nodejs";

export async function POST(request: Request) {
	if (process.env.NODE_ENV === "production") {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	let body: ConsoleLogBody | null = null;
	try {
		body = (await request.json()) as ConsoleLogBody;
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	if (!body || typeof body.event !== "string" || !body.event.trim()) {
		return NextResponse.json({ error: "event is required" }, { status: 400 });
	}

	const timestamp =
		typeof body.timestamp === "string" && body.timestamp.trim()
			? body.timestamp
			: new Date().toISOString();
	const scope =
		typeof body.scope === "string" && body.scope.trim() ? body.scope.trim() : "web-console";
	const href = typeof body.href === "string" ? body.href : "";
	const payload = safeJsonStringify(body.payload);

	const line = `${timestamp}\t${scope}\t${body.event}\t${href}\t${payload}\n`;
	const filePath = resolveConsoleLogPath();

	try {
		await appendFile(filePath, line, "utf8");
	} catch {
		return NextResponse.json({ error: "Failed to write console log" }, { status: 500 });
	}

	return NextResponse.json({ ok: true });
}

function resolveConsoleLogPath(): string {
	const configured = process.env.DEV_CONSOLE_LOG_PATH;
	if (configured?.trim()) {
		return path.resolve(configured);
	}
	const cwd = process.cwd();
	if (cwd.endsWith(`${path.sep}apps${path.sep}web`)) {
		return path.resolve(cwd, "..", "..", "console.txt");
	}
	return path.resolve(cwd, "console.txt");
}

function safeJsonStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return JSON.stringify({ unserializable: true });
	}
}
