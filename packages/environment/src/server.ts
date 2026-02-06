import { createEnv } from "@t3-oss/env-core";
import { createPublicSchema, createServerSchema } from "./schema";

export const env = createEnv({
	server: createServerSchema(process.env),
	client: createPublicSchema(process.env),
	runtimeEnv: process.env,
	clientPrefix: "NEXT_PUBLIC_",
	skipValidation:
		process.env.SKIP_ENV_VALIDATION === "true" ||
		(process.env.NODE_ENV !== "production" && process.env.STRICT_ENV !== "true"),
	onValidationError: (issues) => {
		const details = issues
			.map((issue) => `  ${issue.path?.join(".") || "unknown"}: ${issue.message}`)
			.join("\n");
		const message = `❌ Invalid environment variables:\n${details}`;
		console.error(message);
		throw new Error(message);
	},
});
