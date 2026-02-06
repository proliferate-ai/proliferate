import { createHmac, timingSafeEqual } from "crypto";
import type { Request } from "express";

export interface NangoForwardWebhook {
	type: "forward";
	from: string; // e.g. "linear", "github"
	connectionId: string;
	providerConfigKey: string; // e.g. "linear", "github"
	payload: Record<string, unknown>;
}

export interface NangoWebhookEnvelope {
	type: "auth" | "sync" | "forward";
	connectionId: string;
	providerConfigKey: string;
	payload?: Record<string, unknown>;
	from?: string;
	[k: string]: unknown;
}

export function getRawBody(req: Request): string {
	const raw = (req as Request & { rawBody?: string }).rawBody;
	if (raw) return raw;
	// Fallback: best-effort stringify
	return typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
}

export function verifyNangoSignature(body: string, signature: string, secret: string): boolean {
	const hmac = createHmac("sha256", secret).update(body).digest("hex");
	try {
		return timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
	} catch {
		return false;
	}
}

export function parseNangoForwardWebhook(req: Request): NangoForwardWebhook | null {
	const body = req.body as NangoWebhookEnvelope | null;
	if (!body || body.type !== "forward") return null;
	if (!body.payload) return null;
	return {
		type: "forward",
		from: body.from ?? body.providerConfigKey,
		connectionId: body.connectionId,
		providerConfigKey: body.providerConfigKey,
		payload: body.payload as Record<string, unknown>,
	};
}
