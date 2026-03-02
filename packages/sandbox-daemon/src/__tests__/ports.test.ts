import { describe, expect, it } from "vitest";
import { DENYLISTED_PORTS } from "../config.js";

describe("Port policy", () => {
	it("denylists infrastructure ports", () => {
		expect(DENYLISTED_PORTS.has(22)).toBe(true); // SSH
		expect(DENYLISTED_PORTS.has(2375)).toBe(true); // Docker
		expect(DENYLISTED_PORTS.has(2376)).toBe(true); // Docker TLS
		expect(DENYLISTED_PORTS.has(4096)).toBe(true); // OpenCode
		expect(DENYLISTED_PORTS.has(26500)).toBe(true); // Internal
	});

	it("does not denylist normal ports", () => {
		expect(DENYLISTED_PORTS.has(3000)).toBe(false);
		expect(DENYLISTED_PORTS.has(8080)).toBe(false);
		expect(DENYLISTED_PORTS.has(5173)).toBe(false);
	});
});
