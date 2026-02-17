import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindRunWithRelations = vi.fn();
const mockGetSlackInstallationForNotifications = vi.fn();
const mockFindSideEffect = vi.fn();
const mockRecordOrReplaySideEffect = vi.fn();

vi.mock("@proliferate/environment/server", () => ({
	env: { NEXT_PUBLIC_APP_URL: "https://app.test" },
}));

vi.mock("@proliferate/services", () => ({
	integrations: {
		getSlackInstallationForNotifications: (...args: unknown[]) =>
			mockGetSlackInstallationForNotifications(...args),
	},
	runs: {
		findRunWithRelations: (...args: unknown[]) => mockFindRunWithRelations(...args),
	},
	sideEffects: {
		findSideEffect: (...args: unknown[]) => mockFindSideEffect(...args),
		recordOrReplaySideEffect: (...args: unknown[]) => mockRecordOrReplaySideEffect(...args),
	},
}));

vi.mock("@proliferate/shared/crypto", () => ({
	decrypt: () => "xoxb-decrypted-token",
	getEncryptionKey: () => "test-key",
}));

const mockLogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	child: vi.fn().mockReturnThis(),
} as unknown as import("@proliferate/logger").Logger;

function makeRun(overrides: Record<string, unknown> = {}) {
	return {
		id: "run-1",
		automationId: "auto-1",
		organizationId: "org-1",
		status: "succeeded",
		statusReason: null,
		errorMessage: null,
		completionJson: { summary_markdown: "Done" },
		automation: {
			id: "auto-1",
			name: "Test Automation",
			defaultConfigurationId: null,
			agentInstructions: null,
			modelId: null,
			notificationChannelId: "C_CHANNEL",
			notificationSlackInstallationId: null,
			enabledTools: {},
		},
		triggerEvent: null,
		trigger: null,
		...overrides,
	};
}

// Must import after mocks
const { dispatchRunNotification } = await import("./notifications");

describe("dispatchRunNotification — installation selection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default: successful Slack post
		globalThis.fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({ ok: true }),
		}) as unknown as typeof fetch;
		// Default: no existing side effect (first time sending)
		mockFindSideEffect.mockResolvedValue(null);
		mockRecordOrReplaySideEffect.mockResolvedValue({ row: {}, replayed: false });
	});

	it("passes slackInstallationId to getSlackInstallationForNotifications when set", async () => {
		const run = makeRun({
			automation: {
				...makeRun().automation,
				notificationSlackInstallationId: "inst-abc",
			},
		});
		mockFindRunWithRelations.mockResolvedValue(run);
		mockGetSlackInstallationForNotifications.mockResolvedValue({
			id: "inst-abc",
			encryptedBotToken: "encrypted",
		});

		await dispatchRunNotification("run-1", mockLogger);

		expect(mockGetSlackInstallationForNotifications).toHaveBeenCalledWith("org-1", "inst-abc");
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it("falls back to org-level lookup when slackInstallationId is null", async () => {
		const run = makeRun();
		mockFindRunWithRelations.mockResolvedValue(run);
		mockGetSlackInstallationForNotifications.mockResolvedValue({
			id: "inst-fallback",
			encryptedBotToken: "encrypted",
		});

		await dispatchRunNotification("run-1", mockLogger);

		expect(mockGetSlackInstallationForNotifications).toHaveBeenCalledWith("org-1", null);
	});

	it("returns actionable error when specific installation not found", async () => {
		const run = makeRun({
			automation: {
				...makeRun().automation,
				notificationSlackInstallationId: "inst-revoked",
			},
		});
		mockFindRunWithRelations.mockResolvedValue(run);
		mockGetSlackInstallationForNotifications.mockResolvedValue(null);

		await expect(dispatchRunNotification("run-1", mockLogger)).rejects.toThrow(
			"inst-revoked not found or revoked",
		);

		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ installationId: "inst-revoked" }),
			expect.stringContaining("inst-revoked not found or revoked"),
		);
		// Must NOT call Slack API
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("silently skips when no installation exists and no specific ID configured", async () => {
		const run = makeRun();
		mockFindRunWithRelations.mockResolvedValue(run);
		mockGetSlackInstallationForNotifications.mockResolvedValue(null);

		// Should not throw
		await dispatchRunNotification("run-1", mockLogger);

		expect(mockLogger.debug).toHaveBeenCalledWith(
			expect.objectContaining({ orgId: "org-1" }),
			"No Slack installation for org",
		);
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("uses correct bot token from specified installation", async () => {
		const run = makeRun({
			automation: {
				...makeRun().automation,
				notificationSlackInstallationId: "inst-specific",
			},
		});
		mockFindRunWithRelations.mockResolvedValue(run);
		mockGetSlackInstallationForNotifications.mockResolvedValue({
			id: "inst-specific",
			encryptedBotToken: "encrypted-specific",
		});

		await dispatchRunNotification("run-1", mockLogger);

		const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(fetchCall[1].headers.Authorization).toBe("Bearer xoxb-decrypted-token");
		const body = JSON.parse(fetchCall[1].body);
		expect(body.channel).toBe("C_CHANNEL");
	});

	it("skips notification when side effect already exists (idempotent)", async () => {
		const run = makeRun();
		mockFindRunWithRelations.mockResolvedValue(run);
		// Side effect already recorded — notification was sent previously
		mockFindSideEffect.mockResolvedValue({ id: "se-1", effectId: "notify:run-1:slack:succeeded" });

		await dispatchRunNotification("run-1", mockLogger);

		// Should NOT call Slack API or record again
		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect(mockGetSlackInstallationForNotifications).not.toHaveBeenCalled();
		expect(mockRecordOrReplaySideEffect).not.toHaveBeenCalled();
		expect(mockLogger.info).toHaveBeenCalledWith(
			expect.objectContaining({ runId: "run-1" }),
			"Notification already sent (idempotent replay)",
		);
	});

	it("records side effect only after successful send", async () => {
		const run = makeRun();
		mockFindRunWithRelations.mockResolvedValue(run);
		mockGetSlackInstallationForNotifications.mockResolvedValue({
			id: "inst-1",
			encryptedBotToken: "encrypted",
		});

		await dispatchRunNotification("run-1", mockLogger);

		// findSideEffect is called first (pre-check)
		expect(mockFindSideEffect).toHaveBeenCalledWith("org-1", "notify:run-1:slack:succeeded");
		// Then send happens (fetch called)
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		// Then side effect is recorded after successful send
		expect(mockRecordOrReplaySideEffect).toHaveBeenCalledWith({
			organizationId: "org-1",
			runId: "run-1",
			effectId: "notify:run-1:slack:succeeded",
			kind: "notification",
			provider: "slack",
			requestHash: "C_CHANNEL:succeeded",
		});
	});

	it("does not record side effect when send fails (allows retry)", async () => {
		const run = makeRun();
		mockFindRunWithRelations.mockResolvedValue(run);
		mockGetSlackInstallationForNotifications.mockResolvedValue({
			id: "inst-1",
			encryptedBotToken: "encrypted",
		});
		// Slack API returns error
		globalThis.fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({ ok: false, error: "channel_not_found" }),
		}) as unknown as typeof fetch;

		await expect(dispatchRunNotification("run-1", mockLogger)).rejects.toThrow("channel_not_found");

		// Side effect must NOT be recorded so retries can try again
		expect(mockRecordOrReplaySideEffect).not.toHaveBeenCalled();
	});
});
