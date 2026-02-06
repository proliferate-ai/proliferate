import { type Server, createServer } from "http";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

/**
 * Mock the auth middleware so verifyToken resolves without real JWT/CLI logic.
 */
const mockVerifyToken = vi.fn();
vi.mock("../../../middleware/auth", () => ({
	verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
}));

// Import after mocks are registered (dynamic import required after vi.mock)
let setupProliferateWebSocket: Awaited<typeof import("./index")>["setupProliferateWebSocket"];
beforeAll(async () => {
	const mod = await import("./index");
	setupProliferateWebSocket = mod.setupProliferateWebSocket;
});

/**
 * Helper: collect N messages from a WebSocket, returning them as parsed objects.
 */
function collectMessages(ws: WebSocket, count: number): Promise<unknown[]> {
	return new Promise((resolve, reject) => {
		const messages: unknown[] = [];
		const timeout = setTimeout(() => {
			reject(
				new Error(
					`Timed out waiting for ${count} messages (got ${messages.length}): ${JSON.stringify(messages)}`,
				),
			);
		}, 10000);

		ws.on("message", (data) => {
			messages.push(JSON.parse(data.toString()));
			if (messages.length >= count) {
				clearTimeout(timeout);
				resolve(messages);
			}
		});

		ws.on("error", (err) => {
			clearTimeout(timeout);
			reject(err);
		});
	});
}

/**
 * Helper: wait for the WebSocket to open.
 */
function waitForOpen(ws: WebSocket): Promise<void> {
	return new Promise((resolve, reject) => {
		ws.on("open", resolve);
		ws.on("error", reject);
	});
}

describe("WS handler message ordering", () => {
	let server: Server;
	let port: number;
	let mockAddClient: ReturnType<typeof vi.fn>;
	let mockHandleClientMessage: ReturnType<typeof vi.fn>;
	const openClients: WebSocket[] = [];

	beforeEach(async () => {
		// Reset auth mock to return a valid user by default
		mockVerifyToken.mockReset();
		mockVerifyToken.mockResolvedValue({
			userId: "test-user",
			orgId: "test-org",
			source: "jwt" as const,
		});

		// Create mock SessionHub
		mockHandleClientMessage = vi.fn();
		mockAddClient = vi.fn((ws: WebSocket, _userId: string) => {
			// Simulate real hub behavior:
			// 1. Immediately send status "resuming"
			ws.send(
				JSON.stringify({
					type: "status",
					payload: { status: "resuming", message: "Connecting to coding agent..." },
				}),
			);

			// 2. After a delay (simulating ensureRuntimeReady), send init + running
			setTimeout(() => {
				ws.send(JSON.stringify({ type: "init", payload: { messages: [] } }));
				ws.send(JSON.stringify({ type: "status", payload: { status: "running" } }));
			}, 100);
		});

		const mockHub = {
			addClient: mockAddClient,
			handleClientMessage: mockHandleClientMessage,
		};

		// Create mock HubManager
		const mockHubManager = {
			getOrCreate: vi.fn().mockResolvedValue(mockHub),
			get: vi.fn(),
			remove: vi.fn(),
			getActiveSessionIds: vi.fn().mockReturnValue([]),
		};

		// Create a real HTTP server
		server = createServer();

		// Setup the WS handler with mocked dependencies
		setupProliferateWebSocket(server, mockHubManager as never, {} as never);

		// Listen on a random port
		await new Promise<void>((resolve) => {
			server.listen(0, () => resolve());
		});

		const addr = server.address();
		if (!addr || typeof addr === "string") {
			throw new Error("Failed to get server address");
		}
		port = addr.port;
	});

	afterEach(async () => {
		// Close all WebSocket clients before shutting down the server
		for (const ws of openClients) {
			if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
				ws.terminate();
			}
		}
		openClients.length = 0;

		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	});

	it("sends status resuming immediately after connection", async () => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/proliferate/test-session-id?token=test-token`);
		openClients.push(ws);

		const messages = await collectMessages(ws, 3);
		ws.close();

		// First message must be status "resuming" - the whole point of the fix
		expect(messages[0]).toEqual({
			type: "status",
			payload: { status: "resuming", message: "Connecting to coding agent..." },
		});

		// Second message is init (after runtime ready)
		expect(messages[1]).toEqual({
			type: "init",
			payload: { messages: [] },
		});

		// Third message is status "running"
		expect(messages[2]).toEqual({
			type: "status",
			payload: { status: "running" },
		});
	});

	it("message handler works during startup", async () => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/proliferate/test-session-id?token=test-token`);
		openClients.push(ws);

		await waitForOpen(ws);

		// Send a message immediately (before ensureRuntimeReady would have resolved)
		ws.send(JSON.stringify({ type: "ping" }));

		// Wait for at least the first message to ensure handler is set up
		await collectMessages(ws, 1);

		// Give the message handler a moment to process
		await new Promise((resolve) => setTimeout(resolve, 50));

		ws.close();

		expect(mockHandleClientMessage).toHaveBeenCalledWith(expect.anything(), { type: "ping" });
	});

	it("rejects unauthenticated connections", async () => {
		// Override auth to reject
		mockVerifyToken.mockResolvedValue(null);

		const ws = new WebSocket(`ws://127.0.0.1:${port}/proliferate/test-session-id?token=bad-token`);
		openClients.push(ws);

		const closed = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("Timed out waiting for close")), 5000);

			ws.on("close", (code, reason) => {
				clearTimeout(timeout);
				resolve({ code, reason: reason.toString() });
			});

			ws.on("error", () => {
				// Expected - connection refused after 401
				clearTimeout(timeout);
				resolve({ code: 0, reason: "error" });
			});
		});

		// The server writes "HTTP/1.1 401" and destroys the socket,
		// so the client sees either a close event or an error
		expect(closed).toBeDefined();
	});
});
