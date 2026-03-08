import { describe, expect, it } from "vitest";
import { DAEMON_PORT, loadConfig } from "../config.js";

describe("loadConfig", () => {
	it("uses default port when env is not set", () => {
		const config = loadConfig(["node", "daemon"]);
		expect(config.port).toBe(DAEMON_PORT);
	});

	it("uses default workspace root", () => {
		const config = loadConfig(["node", "daemon"]);
		expect(config.workspaceRoot).toBe("/home/user/workspace");
	});
});
