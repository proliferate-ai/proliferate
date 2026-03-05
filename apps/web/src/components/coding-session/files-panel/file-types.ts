"use client";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const TEXT_EXTENSIONS = new Set([
	"ts",
	"tsx",
	"js",
	"jsx",
	"mjs",
	"cjs",
	"json",
	"md",
	"mdx",
	"txt",
	"css",
	"scss",
	"less",
	"html",
	"xml",
	"yaml",
	"yml",
	"toml",
	"ini",
	"sh",
	"bash",
	"zsh",
	"py",
	"go",
	"rs",
	"java",
	"c",
	"cpp",
	"h",
	"hpp",
	"log",
	"sql",
	"env",
]);

export type FileRenderKind = "text" | "image" | "binary";

export function getFileExtension(path: string): string {
	const parts = path.toLowerCase().split(".");
	return parts.length > 1 ? parts[parts.length - 1] : "";
}

export function getFileRenderKind(path: string): FileRenderKind {
	const ext = getFileExtension(path);
	if (IMAGE_EXTENSIONS.has(ext)) return "image";
	if (TEXT_EXTENSIONS.has(ext)) return "text";
	return "binary";
}

export function isLikelyTextFile(path: string): boolean {
	return getFileRenderKind(path) === "text";
}

export function isJsonFile(path: string): boolean {
	return getFileExtension(path) === "json";
}
