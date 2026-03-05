import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ApiError } from "../../../../../server/middleware/errors";
import { findIntegrationId, resolveActionSource } from "./resolver";

const {
	mockGetProviderActions,
	mockResolveProviderConnectionsForSession,
	mockGetToken,
	mockFindByIdAndOrg,
} = vi.hoisted(() => ({
	mockGetProviderActions: vi.fn(),
	mockResolveProviderConnectionsForSession: vi.fn(),
	mockGetToken: vi.fn(),
	mockFindByIdAndOrg: vi.fn(),
}));

vi.mock("@proliferate/providers/providers/registry", () => ({
	getProviderActions: mockGetProviderActions,
}));

vi.mock("./provider-connections", () => ({
	resolveProviderConnectionsForSession: mockResolveProviderConnectionsForSession,
}));

vi.mock("./connector-cache", () => ({
	computeConnectorDrift: vi.fn(),
	listSessionConnectorTools: vi.fn(),
	resolveConnector: vi.fn(),
}));

vi.mock("@proliferate/services", () => ({
	actions: {
		connectors: {
			McpConnectorActionSource: class {},
		},
	},
	integrations: {
		getToken: mockGetToken,
		findByIdAndOrg: mockFindByIdAndOrg,
	},
}));

describe("actions resolver", () => {
	it("resolves provider action using org fallback integration", async () => {
		mockGetProviderActions.mockReturnValue({
			actions: [
				{
					id: "create_issue",
					description: "Create issue",
					riskLevel: "write",
					params: z.object({}),
				},
			],
			execute: vi.fn(),
		});
		mockResolveProviderConnectionsForSession.mockResolvedValue({
			source: "org_fallback",
			organizationId: "org-1",
			connections: [
				{
					integrationId: "int-1",
					integration: {
						id: "int-1",
						provider: "oauth-app",
						integrationId: "linear",
						connectionId: "linear:org-1:user-1",
						displayName: "Linear",
						status: "active",
						githubInstallationId: null,
					},
				},
			],
		});
		mockFindByIdAndOrg.mockResolvedValue({
			id: "int-1",
			organizationId: "org-1",
			provider: "oauth-app",
			integrationId: "linear",
			connectionId: "linear:org-1:user-1",
			displayName: "Linear",
			status: "active",
			githubInstallationId: null,
			encryptedAccessToken: "enc-token",
			encryptedRefreshToken: "enc-refresh",
			tokenExpiresAt: new Date("2026-03-05T00:00:00.000Z"),
			tokenType: "Bearer",
			connectionMetadata: {},
		});
		mockGetToken.mockResolvedValue("token-1");

		const resolved = await resolveActionSource("session-1", "linear", "create_issue");

		expect(mockGetToken).toHaveBeenCalledWith({
			id: "int-1",
			provider: "oauth-app",
			integrationId: "linear",
			connectionId: "linear:org-1:user-1",
			githubInstallationId: null,
			organizationId: "org-1",
			status: "active",
			encryptedAccessToken: "enc-token",
			encryptedRefreshToken: "enc-refresh",
			tokenExpiresAt: new Date("2026-03-05T00:00:00.000Z"),
			tokenType: "Bearer",
			connectionMetadata: {},
		});
		expect(resolved.ctx.orgId).toBe("org-1");
		expect(resolved.ctx.token).toBe("token-1");
		expect(resolved.actionDef.id).toBe("create_issue");
	});

	it("throws when integration is unavailable in session and org fallback", async () => {
		mockGetProviderActions.mockReturnValue({
			actions: [
				{
					id: "create_issue",
					description: "Create issue",
					riskLevel: "write",
					params: z.object({}),
				},
			],
			execute: vi.fn(),
		});
		mockResolveProviderConnectionsForSession.mockResolvedValue({
			source: "org_fallback",
			organizationId: "org-1",
			connections: [],
		});

		await expect(
			resolveActionSource("session-1", "linear", "create_issue"),
		).rejects.toMatchObject<ApiError>({
			statusCode: 400,
		});
	});

	it("findIntegrationId returns null when no matching integration exists", async () => {
		mockResolveProviderConnectionsForSession.mockResolvedValue({
			source: "org_fallback",
			organizationId: "org-1",
			connections: [],
		});

		const integrationId = await findIntegrationId("session-1", "linear");

		expect(integrationId).toBeNull();
	});
});
