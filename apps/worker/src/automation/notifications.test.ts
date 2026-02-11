import { describe, expect, it } from "vitest";
import { resolveNotificationChannelId } from "./notifications";

describe("resolveNotificationChannelId", () => {
	it("returns notificationChannelId when set", () => {
		expect(resolveNotificationChannelId("C123", null)).toBe("C123");
	});

	it("prefers notificationChannelId over enabled_tools fallback", () => {
		const enabledTools = {
			slack_notify: { enabled: true, channelId: "C_FALLBACK" },
		};
		expect(resolveNotificationChannelId("C_PRIMARY", enabledTools)).toBe("C_PRIMARY");
	});

	it("falls back to enabled_tools.slack_notify.channelId when notificationChannelId is null", () => {
		const enabledTools = {
			slack_notify: { enabled: true, channelId: "C_FALLBACK" },
		};
		expect(resolveNotificationChannelId(null, enabledTools)).toBe("C_FALLBACK");
	});

	it("falls back to enabled_tools.slack_notify.channelId when notificationChannelId is undefined", () => {
		const enabledTools = {
			slack_notify: { enabled: true, channelId: "C_FALLBACK" },
		};
		expect(resolveNotificationChannelId(undefined, enabledTools)).toBe("C_FALLBACK");
	});

	it("returns null when slack_notify is disabled even with channelId", () => {
		const enabledTools = {
			slack_notify: { enabled: false, channelId: "C_DISABLED" },
		};
		expect(resolveNotificationChannelId(null, enabledTools)).toBeNull();
	});

	it("returns null when slack_notify has no channelId", () => {
		const enabledTools = {
			slack_notify: { enabled: true },
		};
		expect(resolveNotificationChannelId(null, enabledTools)).toBeNull();
	});

	it("returns null when slack_notify.channelId is empty string", () => {
		const enabledTools = {
			slack_notify: { enabled: true, channelId: "" },
		};
		expect(resolveNotificationChannelId(null, enabledTools)).toBeNull();
	});

	it("returns null when enabledTools is null", () => {
		expect(resolveNotificationChannelId(null, null)).toBeNull();
	});

	it("returns null when enabledTools has no slack_notify", () => {
		const enabledTools = { create_linear_issue: { enabled: true } };
		expect(resolveNotificationChannelId(null, enabledTools)).toBeNull();
	});

	it("returns null when both sources are empty", () => {
		expect(resolveNotificationChannelId(null, {})).toBeNull();
	});
});
