import { env } from "@proliferate/environment/server";
import { createSyncClient } from "@proliferate/gateway-clients";

async function main() {
	const sessionId = process.argv[2];
	if (!sessionId) throw new Error("sessionId required");
	const client = createSyncClient({
		baseUrl: env.NEXT_PUBLIC_GATEWAY_URL,
		auth: { type: "service", name: "debug", secret: env.SERVICE_TO_SERVICE_AUTH_TOKEN },
		source: "automation",
	});

	let done = false;
	const ws = client.connect(sessionId, {
		reconnect: false,
		onOpen: () => {
			console.log("ws-open");
		},
		onEvent: (event) => {
			if (event.type === "init") {
				const count = Array.isArray(event.payload?.messages) ? event.payload.messages.length : -1;
				const roles = Array.isArray(event.payload?.messages)
					? event.payload.messages.map((m: any) => m.role)
					: [];
				console.log("init-count", count, "roles", JSON.stringify(roles));
				done = true;
				ws.close();
			}
		},
		onClose: (code, reason) => {
			console.log("ws-close", code, reason ?? "");
			if (!done) process.exit(1);
		},
		onReconnectFailed: () => {
			console.log("reconnect-failed");
			process.exit(1);
		},
	});

	setTimeout(() => {
		if (!done) {
			console.log("timeout");
			ws.close();
			process.exit(1);
		}
	}, 30000);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
