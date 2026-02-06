import { z } from "zod";

/**
 * Shared error response schema for all API endpoints.
 * All error responses follow this structure for consistency.
 */
export const ErrorResponseSchema = z.object({
	error: z.string(),
	code: z.string().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * Pagination metadata schema for list endpoints.
 */
export const PaginationSchema = z.object({
	page: z.number().int().positive().optional(),
	limit: z.number().int().positive().max(100).optional(),
	total: z.number().int().nonnegative().optional(),
});

export type Pagination = z.infer<typeof PaginationSchema>;
