import type { Logger } from "@proliferate/logger";
import { configurations } from "@proliferate/services";
import type { SandboxProvider } from "@proliferate/shared/providers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareForSnapshot } from "./snapshot-scrub";

type ExecResult = { stdout: string; stderr: string; exitCode: number };

function createProvider(execCommand?: ReturnType<typeof vi.fn>): SandboxProvider {
	return {
		execCommand,
	} as unknown as SandboxProvider;
}

function createLogger() {
	return {
		info: vi.fn(),
		error: vi.fn(),
	} as unknown as Logger;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("prepareForSnapshot", () => {
	it("returns no-op cleanup when configuration is missing", async () => {
		const execCommand = vi.fn();
		const logger = createLogger();

		const cleanup = await prepareForSnapshot({
			provider: createProvider(execCommand),
			sandboxId: "sandbox-1",
			configurationId: null,
			logger,
			logContext: "test",
		});

		await cleanup();
		expect(execCommand).not.toHaveBeenCalled();
	});

	it("scrubs before capture and re-applies after cleanup", async () => {
		vi.spyOn(configurations, "getConfigurationEnvFiles").mockResolvedValue({ files: [] });
		const execCommand = vi
			.fn<(...args: unknown[]) => Promise<ExecResult>>()
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
		const logger = createLogger();

		const cleanup = await prepareForSnapshot({
			provider: createProvider(execCommand),
			sandboxId: "sandbox-1",
			configurationId: "config-1",
			logger,
			logContext: "test",
			reapplyAfterCapture: true,
		});

		expect(execCommand).toHaveBeenCalledTimes(1);
		expect(execCommand).toHaveBeenNthCalledWith(
			1,
			"sandbox-1",
			["proliferate", "env", "scrub", "--spec", JSON.stringify({ files: [] })],
			{ timeoutMs: 15_000 },
		);

		await cleanup();

		expect(execCommand).toHaveBeenCalledTimes(2);
		expect(execCommand).toHaveBeenNthCalledWith(
			2,
			"sandbox-1",
			["proliferate", "env", "apply", "--spec", JSON.stringify({ files: [] })],
			{ timeoutMs: 15_000 },
		);
	});

	it("skips re-apply when reapplyAfterCapture is false", async () => {
		vi.spyOn(configurations, "getConfigurationEnvFiles").mockResolvedValue({ files: [] });
		const execCommand = vi
			.fn<(...args: unknown[]) => Promise<ExecResult>>()
			.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
		const logger = createLogger();

		const cleanup = await prepareForSnapshot({
			provider: createProvider(execCommand),
			sandboxId: "sandbox-1",
			configurationId: "config-1",
			logger,
			logContext: "test",
			reapplyAfterCapture: false,
		});

		await cleanup();
		expect(execCommand).toHaveBeenCalledTimes(1);
	});

	it("throws on scrub failure in strict mode", async () => {
		vi.spyOn(configurations, "getConfigurationEnvFiles").mockResolvedValue({ files: [] });
		const execCommand = vi
			.fn<(...args: unknown[]) => Promise<ExecResult>>()
			.mockResolvedValue({ stdout: "", stderr: "secret", exitCode: 9 });
		const logger = createLogger();

		await expect(
			prepareForSnapshot({
				provider: createProvider(execCommand),
				sandboxId: "sandbox-1",
				configurationId: "config-1",
				logger,
				logContext: "test",
				failureMode: "throw",
			}),
		).rejects.toThrow("test: env scrub failed before snapshot: env scrub failed: exit code 9");
	});

	it("binds provider context when invoking execCommand", async () => {
		vi.spyOn(configurations, "getConfigurationEnvFiles").mockResolvedValue({ files: [] });
		const logger = createLogger();
		let observedThis: unknown;
		const rawProvider = {
			execCommand(this: object) {
				observedThis = this;
				return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
			},
		};

		const cleanup = await prepareForSnapshot({
			provider: rawProvider as unknown as SandboxProvider,
			sandboxId: "sandbox-1",
			configurationId: "config-1",
			logger,
			logContext: "test",
			reapplyAfterCapture: false,
		});

		await cleanup();

		expect(observedThis).toBe(rawProvider);
	});

	it("logs and continues on scrub failure in log mode", async () => {
		vi.spyOn(configurations, "getConfigurationEnvFiles").mockResolvedValue({ files: [] });
		const execCommand = vi
			.fn<(...args: unknown[]) => Promise<ExecResult>>()
			.mockResolvedValue({ stdout: "", stderr: "secret", exitCode: 7 });
		const logger = createLogger();

		const cleanup = await prepareForSnapshot({
			provider: createProvider(execCommand),
			sandboxId: "sandbox-1",
			configurationId: "config-1",
			logger,
			logContext: "test",
			failureMode: "log",
			reapplyAfterCapture: false,
		});

		await cleanup();

		expect(execCommand).toHaveBeenCalledTimes(1);
		expect((logger as unknown as { error: ReturnType<typeof vi.fn> }).error).toHaveBeenCalledTimes(
			1,
		);
		expect((logger as unknown as { error: ReturnType<typeof vi.fn> }).error).toHaveBeenCalledWith(
			{
				err: expect.objectContaining({
					message: "env scrub failed: exit code 7",
				}),
			},
			"test: env scrub failed before snapshot",
		);
	});

	it("logs apply failures with err shape and no stderr payload", async () => {
		vi.spyOn(configurations, "getConfigurationEnvFiles").mockResolvedValue({ files: [] });
		const execCommand = vi
			.fn<(...args: unknown[]) => Promise<ExecResult>>()
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
			.mockResolvedValueOnce({ stdout: "", stderr: "secret", exitCode: 5 });
		const logger = createLogger();
		const errorSpy = (logger as unknown as { error: ReturnType<typeof vi.fn> }).error;

		const cleanup = await prepareForSnapshot({
			provider: createProvider(execCommand),
			sandboxId: "sandbox-1",
			configurationId: "config-1",
			logger,
			logContext: "test",
			reapplyAfterCapture: true,
		});

		await cleanup();

		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalledWith(
			{
				err: expect.objectContaining({
					message: "env re-apply failed: exit code 5",
				}),
			},
			"test: env re-apply after snapshot failed",
		);
		const loggedPayload = errorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(loggedPayload.stderr).toBeUndefined();
	});
});
