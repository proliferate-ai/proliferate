import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/test/**/*.test.ts"],
		// Exclude tests that require real credentials (Tier 3+)
		exclude: [
			"src/test/linear-metadata.test.ts",
			"src/test/sentry-metadata.test.ts",
			"**/node_modules/**",
		],
		testTimeout: 30000, // Integration tests may take longer
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
});
