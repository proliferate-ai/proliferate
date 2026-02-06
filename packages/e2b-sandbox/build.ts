import "dotenv/config";
import { env } from "@proliferate/environment/server";
import { Template, defaultBuildLogger } from "e2b";
import { template } from "./template";

/**
 * Build the E2B sandbox template.
 *
 * Environment variables:
 * - E2B_API_KEY: Required. API key for E2B.
 * - E2B_DOMAIN: Optional. Custom domain for self-hosted E2B infrastructure.
 * - E2B_TEMPLATE_ALIAS: Required. Custom alias for the template.
 *
 * For self-hosted E2B:
 *   E2B_API_KEY=xxx E2B_DOMAIN=e2b.company.com pnpm build:template
 */
async function main() {
	// Skip build if no E2B API key is set (e.g., in CI)
	if (!env.E2B_API_KEY) {
		console.log("Skipping e2b template build: E2B_API_KEY not set");
		return;
	}

	const domain = env.E2B_DOMAIN;
	const alias = env.E2B_TEMPLATE_ALIAS;
	if (!alias) {
		throw new Error("E2B_TEMPLATE_ALIAS is required to build the E2B template");
	}

	console.log(`Building ${alias} template...`);
	if (domain) {
		console.log(`Using self-hosted E2B domain: ${domain}`);
	}

	// Build options - resources match e2b.toml
	const buildOpts: Parameters<typeof Template.build>[1] = {
		alias,
		cpuCount: 4,
		memoryMB: 8192,
		onBuildLogs: defaultBuildLogger(),
	};

	// Add domain for self-hosted E2B
	if (domain) {
		// @ts-expect-error - domain option exists in E2B SDK for self-hosted
		buildOpts.domain = domain;
	}

	const result = await Template.build(template, buildOpts);

	console.log("\nTemplate built successfully!");
	console.log(`Template ID: ${result.templateId}`);
	console.log(`Alias: ${alias}`);
	if (domain) {
		console.log(`Domain: ${domain}`);
	}
}

main().catch((err) => {
	console.error("Build failed:", err);
	process.exit(1);
});
