"use client";

import {
	FILE_IMAGE_EXTENSIONS,
	FILE_TEXT_BASENAMES,
	FILE_TEXT_EXTENSIONS,
} from "@/config/files-panel";

export type FileRenderKind = "text" | "image" | "binary";

function getFileName(path: string): string {
	return path.split("/").pop()?.toLowerCase() ?? "";
}

export function getFileExtension(path: string): string {
	const parts = path.toLowerCase().split(".");
	return parts.length > 1 ? parts[parts.length - 1] : "";
}

export function getFileRenderKind(path: string): FileRenderKind {
	const fileName = getFileName(path);
	if (FILE_TEXT_BASENAMES.has(fileName)) return "text";
	const ext = getFileExtension(fileName);
	if (FILE_IMAGE_EXTENSIONS.has(ext)) return "image";
	if (FILE_TEXT_EXTENSIONS.has(ext)) return "text";
	return "binary";
}

export function isLikelyTextFile(path: string): boolean {
	return getFileRenderKind(path) === "text";
}

export function isJsonFile(path: string): boolean {
	return getFileExtension(path) === "json";
}
