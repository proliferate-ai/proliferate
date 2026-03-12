import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAuthMock, getUserRoleMock } = vi.hoisted(() => ({
	requireAuthMock: vi.fn(),
	getUserRoleMock: vi.fn(),
}));

vi.mock("@/lib/auth/server/session", () => ({
	requireAuth: requireAuthMock,
}));

vi.mock("@proliferate/services", () => ({
	orgs: {
		getUserRole: getUserRoleMock,
	},
}));

vi.mock("@proliferate/environment/server", () => ({
	env: {
		NEXT_PUBLIC_APP_URL: "https://app.example.com",
	},
}));

import { verifyOAuthCallbackContext } from "@/lib/integrations/oauth-callback";

describe("verifyOAuthCallbackContext", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("allows a different admin in the same org for Composio callbacks", async () => {
		requireAuthMock.mockResolvedValue({
			session: {
				user: {
					id: "user_2",
					email: "admin@example.com",
					name: "Admin",
				},
				session: {
					id: "session_1",
					activeOrganizationId: "org_1",
				},
			},
		});
		getUserRoleMock.mockResolvedValue("admin");

		const result = await verifyOAuthCallbackContext({
			provider: "composio",
			state: {
				orgId: "org_1",
				userId: "user_1",
				timestamp: Date.now(),
			},
			returnUrl: "/dashboard/integrations",
			allowDifferentUserSameOrg: true,
		});

		expect("context" in result).toBe(true);
		if ("context" in result) {
			expect(result.context).toEqual({
				userId: "user_2",
				orgId: "org_1",
				redirectBase: "https://app.example.com/dashboard/integrations",
			});
		}
	});

	it("still rejects a different user when the override is not enabled", async () => {
		requireAuthMock.mockResolvedValue({
			session: {
				user: {
					id: "user_2",
					email: "admin@example.com",
					name: "Admin",
				},
				session: {
					id: "session_1",
					activeOrganizationId: "org_1",
				},
			},
		});

		const result = await verifyOAuthCallbackContext({
			provider: "linear",
			state: {
				orgId: "org_1",
				userId: "user_1",
				timestamp: Date.now(),
			},
			returnUrl: "/dashboard/integrations",
		});

		expect("response" in result).toBe(true);
		if ("response" in result) {
			expect(result.response.headers.get("location")).toBe(
				"https://app.example.com/dashboard/integrations?error=linear_oauth_forbidden",
			);
		}
	});
});
