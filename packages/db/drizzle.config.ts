import { env } from "@proliferate/environment/server";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/schema/schema.ts",
	out: "./drizzle",
	dbCredentials: {
		url: env.DATABASE_URL,
	},
});
