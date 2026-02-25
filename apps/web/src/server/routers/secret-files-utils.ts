import path from "node:path";
import { ORPCError } from "@orpc/server";

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
