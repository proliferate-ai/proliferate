"use client";

import { useCallback, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

const DEFAULT_MAX_IMAGES = 4;
const DEFAULT_MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

export interface ImageAttachment {
	id: string;
	preview: string;
	name: string;
	size: number;
	type: string;
	lastModified: number;
}

interface UseImageAttachmentsOptions {
	maxImages?: number;
	maxImageSizeBytes?: number;
}

function formatImageSize(bytes: number): string {
	const megaBytes = bytes / (1024 * 1024);
	return `${megaBytes.toFixed(0)}MB`;
}

function createFileKey(file: Pick<File, "name" | "size" | "lastModified">): string {
	return `${file.name}:${file.size}:${file.lastModified}`;
}

function readAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => {
			if (typeof reader.result === "string") {
				resolve(reader.result);
				return;
			}
			reject(new Error("Failed to read image file"));
		};
		reader.onerror = () => reject(new Error("Failed to read image file"));
		reader.readAsDataURL(file);
	});
}

export function useImageAttachments(options: UseImageAttachmentsOptions = {}) {
	const maxImages = options.maxImages ?? DEFAULT_MAX_IMAGES;
	const maxImageSizeBytes = options.maxImageSizeBytes ?? DEFAULT_MAX_IMAGE_SIZE_BYTES;
	const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
	const [error, setError] = useState<string | null>(null);

	const imageDataUris = useMemo(
		() => attachments.map((attachment) => attachment.preview),
		[attachments],
	);

	const addFiles = useCallback(
		async (incomingFiles: FileList | File[] | null | undefined) => {
			const files = Array.from(incomingFiles ?? []);
			if (files.length === 0) return;

			const remainingSlots = maxImages - attachments.length;
			if (remainingSlots <= 0) {
				setError(`You can attach up to ${maxImages} images.`);
				return;
			}

			let nextError: string | null = null;
			const existingKeys = new Set(attachments.map((attachment) => createFileKey(attachment)));
			const batchKeys = new Set<string>();
			const validFiles: File[] = [];

			for (const file of files) {
				const fileKey = createFileKey(file);
				if (!file.type.startsWith("image/")) {
					nextError = "Only image files can be attached.";
					continue;
				}
				if (file.size > maxImageSizeBytes) {
					nextError = `${file.name} exceeds ${formatImageSize(maxImageSizeBytes)}.`;
					continue;
				}
				if (existingKeys.has(fileKey) || batchKeys.has(fileKey)) {
					continue;
				}
				batchKeys.add(fileKey);
				validFiles.push(file);
			}

			if (validFiles.length === 0) {
				setError(nextError);
				return;
			}

			if (validFiles.length > remainingSlots) {
				nextError = `You can attach up to ${maxImages} images.`;
			}

			const filesToRead = validFiles.slice(0, remainingSlots);

			try {
				const newAttachments = await Promise.all(
					filesToRead.map(async (file): Promise<ImageAttachment> => {
						const preview = await readAsDataUrl(file);
						return {
							id: crypto.randomUUID(),
							preview,
							name: file.name,
							size: file.size,
							type: file.type,
							lastModified: file.lastModified,
						};
					}),
				);
				setAttachments((prev) => [...prev, ...newAttachments]);
				setError(nextError);
			} catch {
				setError("Failed to attach one or more images.");
			}
		},
		[attachments, maxImageSizeBytes, maxImages],
	);

	const handleFileInputChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			void addFiles(event.target.files);
			event.target.value = "";
		},
		[addFiles],
	);

	const removeAttachment = useCallback((id: string) => {
		setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
	}, []);

	const clearAttachments = useCallback(() => {
		setAttachments([]);
		setError(null);
	}, []);

	const clearError = useCallback(() => {
		setError(null);
	}, []);

	return {
		attachments,
		error,
		imageDataUris,
		addFiles,
		handleFileInputChange,
		removeAttachment,
		clearAttachments,
		clearError,
	};
}
