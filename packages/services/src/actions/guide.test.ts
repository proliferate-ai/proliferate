import { describe, expect, it } from "vitest";
import { getAdapter, getGuide, listAdapters } from "./adapters";

describe("actions guide", () => {
	it("returns guide for sentry", () => {
		const guide = getGuide("sentry");
		expect(guide).toBeDefined();
		expect(guide).toContain("Sentry");
		expect(guide).toContain("list_issues");
		expect(guide).toContain("proliferate actions run");
	});

	it("returns guide for linear", () => {
		const guide = getGuide("linear");
		expect(guide).toBeDefined();
		expect(guide).toContain("Linear");
		expect(guide).toContain("create_issue");
		expect(guide).toContain("proliferate actions run");
	});

	it("returns undefined for unknown provider", () => {
		const guide = getGuide("nonexistent");
		expect(guide).toBeUndefined();
	});

	it("returns undefined for empty string", () => {
		const guide = getGuide("");
		expect(guide).toBeUndefined();
	});

	it("all adapters with guides have non-empty guide content", () => {
		const adapters = listAdapters();
		for (const { integration } of adapters) {
			const adapter = getAdapter(integration);
			if (adapter?.guide) {
				expect(adapter.guide.length).toBeGreaterThan(0);
				// Guide should contain the integration name
				expect(adapter.guide.toLowerCase()).toContain(integration.toLowerCase());
			}
		}
	});

	it("all registered adapters have guides", () => {
		const adapters = listAdapters();
		for (const { integration } of adapters) {
			const guide = getGuide(integration);
			expect(guide, `${integration} should have a guide`).toBeDefined();
		}
	});
});
