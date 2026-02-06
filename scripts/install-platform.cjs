#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

function getPulumiDir(cloud) {
	if (cloud === "gcp") return path.join(ROOT, "infra", "pulumi-k8s-gcp");
	return path.join(ROOT, "infra", "pulumi-k8s");
}

function run(cmd, args, options = {}) {
	const stdio = options.capture
		? "pipe"
		: options.input
			? ["pipe", "inherit", "inherit"]
			: "inherit";
	let env = { ...process.env, ...(options.env || {}) };
	if (
		env.GOOGLE_APPLICATION_CREDENTIALS === undefined ||
		env.GOOGLE_APPLICATION_CREDENTIALS === "" ||
		env.GOOGLE_APPLICATION_CREDENTIALS === "undefined" ||
		env.GOOGLE_APPLICATION_CREDENTIALS === "null"
	) {
		const { GOOGLE_APPLICATION_CREDENTIALS: _ignored, ...rest } = env;
		env = rest;
	}
	const result = spawnSync(cmd, args, {
		stdio,
		encoding: "utf-8",
		cwd: options.cwd || ROOT,
		env,
		input: options.input,
	});
	if (result.status !== 0 && !options.allowFailure) {
		throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
	}
	return result;
}

function which(cmd) {
	const result = spawnSync("which", [cmd], { encoding: "utf-8" });
	return result.status === 0;
}

function parseEnvFile(filePath) {
	if (!fs.existsSync(filePath)) return {};
	const content = fs.readFileSync(filePath, "utf-8");
	const env = {};
	for (const line of content.split(/\r?\n/)) {
		if (!line || line.trim().startsWith("#")) continue;
		const idx = line.indexOf("=");
		if (idx === -1) continue;
		const key = line.slice(0, idx).trim();
		let value = line.slice(idx + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		env[key] = value;
	}
	return env;
}

function randomBase64(bytes = 32) {
	return crypto.randomBytes(bytes).toString("base64");
}

function randomHex(bytes = 32) {
	return crypto.randomBytes(bytes).toString("hex");
}

function randomToken(prefix = "", bytes = 32) {
	return `${prefix}${crypto.randomBytes(bytes).toString("hex")}`;
}

function appendQueryParam(url, key, value) {
	if (!url) return url;
	const exists = new RegExp(`[?&]${key}=`).test(url);
	if (exists) return url;
	const separator = url.includes("?") ? "&" : "?";
	return `${url}${separator}${key}=${value}`;
}

function prompt(question, { defaultValue } = {}) {
	return new Promise((resolve) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		const suffix = defaultValue ? ` (${defaultValue})` : "";
		rl.question(`${question}${suffix}: `, (answer) => {
			rl.close();
			const value = answer.trim();
			resolve(value || defaultValue || "");
		});
	});
}

function promptSecret(question) {
	return new Promise((resolve) => {
		const stdin = process.stdin;
		const stdout = process.stdout;
		stdin.resume();
		stdin.setRawMode(true);
		stdout.write(`${question}: `);
		let value = "";
		stdin.on("data", (char) => {
			const input = char.toString();
			switch (input) {
				case "\n":
				case "\r":
				case "\u0004":
					stdin.setRawMode(false);
					stdout.write("\n");
					stdin.pause();
					resolve(value);
					break;
				case "\u0003":
					process.exit(1);
					break;
				case "\u007F":
					value = value.slice(0, -1);
					stdout.clearLine(0);
					stdout.cursorTo(0);
					stdout.write(`${question}: ${"*".repeat(value.length)}`);
					break;
				default:
					value += input;
					stdout.write("*");
			}
		});
	});
}

async function ensurePulumiBackendAws(region) {
	const account = run(
		"aws",
		["sts", "get-caller-identity", "--query", "Account", "--output", "text"],
		{
			capture: true,
		},
	).stdout.trim();
	const stateBucket = process.env.PULUMI_STATE_BUCKET || `proliferate-pulumi-${account}-${region}`;
	const lockTable = process.env.PULUMI_LOCK_TABLE || `pulumi-locks-${account}-${region}`;
	const statePrefix = process.env.PULUMI_STATE_PREFIX || "k8s";

	const head = run("aws", ["s3api", "head-bucket", "--bucket", stateBucket], {
		allowFailure: true,
	});
	if (head.status !== 0) {
		if (region === "us-east-1") {
			run("aws", ["s3api", "create-bucket", "--bucket", stateBucket, "--region", region]);
		} else {
			run("aws", [
				"s3api",
				"create-bucket",
				"--bucket",
				stateBucket,
				"--region",
				region,
				"--create-bucket-configuration",
				`LocationConstraint=${region}`,
			]);
		}
		run("aws", [
			"s3api",
			"put-bucket-versioning",
			"--bucket",
			stateBucket,
			"--versioning-configuration",
			"Status=Enabled",
		]);
		run("aws", [
			"s3api",
			"put-bucket-encryption",
			"--bucket",
			stateBucket,
			"--server-side-encryption-configuration",
			'{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}',
		]);
		run("aws", [
			"s3api",
			"put-public-access-block",
			"--bucket",
			stateBucket,
			"--public-access-block-configuration",
			"BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
		]);
	}

	const table = run(
		"aws",
		["dynamodb", "describe-table", "--table-name", lockTable, "--region", region],
		{ allowFailure: true },
	);
	if (table.status !== 0) {
		run("aws", [
			"dynamodb",
			"create-table",
			"--table-name",
			lockTable,
			"--attribute-definitions",
			"AttributeName=LockID,AttributeType=S",
			"--key-schema",
			"AttributeName=LockID,KeyType=HASH",
			"--billing-mode",
			"PAY_PER_REQUEST",
			"--region",
			region,
		]);
		run("aws", ["dynamodb", "wait", "table-exists", "--table-name", lockTable, "--region", region]);
	}

	const backend = `s3://${stateBucket}/${statePrefix}?region=${region}`;
	return backend;
}

async function ensurePulumiBackendGcp(projectId, region) {
	const stateBucket =
		process.env.PULUMI_STATE_BUCKET || `${projectId}-pulumi-state`.replace(/_/g, "-");
	const statePrefix = process.env.PULUMI_STATE_PREFIX || "k8s";
	const bucketUri = `gs://${stateBucket}`;
	const describe = run(
		"gcloud",
		["storage", "buckets", "describe", bucketUri, "--project", projectId],
		{ allowFailure: true, capture: true },
	);
	if (describe.status !== 0) {
		run(
			"gcloud",
			[
				"storage",
				"buckets",
				"create",
				bucketUri,
				"--project",
				projectId,
				"--location",
				region,
				"--uniform-bucket-level-access",
			],
			{ allowFailure: false },
		);
	}
	run(
		"gcloud",
		["storage", "buckets", "update", bucketUri, "--versioning", "--project", projectId],
		{ allowFailure: true },
	);
	return `${bucketUri}/${statePrefix}`;
}

function pulumiStackExists(stack, pulumiDir) {
	const result = run("pulumi", ["stack", "ls", "--json"], {
		capture: true,
		cwd: pulumiDir,
	});
	const stacks = JSON.parse(result.stdout);
	return stacks.some((item) => item.name === stack || item.name.endsWith(`/${stack}`));
}

function waitForIngressHostname(kubeconfigPath, namespace = "ingress-nginx") {
	const maxAttempts = 60;
	const waitMs = 10000;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const result = run("kubectl", ["-n", namespace, "get", "svc", "-o", "json"], {
			capture: true,
			env: { KUBECONFIG: kubeconfigPath },
			allowFailure: true,
		});
		if (result.status === 0) {
			try {
				const data = JSON.parse(result.stdout);
				const services = Array.isArray(data.items) ? data.items : [];
				const lbService = services.find((svc) => {
					if (svc?.spec?.type !== "LoadBalancer") return false;
					const labels = svc?.metadata?.labels || {};
					if (labels["app.kubernetes.io/component"] === "controller") return true;
					return (
						typeof svc?.metadata?.name === "string" && svc.metadata.name.includes("controller")
					);
				});
				const ingress = lbService?.status?.loadBalancer?.ingress?.[0];
				if (ingress?.hostname || ingress?.ip) {
					return ingress.hostname || ingress.ip;
				}
			} catch {
				// ignore
			}
		}
		console.log(`Waiting for ingress load balancer... (${attempt}/${maxAttempts})`);
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
	}
	throw new Error("Timed out waiting for ingress load balancer hostname");
}

function writeTempKubeconfig(kubeconfigValue) {
	const tmpDir = path.join(ROOT, ".tmp");
	if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
	const kubeconfigPath = path.join(tmpDir, "kubeconfig.json");
	if (!kubeconfigValue) {
		throw new Error("Missing kubeconfig from Pulumi outputs.");
	}
	const kubeconfig =
		typeof kubeconfigValue === "string" ? kubeconfigValue : JSON.stringify(kubeconfigValue);
	fs.writeFileSync(kubeconfigPath, kubeconfig);
	return kubeconfigPath;
}

function upsertSecretAws(secretName, secretValue, region) {
	const describe = run(
		"aws",
		["secretsmanager", "describe-secret", "--secret-id", secretName, "--region", region],
		{ capture: true, allowFailure: true },
	);
	if (describe.status === 0) {
		run("aws", [
			"secretsmanager",
			"put-secret-value",
			"--secret-id",
			secretName,
			"--secret-string",
			secretValue,
			"--region",
			region,
		]);
	} else {
		run("aws", [
			"secretsmanager",
			"create-secret",
			"--name",
			secretName,
			"--secret-string",
			secretValue,
			"--region",
			region,
		]);
	}
}

function upsertSecretGcp(projectId, secretName, secretValue) {
	const describe = run("gcloud", ["secrets", "describe", secretName, "--project", projectId], {
		capture: true,
		allowFailure: true,
	});
	if (describe.status !== 0) {
		run("gcloud", [
			"secrets",
			"create",
			secretName,
			"--replication-policy=automatic",
			"--project",
			projectId,
		]);
	}
	run(
		"gcloud",
		["secrets", "versions", "add", secretName, "--data-file=-", "--project", projectId],
		{ input: `${secretValue}\n` },
	);
}

function ensurePulumiPassphrase(pulumiDir) {
	const passphrasePath = path.join(pulumiDir, ".pulumi-passphrase");
	if (!fs.existsSync(passphrasePath)) {
		const passphrase = randomBase64(32);
		fs.writeFileSync(passphrasePath, passphrase, { mode: 0o600 });
	}
	process.env.PULUMI_CONFIG_PASSPHRASE_FILE = passphrasePath;
}

function ensureGkeAuthPlugin() {
	if (which("gke-gcloud-auth-plugin")) return;
	run("gcloud", ["components", "install", "gke-gcloud-auth-plugin", "--quiet"]);
}

function ensureGkeAuthPluginOnPath() {
	if (which("gke-gcloud-auth-plugin")) return;
	const sdkRoot = run("gcloud", ["info", "--format=value(installation.sdk_root)"], {
		capture: true,
		allowFailure: true,
	}).stdout.trim();
	if (!sdkRoot) return;
	const candidate = path.join(sdkRoot, "bin");
	const pluginPath = path.join(candidate, "gke-gcloud-auth-plugin");
	if (fs.existsSync(pluginPath)) {
		process.env.PATH = `${candidate}:${process.env.PATH}`;
	}
}

function ensureGcpServiceAccount(projectId) {
	const accountId = "pulumi-deployer";
	const email = `${accountId}@${projectId}.iam.gserviceaccount.com`;
	const describe = run(
		"gcloud",
		["iam", "service-accounts", "describe", email, "--project", projectId],
		{ capture: true, allowFailure: true },
	);
	if (describe.status !== 0) {
		run("gcloud", [
			"iam",
			"service-accounts",
			"create",
			accountId,
			"--display-name",
			"Pulumi Deployer",
			"--project",
			projectId,
		]);
	}

	const roles = [
		"roles/container.admin",
		"roles/compute.networkAdmin",
		"roles/iam.serviceAccountAdmin",
		"roles/iam.serviceAccountUser",
		"roles/iam.securityAdmin",
		"roles/serviceusage.serviceUsageAdmin",
		"roles/secretmanager.admin",
		"roles/cloudsql.admin",
		"roles/redis.admin",
		"roles/artifactregistry.admin",
		"roles/storage.admin",
		"roles/resourcemanager.projectIamAdmin",
	];
	for (const role of roles) {
		run(
			"gcloud",
			[
				"projects",
				"add-iam-policy-binding",
				projectId,
				"--member",
				`serviceAccount:${email}`,
				"--role",
				role,
			],
			{ allowFailure: true },
		);
	}

	const tmpDir = path.join(ROOT, ".tmp");
	if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
	const keyPath = path.join(tmpDir, `gcp-${accountId}.json`);
	const allowKeyCreation = process.env.ALLOW_GCP_SA_KEY_CREATE === "1";
	const isKeyValid = () => {
		if (!fs.existsSync(keyPath)) return false;
		try {
			const raw = fs.readFileSync(keyPath, "utf8");
			if (!raw.trim()) return false;
			const parsed = JSON.parse(raw);
			return Boolean(parsed.client_email && parsed.private_key);
		} catch {
			return false;
		}
	};
	if (!isKeyValid() && allowKeyCreation) {
		const keyResult = run(
			"gcloud",
			[
				"iam",
				"service-accounts",
				"keys",
				"create",
				keyPath,
				"--iam-account",
				email,
				"--project",
				projectId,
			],
			{ allowFailure: true },
		);
		if (keyResult.status !== 0) {
			console.log("Key creation failed or disabled; falling back to user ADC credentials.");
			return { email, keyPath: null };
		}
	}
	if (!allowKeyCreation) {
		console.log("Skipping service account key creation; using user ADC credentials.");
	}
	return { email, keyPath: isKeyValid() ? keyPath : null };
}

async function main() {
	const args = process.argv.slice(2);
	const opts = {
		cloud: "aws",
		stack: "prod",
		region: "us-west-1",
		project: "proliferate",
		provider: "",
		nonInteractive: false,
		gcpProject: "",
		zone: "",
		dryRun: false,
	};

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--cloud") opts.cloud = args[++i];
		else if (arg === "--stack") opts.stack = args[++i];
		else if (arg === "--region") opts.region = args[++i];
		else if (arg === "--project") opts.project = args[++i];
		else if (arg === "--gcp-project") opts.gcpProject = args[++i];
		else if (arg === "--zone") opts.zone = args[++i];
		else if (arg === "--provider") opts.provider = args[++i];
		else if (arg === "--dry-run") opts.dryRun = true;
		else if (arg === "--non-interactive") opts.nonInteractive = true;
	}

	if (!["aws", "gcp"].includes(opts.cloud)) {
		throw new Error(`Unsupported cloud: ${opts.cloud}`);
	}

	const pulumiDir = getPulumiDir(opts.cloud);
	const requiredTools = ["pulumi", "docker", "kubectl"];
	requiredTools.push(opts.cloud === "aws" ? "aws" : "gcloud");
	for (const tool of requiredTools) {
		if (!which(tool)) {
			throw new Error(`${tool} is required but not found in PATH`);
		}
	}

	console.log("\n==> Configuring deployment");
	const isGcp = opts.cloud === "gcp";
	let gcpProjectId =
		opts.gcpProject ||
		process.env.GCP_PROJECT ||
		process.env.GOOGLE_CLOUD_PROJECT ||
		process.env.CLOUDSDK_CORE_PROJECT ||
		"";
	let gcpRegion = "";
	let gcpZone = "";
	if (isGcp) {
		const projectResult = run("gcloud", ["config", "get-value", "project"], {
			capture: true,
			allowFailure: true,
		});
		if (!gcpProjectId && projectResult.status === 0) {
			gcpProjectId = projectResult.stdout.trim();
		}
		const regionResult = run("gcloud", ["config", "get-value", "compute/region"], {
			capture: true,
			allowFailure: true,
		});
		if (regionResult.status === 0) {
			gcpRegion = regionResult.stdout.trim();
		}
		const zoneResult = run("gcloud", ["config", "get-value", "compute/zone"], {
			capture: true,
			allowFailure: true,
		});
		if (zoneResult.status === 0) {
			gcpZone = zoneResult.stdout.trim();
		}
	}

	const regionDefault = isGcp ? gcpRegion || "us-west1" : opts.region;
	const region = opts.nonInteractive
		? isGcp && opts.region === "us-west-1"
			? regionDefault
			: opts.region
		: await prompt(isGcp ? "GCP region" : "AWS region", { defaultValue: regionDefault });
	const project = opts.nonInteractive
		? opts.project
		: await prompt("Project name", { defaultValue: opts.project });
	const stack = opts.nonInteractive
		? opts.stack
		: await prompt("Pulumi stack", { defaultValue: opts.stack });
	const provider = opts.nonInteractive
		? opts.provider || process.env.DEFAULT_SANDBOX_PROVIDER || "e2b"
		: await prompt("Sandbox provider (e2b|modal)", { defaultValue: "e2b" });
	if (!["e2b", "modal"].includes(provider)) {
		throw new Error(`Unsupported sandbox provider: ${provider}`);
	}
	const zone = isGcp
		? opts.nonInteractive
			? opts.zone || gcpZone || `${region}-a`
			: await prompt("GCP zone", { defaultValue: gcpZone || `${region}-a` })
		: "";
	if (isGcp && !gcpProjectId) {
		if (opts.nonInteractive) {
			throw new Error("Missing GCP project ID. Set --gcp-project or gcloud config.");
		}
		gcpProjectId = await prompt("GCP project ID");
	}

	const envExample = parseEnvFile(path.join(ROOT, ".env.example"));
	const envLocal = parseEnvFile(path.join(ROOT, ".env.local"));
	const envDot = parseEnvFile(path.join(ROOT, ".env"));
	const env = { ...envExample, ...envLocal, ...envDot };
	for (const [key, value] of Object.entries(process.env)) {
		if (key in env) {
			env[key] = value;
		}
	}

	if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET === "replace-me") {
		env.BETTER_AUTH_SECRET = randomBase64(32);
	}
	if (!env.SERVICE_TO_SERVICE_AUTH_TOKEN || env.SERVICE_TO_SERVICE_AUTH_TOKEN === "replace-me") {
		env.SERVICE_TO_SERVICE_AUTH_TOKEN = randomBase64(32);
	}
	if (!env.USER_SECRETS_ENCRYPTION_KEY || env.USER_SECRETS_ENCRYPTION_KEY === "replace-me") {
		env.USER_SECRETS_ENCRYPTION_KEY = randomHex(32);
	}
	if (!env.BILLING_JWT_SECRET || env.BILLING_JWT_SECRET === "replace-me") {
		env.BILLING_JWT_SECRET = randomHex(32);
	}
	if (!env.AUTH_TOKEN || env.AUTH_TOKEN === "replace-me") {
		env.AUTH_TOKEN = randomHex(24);
	}
	if (!env.GITHUB_APP_WEBHOOK_SECRET || env.GITHUB_APP_WEBHOOK_SECRET === "replace-me") {
		env.GITHUB_APP_WEBHOOK_SECRET = randomHex(24);
	}
	if (!env.INTERCOM_SECRET_KEY || env.INTERCOM_SECRET_KEY === "replace-me") {
		env.INTERCOM_SECRET_KEY = randomHex(24);
	}
	if (!env.TEST_REPO_ID || env.TEST_REPO_ID === "replace-me") {
		env.TEST_REPO_ID = randomHex(8);
	}
	if (!env.TEST_TOKEN || env.TEST_TOKEN === "replace-me") {
		env.TEST_TOKEN = randomHex(8);
	}
	if (!env.LLM_PROXY_MASTER_KEY || env.LLM_PROXY_MASTER_KEY === "sk-master-key") {
		env.LLM_PROXY_MASTER_KEY = randomToken("sk-", 24);
	}

	if (!env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY === "sk-ant-...") {
		if (opts.nonInteractive) {
			throw new Error("Missing ANTHROPIC_API_KEY. Set it in .env.local or env vars.");
		}
		env.ANTHROPIC_API_KEY = await promptSecret("Anthropic API key");
	}

	if (provider === "e2b") {
		if (!env.E2B_API_KEY || env.E2B_API_KEY === "e2b_...") {
			if (opts.nonInteractive) {
				throw new Error("Missing E2B_API_KEY. Set it in .env.local or env vars.");
			}
			env.E2B_API_KEY = await promptSecret("E2B API key");
		}
		env.DEFAULT_SANDBOX_PROVIDER = "e2b";
		// Modal credentials are optional when DEFAULT_SANDBOX_PROVIDER=e2b, but can still be
		// required to restore Modal-based snapshots. Do not auto-generate dummy values.
		if (env.MODAL_TOKEN_ID === "replace-me") env.MODAL_TOKEN_ID = "";
		if (env.MODAL_TOKEN_SECRET === "replace-me") env.MODAL_TOKEN_SECRET = "";
		if (!env.MODAL_TOKEN_ID || !env.MODAL_TOKEN_SECRET) {
			console.warn(
				"Note: MODAL_TOKEN_ID/MODAL_TOKEN_SECRET are not set. Modal-based snapshot restores will fail.",
			);
		}
	} else {
		if (!env.MODAL_TOKEN_ID || env.MODAL_TOKEN_ID === "replace-me") {
			if (opts.nonInteractive) {
				throw new Error("Missing MODAL_TOKEN_ID. Set it in .env.local or env vars.");
			}
			env.MODAL_TOKEN_ID = await promptSecret("Modal token ID");
		}
		if (!env.MODAL_TOKEN_SECRET || env.MODAL_TOKEN_SECRET === "replace-me") {
			if (opts.nonInteractive) {
				throw new Error("Missing MODAL_TOKEN_SECRET. Set it in .env.local or env vars.");
			}
			env.MODAL_TOKEN_SECRET = await promptSecret("Modal token secret");
		}
		env.DEFAULT_SANDBOX_PROVIDER = "modal";
	}

	env.NEXT_PUBLIC_BILLING_ENABLED = "false";
	env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION = "false";

	let dbPassword = randomHex(24);
	const namePrefix = `${project}-${stack}`.toLowerCase();
	const appEnvSecretName = `${namePrefix}-app-env`;
	const llmProxyEnvSecretName = `${namePrefix}-llm-proxy-env`;
	const dryRun = opts.dryRun || process.env.INSTALL_DRY_RUN === "1";

	if (dryRun) {
		console.log("\n==> Dry run enabled (no cloud changes will be made)");
		console.log(
			JSON.stringify(
				{
					cloud: opts.cloud,
					stack,
					region,
					zone: isGcp ? zone : undefined,
					project,
					gcpProjectId: isGcp ? gcpProjectId : undefined,
					provider,
					appEnvSecretName,
					llmProxyEnvSecretName,
					hasAnthropicKey: Boolean(env.ANTHROPIC_API_KEY),
					hasE2bKey: Boolean(env.E2B_API_KEY),
					hasModalTokenId: Boolean(env.MODAL_TOKEN_ID),
					hasModalTokenSecret: Boolean(env.MODAL_TOKEN_SECRET),
				},
				null,
				2,
			),
		);
		console.log("\nDry run complete.");
		return;
	}

	console.log("\n==> Preparing Pulumi backend");
	if (isGcp) {
		ensureGkeAuthPlugin();
		ensureGkeAuthPluginOnPath();
		if (gcpProjectId) {
			run("gcloud", ["config", "set", "project", gcpProjectId], { allowFailure: true });
		}
	}
	let pulumiEnv = {};
	if (isGcp) {
		const existingCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
		if (existingCreds) {
			try {
				const stat = fs.statSync(existingCreds);
				const raw = fs.readFileSync(existingCreds, "utf-8");
				if (!stat.size || !raw.trim()) {
					process.env.GOOGLE_APPLICATION_CREDENTIALS = "";
				} else {
					JSON.parse(raw);
				}
			} catch {
				process.env.GOOGLE_APPLICATION_CREDENTIALS = "";
			}
		}
		if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
			const serviceAccount = ensureGcpServiceAccount(gcpProjectId);
			if (serviceAccount.keyPath) {
				process.env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccount.keyPath;
				pulumiEnv = {
					GOOGLE_APPLICATION_CREDENTIALS: serviceAccount.keyPath,
				};
			}
		}
	}
	ensurePulumiPassphrase(pulumiDir);
	pulumiEnv = { ...process.env, ...pulumiEnv };
	const backend = isGcp
		? await ensurePulumiBackendGcp(gcpProjectId, region)
		: await ensurePulumiBackendAws(region);
	run("pulumi", ["login", backend], { env: pulumiEnv, cwd: pulumiDir });

	if (!pulumiStackExists(stack, pulumiDir)) {
		run("pulumi", ["stack", "init", stack], { cwd: pulumiDir, env: pulumiEnv });
	} else {
		run("pulumi", ["stack", "select", stack], { cwd: pulumiDir, env: pulumiEnv });
	}

	run("pnpm", ["install", "--ignore-workspace"], { cwd: pulumiDir });

	console.log("\n==> Configuring Pulumi stack");
	const existingDbPassword = run("pulumi", ["config", "get", "--secret", "dbPassword"], {
		cwd: pulumiDir,
		env: pulumiEnv,
		capture: true,
		allowFailure: true,
	});
	if (existingDbPassword.status === 0 && existingDbPassword.stdout.trim()) {
		dbPassword = existingDbPassword.stdout.trim();
	}

	if (isGcp) {
		const gcpNodeMachineType = process.env.GCP_NODE_MACHINE_TYPE || "e2-standard-2";
		const gcpNodeMinCount = process.env.GCP_NODE_MIN_COUNT || "1";
		const gcpNodeMaxCount = process.env.GCP_NODE_MAX_COUNT || "1";
		const gcpNodeInitialCount = process.env.GCP_NODE_INITIAL_COUNT || "1";

		run("pulumi", ["config", "set", "gcp:project", gcpProjectId], {
			cwd: pulumiDir,
			env: pulumiEnv,
		});
		run("pulumi", ["config", "set", "gcp:region", region], {
			cwd: pulumiDir,
			env: pulumiEnv,
		});
		if (zone) {
			run("pulumi", ["config", "set", "gcp:zone", zone], {
				cwd: pulumiDir,
				env: pulumiEnv,
			});
		}
		run("pulumi", ["config", "set", "projectId", gcpProjectId], {
			cwd: pulumiDir,
			env: pulumiEnv,
		});
		run("pulumi", ["config", "set", "region", region], { cwd: pulumiDir, env: pulumiEnv });
		run("pulumi", ["config", "set", "location", region], {
			cwd: pulumiDir,
			env: pulumiEnv,
		});
		if (zone) {
			run("pulumi", ["config", "set", "zone", zone], {
				cwd: pulumiDir,
				env: pulumiEnv,
			});
		}
		run("pulumi", ["config", "set", "projectName", project], {
			cwd: pulumiDir,
			env: pulumiEnv,
		});
		run("pulumi", ["config", "set", "clusterName", `${namePrefix}-gke`], {
			cwd: pulumiDir,
			env: pulumiEnv,
		});
		run("pulumi", ["config", "set", "nodeMachineType", gcpNodeMachineType], {
			cwd: pulumiDir,
			env: pulumiEnv,
		});
		run("pulumi", ["config", "set", "nodeMinCount", gcpNodeMinCount], {
			cwd: pulumiDir,
			env: pulumiEnv,
		});
		run("pulumi", ["config", "set", "nodeMaxCount", gcpNodeMaxCount], {
			cwd: pulumiDir,
			env: pulumiEnv,
		});
		run("pulumi", ["config", "set", "nodeInitialCount", gcpNodeInitialCount], {
			cwd: pulumiDir,
			env: pulumiEnv,
		});
		run("pulumi", ["config", "set", "enableGcsHmac", "false"], {
			cwd: pulumiDir,
			env: pulumiEnv,
		});
		run("pulumi", ["config", "set", "artifactRepositoryId", namePrefix], {
			cwd: pulumiDir,
			env: pulumiEnv,
		});
		run("pulumi", ["config", "set", "bucketName", `${namePrefix}-verification`], {
			cwd: pulumiDir,
			env: pulumiEnv,
		});
	} else {
		run("pulumi", ["config", "set", "region", region], { cwd: pulumiDir });
		run("pulumi", ["config", "set", "projectName", project], { cwd: pulumiDir });
		run("pulumi", ["config", "set", "clusterName", `${namePrefix}-eks`], {
			cwd: pulumiDir,
		});
		run("pulumi", ["config", "set", "s3BucketName", `${namePrefix}-verification`], {
			cwd: pulumiDir,
		});
	}

	run("pulumi", ["config", "set", "--plaintext", "appEnvSecretName", appEnvSecretName], {
		cwd: pulumiDir,
		env: pulumiEnv,
	});
	run("pulumi", ["config", "set", "--plaintext", "llmProxyEnvSecretName", llmProxyEnvSecretName], {
		cwd: pulumiDir,
		env: pulumiEnv,
	});
	run("pulumi", ["config", "set", "externalSecretsEnabled", "true"], {
		cwd: pulumiDir,
		env: pulumiEnv,
	});
	run("pulumi", ["config", "set", "externalSecretsStoreEnabled", "false"], {
		cwd: pulumiDir,
		env: pulumiEnv,
	});
	run("pulumi", ["config", "set", "deployApps", "false"], {
		cwd: pulumiDir,
		env: pulumiEnv,
	});
	run("pulumi", ["config", "set", "dbUsername", "proliferate"], {
		cwd: pulumiDir,
		env: pulumiEnv,
	});
	run("pulumi", ["config", "set", "dbName", "proliferate"], {
		cwd: pulumiDir,
		env: pulumiEnv,
	});
	if (!(existingDbPassword.status === 0 && existingDbPassword.stdout.trim())) {
		run("pulumi", ["config", "set", "--secret", "dbPassword", dbPassword], {
			cwd: pulumiDir,
			env: pulumiEnv,
		});
	}

	console.log("\n==> Provisioning infrastructure (phase 1)");
	run("pulumi", ["up", "--yes"], { cwd: pulumiDir, env: pulumiEnv });

	console.log("\n==> Reading Pulumi outputs");
	const outputs = JSON.parse(
		run("pulumi", ["stack", "output", "--json", "--show-secrets"], {
			cwd: pulumiDir,
			env: pulumiEnv,
			capture: true,
		}).stdout,
	);
	const stackOutputs = outputs.outputs ?? outputs;

	const kubeconfigPath = writeTempKubeconfig(stackOutputs.kubeconfig);
	const ingressHostname = waitForIngressHostname(kubeconfigPath);
	const appUrl = `http://${ingressHostname}`;
	const gatewayUrl = `http://${ingressHostname}/gateway`;

	const databaseUrl = stackOutputs.databaseUrl;
	const databaseUrlWithSsl = appendQueryParam(databaseUrl, "sslmode", "require");
	const redisUrl = stackOutputs.redisUrl;

	console.log(`\nIngress hostname: ${ingressHostname}`);

	// Populate runtime URLs
	env.NEXT_PUBLIC_APP_URL = appUrl;
	env.NEXT_PUBLIC_API_URL = appUrl;
	env.NEXT_PUBLIC_GATEWAY_URL = gatewayUrl;
	env.DATABASE_URL = databaseUrlWithSsl;
	env.REDIS_URL = redisUrl;
	env.S3_BUCKET = stackOutputs.s3Bucket;
	if (isGcp) {
		env.S3_REGION = stackOutputs.s3Region || "auto";
		env.S3_ENDPOINT_URL = stackOutputs.s3EndpointUrl;
		env.S3_ACCESS_KEY = stackOutputs.s3AccessKey || undefined;
		env.S3_SECRET_KEY = stackOutputs.s3SecretKey || undefined;
	} else {
		env.S3_REGION = region;
		if (!env.S3_ENDPOINT_URL || env.S3_ENDPOINT_URL === "replace-me") {
			env.S3_ENDPOINT_URL = undefined;
		}
		env.S3_ACCESS_KEY = undefined;
		env.S3_SECRET_KEY = undefined;
	}

	// Public LLM proxy URL for sandboxes, internal admin URL for server-side calls
	env.LLM_PROXY_URL = `http://${ingressHostname}/llm-proxy`;
	env.LLM_PROXY_ADMIN_URL = "http://proliferate-llm-proxy:4000";
	env.LLM_PROXY_PUBLIC_URL = env.LLM_PROXY_URL;

	const appEnv = { ...env };
	const llmProxyEnv = {
		DATABASE_URL: appendQueryParam(databaseUrlWithSsl, "schema", "litellm"),
		ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
		LITELLM_MASTER_KEY: env.LLM_PROXY_MASTER_KEY,
		LLM_PROXY_MASTER_KEY: env.LLM_PROXY_MASTER_KEY,
	};

	if (isGcp) {
		console.log("\n==> Writing secrets to GCP Secret Manager");
		upsertSecretGcp(gcpProjectId, appEnvSecretName, JSON.stringify(appEnv));
		upsertSecretGcp(gcpProjectId, llmProxyEnvSecretName, JSON.stringify(llmProxyEnv));
	} else {
		console.log("\n==> Writing secrets to AWS Secrets Manager");
		upsertSecretAws(appEnvSecretName, JSON.stringify(appEnv), region);
		upsertSecretAws(llmProxyEnvSecretName, JSON.stringify(llmProxyEnv), region);
	}

	let imageTag = "latest";
	const gitResult = run("git", ["rev-parse", "--short", "HEAD"], {
		capture: true,
		allowFailure: true,
	});
	if (gitResult.status === 0) {
		imageTag = gitResult.stdout.trim();
	}
	const gitStatus = run("git", ["status", "--porcelain"], {
		capture: true,
		allowFailure: true,
	});
	if (gitStatus.status === 0 && gitStatus.stdout.trim()) {
		const stamp = new Date()
			.toISOString()
			.replace(/[-:.TZ]/g, "")
			.slice(0, 12);
		imageTag = `${imageTag}-dirty-${stamp}`;
	}

	if (isGcp) {
		console.log("\n==> Logging into Artifact Registry");
		run("gcloud", ["auth", "configure-docker", `${region}-docker.pkg.dev`, "--quiet"]);
	} else {
		console.log("\n==> Logging into ECR");
		const ecrPassword = run("aws", ["ecr", "get-login-password", "--region", region], {
			capture: true,
		}).stdout.trim();
		run(
			"docker",
			["login", "--username", "AWS", "--password-stdin", stackOutputs.webRepoUrl.split("/")[0]],
			{ env: { ...process.env }, cwd: ROOT, input: `${ecrPassword}\n`, allowFailure: false },
		);
	}

	console.log("\n==> Building and pushing images");
	const platform = "linux/amd64";
	const buildWebArgs = [
		"build",
		"--platform",
		platform,
		"-f",
		"apps/web/Dockerfile",
		"-t",
		`${stackOutputs.webRepoUrl}:${imageTag}`,
		"--build-arg",
		`NEXT_PUBLIC_APP_URL=${env.NEXT_PUBLIC_APP_URL}`,
		"--build-arg",
		`NEXT_PUBLIC_API_URL=${env.NEXT_PUBLIC_API_URL}`,
		"--build-arg",
		`NEXT_PUBLIC_GATEWAY_URL=${env.NEXT_PUBLIC_GATEWAY_URL}`,
		"--build-arg",
		`NEXT_PUBLIC_BILLING_ENABLED=${env.NEXT_PUBLIC_BILLING_ENABLED}`,
		"--build-arg",
		`NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION=${env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION}`,
		"--build-arg",
		`NEXT_PUBLIC_GITHUB_APP_SLUG=${env.NEXT_PUBLIC_GITHUB_APP_SLUG || ""}`,
		"--build-arg",
		`NEXT_PUBLIC_INTERCOM_APP_ID=${env.NEXT_PUBLIC_INTERCOM_APP_ID || ""}`,
		"--build-arg",
		`NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID=${env.NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID || ""}`,
		"--build-arg",
		`NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID=${env.NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID || ""}`,
		"--build-arg",
		`NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID=${env.NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID || ""}`,
		"--build-arg",
		`NEXT_PUBLIC_POSTHOG_HOST=${env.NEXT_PUBLIC_POSTHOG_HOST || ""}`,
		"--build-arg",
		`NEXT_PUBLIC_POSTHOG_KEY=${env.NEXT_PUBLIC_POSTHOG_KEY || ""}`,
		"--build-arg",
		`NEXT_PUBLIC_SENTRY_DSN=${env.NEXT_PUBLIC_SENTRY_DSN || ""}`,
		"--build-arg",
		`NEXT_PUBLIC_USE_NANGO_GITHUB=${env.NEXT_PUBLIC_USE_NANGO_GITHUB || "false"}`,
		".",
	];
	run("docker", buildWebArgs, { cwd: ROOT });

	run(
		"docker",
		[
			"build",
			"--platform",
			platform,
			"-f",
			"apps/gateway/Dockerfile",
			"-t",
			`${stackOutputs.gatewayRepoUrl}:${imageTag}`,
			".",
		],
		{
			cwd: ROOT,
		},
	);
	run(
		"docker",
		[
			"build",
			"--platform",
			platform,
			"-f",
			"apps/worker/Dockerfile",
			"-t",
			`${stackOutputs.workerRepoUrl}:${imageTag}`,
			".",
		],
		{
			cwd: ROOT,
		},
	);
	run(
		"docker",
		[
			"build",
			"--platform",
			platform,
			"-f",
			"apps/trigger-service/Dockerfile",
			"-t",
			`${stackOutputs.triggerServiceRepoUrl}:${imageTag}`,
			".",
		],
		{
			cwd: ROOT,
		},
	);
	run(
		"docker",
		[
			"build",
			"--platform",
			platform,
			"-f",
			"apps/llm-proxy/Dockerfile",
			"-t",
			`${stackOutputs.llmProxyRepoUrl}:${imageTag}`,
			"apps/llm-proxy",
		],
		{
			cwd: ROOT,
		},
	);

	const pushAll = [
		["docker", ["push", `${stackOutputs.webRepoUrl}:${imageTag}`]],
		["docker", ["push", `${stackOutputs.gatewayRepoUrl}:${imageTag}`]],
		["docker", ["push", `${stackOutputs.workerRepoUrl}:${imageTag}`]],
		["docker", ["push", `${stackOutputs.triggerServiceRepoUrl}:${imageTag}`]],
		["docker", ["push", `${stackOutputs.llmProxyRepoUrl}:${imageTag}`]],
	];
	for (const [cmd, args] of pushAll) {
		run(cmd, args, { cwd: ROOT });
	}

	console.log("\n==> Deploying applications (phase 2)");
	run("pulumi", ["config", "set", "deployApps", "true"], { cwd: pulumiDir, env: pulumiEnv });
	run("pulumi", ["config", "set", "externalSecretsStoreEnabled", "true"], {
		cwd: pulumiDir,
		env: pulumiEnv,
	});
	run("pulumi", ["config", "set", "imageTag", imageTag], { cwd: pulumiDir, env: pulumiEnv });
	run("pulumi", ["up", "--yes"], { cwd: pulumiDir, env: pulumiEnv });

	console.log("\n==> Done");
	console.log(`App URL: ${appUrl}`);
	console.log(`Gateway URL: ${gatewayUrl}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
