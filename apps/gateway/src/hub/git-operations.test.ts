import { describe, expect, it } from "vitest";
import { parseBusyState, parseLogOutput, parseStatusV2 } from "./git-operations";

describe("parseStatusV2", () => {
	it("parses empty output (clean repo)", () => {
		const result = parseStatusV2("");
		expect(result.branch).toBe("");
		expect(result.stagedChanges).toEqual([]);
		expect(result.unstagedChanges).toEqual([]);
		expect(result.untrackedFiles).toEqual([]);
		expect(result.conflictedFiles).toEqual([]);
	});

	it("parses branch header", () => {
		const output =
			"# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0";
		const result = parseStatusV2(output);
		expect(result.branch).toBe("main");
		expect(result.detached).toBe(false);
		expect(result.ahead).toBe(2);
		expect(result.behind).toBe(1);
	});

	it("parses detached HEAD", () => {
		const output = "# branch.oid abc123\0# branch.head (detached)\0";
		const result = parseStatusV2(output);
		expect(result.detached).toBe(true);
		expect(result.branch).toBe("HEAD (detached)");
	});

	it("parses branch with no upstream (ahead/behind null)", () => {
		const output = "# branch.oid abc123\0# branch.head feature/test\0";
		const result = parseStatusV2(output);
		expect(result.branch).toBe("feature/test");
		expect(result.ahead).toBeNull();
		expect(result.behind).toBeNull();
	});

	it("parses modified file (staged only)", () => {
		const output =
			"# branch.head main\0" + "1 M. N... 100644 100644 100644 abc123 def456 src/index.ts\0";
		const result = parseStatusV2(output);
		expect(result.stagedChanges).toHaveLength(1);
		expect(result.stagedChanges[0]).toEqual({
			path: "src/index.ts",
			indexStatus: "M",
			worktreeStatus: ".",
		});
		expect(result.unstagedChanges).toHaveLength(0);
	});

	it("parses modified file (unstaged only)", () => {
		const output =
			"# branch.head main\0" + "1 .M N... 100644 100644 100644 abc123 def456 src/utils.ts\0";
		const result = parseStatusV2(output);
		expect(result.stagedChanges).toHaveLength(0);
		expect(result.unstagedChanges).toHaveLength(1);
		expect(result.unstagedChanges[0]).toEqual({
			path: "src/utils.ts",
			indexStatus: ".",
			worktreeStatus: "M",
		});
	});

	it("parses both staged and unstaged (MM)", () => {
		const output =
			"# branch.head main\0" + "1 MM N... 100644 100644 100644 abc123 def456 src/index.ts\0";
		const result = parseStatusV2(output);
		expect(result.stagedChanges).toHaveLength(1);
		expect(result.stagedChanges[0]).toEqual({
			path: "src/index.ts",
			indexStatus: "M",
			worktreeStatus: ".",
		});
		expect(result.unstagedChanges).toHaveLength(1);
		expect(result.unstagedChanges[0]).toEqual({
			path: "src/index.ts",
			indexStatus: ".",
			worktreeStatus: "M",
		});
	});

	it("parses added file (staged)", () => {
		const output =
			"# branch.head main\0" + "1 A. N... 000000 100644 100644 0000000 abc123 src/new-file.ts\0";
		const result = parseStatusV2(output);
		expect(result.stagedChanges).toHaveLength(1);
		expect(result.stagedChanges[0].indexStatus).toBe("A");
	});

	it("parses deleted file", () => {
		const output =
			"# branch.head main\0" + "1 D. N... 100644 000000 000000 abc123 0000000 src/old-file.ts\0";
		const result = parseStatusV2(output);
		expect(result.stagedChanges).toHaveLength(1);
		expect(result.stagedChanges[0].indexStatus).toBe("D");
	});

	it("parses untracked files", () => {
		const output = "# branch.head main\0" + "? .env.local\0" + "? temp.log\0";
		const result = parseStatusV2(output);
		expect(result.untrackedFiles).toEqual([".env.local", "temp.log"]);
	});

	it("parses conflicted/unmerged files", () => {
		const output =
			"# branch.head main\0" +
			"u UU N... 100644 100644 100644 100644 abc123 def456 ghi789 src/config.ts\0";
		const result = parseStatusV2(output);
		expect(result.conflictedFiles).toEqual(["src/config.ts"]);
	});

	it("parses renamed file", () => {
		const output =
			"# branch.head main\0" +
			"2 R. N... 100644 100644 100644 abc123 def456 R100 src/new-name.ts\0src/old-name.ts\0";
		const result = parseStatusV2(output);
		expect(result.stagedChanges).toHaveLength(1);
		expect(result.stagedChanges[0].path).toBe("src/old-name.ts -> src/new-name.ts");
		expect(result.stagedChanges[0].indexStatus).toBe("R");
	});

	it("parses mixed status (staged, unstaged, untracked, conflicted)", () => {
		const output =
			"# branch.oid abc123\0" +
			"# branch.head feature/auth\0" +
			"# branch.upstream origin/feature/auth\0" +
			"# branch.ab +3 -0\0" +
			"1 M. N... 100644 100644 100644 abc123 def456 src/auth.ts\0" +
			"1 .M N... 100644 100644 100644 abc123 def456 src/utils.ts\0" +
			"? .env\0" +
			"u UU N... 100644 100644 100644 100644 abc123 def456 ghi789 src/merge.ts\0";
		const result = parseStatusV2(output);
		expect(result.branch).toBe("feature/auth");
		expect(result.ahead).toBe(3);
		expect(result.behind).toBe(0);
		expect(result.stagedChanges).toHaveLength(1);
		expect(result.unstagedChanges).toHaveLength(1);
		expect(result.untrackedFiles).toEqual([".env"]);
		expect(result.conflictedFiles).toEqual(["src/merge.ts"]);
	});

	it("handles paths with spaces", () => {
		const output =
			"# branch.head main\0" + "1 M. N... 100644 100644 100644 abc123 def456 src/my file.ts\0";
		const result = parseStatusV2(output);
		expect(result.stagedChanges[0].path).toBe("src/my file.ts");
	});
});

describe("parseLogOutput", () => {
	it("returns empty array for empty output", () => {
		expect(parseLogOutput("")).toEqual([]);
		expect(parseLogOutput("  \n  ")).toEqual([]);
	});

	it("parses single commit", () => {
		const output = "\x1eabc1234def5678\x1ffeat: add auth\x1fPablo\x1f2025-01-15T10:30:00-05:00";
		const result = parseLogOutput(output);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			sha: "abc1234def5678",
			message: "feat: add auth",
			author: "Pablo",
			date: "2025-01-15T10:30:00-05:00",
		});
	});

	it("parses multiple commits", () => {
		const output =
			"\x1eabc123\x1ffeat: add auth\x1fPablo\x1f2025-01-15T10:30:00-05:00" +
			"\x1edef456\x1ffix: login bug\x1fAlice\x1f2025-01-14T09:00:00-05:00";
		const result = parseLogOutput(output);
		expect(result).toHaveLength(2);
		expect(result[0].sha).toBe("abc123");
		expect(result[1].sha).toBe("def456");
	});

	it("handles commit messages with special characters", () => {
		const output =
			"\x1eabc123\x1ffix: handle | pipe in names\x1fPablo\x1f2025-01-15T10:30:00-05:00";
		const result = parseLogOutput(output);
		expect(result[0].message).toBe("fix: handle | pipe in names");
	});

	it("handles unicode in author names", () => {
		const output = "\x1eabc123\x1ffeat: something\x1fJosé García\x1f2025-01-15T10:30:00-05:00";
		const result = parseLogOutput(output);
		expect(result[0].author).toBe("José García");
	});

	it("skips entries with too few fields", () => {
		const output = "\x1eabc123\x1fonly-two-fields";
		const result = parseLogOutput(output);
		expect(result).toHaveLength(0);
	});
});

describe("parseBusyState", () => {
	it("parses all-clear state", () => {
		const output = "shallow:false\nlock:0\nrebase:0\nmerge:0\n";
		const result = parseBusyState(output);
		expect(result).toEqual({
			isShallow: false,
			isBusy: false,
			rebaseInProgress: false,
			mergeInProgress: false,
		});
	});

	it("detects shallow clone", () => {
		const output = "shallow:true\nlock:0\nrebase:0\nmerge:0\n";
		const result = parseBusyState(output);
		expect(result.isShallow).toBe(true);
	});

	it("detects index lock (busy)", () => {
		const output = "shallow:false\nlock:1\nrebase:0\nmerge:0\n";
		const result = parseBusyState(output);
		expect(result.isBusy).toBe(true);
	});

	it("detects rebase in progress", () => {
		const output = "shallow:false\nlock:0\nrebase:1\nmerge:0\n";
		const result = parseBusyState(output);
		expect(result.rebaseInProgress).toBe(true);
	});

	it("detects merge in progress", () => {
		const output = "shallow:false\nlock:0\nrebase:0\nmerge:1\n";
		const result = parseBusyState(output);
		expect(result.mergeInProgress).toBe(true);
	});

	it("detects multiple states simultaneously", () => {
		const output = "shallow:true\nlock:1\nrebase:1\nmerge:0\n";
		const result = parseBusyState(output);
		expect(result.isShallow).toBe(true);
		expect(result.isBusy).toBe(true);
		expect(result.rebaseInProgress).toBe(true);
		expect(result.mergeInProgress).toBe(false);
	});

	it("handles empty output gracefully", () => {
		const result = parseBusyState("");
		expect(result).toEqual({
			isShallow: false,
			isBusy: false,
			rebaseInProgress: false,
			mergeInProgress: false,
		});
	});
});
