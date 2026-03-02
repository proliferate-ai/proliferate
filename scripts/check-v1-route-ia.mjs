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
const commandSearchPath = "apps/web/src/components/dashboard/command-search.tsx";

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
	"/dashboard/automations",
	"/dashboard/repos",
	"/dashboard/runs",
	"/dashboard/triggers",
];

// Legacy route directories that were deleted in PR 09 and must not reappear.
const bannedRouteDirectories = [
	"apps/web/src/app/(command-center)/dashboard/actions",
	"apps/web/src/app/(command-center)/dashboard/activity",
	"apps/web/src/app/(command-center)/dashboard/automations",
	"apps/web/src/app/(command-center)/dashboard/configurations",
	"apps/web/src/app/(command-center)/dashboard/inbox",
	"apps/web/src/app/(command-center)/dashboard/my-work",
	"apps/web/src/app/(command-center)/dashboard/repos",
	"apps/web/src/app/(command-center)/dashboard/runs",
	"apps/web/src/app/(command-center)/dashboard/triggers",
];

// Dead code files that were removed and must not be re-created.
const bannedDeadFiles = [
	"apps/web/src/hooks/use-my-work.ts",
	"apps/web/src/hooks/use-org-activity.ts",
	"apps/web/src/components/inbox/inbox-empty.tsx",
	"apps/web/src/components/inbox/inbox-item.tsx",
];

const rootCanonicalRedirectPattern = /redirect\(\s*["']\/dashboard["']\s*\)/;
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
		if (!rootCanonicalRedirectPattern.test(rootPage)) {
			failures.push("Root route '/' must redirect to '/dashboard' (canonical composer route).");
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

	// Sidebar: check both required and banned targets (primary nav)
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

	// Command search: check banned targets only (supplementary nav surface)
	if (await fileExists(commandSearchPath)) {
		const commandSearch = await fs.readFile(path.join(workspaceRoot, commandSearchPath), "utf8");
		const commandSearchTargets = extractSidebarRoutes(commandSearch);

		for (const target of bannedPrimaryTargets) {
			if (commandSearchTargets.has(target)) {
				failures.push(`Command search still references legacy primary target: ${target}`);
			}
		}
	}

	// Ensure deleted legacy route directories haven't reappeared.
	for (const dir of bannedRouteDirectories) {
		if (await fileExists(dir)) {
			failures.push(`Legacy route directory must not exist: ${dir}`);
		}
	}

	// Ensure deleted dead-code files haven't been re-created.
	for (const file of bannedDeadFiles) {
		if (await fileExists(file)) {
			failures.push(`Dead code file must not exist: ${file}`);
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
