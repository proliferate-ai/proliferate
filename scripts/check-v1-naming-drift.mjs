#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scanTargets = [
	"apps/web/src/app/(workspace)/workspace/[id]/page.tsx",
	"apps/web/src/app/(command-center)/sessions/page.tsx",
	"apps/web/src/components/dashboard/sidebar.tsx",
	"apps/web/src/components/dashboard/command-search.tsx",
	"apps/web/src/components/dashboard/empty-state.tsx",
	"packages/services/src/workers",
	"packages/services/src/wakes",
	"packages/services/src/sessions/v1-db.ts",
	"packages/services/src/sessions/v1-service.ts",
	"apps/gateway/src/harness",
	"apps/gateway/src/hub/control-plane.ts",
	"apps/gateway/src/hub/control-plane.test.ts",
	"packages/db/src/schema",
];

// Dead DB tables that were dropped in PR 11. Guard against schema re-introduction.
const bannedSchemaSymbols = ["sessionToolInvocations", "triggerEventActions", "workspaceCacheSnapshots"];

const scanExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const forbiddenPattern = /\b(?:automation[a-zA-Z0-9_]*|configuration[a-zA-Z0-9_]*)\b/gi;
const stringLiteralPattern = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
const skipTermScanPathPatterns = [/^packages\/db\/src\/schema\//];
const ignoreStringPatterns = [
	/^\/dashboard\//,
	/^@\//,
	/^\.\/automation-/,
	/^automation(?:[._][a-z0-9_]+)?$/i,
	/^configuration(?:s|Id|_id)?$/i,
];

const sessionKindsFile = "packages/db/src/schema/schema.ts";
const sharedSessionContractFile = "packages/shared/src/contracts/sessions.ts";
const allowedSessionKinds = ["manager", "task", "setup"];

async function statOrNull(fullPath) {
	try {
		return await fs.stat(fullPath);
	} catch {
		return null;
	}
}

async function walk(fullPath, files = []) {
	const stat = await statOrNull(fullPath);
	if (!stat) {
		return files;
	}

	if (stat.isFile()) {
		if (scanExtensions.has(path.extname(fullPath))) {
			files.push(fullPath);
		}
		return files;
	}

	const entries = await fs.readdir(fullPath, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".next") {
			continue;
		}
		await walk(path.join(fullPath, entry.name), files);
	}
	return files;
}

function lineFromIndex(content, index) {
	return content.substring(0, index).split("\n").length;
}

function shouldIgnoreStringLiteral(raw) {
	const value = raw.trim();
	if (!value) {
		return true;
	}
	return ignoreStringPatterns.some((pattern) => pattern.test(value));
}

/**
 * Extract static segments from a template literal, splitting on `${...}` expressions.
 * For plain strings (no interpolation), returns the full string as a single segment.
 */
function staticSegments(literalContent) {
	if (!literalContent.includes("${")) {
		return [literalContent];
	}
	return literalContent.split(/\$\{[^}]*\}/g).filter(Boolean);
}

function collectTermFindings(content, file) {
	const findings = [];
	for (const literalMatch of content.matchAll(stringLiteralPattern)) {
		const literalContent = literalMatch[2] ?? "";
		const segments = staticSegments(literalContent);

		for (const segment of segments) {
			if (shouldIgnoreStringLiteral(segment)) {
				continue;
			}

			for (const match of segment.matchAll(forbiddenPattern)) {
				const literalStart = literalMatch.index ?? 0;
				const segmentOffset = literalContent.indexOf(segment);
				const relativeOffset = segmentOffset + (match.index ?? 0);
				const absoluteIndex = literalStart + relativeOffset;
				findings.push({
					file,
					line: lineFromIndex(content, absoluteIndex),
					snippet: match[0],
				});
			}
		}
	}
	return findings;
}

async function validateSessionKindEnum(failures) {
	const fullPath = path.join(workspaceRoot, sessionKindsFile);
	const content = await fs.readFile(fullPath, "utf8");

	let kinds = [];
	const enumMatch = content.match(/pgEnum\(\s*["']session_kind["']\s*,\s*\[([\s\S]*?)\]\s*\)/);
	if (enumMatch) {
		kinds = Array.from(enumMatch[1].matchAll(/["']([^"']+)["']/g)).map((m) => m[1]);
	} else {
		const checkMatch = content.match(/sessions_kind_check[\s\S]*?ARRAY\[(?<values>[\s\S]*?)\]/);
		if (!checkMatch?.groups?.values) {
			failures.push(`Could not locate session_kind enum declaration in ${sessionKindsFile}.`);
			return;
		}
		kinds = Array.from(checkMatch.groups.values.matchAll(/'([^']+)'::text/g)).map((m) => m[1]);
	}
	const sortedKinds = [...kinds].sort();
	const sortedAllowed = [...allowedSessionKinds].sort();
	if (sortedKinds.length !== sortedAllowed.length) {
		failures.push(
			`session_kind enum must be exactly [${sortedAllowed.join(", ")}], found [${sortedKinds.join(", ")}].`,
		);
		return;
	}
	for (let i = 0; i < sortedAllowed.length; i++) {
		if (sortedKinds[i] !== sortedAllowed[i]) {
			failures.push(
				`session_kind enum must be exactly [${sortedAllowed.join(", ")}], found [${sortedKinds.join(", ")}].`,
			);
			return;
		}
	}
}

async function validateSharedSessionKindContract(failures) {
	const fullPath = path.join(workspaceRoot, sharedSessionContractFile);
	const content = await fs.readFile(fullPath, "utf8");
	const expectedEnumPattern =
		/z\.enum\(\s*\[\s*["']manager["']\s*,\s*["']task["']\s*,\s*["']setup["']\s*\]\s*\)/;
	if (!expectedEnumPattern.test(content)) {
		failures.push(
			`Expected shared session kind enum z.enum(["manager", "task", "setup"]) in ${sharedSessionContractFile}.`,
		);
	}
}

async function main() {
	const findings = [];
	const failures = [];

	for (const target of scanTargets) {
		const fullTarget = path.join(workspaceRoot, target);
		const files = await walk(fullTarget);
		for (const filePath of files) {
			const relative = path.relative(workspaceRoot, filePath);
			if (skipTermScanPathPatterns.some((pattern) => pattern.test(relative))) {
				continue;
			}
			const content = await fs.readFile(filePath, "utf8");
			findings.push(...collectTermFindings(content, relative));
		}
	}

	// Check that dropped DB tables haven't been re-introduced in the schema.
	const schemaPath = path.join(workspaceRoot, "packages/db/src/schema/schema.ts");
	try {
		const schemaContent = await fs.readFile(schemaPath, "utf8");
		for (const symbol of bannedSchemaSymbols) {
			if (schemaContent.includes(symbol)) {
				findings.push({
					file: "packages/db/src/schema/schema.ts",
					line: lineFromIndex(schemaContent, schemaContent.indexOf(symbol)),
					snippet: `${symbol} (dropped table re-introduced)`,
				});
			}
		}
	} catch {
		// Schema file missing is fine — skip this check.
	}

	await validateSessionKindEnum(failures);
	await validateSharedSessionKindContract(failures);

	if (findings.length === 0 && failures.length === 0) {
		console.log("V1 naming drift guard passed.");
		return;
	}

	if (findings.length > 0) {
		console.error(
			"V1 naming drift guard failed (legacy automation/configuration naming in guarded paths):",
		);
		for (const finding of findings) {
			console.error(`- ${finding.file}:${finding.line} ${finding.snippet}`);
		}
	}

	if (failures.length > 0) {
		console.error("V1 naming drift guard failed (session kind contract checks):");
		for (const failure of failures) {
			console.error(`- ${failure}`);
		}
	}

	console.error(
		"Use canonical V1 terms in guarded surfaces: coworker (UI), worker / worker_run (runtime), session kinds manager|task|setup.",
	);
	process.exit(1);
}

main().catch((error) => {
	console.error("Failed to run V1 naming drift guard:", error);
	process.exit(1);
});
