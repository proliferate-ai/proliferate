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
	await client.postMessage(sessionId, {
		content: "Reply with exactly: hello-debug",
		userId: "automation",
		idempotencyKey: `debug:${Date.now()}`,
	});
	console.log("posted");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
