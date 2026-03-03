import { z } from "zod";

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
