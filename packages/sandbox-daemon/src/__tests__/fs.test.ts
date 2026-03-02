import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../event-bus.js";
import { FsSecurityError, FsTransport } from "../fs.js";

function createTestLogger(): any {
	const noop = () => undefined;
	return { child: () => createTestLogger(), info: noop, debug: noop, warn: noop, error: noop };
}

describe("FsTransport", () => {
	let workspace: string;
	let bus: EventBus;
	let fs: FsTransport;

	beforeEach(() => {
		workspace = mkdtempSync(join(tmpdir(), "daemon-fs-test-"));
		bus = new EventBus();
		fs = new FsTransport({
			workspaceRoot: workspace,
			eventBus: bus,
			logger: createTestLogger(),
		});

		// Create test files
		mkdirSync(join(workspace, "src"), { recursive: true });
		writeFileSync(join(workspace, "README.md"), "# Test");
		writeFileSync(join(workspace, "src/index.ts"), "export {}");
	});

	afterEach(() => {
		rmSync(workspace, { recursive: true, force: true });
	});

	it("lists directory tree", () => {
		const entries = fs.tree(".", 2);
		const names = entries.map((e) => e.name);
		expect(names).toContain("README.md");
		expect(names).toContain("src");
		expect(names).toContain("index.ts");
	});

	it("reads file content", () => {
		const result = fs.read("README.md");
		expect(result.content).toBe("# Test");
		expect(result.size).toBeGreaterThan(0);
	});

	it("writes file and emits event", async () => {
		const events: unknown[] = [];
		bus.subscribe((e) => events.push(e));

		await fs.write("new-file.txt", "hello world");

		expect(existsSync(join(workspace, "new-file.txt"))).toBe(true);
		const written = fs.read("new-file.txt");
		expect(written.content).toBe("hello world");

		const fsEvent = events.find((e) => (e as { stream: string }).stream === "fs_change") as {
			payload: { action: string; path: string };
		};
		expect(fsEvent).toBeDefined();
		expect(fsEvent.payload.action).toBe("write");
	});

	it("creates parent directories on write", async () => {
		await fs.write("deep/nested/file.txt", "content");
		expect(existsSync(join(workspace, "deep/nested/file.txt"))).toBe(true);
	});

	it("rejects null bytes in path", () => {
		expect(() => fs.read("file\0.txt")).toThrow(FsSecurityError);
		expect(() => fs.read("file\0.txt")).toThrow("Null byte");
	});

	it("rejects path traversal", () => {
		expect(() => fs.read("../etc/passwd")).toThrow(FsSecurityError);
		expect(() => fs.read("src/../../etc/passwd")).toThrow(FsSecurityError);
	});

	it("rejects absolute paths outside workspace", () => {
		expect(() => fs.read("/etc/passwd")).toThrow(FsSecurityError);
	});

	it("rejects symlinks that escape workspace", () => {
		const linkPath = join(workspace, "escape-link");
		symlinkSync("/etc/passwd", linkPath);

		expect(() => fs.read("escape-link")).toThrow(FsSecurityError);
	});

	it("rejects writes exceeding max size", async () => {
		const huge = "x".repeat(11 * 1024 * 1024); // 11 MB
		await expect(fs.write("huge.txt", huge)).rejects.toThrow("Payload too large");
	});

	it("returns empty for nonexistent directory", () => {
		const entries = fs.tree("nonexistent");
		expect(entries).toEqual([]);
	});

	it("throws for reading nonexistent file", () => {
		expect(() => fs.read("nonexistent.txt")).toThrow("not found");
	});

	it("throws for reading a directory", () => {
		expect(() => fs.read("src")).toThrow("directory");
	});
});
