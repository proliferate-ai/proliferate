#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scanTargets = [
	"packages/services/src/workers",
	"packages/services/src/wakes",
	"packages/services/src/sessions/v1-db.ts",
	"packages/services/src/sessions/v1-service.ts",
	"apps/gateway/src/harness",
	"apps/gateway/src/hub/control-plane.ts",
	"apps/gateway/src/hub/control-plane.test.ts",
];

const scanExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const forbiddenPattern = /\bautomation[a-zA-Z0-9_]*\b/gi;

async function walk(fullPath, files = []) {
	const stat = await fs.stat(fullPath);
	if (stat.isFile()) {
		if (scanExtensions.has(path.extname(fullPath))) {
			files.push(fullPath);
		}
		return files;
	}

	const entries = await fs.readdir(fullPath, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name === "node_modules" || entry.name === "dist") {
			continue;
		}
		await walk(path.join(fullPath, entry.name), files);
	}
	return files;
}

function lineFromIndex(content, index) {
	let line = 1;
	for (let i = 0; i < index; i++) {
		if (content.charCodeAt(i) === 10) {
			line++;
		}
	}
	return line;
}

async function main() {
	const findings = [];

	for (const target of scanTargets) {
		const fullTarget = path.join(workspaceRoot, target);
		try {
			await fs.stat(fullTarget);
		} catch {
			continue;
		}

		const files = await walk(fullTarget);
		for (const filePath of files) {
			const content = await fs.readFile(filePath, "utf8");
			for (const match of content.matchAll(forbiddenPattern)) {
				findings.push({
					file: path.relative(workspaceRoot, filePath),
					line: lineFromIndex(content, match.index ?? 0),
					snippet: match[0],
				});
			}
		}
	}

	if (findings.length === 0) {
		console.log("V1 naming drift guard passed.");
		return;
	}

	console.error("V1 naming drift guard failed (legacy automation naming in V1 paths):");
	for (const finding of findings) {
		console.error(`- ${finding.file}:${finding.line} ${finding.snippet}`);
	}
	console.error(
		"Use canonical V1 terms: worker / worker_run / coworker (UI), not automation* in V1 runtime paths.",
	);
	process.exit(1);
}

main().catch((error) => {
	console.error("Failed to run V1 naming drift guard:", error);
	process.exit(1);
});
