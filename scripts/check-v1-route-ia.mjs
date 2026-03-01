#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredRouteFiles = [
	{ route: "/", file: "apps/web/src/app/page.tsx" },
	{ route: "/sessions", file: "apps/web/src/app/(command-center)/sessions/page.tsx" },
	{ route: "/coworkers", file: "apps/web/src/app/(command-center)/coworkers/page.tsx" },
	{ route: "/workspace/[id]", file: "apps/web/src/app/(workspace)/workspace/[id]/page.tsx" },
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
	"/dashboard/configurations",
];

async function fileExists(relPath) {
	try {
		await fs.access(path.join(workspaceRoot, relPath));
		return true;
	} catch {
		return false;
	}
}

async function main() {
	const failures = [];

	for (const item of requiredRouteFiles) {
		if (!(await fileExists(item.file))) {
			failures.push(`Missing canonical route file for ${item.route}: ${item.file}`);
		}
	}

	const rootPage = await fs.readFile(path.join(workspaceRoot, "apps/web/src/app/page.tsx"), "utf8");
	if (!rootPage.includes('redirect("/sessions")') && !rootPage.includes("redirect('/sessions')")) {
		failures.push("Root route '/' must redirect to '/sessions' for V1 IA consistency.");
	}

	const sidebar = await fs.readFile(path.join(workspaceRoot, sidebarPath), "utf8");

	for (const target of requiredPrimaryTargets) {
		if (!sidebar.includes(target)) {
			failures.push(`Sidebar is missing required primary target: ${target}`);
		}
	}

	for (const target of bannedPrimaryTargets) {
		if (sidebar.includes(target)) {
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
