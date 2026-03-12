import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger", () => ({
	getServicesLogger: () => ({
		child: () => ({
			warn: vi.fn(),
		}),
	}),
}));

import { getConnectedAccount, getOrCreateMcpServer, initiateOAuth } from "./client";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(body), {
		status: init?.status ?? 200,
		headers: { "Content-Type": "application/json" },
		...init,
	});
}

describe("composio client", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it("initiates hosted OAuth with the toolkit auth config", async () => {
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse({
					items: [
						{
							id: "ac_gmail",
							toolkit: { slug: "gmail" },
							status: "ENABLED",
							auth_scheme: "OAUTH2",
							is_composio_managed: true,
						},
					],
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					redirect_url: "https://connect.composio.dev/link/lk_123",
					connected_account_id: "ca_123",
				}),
			);

		const result = await initiateOAuth(
			{ apiKey: "test-key", baseUrl: "https://backend.composio.dev" },
			{
				toolkit: "gmail",
				orgId: "org_123",
				callbackUrl: "https://app.example.com/api/integrations/composio/oauth/callback?state=abc",
			},
		);

		expect(result).toEqual({
			redirectUrl: "https://connect.composio.dev/link/lk_123",
			connectedAccountId: "ca_123",
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);

		const [authConfigUrl, authConfigInit] = fetchMock.mock.calls[0] as [string, RequestInit];
		const authConfigRequestUrl = new URL(authConfigUrl);
		expect(authConfigRequestUrl.pathname).toBe("/api/v3/auth_configs");
		expect(authConfigRequestUrl.searchParams.get("toolkit_slug")).toBe("gmail");
		expect(authConfigRequestUrl.searchParams.get("is_composio_managed")).toBe("true");
		expect(authConfigInit.method).toBe("GET");

		const [linkUrl, linkInit] = fetchMock.mock.calls[1] as [string, RequestInit];
		expect(new URL(linkUrl).pathname).toBe("/api/v3/connected_accounts/link");
		expect(linkInit.method).toBe("POST");
		expect(JSON.parse(String(linkInit.body))).toEqual({
			auth_config_id: "ac_gmail",
			user_id: "org_123",
			callback_url: "https://app.example.com/api/integrations/composio/oauth/callback?state=abc",
		});
	});

	it("creates a managed auth config when the toolkit does not have one yet", async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ items: [] }))
			.mockResolvedValueOnce(
				jsonResponse(
					{
						toolkit: { slug: "gmail" },
						auth_config: { id: "ac_new" },
					},
					{ status: 201 },
				),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					redirect_url: "https://connect.composio.dev/link/lk_456",
					connected_account_id: "ca_456",
				}),
			);

		await initiateOAuth(
			{ apiKey: "test-key", baseUrl: "https://backend.composio.dev" },
			{
				toolkit: "gmail",
				orgId: "org_456",
				callbackUrl: "https://app.example.com/callback?state=def",
			},
		);

		expect(fetchMock).toHaveBeenCalledTimes(3);

		const [createAuthConfigUrl, createAuthConfigInit] = fetchMock.mock.calls[1] as [
			string,
			RequestInit,
		];
		expect(new URL(createAuthConfigUrl).pathname).toBe("/api/v3/auth_configs");
		expect(createAuthConfigInit.method).toBe("POST");
		expect(JSON.parse(String(createAuthConfigInit.body))).toEqual({
			toolkit: { slug: "gmail" },
			auth_config: {
				auth_scheme: "OAUTH2",
				is_composio_managed: true,
			},
		});
	});

	it("parses toolkit and auth config details from a connected account", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({
				id: "ca_789",
				status: "ACTIVE",
				user_id: "org_789",
				toolkit: { slug: "gmail" },
				auth_config: { id: "ac_gmail" },
			}),
		);

		const account = await getConnectedAccount(
			{ apiKey: "test-key", baseUrl: "https://backend.composio.dev" },
			"ca_789",
		);

		expect(account).toEqual({
			id: "ca_789",
			status: "ACTIVE",
			userId: "org_789",
			toolkitSlug: "gmail",
			authConfigId: "ac_gmail",
			integrationId: undefined,
		});
	});

	it("prefers top-level connected account metadata over the nested token data blob", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({
				id: "ca_blob",
				status: "ACTIVE",
				user_id: "org_blob",
				toolkit: { slug: "gmail" },
				auth_config: { id: "ac_blob" },
				data: {
					status: "ACTIVE",
					access_token: "secret",
				},
			}),
		);

		const account = await getConnectedAccount(
			{ apiKey: "test-key", baseUrl: "https://backend.composio.dev" },
			"ca_blob",
		);

		expect(account).toEqual({
			id: "ca_blob",
			status: "ACTIVE",
			userId: "org_blob",
			toolkitSlug: "gmail",
			authConfigId: "ac_blob",
			integrationId: undefined,
		});
	});

	it("reuses an MCP server and generates a user-scoped MCP URL", async () => {
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse({
					items: [
						{
							id: "srv_123",
							toolkits: ["gmail"],
							auth_config_ids: ["ac_gmail"],
							managed_auth_via_composio: true,
						},
					],
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					mcp_url: "https://backend.composio.dev/v3/mcp/srv_123",
					connected_account_urls: [
						"https://backend.composio.dev/v3/mcp/srv_123?connected_account_ids=ca_123",
					],
					user_ids_url: ["https://backend.composio.dev/v3/mcp/srv_123?user_id=org_123"],
				}),
			);

		const result = await getOrCreateMcpServer(
			{ apiKey: "test-key", baseUrl: "https://backend.composio.dev" },
			{
				toolkit: "gmail",
				orgId: "org_123",
				authConfigId: "ac_gmail",
				connectedAccountId: "ca_123",
			},
		);

		expect(result).toEqual({
			mcpUrl: "https://backend.composio.dev/v3/mcp/srv_123?user_id=org_123",
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);

		const [listUrl] = fetchMock.mock.calls[0] as [string];
		const listRequestUrl = new URL(listUrl);
		expect(listRequestUrl.pathname).toBe("/api/v3/mcp/servers");
		expect(listRequestUrl.searchParams.get("toolkits")).toBe("gmail");
		expect(listRequestUrl.searchParams.get("auth_config_ids")).toBe("ac_gmail");

		const [generateUrl, generateInit] = fetchMock.mock.calls[1] as [string, RequestInit];
		expect(new URL(generateUrl).pathname).toBe("/api/v3/mcp/servers/generate");
		expect(JSON.parse(String(generateInit.body))).toEqual({
			mcp_server_id: "srv_123",
			managed_auth_by_composio: true,
			user_ids: ["org_123"],
			connected_account_ids: ["ca_123"],
		});
	});
});
