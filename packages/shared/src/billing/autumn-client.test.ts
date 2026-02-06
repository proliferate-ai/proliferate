import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockedEnv: { AUTUMN_API_URL: string; AUTUMN_API_KEY: string } = {
	AUTUMN_API_URL: "https://api.useautumn.com",
	AUTUMN_API_KEY: "am_sk_test_123",
};

vi.mock("@proliferate/environment/server", () => ({
	env: mockedEnv,
}));

describe("Autumn Client", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({}),
				text: async () => "",
			})) as unknown as typeof fetch,
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it("strips inline comments from AUTUMN_API_KEY", async () => {
		mockedEnv.AUTUMN_API_KEY = "am_sk_test_123 # Sandbox";
		mockedEnv.AUTUMN_API_URL = "https://api.useautumn.com";

		const { autumnGetCustomer } = await import("./autumn-client");
		await autumnGetCustomer("cust_123");

		const fetchMock = vi.mocked(globalThis.fetch);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const [_url, options] = fetchMock.mock.calls[0] ?? [];
		expect(options?.headers).toMatchObject({
			Authorization: "Bearer am_sk_test_123",
		});
	});

	it("accepts AUTUMN_API_KEY with an accidental Bearer prefix", async () => {
		mockedEnv.AUTUMN_API_KEY = "Bearer am_sk_test_123";
		mockedEnv.AUTUMN_API_URL = "https://api.useautumn.com";

		const { autumnGetCustomer } = await import("./autumn-client");
		await autumnGetCustomer("cust_123");

		const fetchMock = vi.mocked(globalThis.fetch);
		const [_url, options] = fetchMock.mock.calls[0] ?? [];
		expect(options?.headers).toMatchObject({
			Authorization: "Bearer am_sk_test_123",
		});
	});

	it("normalizes AUTUMN_API_URL when it already includes /v1", async () => {
		mockedEnv.AUTUMN_API_KEY = "am_sk_test_123";
		mockedEnv.AUTUMN_API_URL = "https://api.useautumn.com/v1/";

		const { autumnGetCustomer } = await import("./autumn-client");
		await autumnGetCustomer("cust_123");

		const fetchMock = vi.mocked(globalThis.fetch);
		const [url] = fetchMock.mock.calls[0] ?? [];
		expect(url).toBe("https://api.useautumn.com/v1/customers/cust_123");
	});
});
