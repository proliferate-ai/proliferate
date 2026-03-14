import { env } from "@proliferate/environment/server";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "postgresql",
	schema: [
		"./src/schema/auth.ts",
		"./src/schema/repos.ts",
		"./src/schema/secrets.ts",
		"./src/schema/sessions.ts",
	],
	out: "./drizzle",
	dbCredentials: {
		url: env.DATABASE_URL,
	},
});
