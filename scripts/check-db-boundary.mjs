#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetRoot = path.join(workspaceRoot, "packages", "services", "src");
const baselinePath = path.join(workspaceRoot, "scripts", "db-boundary-baseline.json");

const scanExtensions = new Set([".ts"]);

const drizzleOpPattern =
	/\b(?:db|tx|database|client)\s*\.\s*(?:select|insert|update|delete|execute)\s*\(/g;
const drizzleQueryPattern = /\b(?:db|tx|database|client)\s*\.\s*query\s*\./g;

function lineFromIndex(content, index) {
	let line = 1;
	for (let i = 0; i < index; i++) {
		if (content.charCodeAt(i) === 10) {
			line++;
		}
	}
	return line;
}

function isExcluded(fileName, relPath) {
	if (fileName === "db.ts" || fileName.endsWith("-db.ts")) {
		return true;
	}
	if (/\.test\.[^.]+$/.test(fileName) || relPath.includes("/__tests__/")) {
		return true;
	}
	return false;
}

async function loadBaseline() {
	try {
		const raw = await fs.readFile(baselinePath, "utf8");
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return new Map(parsed.map((f) => [f, Number.POSITIVE_INFINITY]));
		}
		return new Map(Object.entries(parsed));
	} catch {
		return new Map();
	}
}

async function walk(dir, acc = []) {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist") {
				continue;
			}
			await walk(fullPath, acc);
			continue;
		}
		if (scanExtensions.has(path.extname(entry.name))) {
			acc.push(fullPath);
		}
	}
	return acc;
}

async function main() {
	const baseline = await loadBaseline();
	const files = await walk(targetRoot);
	const findingsByFile = new Map();

	for (const filePath of files) {
		const rel = path.relative(workspaceRoot, filePath);
		const fileName = path.basename(filePath);

		if (isExcluded(fileName, rel)) {
			continue;
		}

		const content = await fs.readFile(filePath, "utf8");
		const fileFindings = [];

		for (const match of content.matchAll(drizzleOpPattern)) {
			fileFindings.push({
				file: rel,
				line: lineFromIndex(content, match.index ?? 0),
				snippet: match[0].trim(),
			});
		}

		for (const match of content.matchAll(drizzleQueryPattern)) {
			fileFindings.push({
				file: rel,
				line: lineFromIndex(content, match.index ?? 0),
				snippet: match[0].trim(),
			});
		}

		if (fileFindings.length > 0) {
			findingsByFile.set(rel, fileFindings);
		}
	}

	let baselinedTotal = 0;
	const newViolations = [];
	const regressions = [];

	for (const [file, fileFindings] of findingsByFile) {
		const allowedCount = baseline.get(file);

		if (allowedCount === undefined) {
			newViolations.push(...fileFindings);
		} else if (fileFindings.length > allowedCount) {
			regressions.push({ file, allowed: allowedCount, actual: fileFindings.length });
			for (const f of fileFindings.slice(allowedCount)) {
				newViolations.push(f);
			}
			baselinedTotal += allowedCount;
		} else {
			baselinedTotal += fileFindings.length;
		}
	}

	if (baselinedTotal > 0) {
		const fileCount = [...findingsByFile.keys()].filter((f) => baseline.has(f)).length;
		console.log(
			`DB boundary: ${baselinedTotal} known violation(s) in ${fileCount} baselined file(s).`,
		);
	}

	if (regressions.length > 0) {
		console.error("DB boundary regressions in baselined files:");
		for (const r of regressions) {
			console.error(`- ${r.file}: was ${r.allowed}, now ${r.actual} (+${r.actual - r.allowed})`);
		}
	}

	if (newViolations.length === 0 && regressions.length === 0) {
		console.log("No new DB boundary violations found.");
		return;
	}

	if (newViolations.length > 0) {
		console.error("Found NEW DB operations outside of db.ts files in packages/services/:");
		for (const finding of newViolations) {
			console.error(`- ${finding.file}:${finding.line} ${finding.snippet}`);
		}
	}
	console.error(
		"\nAll database operations (db.select, db.insert, db.update, db.delete, db.query, db.execute)",
	);
	console.error("must live in files named db.ts (or *-db.ts) within packages/services/src/.");
	console.error(
		"If migrating an existing file, update its count in scripts/db-boundary-baseline.json.",
	);
	process.exit(1);
}

main().catch((error) => {
	console.error("Failed to run DB boundary check:", error);
	process.exit(1);
});
