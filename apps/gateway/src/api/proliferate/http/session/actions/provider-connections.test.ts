import { integrations, sessions } from "@proliferate/services";
import { describe, expect, it, vi } from "vitest";
import type { ApiError } from "../../../../../server/middleware/errors";
import { resolveProviderConnectionsForSession } from "./provider-connections";

vi.mock("@proliferate/services", () => ({
	sessions: {
		findSessionByIdInternal: vi.fn(),
		listSessionConnections: vi.fn(),
	},
	integrations: {
		listActiveIntegrationsForOrganization: vi.fn(),
	},
}));

describe("resolveProviderConnectionsForSession", () => {
	it("uses session-linked integrations when present", async () => {
		vi.mocked(sessions.findSessionByIdInternal).mockResolvedValue({
			id: "session-1",
			organizationId: "org-1",
		} as never);
		vi.mocked(sessions.listSessionConnections).mockResolvedValue([
			{
				id: "sc-1",
				sessionId: "session-1",
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
		] as never);

		const result = await resolveProviderConnectionsForSession("session-1");

		expect(result.source).toBe("session_connections");
		expect(result.connections).toHaveLength(1);
		expect(result.connections[0]?.integration.integrationId).toBe("linear");
		expect(integrations.listActiveIntegrationsForOrganization).not.toHaveBeenCalled();
	});

	it("falls back to org integrations when session links are empty", async () => {
		vi.mocked(sessions.findSessionByIdInternal).mockResolvedValue({
			id: "session-1",
			organizationId: "org-1",
		} as never);
		vi.mocked(sessions.listSessionConnections).mockResolvedValue([] as never);
		vi.mocked(integrations.listActiveIntegrationsForOrganization).mockResolvedValue([
			{
				id: "int-2",
				provider: "oauth-app",
				integrationId: "linear",
				connectionId: "linear:org-1:user-1",
				displayName: "Linear",
				status: "active",
				githubInstallationId: null,
			},
		]);

		const result = await resolveProviderConnectionsForSession("session-1");

		expect(result.source).toBe("org_fallback");
		expect(result.connections).toHaveLength(1);
		expect(result.connections[0]?.integrationId).toBe("int-2");
		expect(result.connections[0]?.integration.integrationId).toBe("linear");
	});

	it("throws when session is missing", async () => {
		vi.mocked(sessions.findSessionByIdInternal).mockResolvedValue(null);

		await expect(resolveProviderConnectionsForSession("missing")).rejects.toMatchObject<ApiError>({
			statusCode: 404,
		});
	});
});
