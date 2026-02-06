import { NextResponse } from "next/server";

export async function GET() {
	throw new Error("Sentry Test: Server-side API error thrown intentionally!");
}
