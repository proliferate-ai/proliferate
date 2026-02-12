"use client";

import { gatewayClient } from "@/lib/gateway-client";
import type { VerificationFile } from "@proliferate/shared";
import { useEffect, useState } from "react";

// Global cache for verification media URLs
const urlCache = new Map<string, { url: string; expiresAt: number }>();

// Global cache for file listings
const filesCache = new Map<string, { files: VerificationFile[]; expiresAt: number }>();

// Cache duration: 50 minutes
const CACHE_DURATION_MS = 50 * 60 * 1000;

function buildProxyUrl(key: string): string {
	return `/api/verification-media?key=${encodeURIComponent(key)}&stream=true`;
}

/**
 * Hook to fetch verification files from the gateway.
 */
export function useVerificationFiles(prefix: string | null | undefined): {
	files: VerificationFile[];
	isLoading: boolean;
	error: string | null;
} {
	const [files, setFiles] = useState<VerificationFile[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!prefix) {
			setFiles([]);
			setIsLoading(false);
			setError(null);
			return;
		}

		// Check cache
		const cached = filesCache.get(prefix);
		if (cached && cached.expiresAt > Date.now()) {
			setFiles(cached.files);
			setIsLoading(false);
			setError(null);
			return;
		}

		setIsLoading(true);
		setError(null);

		gatewayClient
			.listVerificationFiles(prefix)
			.then((fileList) => {
				filesCache.set(prefix, {
					files: fileList,
					expiresAt: Date.now() + CACHE_DURATION_MS,
				});
				setFiles(fileList);
				setIsLoading(false);
			})
			.catch((err) => {
				console.error("Failed to list verification files:", err);
				setError(err.message || "Failed to list files");
				setIsLoading(false);
			});
	}, [prefix]);

	return { files, isLoading, error };
}

/**
 * Hook to get a proxy URL for a verification media key.
 */
export function useVerificationMediaUrl(key: string | null | undefined): {
	url: string | null;
	isLoading: boolean;
	error: string | null;
} {
	if (!key) {
		return { url: null, isLoading: false, error: null };
	}

	const cached = urlCache.get(key);
	if (cached && cached.expiresAt > Date.now()) {
		return { url: cached.url, isLoading: false, error: null };
	}

	const proxyUrl = buildProxyUrl(key);
	urlCache.set(key, {
		url: proxyUrl,
		expiresAt: Date.now() + CACHE_DURATION_MS,
	});

	return { url: proxyUrl, isLoading: false, error: null };
}

/**
 * Get a cached URL synchronously, or return null if not cached.
 */
export function getCachedVerificationUrl(key: string): string | null {
	const cached = urlCache.get(key);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.url;
	}
	return null;
}

/**
 * Fetch text content from a verification file.
 */
export async function fetchVerificationTextContent(key: string): Promise<string> {
	return gatewayClient.getVerificationFileText(key);
}

/**
 * Prefetch URLs for multiple keys.
 */
export async function prefetchVerificationUrls(keys: string[]): Promise<void> {
	for (const key of keys) {
		const cached = urlCache.get(key);
		if (cached && cached.expiresAt > Date.now()) {
			continue;
		}
		urlCache.set(key, {
			url: buildProxyUrl(key),
			expiresAt: Date.now() + CACHE_DURATION_MS,
		});
	}
}
