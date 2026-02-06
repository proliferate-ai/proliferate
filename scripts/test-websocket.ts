/**
 * Test script for WebSocket connection to Durable Object
 *
 * Usage:
 *   TEST_TOKEN=xxx NEXT_PUBLIC_GATEWAY_URL=xxx npx tsx scripts/test-websocket.ts
 *
 * To get a test token:
 * 1. Log in to your app in the browser
 * 2. Open DevTools > Application > Local Storage > better-auth session
 * 3. Copy the session token
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnv } from "@proliferate/environment/runtime";
import WebSocket from "ws";

// Load .env.local manually
const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
	const envContent = readFileSync(envPath, "utf8");
	for (const line of envContent.split("\n")) {
		const trimmed = line.trim();
		if (trimmed && !trimmed.startsWith("#")) {
			const match = trimmed.match(/^([^=]+)=(.*)$/);
			if (match) {
				const key = match[1].trim();
				let value = match[2].trim();
				if (
					(value.startsWith('"') && value.endsWith('"')) ||
					(value.startsWith("'") && value.endsWith("'"))
				) {
					value = value.slice(1, -1);
				}
				if (!runtimeEnv[key]) {
					runtimeEnv[key] = value;
				}
			}
		}
	}
}

const { env } = await import("@proliferate/environment/server");
const workerUrl = env.NEXT_PUBLIC_GATEWAY_URL;
const testToken = env.TEST_TOKEN;

async function test() {
	const sessionId = `test-${Date.now()}`;
	const wsUrl = workerUrl.replace("https://", "wss://").replace("http://", "ws://");
	const fullUrl = `${wsUrl}/session/${sessionId}?token=${testToken}`;

	console.log("=== WebSocket Connection Test ===\n");
	console.log(`Session ID: ${sessionId}`);
	console.log(`Connecting to: ${wsUrl}/session/${sessionId}?token=<redacted>`);
	console.log("");

	const ws = new WebSocket(fullUrl);

	const timeout = setTimeout(() => {
		console.error("✗ Connection timed out after 10 seconds");
		ws.close();
		process.exit(1);
	}, 10000);

	ws.on("open", () => {
		console.log("✓ Connected successfully!");
		console.log("  Sending ping...");
		ws.send(JSON.stringify({ type: "ping" }));
	});

	ws.on("message", (data) => {
		try {
			const msg = JSON.parse(data.toString());
			console.log(
				`  Received: ${msg.type}`,
				msg.payload ? JSON.stringify(msg.payload).slice(0, 100) : "",
			);

			if (msg.type === "init") {
				console.log(`  ✓ Received init with ${msg.payload.messages?.length ?? 0} messages`);
			}

			if (msg.type === "pong") {
				console.log("\n✓ Ping/pong working!");
				clearTimeout(timeout);
				ws.close();
				console.log("\n=== All tests passed! ===");
				process.exit(0);
			}
		} catch (err) {
			console.error("  Error parsing message:", err);
		}
	});

	ws.on("error", (err) => {
		clearTimeout(timeout);
		console.error("\n✗ WebSocket error:", err.message);
		process.exit(1);
	});

	ws.on("close", (code, reason) => {
		clearTimeout(timeout);
		if (code !== 1000) {
			console.log(`\nConnection closed: code=${code}, reason=${reason.toString() || "(none)"}`);
		}
	});

	ws.on("unexpected-response", (_req, res) => {
		clearTimeout(timeout);
		console.error(`\n✗ Unexpected response: ${res.statusCode} ${res.statusMessage}`);

		let body = "";
		res.on("data", (chunk) => {
			body += chunk.toString();
		});
		res.on("end", () => {
			if (body) {
				console.error(`  Response body: ${body}`);
			}
			process.exit(1);
		});
	});
}

test().catch((err) => {
	console.error("Test failed:", err);
	process.exit(1);
});
