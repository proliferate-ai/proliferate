import { describe, expect, it } from "vitest";
import { DAEMON_PORT, loadConfig } from "../config.js";

describe("loadConfig", () => {
	it("defaults to worker mode", () => {
		const config = loadConfig(["node", "daemon"]);
		expect(config.mode).toBe("worker");
	});

	it("parses --mode=manager", () => {
		const config = loadConfig(["node", "daemon", "--mode=manager"]);
		expect(config.mode).toBe("manager");
	});

	it("parses --mode=worker explicitly", () => {
		const config = loadConfig(["node", "daemon", "--mode=worker"]);
		expect(config.mode).toBe("worker");
	});

	it("uses default port when env is not set", () => {
		const config = loadConfig(["node", "daemon"]);
		expect(config.port).toBe(DAEMON_PORT);
	});

	it("uses default workspace root", () => {
		const config = loadConfig(["node", "daemon"]);
		expect(config.workspaceRoot).toBe("/home/user/workspace");
	});
});
