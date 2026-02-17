import { createEnv } from "@t3-oss/env-core";
import { createPublicSchema, createServerSchema } from "./schema";

const rawEnv = createEnv({
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

// When env validation is skipped (default in local dev), @t3-oss/env-core returns the raw
// runtime env object (strings) instead of applying schema transforms/defaults. Normalize
// the handful of boolean/number fields we use as typed values at runtime.
const normalizeBoolean = (value: unknown, fallback = false) => {
	if (value === true || value === "true" || value === "1") return true;
	if (value === false || value === "false" || value === "0") return false;
	return fallback;
};

const normalizeInt = (value: unknown, fallback: number) => {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
	}
	return fallback;
};

export const env = new Proxy(rawEnv as typeof rawEnv, {
	get(target, prop, receiver) {
		const value = Reflect.get(target, prop, receiver);
		if (prop === "DEPLOYMENT_PROFILE") return value === "cloud" ? "cloud" : "self_host";
		if (prop === "SUPER_ADMIN_EMAILS") return typeof value === "string" ? value : "";

		if (prop === "API_PORT") return normalizeInt(value, 3001);
		if (prop === "GATEWAY_PORT") return normalizeInt(value, 8787);
		if (prop === "WEB_PORT") return normalizeInt(value, 3000);
		if (prop === "WORKER_PORT") return normalizeInt(value, 3002);
		if (prop === "IDLE_SNAPSHOT_DELAY_SECONDS") return normalizeInt(value, 300);
		if (prop === "SANDBOX_TIMEOUT_SECONDS") return normalizeInt(value, 3600);
		if (prop === "SNAPSHOT_RETENTION_DAYS") return normalizeInt(value, 14);

		if (prop === "CI") return normalizeBoolean(value);
		if (prop === "EMAIL_ENABLED") return normalizeBoolean(value);
		if (prop === "LLM_PROXY_REQUIRED") return normalizeBoolean(value);
		if (prop === "LOG_PRETTY") return normalizeBoolean(value);
		if (prop === "NEXT_BUILD_STANDALONE") return normalizeBoolean(value);
		if (prop === "STRICT_ENV") return normalizeBoolean(value);

		// Public booleans are used on the server too (workers, server components, etc.)
		if (prop === "NEXT_PUBLIC_BILLING_ENABLED") return normalizeBoolean(value);
		if (prop === "NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION") return normalizeBoolean(value);
		if (prop === "NEXT_PUBLIC_INTEGRATIONS_ENABLED") return normalizeBoolean(value);
		if (prop === "NEXT_PUBLIC_USE_NANGO_GITHUB") return normalizeBoolean(value);

		return value;
	},
}) as typeof rawEnv;
