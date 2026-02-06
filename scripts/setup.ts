#!/usr/bin/env npx tsx
/*
 * Proliferate one-click setup script (AWS + Pulumi S3 backend).
 * - Ensures Pulumi CLI is installed
 * - Collects AWS credentials and bootstraps S3 + DynamoDB backend
 * - Initializes/selects Pulumi stack and runs `pulumi up`
 * - Generates .env.prod from schema + prompts + outputs
 */

import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { ensureAwsIdentity, ensureBackendResources, runMigrationsTask } from "./setup/aws";
import {
	createEnvState,
	looksLikePlaceholder,
	mergeEnvTemplate,
	parseEnvFile,
	parseSchemaKeys,
	pickOutput,
	randomBase64,
} from "./setup/env";
import { ENV_EXAMPLE_PATH, ENV_PROD_PATH, PULUMI_DIR, ROOT_DIR } from "./setup/paths";
import {
	type PromptOptions,
	promptAndSet,
	promptChoice,
	promptConfirm,
	promptInput,
	promptSecret,
	promptValue,
} from "./setup/prompts";
import {
	ensurePulumiInstalled,
	loginPulumiBackend,
	pulumiProjectExists,
	readPulumiOutputs,
	runPulumiUp,
	selectOrInitStack,
	setPulumiConfig,
} from "./setup/pulumi";

async function main() {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	process.env.AWS_SDK_LOAD_CONFIG = "1";

	console.log("==========================================");
	console.log("  Proliferate AWS + Pulumi Setup");
	console.log("==========================================");

	await ensurePulumiInstalled(rl);

	const envExample = parseEnvFile(ENV_EXAMPLE_PATH);
	const envExisting = parseEnvFile(ENV_PROD_PATH);
	const { publicKeys, serverKeys } = parseSchemaKeys();
	const schemaKeys = [...publicKeys, ...serverKeys];

	const region = await promptInput(rl, "AWS region", {
		defaultValue: envExisting.AWS_REGION || envExample.AWS_REGION || "us-east-1",
		required: true,
	});

	const { accountId, credentials } = await ensureAwsIdentity(rl, region);

	const { bucket } = await ensureBackendResources({
		region,
		accountId,
		credentials,
		rl,
	});

	const backendUrl = `s3://${bucket}?region=${region}`;
	const pulumiPassphrase =
		process.env.PULUMI_CONFIG_PASSPHRASE ||
		(await promptSecret("Pulumi config passphrase (leave blank to generate)", ""));
	const resolvedPassphrase = pulumiPassphrase || randomBase64(32);

	const pulumiEnv: NodeJS.ProcessEnv = {
		AWS_REGION: region,
		AWS_DEFAULT_REGION: region,
		PULUMI_CONFIG_PASSPHRASE: resolvedPassphrase,
		AWS_SDK_LOAD_CONFIG: "1",
	};
	if (credentials) {
		pulumiEnv.AWS_ACCESS_KEY_ID = credentials.accessKeyId;
		pulumiEnv.AWS_SECRET_ACCESS_KEY = credentials.secretAccessKey;
		if (credentials.sessionToken) pulumiEnv.AWS_SESSION_TOKEN = credentials.sessionToken;
	} else {
		if (process.env.AWS_PROFILE) pulumiEnv.AWS_PROFILE = process.env.AWS_PROFILE;
		if (process.env.AWS_DEFAULT_PROFILE)
			pulumiEnv.AWS_DEFAULT_PROFILE = process.env.AWS_DEFAULT_PROFILE;
	}

	const login = loginPulumiBackend(backendUrl, pulumiEnv);
	if (!login.ok) {
		console.log("Pulumi login failed. Please check AWS credentials and bucket permissions.");
		process.exit(1);
	}

	const stack = await promptInput(rl, "Pulumi stack name", {
		defaultValue: "dev",
		required: true,
	});

	let ranPulumiUp = false;
	let pulumiOutputs: Record<string, unknown> = {};
	let migrationSummary: { success: boolean; message: string } | null = null;

	const loadPulumiOutputs = () => {
		pulumiOutputs = readPulumiOutputs(pulumiEnv);
	};

	if (pulumiProjectExists()) {
		selectOrInitStack(stack, pulumiEnv);

		const enableHttps = await promptConfirm(rl, "Enable HTTPS with ACM certificate?", false);
		const domainName = enableHttps
			? await promptInput(rl, "Custom domain name (e.g., app.example.com)", { required: true })
			: await promptInput(rl, "Custom domain name (optional)");
		const certificateArn = enableHttps
			? await promptInput(rl, "ACM certificate ARN", { required: true })
			: "";

		const configSets: Array<{ key: string; value: string; secret?: boolean }> = [
			{ key: "aws:region", value: region },
			{ key: "proliferate:enableRds", value: "true" },
			{ key: "proliferate:enableHttps", value: enableHttps ? "true" : "false" },
		];
		if (domainName) configSets.push({ key: "proliferate:domainName", value: domainName });
		if (certificateArn)
			configSets.push({ key: "proliferate:certificateArn", value: certificateArn, secret: true });

		setPulumiConfig(configSets, pulumiEnv);

		const runUp = await promptConfirm(rl, "Run `pulumi up` now?", true);
		if (runUp) {
			ranPulumiUp = runPulumiUp(pulumiEnv);
			if (ranPulumiUp) loadPulumiOutputs();
		}
	} else {
		console.log(`Pulumi project not found at ${PULUMI_DIR}. Skipping 'pulumi up'.`);
		console.log("Create infra/pulumi first, then rerun this script.");
	}

	if (ranPulumiUp) {
		const runMigrations = await promptConfirm(
			rl,
			"Run database migrations via ECS task now?",
			true,
		);
		if (runMigrations) {
			try {
				migrationSummary = await runMigrationsTask({
					region,
					credentials,
					outputs: pulumiOutputs,
				});
				console.log(migrationSummary.message);
			} catch {
				migrationSummary = { success: false, message: "Failed to run migrations. Check ECS logs." };
				console.log(migrationSummary.message);
			}
		}
	}

	const envState = createEnvState(envExisting, envExample);

	const coreSecrets = [
		"BETTER_AUTH_SECRET",
		"SERVICE_TO_SERVICE_AUTH_TOKEN",
		"USER_SECRETS_ENCRYPTION_KEY",
		"BILLING_JWT_SECRET",
		"LLM_PROXY_MASTER_KEY",
	];
	for (const key of coreSecrets) {
		envState.ensureGenerated(key);
	}

	const autoDevKeys = await promptConfirm(
		rl,
		"Autogenerate dev/test values (AUTH_TOKEN, TEST_TOKEN, TEST_REPO_ID, DEV_USER_ID)?",
		true,
	);
	if (autoDevKeys) {
		for (const key of ["AUTH_TOKEN", "TEST_TOKEN", "TEST_REPO_ID", "DEV_USER_ID"]) {
			envState.ensureGenerated(key, 24);
		}
	}

	const promptKeys = async (
		entries: Array<PromptOptions & { key: string; defaultValue?: string }>,
	) => {
		for (const entry of entries) {
			await promptAndSet(rl, envState, entry.key, {
				label: entry.label,
				secret: entry.secret,
				required: entry.required,
				defaultValue: entry.defaultValue ?? envState.getDefault(entry.key),
			});
		}
	};

	const sandboxProvider = await promptChoice(
		rl,
		"Default sandbox provider",
		["modal", "e2b"],
		"modal",
	);
	envState.set("DEFAULT_SANDBOX_PROVIDER", sandboxProvider);

	if (sandboxProvider === "modal") {
		await promptKeys([
			{ key: "MODAL_TOKEN_ID", secret: true },
			{ key: "MODAL_TOKEN_SECRET", secret: true },
			{ key: "MODAL_APP_NAME" },
			{ key: "MODAL_APP_SUFFIX" },
			{ key: "MODAL_ENDPOINT_URL" },
		]);
	} else {
		await promptKeys([
			{ key: "E2B_API_KEY", secret: true },
			{ key: "E2B_DOMAIN" },
			{ key: "E2B_TEMPLATE" },
			{ key: "E2B_TEMPLATE_ALIAS" },
		]);
	}

	await promptKeys([
		{ key: "ANTHROPIC_API_KEY", secret: true },
		{ key: "OPENAI_API_KEY", secret: true },
		{ key: "SANDBOX_TIMEOUT_SECONDS" },
	]);

	await promptKeys([
		{ key: "GITHUB_APP_ID", required: true },
		{ key: "NEXT_PUBLIC_GITHUB_APP_SLUG", required: true },
	]);

	const privateKeyPath = await promptInput(
		rl,
		"Path to GitHub App private key PEM (leave blank to paste)",
	);
	if (privateKeyPath) {
		const keyContents = readFileSync(resolve(ROOT_DIR, privateKeyPath), "utf-8");
		envState.set("GITHUB_APP_PRIVATE_KEY", keyContents.trim());
	} else {
		envState.set(
			"GITHUB_APP_PRIVATE_KEY",
			await promptSecret("GITHUB_APP_PRIVATE_KEY (paste, use \\n for newlines)"),
		);
	}

	await promptKeys([
		{ key: "GITHUB_APP_WEBHOOK_SECRET", secret: true },
		{ key: "GITHUB_OAUTH_APP_ID", required: true },
		{ key: "GITHUB_OAUTH_APP_SECRET", secret: true },
		{ key: "GOOGLE_CLIENT_ID" },
		{ key: "GOOGLE_CLIENT_SECRET", secret: true },
	]);

	const appUrlDefault = pickOutput(
		pulumiOutputs,
		["appUrl", "webUrl"],
		envState.getDefault("NEXT_PUBLIC_APP_URL") || "",
	);
	await promptAndSet(rl, envState, "NEXT_PUBLIC_APP_URL", {
		defaultValue: appUrlDefault,
		required: true,
	});
	await promptAndSet(rl, envState, "NEXT_PUBLIC_API_URL", {
		defaultValue: envState.values.NEXT_PUBLIC_APP_URL,
		required: true,
	});

	const gatewayDefault = pickOutput(
		pulumiOutputs,
		["gatewayUrl"],
		envState.getDefault("NEXT_PUBLIC_GATEWAY_URL") || "",
	);
	await promptAndSet(rl, envState, "NEXT_PUBLIC_GATEWAY_URL", {
		defaultValue: gatewayDefault,
		required: true,
	});

	const llmProxyDefault = pickOutput(
		pulumiOutputs,
		["llmProxyUrl"],
		envState.getDefault("LLM_PROXY_URL") || "",
	);
	await promptAndSet(rl, envState, "LLM_PROXY_URL", {
		defaultValue: llmProxyDefault,
		required: true,
	});
	await promptAndSet(rl, envState, "LLM_PROXY_KEY_DURATION", {
		defaultValue: envState.getDefault("LLM_PROXY_KEY_DURATION"),
	});
	await promptAndSet(rl, envState, "LLM_PROXY_REQUIRED", {
		defaultValue: envState.getDefault("LLM_PROXY_REQUIRED") || "true",
	});

	const databaseUrlDefault = pickOutput(
		pulumiOutputs,
		["databaseUrl"],
		envState.getDefault("DATABASE_URL") || "",
	);
	await promptAndSet(rl, envState, "DATABASE_URL", {
		defaultValue: databaseUrlDefault,
		required: true,
	});

	const redisUrlDefault = pickOutput(
		pulumiOutputs,
		["redisUrl"],
		envState.getDefault("REDIS_URL") || "",
	);
	await promptAndSet(rl, envState, "REDIS_URL", { defaultValue: redisUrlDefault, required: true });

	await promptKeys([
		{ key: "RESEND_API_KEY", secret: true },
		{ key: "EMAIL_FROM" },
		{ key: "SUPER_ADMIN_EMAILS" },
	]);

	const s3EndpointDefault =
		region === "us-east-1" ? "https://s3.amazonaws.com" : `https://s3.${region}.amazonaws.com`;

	await promptKeys([
		{ key: "S3_BUCKET", defaultValue: envState.getDefault("S3_BUCKET") || "" },
		{ key: "S3_REGION", defaultValue: envState.getDefault("S3_REGION") || region },
		{
			key: "S3_ENDPOINT_URL",
			defaultValue: envState.getDefault("S3_ENDPOINT_URL") || s3EndpointDefault,
		},
	]);

	if (credentials) {
		envState.set("S3_ACCESS_KEY", credentials.accessKeyId);
		envState.set("S3_SECRET_KEY", credentials.secretAccessKey);
	} else {
		await promptKeys([{ key: "S3_ACCESS_KEY" }, { key: "S3_SECRET_KEY", secret: true }]);
	}

	const secretPattern = /(SECRET|TOKEN|PRIVATE|KEY|PASSWORD|CERT|ARN)/;

	for (const key of schemaKeys) {
		if (envState.hasRealValue(key)) continue;
		const exampleDefault = envExample[key];
		const defaultValue =
			exampleDefault && !looksLikePlaceholder(exampleDefault) ? exampleDefault : undefined;
		const shouldMask = !key.startsWith("NEXT_PUBLIC_") && secretPattern.test(key);
		const value = await promptValue(rl, key, {
			defaultValue,
			required: true,
			secret: shouldMask,
		});
		envState.set(key, value);
	}

	const envContents = mergeEnvTemplate(ENV_EXAMPLE_PATH, envState.values);
	let wroteEnv = false;
	if (existsSync(ENV_PROD_PATH)) {
		const overwriteEnv = await promptConfirm(
			rl,
			".env.prod already exists. Overwrite with updated values?",
			true,
		);
		if (overwriteEnv) {
			await writeFile(ENV_PROD_PATH, envContents, "utf-8");
			wroteEnv = true;
		}
	} else {
		await writeFile(ENV_PROD_PATH, envContents, "utf-8");
		wroteEnv = true;
	}

	console.log("");
	console.log("==========================================");
	console.log("Setup complete");
	console.log("==========================================");
	console.log(`- .env.prod ${wroteEnv ? "written" : "left unchanged"} at ${ENV_PROD_PATH}`);
	console.log(`- Pulumi backend: ${backendUrl}`);
	console.log(`- Pulumi stack: ${stack}`);
	if (!ranPulumiUp) {
		console.log("- Pulumi up was not run; run it manually when ready.");
	}
	if (migrationSummary) {
		console.log(
			`- Migrations: ${migrationSummary.success ? "success" : "failed"} (${migrationSummary.message})`,
		);
	}
	console.log("");
	console.log("Next steps:");
	console.log("- Update DNS and OAuth callback URLs after your load balancer domain is known.");
	console.log("- Store the Pulumi passphrase securely for future stack operations.");
	console.log("- Rerun this script if you change the stack or domain.");

	rl.close();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
