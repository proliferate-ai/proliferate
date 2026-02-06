import { DescribeTasksCommand, ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
import {
	CreateBucketCommand,
	HeadBucketCommand,
	PutBucketEncryptionCommand,
	PutBucketVersioningCommand,
	PutPublicAccessBlockCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { getStringArrayOutput, getStringOutput } from "./env";
import { type PromptInterface, promptConfirm, promptInput, promptSecret } from "./prompts";

export interface AwsCredentials {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken?: string;
}

function normalizeYesAsDefault(value: string, fallback: string): string {
	const lowered = value.trim().toLowerCase();
	if (lowered === "y" || lowered === "yes") return fallback;
	return value;
}

function isValidBucketName(name: string): boolean {
	if (name.length < 3 || name.length > 63) return false;
	if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) return false;
	if (name.includes("..")) return false;
	if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return false;
	return true;
}

export async function ensureAwsIdentity(
	rl: PromptInterface,
	region: string,
): Promise<{ accountId: string; credentials?: AwsCredentials }> {
	const hasProfile = !!(process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE);
	if (hasProfile) {
		console.log(
			"Detected AWS profile in environment. Choose 'n' to use your existing profile/SSO session.",
		);
	} else {
		console.log("If you already ran `aws sso login`, choose 'n' to use that session.");
	}

	const useAccessKeys = await promptConfirm(rl, "Use AWS access keys for setup?", !hasProfile);
	let credentials: AwsCredentials | undefined;

	if (useAccessKeys) {
		const accessKeyId = await promptInput(rl, "AWS_ACCESS_KEY_ID", { required: true });
		const secretAccessKey = await promptSecret("AWS_SECRET_ACCESS_KEY");
		const sessionToken = await promptInput(rl, "AWS_SESSION_TOKEN (optional)");
		credentials = { accessKeyId, secretAccessKey };
		if (sessionToken) credentials.sessionToken = sessionToken;
	}

	while (true) {
		try {
			const sts = new STSClient({ region, credentials });
			const identity = await sts.send(new GetCallerIdentityCommand({}));
			if (!identity.Account) throw new Error("Missing account id from STS");
			console.log(`AWS identity verified (account ${identity.Account}).`);
			return { accountId: identity.Account, credentials };
		} catch {
			console.log("AWS credentials are not valid yet.");
			console.log(
				"If you are using AWS CLI profiles/SSO, run `aws configure` or `aws sso login` and retry.",
			);
			const retry = await promptConfirm(rl, "Retry AWS credential check?", true);
			if (!retry) process.exit(1);
			if (useAccessKeys) {
				const accessKeyId = await promptInput(rl, "AWS_ACCESS_KEY_ID", { required: true });
				const secretAccessKey = await promptSecret("AWS_SECRET_ACCESS_KEY");
				const sessionToken = await promptInput(rl, "AWS_SESSION_TOKEN (optional)");
				credentials = { accessKeyId, secretAccessKey };
				if (sessionToken) credentials.sessionToken = sessionToken;
			} else {
				credentials = undefined;
			}
		}
	}
}

export async function ensureBackendResources(params: {
	region: string;
	accountId: string;
	credentials?: AwsCredentials;
	rl: PromptInterface;
}): Promise<{ bucket: string }> {
	const { region, accountId, credentials, rl } = params;
	const defaultBucket = `proliferate-pulumi-${accountId}-${region}`.toLowerCase();

	const s3 = new S3Client({ region, credentials });

	let bucket = await promptInput(rl, "Pulumi state S3 bucket name", {
		defaultValue: defaultBucket,
		required: true,
	});
	bucket = normalizeYesAsDefault(bucket, defaultBucket);
	while (!isValidBucketName(bucket)) {
		console.log(
			"Bucket names must be 3-63 chars, lowercase letters/numbers, and may include '.' or '-'.",
		);
		bucket = await promptInput(rl, "Pulumi state S3 bucket name", {
			defaultValue: defaultBucket,
			required: true,
		});
		bucket = normalizeYesAsDefault(bucket, defaultBucket);
	}

	while (true) {
		try {
			await s3.send(new HeadBucketCommand({ Bucket: bucket }));
			console.log(`Using existing bucket: ${bucket}`);
			break;
		} catch {
			try {
				const createParams: {
					Bucket: string;
					CreateBucketConfiguration?: { LocationConstraint: string };
				} = {
					Bucket: bucket,
				};
				if (region !== "us-east-1") {
					createParams.CreateBucketConfiguration = { LocationConstraint: region };
				}
				await s3.send(new CreateBucketCommand(createParams));
				await s3.send(
					new PutBucketVersioningCommand({
						Bucket: bucket,
						VersioningConfiguration: { Status: "Enabled" },
					}),
				);
				await s3.send(
					new PutPublicAccessBlockCommand({
						Bucket: bucket,
						PublicAccessBlockConfiguration: {
							BlockPublicAcls: true,
							BlockPublicPolicy: true,
							IgnorePublicAcls: true,
							RestrictPublicBuckets: true,
						},
					}),
				);
				await s3.send(
					new PutBucketEncryptionCommand({
						Bucket: bucket,
						ServerSideEncryptionConfiguration: {
							Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }],
						},
					}),
				);
				console.log(`Created bucket: ${bucket}`);
				break;
			} catch {
				console.log("Failed to create bucket. It may already exist in another account.");
				bucket = await promptInput(rl, "Enter a different bucket name", { required: true });
			}
		}
	}

	return { bucket };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runMigrationsTask(params: {
	region: string;
	credentials?: AwsCredentials;
	outputs: Record<string, unknown>;
}): Promise<{ success: boolean; message: string }> {
	const { region, credentials, outputs } = params;
	const clusterArn = getStringOutput(outputs, [
		"migrationsClusterArn",
		"ecsClusterArn",
		"clusterArn",
	]);
	const taskDefinition = getStringOutput(outputs, [
		"migrationsTaskDefinitionArn",
		"migrationTaskDefinitionArn",
		"migrationsTaskArn",
	]);
	const subnetIds = getStringArrayOutput(outputs, [
		"migrationsSubnetIds",
		"privateSubnetIds",
		"privateSubnets",
		"subnetIds",
	]);
	const securityGroupIds = getStringArrayOutput(outputs, [
		"migrationsSecurityGroupIds",
		"serviceSecurityGroupIds",
		"ecsSecurityGroupIds",
		"securityGroupIds",
	]);

	if (!clusterArn || !taskDefinition || !subnetIds || !securityGroupIds) {
		return {
			success: false,
			message:
				"Missing Pulumi outputs for migrations (need cluster ARN, task definition ARN, subnets, security groups).",
		};
	}

	const ecs = new ECSClient({ region, credentials });
	const run = await ecs.send(
		new RunTaskCommand({
			cluster: clusterArn,
			taskDefinition,
			launchType: "FARGATE",
			networkConfiguration: {
				awsvpcConfiguration: {
					subnets: subnetIds,
					securityGroups: securityGroupIds,
					assignPublicIp: "DISABLED",
				},
			},
		}),
	);

	if (run.failures && run.failures.length > 0) {
		return {
			success: false,
			message: `RunTask failed: ${run.failures.map((f) => f.reason).join(", ")}`,
		};
	}

	const taskArns = (run.tasks || []).map((task) => task.taskArn).filter(Boolean) as string[];
	if (taskArns.length === 0) {
		return { success: false, message: "RunTask returned no task ARNs." };
	}

	const start = Date.now();
	const timeoutMs = 30 * 60 * 1000;
	const pollInterval = 10000;

	while (Date.now() - start < timeoutMs) {
		const describe = await ecs.send(
			new DescribeTasksCommand({
				cluster: clusterArn,
				tasks: taskArns,
			}),
		);

		const tasks = describe.tasks || [];
		const allStopped = tasks.every((task) => task.lastStatus === "STOPPED");

		if (allStopped) {
			const failed = tasks
				.flatMap((task) => task.containers || [])
				.filter((container) => container.exitCode && container.exitCode !== 0);
			if (failed.length > 0) {
				return {
					success: false,
					message: "Migration task failed. Non-zero exit codes detected.",
				};
			}
			return { success: true, message: "Migrations completed successfully." };
		}

		await sleep(pollInterval);
	}

	return {
		success: false,
		message: "Timed out waiting for migration task to complete. Check ECS task logs.",
	};
}
