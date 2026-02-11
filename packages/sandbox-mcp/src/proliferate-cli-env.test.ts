/**
 * Proliferate CLI — env apply/scrub tests.
 *
 * Tests the safePath, envApply, and envScrub functions without
 * spawning the full CLI process. We import the module helpers directly
 * and mock the filesystem + process interactions.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================
// Test helpers — we re-implement the pure functions
// from proliferate-cli.ts to test them in isolation.
// The CLI is a single-file script with no exports,
// so we extract and test the core logic directly.
// ============================================

/**
 * safePath — validates that an untrusted path doesn't escape `base`.
 * Mirrors the implementation in proliferate-cli.ts.
 */
function safePath(base: string, untrusted: string): string {
	const { isAbsolute, resolve, relative } = require("node:path");
	if (isAbsolute(untrusted)) throw new Error(`Path must be relative: ${untrusted}`);
	if (untrusted.split("/").includes(".."))
		throw new Error(`Path must not contain '..': ${untrusted}`);
	const resolved = resolve(base, untrusted);
	const rel = relative(base, resolved);
	if (rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(`Path escapes workspace: ${untrusted}`);
	}
	return resolved;
}

/**
 * resolveWorkspacePath — maps a workspacePath to a real FS path.
 */
function resolveWorkspacePath(workspacePath: string, workspaceDir: string): string {
	if (workspacePath === "." || workspacePath === "") return workspaceDir;
	return safePath(workspaceDir, workspacePath);
}

interface EnvFileSpec {
	workspacePath: string;
	path: string;
	format: string;
	mode: string;
	keys: Array<{ key: string; required: boolean }>;
}

/**
 * envApply — writes env files from specs.
 */
function envApply(
	spec: EnvFileSpec[],
	envOverrides: Record<string, string>,
	processEnv: Record<string, string | undefined>,
	workspaceDir: string,
): { applied: Array<{ path: string; keyCount: number }> } {
	const { dirname } = require("node:path");
	const missing: string[] = [];
	const prepared: Array<{
		repoDir: string;
		filePath: string;
		entryPath: string;
		lines: string[];
	}> = [];

	for (const entry of spec) {
		const repoDir = resolveWorkspacePath(entry.workspacePath, workspaceDir);
		const filePath = safePath(repoDir, entry.path);
		const lines: string[] = [];

		for (const { key, required } of entry.keys) {
			const val = envOverrides[key] ?? processEnv[key];
			if (val === undefined) {
				if (required) missing.push(key);
				continue;
			}
			lines.push(`${key}=${val}`);
		}

		prepared.push({ repoDir, filePath, entryPath: entry.path, lines });
	}

	if (missing.length > 0) {
		throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
	}

	const applied: Array<{ path: string; keyCount: number }> = [];
	for (const { filePath, entryPath, lines } of prepared) {
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, `${lines.join("\n")}\n`);
		applied.push({ path: entryPath, keyCount: lines.length });
	}

	return { applied };
}

/**
 * envScrub — removes secret env files and the overrides file.
 */
function envScrub(
	spec: EnvFileSpec[],
	workspaceDir: string,
	proliferateEnvFile: string,
): { scrubbed: string[] } {
	const scrubbed: string[] = [];

	for (const entry of spec) {
		if (entry.mode !== "secret") continue;
		const repoDir = resolveWorkspacePath(entry.workspacePath, workspaceDir);
		const filePath = safePath(repoDir, entry.path);
		if (existsSync(filePath)) {
			unlinkSync(filePath);
			scrubbed.push(entry.path);
		}
	}

	if (existsSync(proliferateEnvFile)) {
		unlinkSync(proliferateEnvFile);
		scrubbed.push(proliferateEnvFile);
	}

	return { scrubbed };
}

// ============================================
// Tests
// ============================================

describe("safePath", () => {
	const base = "/home/user/workspace";

	it("resolves a valid relative path", () => {
		const result = safePath(base, ".env.local");
		expect(result).toBe("/home/user/workspace/.env.local");
	});

	it("resolves a nested relative path", () => {
		const result = safePath(base, "app/.env");
		expect(result).toBe("/home/user/workspace/app/.env");
	});

	it("rejects absolute paths", () => {
		expect(() => safePath(base, "/etc/passwd")).toThrow(/Path must be relative/);
	});

	it("rejects paths with .. components", () => {
		expect(() => safePath(base, "../.env")).toThrow(/Path must not contain '..'/);
	});

	it("rejects deeply traversing paths", () => {
		expect(() => safePath(base, "foo/../../.env")).toThrow(/Path must not contain '..'/);
	});

	it("rejects double-dot at start", () => {
		expect(() => safePath(base, "..")).toThrow(/Path must not contain '..'/);
	});

	it("rejects filenames starting with '..' (defensive security)", () => {
		// "..foo" resolves to a relative path that starts with ".."
		// which is correctly rejected by the escape check
		expect(() => safePath(base, "..foo")).toThrow(/Path escapes workspace/);
	});
});

describe("envApply", () => {
	let workspaceDir: string;

	beforeEach(() => {
		workspaceDir = join(
			tmpdir(),
			`proliferate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(workspaceDir, { recursive: true });
	});

	afterEach(() => {
		// Best-effort cleanup
		try {
			const { rmSync } = require("node:fs");
			rmSync(workspaceDir, { recursive: true, force: true });
		} catch {
			// Ignore
		}
	});

	it("writes env file with matching keys from overrides", () => {
		const spec: EnvFileSpec[] = [
			{
				workspacePath: ".",
				path: ".env.local",
				format: "dotenv",
				mode: "secret",
				keys: [
					{ key: "DATABASE_URL", required: true },
					{ key: "API_KEY", required: false },
				],
			},
		];

		const result = envApply(
			spec,
			{ DATABASE_URL: "postgres://localhost/test", API_KEY: "sk-123" },
			{},
			workspaceDir,
		);

		expect(result.applied).toEqual([{ path: ".env.local", keyCount: 2 }]);
		const content = readFileSync(join(workspaceDir, ".env.local"), "utf-8");
		expect(content).toContain("DATABASE_URL=postgres://localhost/test");
		expect(content).toContain("API_KEY=sk-123");
	});

	it("falls back to processEnv when override not available", () => {
		const spec: EnvFileSpec[] = [
			{
				workspacePath: ".",
				path: ".env.local",
				format: "dotenv",
				mode: "secret",
				keys: [{ key: "SECRET", required: true }],
			},
		];

		const result = envApply(spec, {}, { SECRET: "from-process" }, workspaceDir);

		expect(result.applied).toEqual([{ path: ".env.local", keyCount: 1 }]);
		const content = readFileSync(join(workspaceDir, ".env.local"), "utf-8");
		expect(content).toContain("SECRET=from-process");
	});

	it("throws when required keys are missing", () => {
		const spec: EnvFileSpec[] = [
			{
				workspacePath: ".",
				path: ".env.local",
				format: "dotenv",
				mode: "secret",
				keys: [{ key: "MISSING_KEY", required: true }],
			},
		];

		expect(() => envApply(spec, {}, {}, workspaceDir)).toThrow(
			/Missing required environment variables/,
		);
	});

	it("skips optional missing keys without error", () => {
		const spec: EnvFileSpec[] = [
			{
				workspacePath: ".",
				path: ".env.local",
				format: "dotenv",
				mode: "secret",
				keys: [
					{ key: "PRESENT", required: false },
					{ key: "ABSENT", required: false },
				],
			},
		];

		const result = envApply(spec, { PRESENT: "yes" }, {}, workspaceDir);
		expect(result.applied).toEqual([{ path: ".env.local", keyCount: 1 }]);
	});

	it("rejects absolute paths in spec", () => {
		const spec: EnvFileSpec[] = [
			{
				workspacePath: ".",
				path: "/etc/passwd",
				format: "dotenv",
				mode: "secret",
				keys: [],
			},
		];

		expect(() => envApply(spec, {}, {}, workspaceDir)).toThrow(/Path must be relative/);
	});

	it("rejects traversal paths in spec", () => {
		const spec: EnvFileSpec[] = [
			{
				workspacePath: ".",
				path: "../../etc/shadow",
				format: "dotenv",
				mode: "secret",
				keys: [],
			},
		];

		expect(() => envApply(spec, {}, {}, workspaceDir)).toThrow(/Path must not contain '..'/);
	});

	it("handles multiple spec entries", () => {
		mkdirSync(join(workspaceDir, "backend"), { recursive: true });

		const spec: EnvFileSpec[] = [
			{
				workspacePath: ".",
				path: ".env",
				format: "dotenv",
				mode: "shared",
				keys: [{ key: "APP_URL", required: true }],
			},
			{
				workspacePath: "backend",
				path: ".env.local",
				format: "dotenv",
				mode: "secret",
				keys: [{ key: "DB_URL", required: true }],
			},
		];

		const result = envApply(
			spec,
			{ APP_URL: "http://localhost", DB_URL: "postgres://localhost/db" },
			{},
			workspaceDir,
		);

		expect(result.applied).toHaveLength(2);
		expect(result.applied[0]).toEqual({ path: ".env", keyCount: 1 });
		expect(result.applied[1]).toEqual({ path: ".env.local", keyCount: 1 });
	});
});

describe("envScrub", () => {
	let workspaceDir: string;
	let proliferateEnvFile: string;

	beforeEach(() => {
		workspaceDir = join(
			tmpdir(),
			`proliferate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(workspaceDir, { recursive: true });
		proliferateEnvFile = join(workspaceDir, ".proliferate_env.json");
	});

	afterEach(() => {
		try {
			const { rmSync } = require("node:fs");
			rmSync(workspaceDir, { recursive: true, force: true });
		} catch {
			// Ignore
		}
	});

	it("removes secret-mode env files", () => {
		const envFile = join(workspaceDir, ".env.local");
		writeFileSync(envFile, "SECRET=val\n");

		const spec: EnvFileSpec[] = [
			{
				workspacePath: ".",
				path: ".env.local",
				format: "dotenv",
				mode: "secret",
				keys: [],
			},
		];

		const result = envScrub(spec, workspaceDir, proliferateEnvFile);
		expect(result.scrubbed).toContain(".env.local");
		expect(existsSync(envFile)).toBe(false);
	});

	it("does not remove non-secret-mode files", () => {
		const envFile = join(workspaceDir, ".env");
		writeFileSync(envFile, "PUBLIC=val\n");

		const spec: EnvFileSpec[] = [
			{
				workspacePath: ".",
				path: ".env",
				format: "dotenv",
				mode: "shared",
				keys: [],
			},
		];

		const result = envScrub(spec, workspaceDir, proliferateEnvFile);
		expect(result.scrubbed).not.toContain(".env");
		expect(existsSync(envFile)).toBe(true);
	});

	it("removes the proliferate env override file", () => {
		writeFileSync(proliferateEnvFile, '{"KEY":"val"}');

		const result = envScrub([], workspaceDir, proliferateEnvFile);
		expect(result.scrubbed).toContain(proliferateEnvFile);
		expect(existsSync(proliferateEnvFile)).toBe(false);
	});

	it("handles missing files gracefully", () => {
		const spec: EnvFileSpec[] = [
			{
				workspacePath: ".",
				path: ".env.local",
				format: "dotenv",
				mode: "secret",
				keys: [],
			},
		];

		// No files exist — should not throw
		const result = envScrub(spec, workspaceDir, proliferateEnvFile);
		expect(result.scrubbed).toEqual([]);
	});

	it("rejects traversal paths in scrub spec", () => {
		const spec: EnvFileSpec[] = [
			{
				workspacePath: ".",
				path: "../../etc/shadow",
				format: "dotenv",
				mode: "secret",
				keys: [],
			},
		];

		expect(() => envScrub(spec, workspaceDir, proliferateEnvFile)).toThrow(
			/Path must not contain '..'/,
		);
	});
});
