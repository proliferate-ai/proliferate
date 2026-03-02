#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredRouteFiles = [
	{ route: "/", file: "apps/web/src/app/page.tsx" },
	{ route: "/sessions", file: "apps/web/src/app/(command-center)/sessions/page.tsx" },
	{ route: "/coworkers", file: "apps/web/src/app/(command-center)/coworkers/page.tsx" },
	{ route: "/coworkers/[id]", file: "apps/web/src/app/(command-center)/coworkers/[id]/page.tsx" },
	{
		route: "/coworkers/[id]/events",
		file: "apps/web/src/app/(command-center)/coworkers/[id]/events/page.tsx",
	},
	{ route: "/integrations", file: "apps/web/src/app/(command-center)/integrations/page.tsx" },
	{ route: "/workspace/[id]", file: "apps/web/src/app/(workspace)/workspace/[id]/page.tsx" },
	{
		route: "/workspace/setup/[id]",
		file: "apps/web/src/app/(workspace)/workspace/setup/[id]/page.tsx",
	},
	{
		route: "/settings/repositories",
		file: "apps/web/src/app/(command-center)/settings/repositories/page.tsx",
	},
];

const sidebarPath = "apps/web/src/components/dashboard/sidebar.tsx";

const requiredPrimaryTargets = [
	"/",
	"/sessions",
	"/coworkers",
	"/integrations",
	"/settings/profile",
];
const bannedPrimaryTargets = [
	"/dashboard/my-work",
	"/dashboard/inbox",
	"/dashboard/activity",
	"/dashboard/actions",
	"/dashboard/configurations",
	"/dashboard/repos",
];

const rootMustNotRedirectToSessionsPattern = /redirect\(\s*["']\/sessions["']\s*\)/;
const canonicalRouteMustNotRedirectToLegacyPattern =
	/redirect\(\s*["']\/dashboard(?:\/[^"']*)?["']\s*\)/;

async function fileExists(relPath) {
	try {
		await fs.access(path.join(workspaceRoot, relPath));
		return true;
	} catch {
		return false;
	}
}

function extractSidebarRoutes(sidebarContent) {
	const routes = new Set();
	const routePatterns = [
		/handleNavigate\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
		/router\.push\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
		/href=\s*["'`]([^"'`]+)["'`]/g,
	];

	for (const pattern of routePatterns) {
		for (const match of sidebarContent.matchAll(pattern)) {
			const route = match[1]?.trim();
			if (route?.startsWith("/")) {
				routes.add(route);
			}
		}
	}

	return routes;
}

async function main() {
	const failures = [];

	for (const item of requiredRouteFiles) {
		if (!(await fileExists(item.file))) {
			failures.push(`Missing canonical route file for ${item.route}: ${item.file}`);
		}
	}

	const rootPagePath = "apps/web/src/app/page.tsx";
	if (await fileExists(rootPagePath)) {
		const rootPage = await fs.readFile(path.join(workspaceRoot, rootPagePath), "utf8");
		if (rootMustNotRedirectToSessionsPattern.test(rootPage)) {
			failures.push("Root route '/' must not redirect to '/sessions'.");
		}
	}

	for (const item of requiredRouteFiles) {
		if (item.route === "/") {
			continue;
		}
		if (!(await fileExists(item.file))) {
			continue;
		}
		const content = await fs.readFile(path.join(workspaceRoot, item.file), "utf8");
		if (canonicalRouteMustNotRedirectToLegacyPattern.test(content)) {
			failures.push(
				`Canonical route ${item.route} redirects back to legacy dashboard IA in ${item.file}.`,
			);
		}
	}

	let sidebarTargets = new Set();
	if (await fileExists(sidebarPath)) {
		const sidebar = await fs.readFile(path.join(workspaceRoot, sidebarPath), "utf8");
		sidebarTargets = extractSidebarRoutes(sidebar);
	}

	for (const target of requiredPrimaryTargets) {
		if (!sidebarTargets.has(target)) {
			failures.push(`Sidebar is missing required primary target: ${target}`);
		}
	}

	for (const target of bannedPrimaryTargets) {
		if (sidebarTargets.has(target)) {
			failures.push(`Sidebar still references legacy primary target: ${target}`);
		}
	}

	if (failures.length === 0) {
		console.log("V1 route IA guard passed.");
		return;
	}

	console.error("V1 route IA guard failed:");
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	process.exit(1);
}

main().catch((error) => {
	console.error("Failed to run V1 route IA guard:", error);
	process.exit(1);
});
