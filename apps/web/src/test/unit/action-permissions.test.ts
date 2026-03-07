import {
	isOrgActionDenied,
	mapConnectorToolsToPermissionActions,
	resolveUserToggleState,
} from "@/lib/integrations/action-permissions";
import { describe, expect, it } from "vitest";

describe("action permissions model", () => {
	it("treats org deny as hard ceiling", () => {
		expect(
			isOrgActionDenied(
				{
					"slack:post_message": "deny",
				},
				"slack:post_message",
			),
		).toBe(true);
		expect(
			isOrgActionDenied(
				{
					"slack:post_message": "allow",
				},
				"slack:post_message",
			),
		).toBe(false);
		expect(
			isOrgActionDenied(
				{
					"slack:list_channels": "deny",
				},
				"slack:list_channels",
			),
		).toBe(true);
	});

	it("forces user toggle off when admin disables action", () => {
		const state = resolveUserToggleState({
			adminActionEnabled: false,
			userActionEnabled: true,
		});
		expect(state.checked).toBe(false);
		expect(state.disabledByAdmin).toBe(true);
	});

	it("maps connector tools to permission actions", () => {
		const actions = mapConnectorToolsToPermissionActions("abc-123", [
			{
				name: "create_ticket",
				description: "Create a ticket",
				riskLevel: "write",
			},
		]);

		expect(actions).toEqual([
			{
				key: "connector:abc-123:create_ticket",
				name: "create_ticket",
				description: "Create a ticket",
				riskLevel: "write",
			},
		]);
	});
});
