#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetRoot = path.join(workspaceRoot, "apps", "web", "src");

const scanExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);

const directApiFetchPattern = /fetch\s*\(\s*(['"`])\/api\/[^'"`]*\1/g;
const apiUrlVariablePattern =
	/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])\/api\/[^'"`]*\2/g;

function lineFromIndex(content, index) {
	let line = 1;
	for (let i = 0; i < index; i++) {
		if (content.charCodeAt(i) === 10) {
			line++;
		}
	}
	return line;
}

async function walk(dir, acc = []) {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
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
	const files = await walk(targetRoot);
	const findings = [];

	for (const filePath of files) {
		const rel = path.relative(workspaceRoot, filePath);
		const content = await fs.readFile(filePath, "utf8");
		const apiVars = new Set();

		for (const match of content.matchAll(apiUrlVariablePattern)) {
			apiVars.add(match[1]);
		}

		for (const match of content.matchAll(directApiFetchPattern)) {
			findings.push({
				file: rel,
				line: lineFromIndex(content, match.index ?? 0),
				snippet: match[0].trim(),
			});
		}

		for (const variableName of apiVars) {
			const varFetchPattern = new RegExp(`fetch\\s*\\(\\s*${variableName}\\s*[,)]`, "g");
			for (const match of content.matchAll(varFetchPattern)) {
				findings.push({
					file: rel,
					line: lineFromIndex(content, match.index ?? 0),
					snippet: `fetch(${variableName}, ...)`,
				});
			}
		}
	}

	if (findings.length === 0) {
		console.log("No raw local /api fetch calls found.");
		return;
	}

	console.error("Found forbidden raw local /api fetch calls:");
	for (const finding of findings) {
		console.error(`- ${finding.file}:${finding.line} ${finding.snippet}`);
	}
	console.error("\nUse oRPC procedures/hooks instead of fetch('/api/...') in web source.");
	process.exit(1);
}

main().catch((error) => {
	console.error("Failed to run raw /api fetch check:", error);
	process.exit(1);
});
