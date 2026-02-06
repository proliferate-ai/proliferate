import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { ErrorResponseSchema } from "./common";

const c = initContract();

// ============================================
// Schemas
// ============================================

export const VerificationFileSchema = z.object({
	key: z.string(),
	name: z.string(),
	path: z.string(),
	contentType: z.string(),
	size: z.number(),
	lastModified: z.string(),
});

export type VerificationFile = z.infer<typeof VerificationFileSchema>;

// Query params for the unified GET endpoint
export const VerificationMediaQuerySchema = z.object({
	key: z.string().optional(),
	prefix: z.string().optional(),
	content: z.enum(["true"]).optional(),
	stream: z.enum(["true"]).optional(),
});

// Response for presigned URL
export const PresignedUrlResponseSchema = z.object({
	url: z.string(),
});

// Response for text content
export const TextContentResponseSchema = z.object({
	content: z.string(),
	contentType: z.string(),
});

// Response for file listing
export const FileListResponseSchema = z.object({
	files: z.array(VerificationFileSchema),
});

// ============================================
// Contract
// ============================================

export const verificationContract = c.router(
	{
		getMedia: {
			method: "GET",
			path: "/verification-media",
			query: VerificationMediaQuerySchema,
			responses: {
				// Note: actual response varies based on query params
				// - key only -> { url }
				// - key + content=true -> { content, contentType }
				// - key + stream=true -> binary (not representable in JSON schema)
				// - prefix -> { files }
				200: z.union([
					PresignedUrlResponseSchema,
					TextContentResponseSchema,
					FileListResponseSchema,
				]),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Get verification media (presigned URL, content, or file list)",
		},
	},
	{
		pathPrefix: "/api",
	},
);
