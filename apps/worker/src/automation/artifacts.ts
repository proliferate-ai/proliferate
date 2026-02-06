/**
 * Automation artifact writer.
 */

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@proliferate/environment/server";

function createS3Client(): S3Client {
	const region = env.S3_REGION;
	const bucket = env.S3_BUCKET;
	if (!region || !bucket) {
		throw new Error("S3_BUCKET and S3_REGION must be set to write artifacts");
	}

	return new S3Client({
		region: region === "auto" ? "us-east-1" : region,
		endpoint: env.S3_ENDPOINT_URL || undefined,
		credentials:
			env.S3_ACCESS_KEY && env.S3_SECRET_KEY
				? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY }
				: undefined,
		forcePathStyle: Boolean(env.S3_ENDPOINT_URL),
	});
}

export async function writeCompletionArtifact(runId: string, payload: unknown): Promise<string> {
	const bucket = env.S3_BUCKET;
	if (!bucket) {
		throw new Error("S3_BUCKET must be set to write artifacts");
	}

	const client = createS3Client();
	const key = `runs/${runId}/completion.json`;
	const body = JSON.stringify(payload, null, 2);

	await client.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: key,
			Body: body,
			ContentType: "application/json",
		}),
	);

	return key;
}
