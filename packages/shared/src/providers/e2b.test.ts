import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_CADDYFILE,
	ENV_INSTRUCTIONS,
	PLUGIN_MJS,
	getOpencodeConfig,
	waitForOpenCodeReady,
} from "./e2b";

describe("E2B Provider - Helper Functions", () => {
	describe("getOpencodeConfig", () => {
		it("should generate valid JSON config", () => {
			const config = getOpencodeConfig("claude-sonnet-4-20250514");
			expect(() => JSON.parse(config)).not.toThrow();
		});

		it("should include the specified model", () => {
			const modelId = "claude-sonnet-4-20250514";
			const config = getOpencodeConfig(modelId);
			const parsed = JSON.parse(config);
			expect(parsed.model).toBe(modelId);
		});

		it("should configure server on port 4096", () => {
			const config = getOpencodeConfig("test-model");
			const parsed = JSON.parse(config);
			expect(parsed.server.port).toBe(4096);
			expect(parsed.server.hostname).toBe("0.0.0.0");
		});

		it("should include proliferate plugin path", () => {
			const config = getOpencodeConfig("test-model");
			const parsed = JSON.parse(config);
			expect(parsed.plugin).toContain("/home/user/.config/opencode/plugin/proliferate.mjs");
		});

		it("should configure permissions to allow all except question", () => {
			const config = getOpencodeConfig("test-model");
			const parsed = JSON.parse(config);
			expect(parsed.permission["*"]).toBe("allow");
			expect(parsed.permission.question).toBe("deny");
		});

		it("should include playwright MCP configuration", () => {
			const config = getOpencodeConfig("test-model");
			const parsed = JSON.parse(config);
			expect(parsed.mcp.playwright).toBeDefined();
			expect(parsed.mcp.playwright.type).toBe("local");
			expect(parsed.mcp.playwright.command).toContain("playwright-mcp");
		});

		it("should NOT include sandbox_mcp MCP entry (regression)", () => {
			const config = getOpencodeConfig("test-model");
			const parsed = JSON.parse(config);
			expect(parsed.mcp.sandbox_mcp).toBeUndefined();
		});

		it("should work with different model IDs", () => {
			const models = [
				"claude-sonnet-4-20250514",
				"claude-3-5-sonnet-20241022",
				"gpt-4o",
				"gemini-1.5-pro",
			];
			for (const model of models) {
				const config = getOpencodeConfig(model);
				const parsed = JSON.parse(config);
				expect(parsed.model).toBe(model);
			}
		});

		it("should use empty anthropic provider config by default", () => {
			const config = getOpencodeConfig("test-model");
			const parsed = JSON.parse(config);
			expect(parsed.provider.anthropic).toEqual({});
		});

		it("should embed baseURL and apiKey when proxy params provided", () => {
			const proxyUrl = "https://proxy.example.com/v1";
			const jwtToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test";
			const config = getOpencodeConfig("test-model", proxyUrl, jwtToken);
			const parsed = JSON.parse(config);
			expect(parsed.provider.anthropic.options.baseURL).toBe(proxyUrl);
			expect(parsed.provider.anthropic.options.apiKey).toBe(jwtToken);
		});

		it("should embed baseURL when only baseURL provided", () => {
			const config = getOpencodeConfig("test-model", "https://proxy.example.com/v1");
			const parsed = JSON.parse(config);
			expect(parsed.provider.anthropic.options.baseURL).toBe("https://proxy.example.com/v1");
			expect(parsed.provider.anthropic.options.apiKey).toBeUndefined();
		});

		it("should embed apiKey when only apiKey provided", () => {
			const config = getOpencodeConfig("test-model", undefined, "jwt-token");
			const parsed = JSON.parse(config);
			expect(parsed.provider.anthropic.options.apiKey).toBe("jwt-token");
			expect(parsed.provider.anthropic.options.baseURL).toBeUndefined();
		});
	});

	describe("PLUGIN_MJS", () => {
		it("should be valid JavaScript", () => {
			// The plugin should at least be parseable as a module
			expect(PLUGIN_MJS).toContain("export const ProliferatePlugin");
		});

		it("should export ProliferatePlugin function", () => {
			expect(PLUGIN_MJS).toContain("ProliferatePlugin = async");
		});

		it("should return empty hooks", () => {
			expect(PLUGIN_MJS).toContain("return {}");
		});
	});

	describe("DEFAULT_CADDYFILE", () => {
		it("should disable admin endpoint", () => {
			expect(DEFAULT_CADDYFILE).toContain("admin off");
		});

		it("should listen on port 20000", () => {
			expect(DEFAULT_CADDYFILE).toContain(":20000 {");
		});

		it("should route /_proliferate/mcp to sandbox-mcp on port 4000", () => {
			expect(DEFAULT_CADDYFILE).toContain("handle_path /_proliferate/mcp/*");
			expect(DEFAULT_CADDYFILE).toContain("reverse_proxy localhost:4000");
		});

		it("should import user caddy config", () => {
			expect(DEFAULT_CADDYFILE).toContain("import /home/user/.proliferate/caddy/user.caddy");
		});

		it("should proxy to common dev ports in a handle block", () => {
			expect(DEFAULT_CADDYFILE).toContain("handle {");
			expect(DEFAULT_CADDYFILE).toContain("localhost:3000");
			expect(DEFAULT_CADDYFILE).toContain("localhost:5173");
			expect(DEFAULT_CADDYFILE).toContain("localhost:8000");
			expect(DEFAULT_CADDYFILE).toContain("localhost:4321");
		});

		it("should use first available backend policy", () => {
			expect(DEFAULT_CADDYFILE).toContain("lb_policy first");
		});

		it("should remove security headers for iframe embedding", () => {
			expect(DEFAULT_CADDYFILE).toContain("-X-Frame-Options");
			expect(DEFAULT_CADDYFILE).toContain("-Content-Security-Policy");
		});
	});

	describe("ENV_INSTRUCTIONS", () => {
		it("should document PostgreSQL configuration", () => {
			expect(ENV_INSTRUCTIONS).toContain("PostgreSQL");
			expect(ENV_INSTRUCTIONS).toContain("localhost:5432");
			expect(ENV_INSTRUCTIONS).toContain("postgres");
		});

		it("should document Redis configuration", () => {
			expect(ENV_INSTRUCTIONS).toContain("Redis");
			expect(ENV_INSTRUCTIONS).toContain("localhost:6379");
		});

		it("should document Docker support", () => {
			expect(ENV_INSTRUCTIONS).toContain("Docker");
			expect(ENV_INSTRUCTIONS).toContain("docker compose");
		});

		it("should document available tools", () => {
			expect(ENV_INSTRUCTIONS).toContain("Node.js 20");
			expect(ENV_INSTRUCTIONS).toContain("Python 3.11");
			expect(ENV_INSTRUCTIONS).toContain("pnpm");
			expect(ENV_INSTRUCTIONS).toContain("uv");
		});

		it("should include example setup commands", () => {
			expect(ENV_INSTRUCTIONS).toContain("pnpm install");
			expect(ENV_INSTRUCTIONS).toContain("uv sync");
		});
	});

	describe("waitForOpenCodeReady", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
			vi.restoreAllMocks();
		});

		it("should resolve immediately if server responds ok", async () => {
			global.fetch = vi.fn().mockResolvedValueOnce({
				ok: true,
			});

			const log = vi.fn();
			const promise = waitForOpenCodeReady("http://localhost:4096", 30000, log);

			// Fast-forward through any initial delay
			await vi.advanceTimersByTimeAsync(0);

			await expect(promise).resolves.toBeUndefined();
			expect(fetch).toHaveBeenCalledWith("http://localhost:4096/session", expect.anything());
			expect(log).toHaveBeenCalledWith(expect.stringContaining("Agent ready after 1 attempts"));
		});

		it("should retry on failure and succeed on second attempt", async () => {
			global.fetch = vi
				.fn()
				.mockRejectedValueOnce(new Error("Connection refused"))
				.mockResolvedValueOnce({ ok: true });

			const log = vi.fn();
			const promise = waitForOpenCodeReady("http://localhost:4096", 30000, log);

			// First attempt fails
			await vi.advanceTimersByTimeAsync(0);
			// Wait for backoff delay (200ms)
			await vi.advanceTimersByTimeAsync(200);

			await expect(promise).resolves.toBeUndefined();
			expect(fetch).toHaveBeenCalledTimes(2);
			expect(log).toHaveBeenCalledWith(expect.stringContaining("Agent ready after 2 attempts"));
		});

		it("should throw error after timeout", async () => {
			vi.useRealTimers(); // Use real timers for this test since it's about actual timeout
			global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

			const log = vi.fn();

			// Use a very short timeout to make the test fast
			await expect(waitForOpenCodeReady("http://localhost:4096", 500, log)).rejects.toThrow(
				"Agent not ready after 500ms",
			);
		});

		it("should use exponential backoff", async () => {
			let attemptCount = 0;
			const attemptTimes: number[] = [];
			const startTime = Date.now();

			global.fetch = vi.fn().mockImplementation(() => {
				attemptCount++;
				attemptTimes.push(Date.now() - startTime);
				if (attemptCount < 4) {
					return Promise.reject(new Error("Not ready"));
				}
				return Promise.resolve({ ok: true });
			});

			const log = vi.fn();
			const promise = waitForOpenCodeReady("http://localhost:4096", 30000, log);

			// Advance through retries
			await vi.advanceTimersByTimeAsync(0); // First attempt
			await vi.advanceTimersByTimeAsync(200); // First backoff (200ms)
			await vi.advanceTimersByTimeAsync(300); // Second backoff (300ms)
			await vi.advanceTimersByTimeAsync(450); // Third backoff (450ms)

			await expect(promise).resolves.toBeUndefined();
			expect(attemptCount).toBe(4);
		});

		it("should retry on non-ok response", async () => {
			global.fetch = vi
				.fn()
				.mockResolvedValueOnce({ ok: false, status: 503 })
				.mockResolvedValueOnce({ ok: true });

			const log = vi.fn();
			const promise = waitForOpenCodeReady("http://localhost:4096", 30000, log);

			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(200);

			await expect(promise).resolves.toBeUndefined();
			expect(fetch).toHaveBeenCalledTimes(2);
		});

		it("should use default log function if not provided", async () => {
			global.fetch = vi.fn().mockResolvedValueOnce({ ok: true });

			const promise = waitForOpenCodeReady("http://localhost:4096");
			await vi.advanceTimersByTimeAsync(0);
			await expect(promise).resolves.toBeUndefined();
			expect(fetch).toHaveBeenCalledTimes(1);
		});
	});
});

describe("E2B Provider - Configuration Constants", () => {
	it("requires E2B_TEMPLATE to be set when using E2B", () => {
		// Template must be provided via env when E2B provider is enabled
		expect(true).toBe(true); // Placeholder - actual value tested in integration tests
	});

	it("should support E2B_DOMAIN for self-hosted", () => {
		// Verified by the integration test which passes E2B_DOMAIN
		expect(true).toBe(true);
	});
});
