#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scanExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);

const dbImportPattern =
	/(?:from|import)\s+['"]@proliferate\/db(?:\/[^'"]*)?['"]|(?:import|require)\s*\(\s*['"]@proliferate\/db(?:\/[^'"]*)?['"]\s*\)/g;

function lineFromIndex(content, index) {
	let line = 1;
	for (let i = 0; i < index; i++) {
		if (content.charCodeAt(i) === 10) {
			line++;
		}
	}
	return line;
}

function isExcluded(relPath) {
	if (relPath.startsWith("packages/services/") || relPath.startsWith("packages/db/")) {
		return true;
	}
	if (relPath.startsWith("packages/gateway-clients/")) {
		return true;
	}
	if (relPath.startsWith("scripts/")) {
		return true;
	}
	if (relPath.includes("/drizzle/")) {
		return true;
	}
	if (/\.test\.[^.]+$/.test(relPath) || relPath.includes("/__tests__/")) {
		return true;
	}
	return false;
}

async function walk(dir, acc = []) {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (
				entry.name === "node_modules" ||
				entry.name === ".git" ||
				entry.name === "dist" ||
				entry.name === ".next" ||
				entry.name === ".worktrees"
			) {
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
	const files = await walk(workspaceRoot);
	const findings = [];

	for (const filePath of files) {
		const rel = path.relative(workspaceRoot, filePath);

		if (isExcluded(rel)) {
			continue;
		}

		const content = await fs.readFile(filePath, "utf8");

		for (const match of content.matchAll(dbImportPattern)) {
			findings.push({
				file: rel,
				line: lineFromIndex(content, match.index ?? 0),
				snippet: match[0].trim(),
			});
		}
	}

	if (findings.length === 0) {
		console.log("No direct @proliferate/db imports found outside allowed packages.");
		return;
	}

	console.error("Found forbidden direct @proliferate/db imports:");
	for (const finding of findings) {
		console.error(`- ${finding.file}:${finding.line} ${finding.snippet}`);
	}
	console.error("\nImport from @proliferate/services instead of @proliferate/db directly.");
	console.error("DB operations must live in packages/services/src/**/db.ts files.");
	process.exit(1);
}

main().catch((error) => {
	console.error("Failed to run direct DB import check:", error);
	process.exit(1);
});
