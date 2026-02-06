import { env } from "@proliferate/environment/server";
import { NextResponse } from "next/server";

export async function GET() {
	if (!env.TRIGGER_SERVICE_URL) {
		return NextResponse.json({ error: "Trigger service not configured" }, { status: 503 });
	}
	const baseUrl = env.TRIGGER_SERVICE_URL.replace(/\/$/, "");
	const response = await fetch(`${baseUrl}/providers`, {
		headers: { "Content-Type": "application/json" },
		cache: "no-store",
	});

	if (!response.ok) {
		const text = await response.text();
		return NextResponse.json(
			{ error: "Failed to fetch trigger providers", details: text },
			{ status: response.status },
		);
	}

	const data = await response.json();
	return NextResponse.json(data);
}
