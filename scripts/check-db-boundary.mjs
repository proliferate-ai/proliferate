#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetRoot = path.join(workspaceRoot, "packages", "services", "src");
const baselinePath = path.join(workspaceRoot, "scripts", "db-boundary-baseline.json");

const scanExtensions = new Set([".ts"]);

const drizzleOpPattern = /\b(?:db|tx)\s*\.\s*(?:select|insert|update|delete|execute)\s*\(/g;
const drizzleQueryPattern = /\b(?:db|tx)\s*\.\s*query\s*\./g;

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
		return new Set(JSON.parse(raw));
	} catch {
		return new Set();
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
	const findings = [];

	for (const filePath of files) {
		const rel = path.relative(workspaceRoot, filePath);
		const fileName = path.basename(filePath);

		if (isExcluded(fileName, rel)) {
			continue;
		}

		const content = await fs.readFile(filePath, "utf8");

		for (const match of content.matchAll(drizzleOpPattern)) {
			findings.push({
				file: rel,
				line: lineFromIndex(content, match.index ?? 0),
				snippet: match[0].trim(),
			});
		}

		for (const match of content.matchAll(drizzleQueryPattern)) {
			findings.push({
				file: rel,
				line: lineFromIndex(content, match.index ?? 0),
				snippet: match[0].trim(),
			});
		}
	}

	const baselined = [];
	const newViolations = [];

	for (const f of findings) {
		if (baseline.has(f.file)) {
			baselined.push(f);
		} else {
			newViolations.push(f);
		}
	}

	if (baselined.length > 0) {
		const files = [...new Set(baselined.map((f) => f.file))];
		console.log(
			`DB boundary: ${baselined.length} known violation(s) in ${files.length} baselined file(s).`,
		);
	}

	if (newViolations.length === 0) {
		console.log("No new DB boundary violations found.");
		return;
	}

	console.error("Found NEW DB operations outside of db.ts files in packages/services/:");
	for (const finding of newViolations) {
		console.error(`- ${finding.file}:${finding.line} ${finding.snippet}`);
	}
	console.error(
		"\nAll database operations (db.select, db.insert, db.update, db.delete, db.query, db.execute)",
	);
	console.error("must live in files named db.ts (or *-db.ts) within packages/services/src/.");
	console.error(
		"If migrating an existing file, remove it from scripts/db-boundary-baseline.json after.",
	);
	process.exit(1);
}

main().catch((error) => {
	console.error("Failed to run DB boundary check:", error);
	process.exit(1);
});
