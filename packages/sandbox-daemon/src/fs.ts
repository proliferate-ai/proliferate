/**
 * FS transport — B4: tree, read, write APIs.
 *
 * Workspace root canonicalized by realpath.
 * Rejects null bytes, traversal (..), absolute escapes.
 * Re-checks resolved symlink targets under workspace.
 * Write max payload: 10 MB.
 */

import {
	type Stats,
	existsSync,
	lstatSync,
	readFileSync,
	readdirSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import type { Logger } from "@proliferate/logger";
import { FS_WRITE_MAX_BYTES } from "./config.js";
import type { EventBus } from "./event-bus.js";

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

export class FsSecurityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FsSecurityError";
	}
}

/**
 * Resolve and validate a path is within the workspace root.
 * Throws FsSecurityError on any traversal or escape attempt.
 */
function resolveSecure(workspaceRoot: string, relativePath: string): string {
	// Reject null bytes
	if (relativePath.includes("\0")) {
		throw new FsSecurityError("Null byte in path");
	}

	// Normalize and resolve relative to workspace
	const normalized = normalize(relativePath);

	// Reject absolute paths that don't start with workspace root
	if (normalized.startsWith("/") && !normalized.startsWith(workspaceRoot)) {
		throw new FsSecurityError("Absolute path outside workspace");
	}

	// Reject explicit traversal
	if (normalized.startsWith("..") || normalized.includes("/../") || normalized.endsWith("/..")) {
		throw new FsSecurityError("Path traversal detected");
	}

	const resolved = resolve(workspaceRoot, normalized);

	// Verify resolved path is under workspace
	if (!resolved.startsWith(`${workspaceRoot}/`) && resolved !== workspaceRoot) {
		throw new FsSecurityError("Resolved path escapes workspace");
	}

	return resolved;
}

/**
 * Verify that a path (after resolving symlinks) stays within the workspace.
 */
function verifySymlinkTarget(workspaceRoot: string, resolvedPath: string): void {
	try {
		const realWorkspace = realpathSync(workspaceRoot);
		const realTarget = realpathSync(resolvedPath);
		if (realTarget !== realWorkspace && !realTarget.startsWith(`${realWorkspace}/`)) {
			throw new FsSecurityError("Symlink target escapes workspace");
		}
	} catch (err) {
		if (err instanceof FsSecurityError) throw err;
		// Path doesn't exist yet — acceptable for write operations
	}
}

// ---------------------------------------------------------------------------
// FS transport
// ---------------------------------------------------------------------------

export interface FsTransportOptions {
	workspaceRoot: string;
	eventBus: EventBus;
	logger: Logger;
}

export interface FsTreeEntry {
	name: string;
	path: string;
	type: "file" | "directory" | "symlink";
	size?: number;
}

export class FsTransport {
	private readonly workspaceRoot: string;
	private readonly eventBus: EventBus;
	private readonly logger: Logger;

	constructor(options: FsTransportOptions) {
		// Canonicalize workspace root
		this.workspaceRoot = existsSync(options.workspaceRoot)
			? realpathSync(options.workspaceRoot)
			: options.workspaceRoot;
		this.eventBus = options.eventBus;
		this.logger = options.logger.child({ module: "fs" });
	}

	/**
	 * List directory contents, optionally recursive.
	 */
	tree(relativePath: string, depth = 1): FsTreeEntry[] {
		const resolved = resolveSecure(this.workspaceRoot, relativePath || ".");
		verifySymlinkTarget(this.workspaceRoot, resolved);

		if (!existsSync(resolved)) {
			return [];
		}

		return this.listDir(resolved, relativePath || ".", depth);
	}

	/**
	 * Read a file's contents as UTF-8.
	 */
	read(relativePath: string): { content: string; size: number } {
		if (!relativePath) {
			throw new FsSecurityError("Path is required");
		}

		const resolved = resolveSecure(this.workspaceRoot, relativePath);
		verifySymlinkTarget(this.workspaceRoot, resolved);

		if (!existsSync(resolved)) {
			throw new Error(`File not found: ${relativePath}`);
		}

		const stat = lstatSync(resolved);
		if (stat.isDirectory()) {
			throw new Error(`Path is a directory: ${relativePath}`);
		}

		const content = readFileSync(resolved, "utf-8");
		return { content, size: stat.size };
	}

	readBinary(relativePath: string): { base64: string; size: number; mimeType: string } {
		if (!relativePath) {
			throw new FsSecurityError("Path is required");
		}

		const resolved = resolveSecure(this.workspaceRoot, relativePath);
		verifySymlinkTarget(this.workspaceRoot, resolved);

		if (!existsSync(resolved)) {
			throw new Error(`File not found: ${relativePath}`);
		}

		const stat = lstatSync(resolved);
		if (stat.isDirectory()) {
			throw new Error(`Path is a directory: ${relativePath}`);
		}

		const buffer = readFileSync(resolved);
		return {
			base64: buffer.toString("base64"),
			size: stat.size,
			mimeType: inferMimeType(relativePath),
		};
	}

	/**
	 * Write content to a file. Creates parent directories if needed.
	 * Max payload: 10 MB.
	 */
	async write(relativePath: string, content: string): Promise<{ bytesWritten: number }> {
		if (!relativePath) {
			throw new FsSecurityError("Path is required");
		}

		const contentBytes = Buffer.byteLength(content, "utf-8");
		if (contentBytes > FS_WRITE_MAX_BYTES) {
			throw new Error(`Payload too large: ${contentBytes} bytes (max ${FS_WRITE_MAX_BYTES})`);
		}

		const resolved = resolveSecure(this.workspaceRoot, relativePath);

		// Verify symlink target BEFORE write to prevent escape
		verifySymlinkTarget(this.workspaceRoot, resolved);

		// Create parent directories if needed
		const dir = dirname(resolved);
		await mkdir(dir, { recursive: true });

		// Write the file
		writeFileSync(resolved, content, "utf-8");

		this.logger.debug({ path: relativePath, bytes: contentBytes }, "File written");

		// Emit fs_change event
		this.eventBus.emit("fs_change", "data", {
			action: "write",
			path: relativePath,
			size: contentBytes,
		});

		return { bytesWritten: contentBytes };
	}

	// -----------------------------------------------------------------------
	// Internal
	// -----------------------------------------------------------------------

	private listDir(absPath: string, relPath: string, depth: number): FsTreeEntry[] {
		if (depth <= 0) return [];

		let entries: string[];
		try {
			entries = readdirSync(absPath);
		} catch {
			return [];
		}

		const result: FsTreeEntry[] = [];
		for (const name of entries) {
			// Skip hidden files/dirs at the top level (like .git)
			if (name.startsWith(".") && relPath === ".") continue;

			const childAbs = join(absPath, name);
			const childRel = relPath === "." ? name : `${relPath}/${name}`;

			let stat: Stats;
			try {
				stat = lstatSync(childAbs);
			} catch {
				continue;
			}

			if (stat.isSymbolicLink()) {
				result.push({ name, path: childRel, type: "symlink" });
			} else if (stat.isDirectory()) {
				result.push({ name, path: childRel, type: "directory" });
				if (depth > 1) {
					result.push(...this.listDir(childAbs, childRel, depth - 1));
				}
			} else if (stat.isFile()) {
				result.push({ name, path: childRel, type: "file", size: stat.size });
			}
		}
		return result;
	}
}

function inferMimeType(path: string): string {
	const ext = path.toLowerCase().split(".").pop() ?? "";
	switch (ext) {
		case "png":
			return "image/png";
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		case "gif":
			return "image/gif";
		case "webp":
			return "image/webp";
		case "svg":
			return "image/svg+xml";
		default:
			return "application/octet-stream";
	}
}
