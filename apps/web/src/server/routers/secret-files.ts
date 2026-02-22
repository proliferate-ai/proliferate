/**
 * Secret Files oRPC router.
 *
 * Handles file-based secrets CRUD for configurations.
 * Write operations require admin/owner role.
 */

import path from "node:path";
import { logger } from "@/lib/logger";
import { ORPCError } from "@orpc/server";
import { orgs, secretFiles, sessions } from "@proliferate/services";
import type { SandboxProviderType } from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";
import { z } from "zod";
import { orgProcedure } from "./middleware";

const SecretFileMetaSchema = z.object({
	id: z.string().uuid(),
	filePath: z.string(),
	description: z.string().nullable(),
	createdAt: z.string().nullable(),
	updatedAt: z.string().nullable(),
});

const SANDBOX_WORKSPACE_ROOT = "/home/user/workspace";
const SECRET_FILE_WRITE_TIMEOUT_MS = 15_000;
const WRITE_SECRET_FILE_SCRIPT = `
set -eu
target="$PROLIFERATE_SECRET_FILE_TARGET"
mkdir -p "$(dirname "$target")"
printf '%s' "$PROLIFERATE_SECRET_FILE_CONTENT_B64" | base64 -d > "$target"
`;
const log = logger.child({ handler: "secret-files" });

export function normalizeSecretFilePathForSandbox(filePath: string): string {
	const trimmed = filePath.trim();
	if (!trimmed) {
		throw new ORPCError("BAD_REQUEST", { message: "Secret file path is required" });
	}
	if (trimmed.includes("\0")) {
		throw new ORPCError("BAD_REQUEST", { message: "Secret file path contains invalid characters" });
	}

	const normalized = path.posix.normalize(trimmed.replaceAll("\\", "/"));
	if (
		normalized.startsWith("/") ||
		normalized === "." ||
		normalized === ".." ||
		normalized.startsWith("../") ||
		normalized.includes("/../")
	) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Secret file path must be a relative path under workspace",
		});
	}

	return normalized;
}

async function applySecretFileToActiveSession(params: {
	orgId: string;
	sessionId: string;
	configurationId: string;
	filePath: string;
	content: string;
}): Promise<void> {
	const { orgId, sessionId, configurationId, filePath, content } = params;
	const session = await sessions.getFullSession(sessionId, orgId);
	if (!session) {
		throw new ORPCError("NOT_FOUND", { message: "Session not found" });
	}
	if (!session.sandboxId) {
		throw new ORPCError("BAD_REQUEST", { message: "Session has no active sandbox" });
	}
	if (session.configurationId !== configurationId) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Session configuration does not match secret file configuration",
		});
	}

	const provider = getSandboxProvider(session.sandboxProvider as SandboxProviderType);
	const execCommand = provider.execCommand;
	if (!execCommand) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "Sandbox provider does not support runtime file writes",
		});
	}

	const relativePath = normalizeSecretFilePathForSandbox(filePath);
	const targetPath = path.posix.join(SANDBOX_WORKSPACE_ROOT, relativePath);
	const contentBase64 = Buffer.from(content, "utf8").toString("base64");

	const result = await execCommand.call(
		provider,
		session.sandboxId,
		["sh", "-lc", WRITE_SECRET_FILE_SCRIPT],
		{
			timeoutMs: SECRET_FILE_WRITE_TIMEOUT_MS,
			env: {
				PROLIFERATE_SECRET_FILE_TARGET: targetPath,
				PROLIFERATE_SECRET_FILE_CONTENT_B64: contentBase64,
			},
		},
	);

	if (result.exitCode !== 0) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: `Failed to apply secret file to sandbox: exit code ${result.exitCode}`,
		});
	}
}

export const secretFilesRouter = {
	/**
	 * List secret files for a configuration (metadata only, no content).
	 */
	list: orgProcedure
		.input(z.object({ configurationId: z.string().uuid() }))
		.output(z.object({ files: z.array(SecretFileMetaSchema) }))
		.handler(async ({ input, context }) => {
			const rows = await secretFiles.listByConfiguration(context.orgId, input.configurationId);
			return {
				files: rows.map((r) => ({
					id: r.id,
					filePath: r.filePath,
					description: r.description,
					createdAt: r.createdAt?.toISOString() ?? null,
					updatedAt: r.updatedAt?.toISOString() ?? null,
				})),
			};
		}),

	/**
	 * Upsert a secret file. Encrypts content server-side before storing.
	 * Requires admin or owner role.
	 */
	upsert: orgProcedure
		.input(
			z.object({
				configurationId: z.string().uuid(),
				filePath: z.string().min(1).max(500),
				content: z.string(),
				description: z.string().max(500).optional(),
				sessionId: z.string().uuid().optional(),
			}),
		)
		.output(z.object({ file: SecretFileMetaSchema }))
		.handler(async ({ input, context }) => {
			const role = await orgs.getUserRole(context.user.id, context.orgId);
			if (role !== "owner" && role !== "admin") {
				throw new ORPCError("FORBIDDEN", {
					message: "Only admins and owners can manage secret files",
				});
			}

			const row = await secretFiles.upsertSecretFile({
				organizationId: context.orgId,
				configurationId: input.configurationId,
				filePath: input.filePath,
				content: input.content,
				description: input.description,
				createdBy: context.user.id,
			});

			// Optional live apply for active session UX (Environment panel path).
			if (input.sessionId) {
				try {
					await applySecretFileToActiveSession({
						orgId: context.orgId,
						sessionId: input.sessionId,
						configurationId: input.configurationId,
						filePath: input.filePath,
						content: input.content,
					});
				} catch (error) {
					// Best effort: the DB save succeeded even if runtime apply failed.
					log.warn(
						{
							err: error,
							orgId: context.orgId,
							configurationId: input.configurationId,
							sessionId: input.sessionId,
							filePath: input.filePath,
						},
						"Failed to live-apply secret file to active sandbox",
					);
				}
			}

			return {
				file: {
					id: row.id,
					filePath: row.filePath,
					description: row.description,
					createdAt: row.createdAt?.toISOString() ?? null,
					updatedAt: row.updatedAt?.toISOString() ?? null,
				},
			};
		}),

	/**
	 * Delete a secret file.
	 * Requires admin or owner role.
	 */
	delete: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			const role = await orgs.getUserRole(context.user.id, context.orgId);
			if (role !== "owner" && role !== "admin") {
				throw new ORPCError("FORBIDDEN", {
					message: "Only admins and owners can manage secret files",
				});
			}

			const deleted = await secretFiles.deleteById(input.id, context.orgId);
			if (!deleted) {
				throw new ORPCError("NOT_FOUND", { message: "Secret file not found" });
			}

			return { success: true };
		}),
};
