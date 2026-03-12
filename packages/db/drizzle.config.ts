import { env } from "@proliferate/environment/server";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "postgresql",
	schema: [
		"./src/schema/actions.ts",
		"./src/schema/auth.ts",
		"./src/schema/automations.ts",
		"./src/schema/billing.ts",
		"./src/schema/configurations.ts",
		"./src/schema/integrations.ts",
		"./src/schema/notifications.ts",
		"./src/schema/repos.ts",
		"./src/schema/schedules.ts",
		"./src/schema/secrets.ts",
		"./src/schema/sessions.ts",
		"./src/schema/slack.ts",
		"./src/schema/triggers.ts",
		"./src/schema/workers.ts",
	],
	out: "./drizzle",
	dbCredentials: {
		url: env.DATABASE_URL,
	},
});
