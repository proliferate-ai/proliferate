import { getProviderActions } from "@proliferate/providers";
import { describe, expect, it } from "vitest";

describe("provider discovery actions", () => {
	it("includes linear discovery actions", () => {
		const linear = getProviderActions("linear");
		expect(linear).toBeDefined();
		const ids = linear?.actions.map((action) => action.id) ?? [];
		expect(ids).toEqual(
			expect.arrayContaining(["list_teams", "list_projects", "list_workflow_states", "list_users"]),
		);
	});

	it("includes jira discovery actions", () => {
		const jira = getProviderActions("jira");
		expect(jira).toBeDefined();
		const ids = jira?.actions.map((action) => action.id) ?? [];
		expect(ids).toEqual(
			expect.arrayContaining(["list_projects", "list_issue_types", "list_users"]),
		);
	});

	it("includes sentry discovery actions", () => {
		const sentry = getProviderActions("sentry");
		expect(sentry).toBeDefined();
		const ids = sentry?.actions.map((action) => action.id) ?? [];
		expect(ids).toEqual(expect.arrayContaining(["list_organizations", "list_projects"]));
	});
});
