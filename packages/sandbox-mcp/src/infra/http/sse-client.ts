const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 1_000;

export async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
		} catch (error) {
			const isConnectionError =
				error instanceof TypeError &&
				(error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed"));
			if (isConnectionError && attempt < MAX_RETRIES) {
				await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
				continue;
			}
			throw error;
		}
	}
}

export async function streamSse(
	url: string,
	options: { authToken: string; follow: boolean; onData: (payload: string) => void },
): Promise<void> {
	const response = await fetchWithRetry(url, {
		headers: {
			Authorization: `Bearer ${options.authToken}`,
			Accept: "text/event-stream",
		},
	});

	if (!response.ok) {
		let message = `HTTP ${response.status}`;
		try {
			const body = (await response.json()) as { error?: string };
			if (body.error) {
				message = body.error;
			}
		} catch {
			// Ignore parse failure and keep status-based message.
		}
		throw new Error(message);
	}

	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error("No response body");
	}

	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let frameBoundary = buffer.indexOf("\n\n");
		while (frameBoundary !== -1) {
			const frame = buffer.slice(0, frameBoundary);
			buffer = buffer.slice(frameBoundary + 2);
			for (const line of frame.split("\n")) {
				if (!line.startsWith("data: ")) continue;
				options.onData(line.slice(6));
				if (!options.follow) {
					reader.cancel();
					return;
				}
			}
			frameBoundary = buffer.indexOf("\n\n");
		}
	}
}
