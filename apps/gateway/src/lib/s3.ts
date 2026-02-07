/**
 * S3 Upload Helper
 *
 * Handles uploading verification files to S3.
 * Uses the AWS SDK directly with credentials from the gateway environment.
 */

import { extname } from "path";
import {
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Storage } from "@google-cloud/storage";
import { createLogger } from "@proliferate/logger";
import type { FileContent } from "@proliferate/shared";
import type { GatewayEnv } from "./env";

const logger = createLogger({ service: "gateway" }).child({ module: "s3" });

const CONTENT_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".mov": "video/quicktime",
	".txt": "text/plain",
	".log": "text/plain",
	".md": "text/markdown",
	".json": "application/json",
	".html": "text/html",
	".css": "text/css",
	".js": "text/javascript",
	".ts": "text/typescript",
	".pdf": "application/pdf",
};

function getContentType(filename: string): string {
	const ext = extname(filename).toLowerCase();
	return CONTENT_TYPES[ext] || "application/octet-stream";
}

function isGcsEnv(env: GatewayEnv): boolean {
	return Boolean(
		env.s3EndpointUrl?.includes("storage.googleapis.com") && (!env.s3AccessKey || !env.s3SecretKey),
	);
}

function createGcsClient(): Storage {
	return new Storage();
}

function requireS3Bucket(env: GatewayEnv): string {
	if (!env.s3Bucket) {
		throw new Error("S3 not configured");
	}
	return env.s3Bucket;
}

function assertValidPrefix(prefix: string): void {
	if (!prefix.startsWith("sessions/") || !prefix.includes("/verification/")) {
		throw new Error("Invalid prefix format");
	}
}

function assertValidKey(key: string): void {
	if (!key.startsWith("sessions/") || !key.includes("/verification/")) {
		throw new Error("Invalid key format");
	}
}

export interface UploadResult {
	uploadedCount: number;
	prefix: string;
}

/**
 * Upload verification files to S3.
 *
 * @param sessionId - Session ID for organizing files
 * @param files - Files to upload (from sandbox.readFiles)
 * @param env - Gateway environment with S3 credentials
 * @returns Upload result with count and S3 prefix
 */
export async function uploadVerificationFiles(
	sessionId: string,
	files: FileContent[],
	env: GatewayEnv,
): Promise<UploadResult> {
	const { s3Bucket, s3Region, s3EndpointUrl, s3AccessKey, s3SecretKey } = env;

	if (!s3Bucket || !s3Region) {
		throw new Error("S3 not configured");
	}

	if (isGcsEnv(env)) {
		const storage = createGcsClient();
		const bucket = storage.bucket(s3Bucket);
		const timestamp = Math.floor(Date.now() / 1000);
		const prefix = `sessions/${sessionId}/verification/${timestamp}`;
		let uploadedCount = 0;

		for (const file of files) {
			const key = `${prefix}/${file.path}`;
			const contentType = getContentType(file.path);
			try {
				await bucket.file(key).save(Buffer.from(file.data), { contentType });
				uploadedCount++;
			} catch (err) {
				logger.error({ err, path: file.path }, "Failed to upload file to GCS");
			}
		}

		return { uploadedCount, prefix };
	}

	const client = new S3Client({
		region: s3Region === "auto" ? "us-east-1" : s3Region,
		endpoint: s3EndpointUrl || undefined,
		credentials:
			s3AccessKey && s3SecretKey
				? { accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey }
				: undefined,
		forcePathStyle: Boolean(s3EndpointUrl), // For S3-compatible services like R2
	});

	const timestamp = Math.floor(Date.now() / 1000);
	const prefix = `sessions/${sessionId}/verification/${timestamp}`;

	let uploadedCount = 0;

	for (const file of files) {
		const key = `${prefix}/${file.path}`;
		const contentType = getContentType(file.path);

		try {
			await client.send(
				new PutObjectCommand({
					Bucket: s3Bucket,
					Key: key,
					Body: file.data,
					ContentType: contentType,
				}),
			);
			uploadedCount++;
		} catch (err) {
			logger.error({ err, path: file.path }, "Failed to upload file to S3");
			// Continue uploading other files
		}
	}

	return { uploadedCount, prefix };
}

/**
 * Create an S3 client from gateway environment.
 */
function createS3Client(env: GatewayEnv): S3Client | null {
	const { s3Bucket, s3Region, s3EndpointUrl, s3AccessKey, s3SecretKey } = env;

	if (!s3Bucket || !s3Region) {
		return null;
	}

	return new S3Client({
		region: s3Region === "auto" ? "us-east-1" : s3Region,
		endpoint: s3EndpointUrl || undefined,
		credentials:
			s3AccessKey && s3SecretKey
				? { accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey }
				: undefined,
		forcePathStyle: Boolean(s3EndpointUrl),
	});
}

export interface VerificationFile {
	key: string;
	name: string;
	path: string;
	contentType: string;
	size: number;
	lastModified: string;
}

/**
 * List verification files under a prefix.
 */
export async function listVerificationFiles(
	prefix: string,
	env: GatewayEnv,
): Promise<VerificationFile[]> {
	assertValidPrefix(prefix);
	const client = createS3Client(env);
	if (!client) {
		if (isGcsEnv(env)) {
			const storage = createGcsClient();
			const bucket = requireS3Bucket(env);
			const [files] = await storage.bucket(bucket).getFiles({ prefix });

			const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
			const results: VerificationFile[] = [];

			for (const file of files) {
				const [metadata] = await file.getMetadata();
				const key = metadata.name || file.name;
				const relativePath = key.startsWith(normalizedPrefix)
					? key.slice(normalizedPrefix.length)
					: key.split("/").pop() || key;
				const name = relativePath.split("/").pop() || relativePath;
				const contentType = metadata.contentType || getContentType(key);

				results.push({
					key,
					name,
					path: relativePath,
					contentType,
					size: Number(metadata.size || 0),
					lastModified: metadata.updated || new Date().toISOString(),
				});
			}

			return results;
		}
		throw new Error("S3 not configured");
	}

	const bucket = requireS3Bucket(env);
	const listResult = await client.send(
		new ListObjectsV2Command({
			Bucket: bucket,
			Prefix: prefix,
		}),
	);

	const files: VerificationFile[] = [];
	const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;

	for (const obj of listResult.Contents || []) {
		if (!obj.Key || !obj.Size) continue;

		// Get content type from HEAD request or infer from extension
		let contentType: string;
		try {
			const headResult = await client.send(
				new HeadObjectCommand({
					Bucket: bucket,
					Key: obj.Key,
				}),
			);
			contentType = headResult.ContentType || getContentType(obj.Key);
		} catch {
			contentType = getContentType(obj.Key);
		}

		const relativePath = obj.Key.startsWith(normalizedPrefix)
			? obj.Key.slice(normalizedPrefix.length)
			: obj.Key.split("/").pop() || obj.Key;
		const name = relativePath.split("/").pop() || relativePath;

		files.push({
			key: obj.Key,
			name,
			path: relativePath,
			contentType,
			size: obj.Size,
			lastModified: obj.LastModified?.toISOString() || new Date().toISOString(),
		});
	}

	return files;
}

export interface FileStreamResult {
	body: Uint8Array;
	contentType: string;
}

/**
 * Get a verification file's content as a stream.
 */
export async function getVerificationFileStream(
	key: string,
	env: GatewayEnv,
): Promise<FileStreamResult> {
	assertValidKey(key);
	const client = createS3Client(env);
	if (!client) {
		if (isGcsEnv(env)) {
			const storage = createGcsClient();
			const bucket = requireS3Bucket(env);
			const [contents] = await storage.bucket(bucket).file(key).download();
			const [metadata] = await storage.bucket(bucket).file(key).getMetadata();

			return {
				body: new Uint8Array(contents),
				contentType: metadata.contentType || getContentType(key),
			};
		}
		throw new Error("S3 not configured");
	}

	const bucket = requireS3Bucket(env);
	const response = await client.send(
		new GetObjectCommand({
			Bucket: bucket,
			Key: key,
		}),
	);

	const body = await response.Body?.transformToByteArray();
	if (!body) {
		throw new Error("Empty file");
	}

	return {
		body,
		contentType: response.ContentType || getContentType(key),
	};
}

/**
 * Get a presigned URL for a verification file.
 */
export async function getVerificationFileUrl(
	key: string,
	env: GatewayEnv,
	expiresIn = 3600,
): Promise<string> {
	assertValidKey(key);
	const client = createS3Client(env);
	if (!client) {
		if (isGcsEnv(env)) {
			const storage = createGcsClient();
			const bucket = requireS3Bucket(env);
			const [signedUrl] = await storage
				.bucket(bucket)
				.file(key)
				.getSignedUrl({
					action: "read",
					expires: Date.now() + expiresIn * 1000,
				});
			return signedUrl;
		}
		throw new Error("S3 not configured");
	}

	const command = new GetObjectCommand({
		Bucket: requireS3Bucket(env),
		Key: key,
	});

	return await getSignedUrl(client, command, { expiresIn });
}
