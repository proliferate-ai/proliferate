const DEV_DEBUG = process.env.NODE_ENV !== "production";

interface DevConsoleLogOptions {
	persist?: boolean;
}

interface DevConsolePayload {
	scope: string;
	event: string;
	payload: Record<string, unknown>;
	timestamp: string;
	href: string | null;
}

export function devConsoleLog(
	scope: string,
	event: string,
	payload: Record<string, unknown>,
	options?: DevConsoleLogOptions,
): void {
	if (!DEV_DEBUG) {
		return;
	}

	console.debug(`[${scope}] ${event}`, payload);

	if (options?.persist === false) {
		return;
	}

	const body: DevConsolePayload = {
		scope,
		event,
		payload,
		timestamp: new Date().toISOString(),
		href: typeof window !== "undefined" ? window.location.href : null,
	};

	const json = safeJson(body);
	if (!json) {
		return;
	}

	const endpoint = "/api/dev/client-console-log";
	try {
		if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
			const blob = new Blob([json], { type: "application/json" });
			navigator.sendBeacon(endpoint, blob);
			return;
		}
	} catch {
		// Fall through to fetch.
	}

	void fetch(endpoint, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: json,
		keepalive: true,
	}).catch(() => {
		// Best-effort logging only.
	});
}

function safeJson(value: unknown): string | null {
	try {
		return JSON.stringify(value);
	} catch {
		return null;
	}
}
