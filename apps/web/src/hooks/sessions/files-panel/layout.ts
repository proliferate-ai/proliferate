"use client";

import { useCallback, useState } from "react";

interface FilesPanelLayoutOptions {
	storageKey: string;
	defaultSizes: [number, number];
	leftMin: number;
	leftMax: number;
	layoutId: string;
}

function normalizeSplitSizes(
	leftCandidate: number,
	leftMin: number,
	leftMax: number,
): [number, number] {
	const left = Math.max(leftMin, Math.min(leftMax, leftCandidate));
	return [left, 100 - left];
}

function readInitialSplitSizes(options: FilesPanelLayoutOptions): [number, number] {
	if (typeof window === "undefined") {
		return options.defaultSizes;
	}

	try {
		const stored = window.localStorage.getItem(options.storageKey);
		if (!stored) return options.defaultSizes;
		const parsed = JSON.parse(stored) as number[];
		if (!Array.isArray(parsed) || parsed.length < 2) return options.defaultSizes;
		const left = Number(parsed[0]);
		if (!Number.isFinite(left)) return options.defaultSizes;
		return normalizeSplitSizes(left, options.leftMin, options.leftMax);
	} catch {
		return options.defaultSizes;
	}
}

function getNamedPanelValue(layout: unknown, layoutId: string): number | null {
	if (!layout || typeof layout !== "object" || Array.isArray(layout)) return null;
	const candidate = (layout as Record<string, unknown>)[layoutId];
	const value = Number(candidate);
	return Number.isFinite(value) ? value : null;
}

function getIndexedPanelValue(layout: unknown): number | null {
	if (!Array.isArray(layout) || layout.length < 1) return null;
	const value = Number(layout[0]);
	return Number.isFinite(value) ? value : null;
}

export function useFilesPanelLayout(options: FilesPanelLayoutOptions) {
	const [initialSplitSizes] = useState<[number, number]>(() => readInitialSplitSizes(options));

	const handleLayoutChanged = useCallback(
		(layout: unknown) => {
			const left =
				getNamedPanelValue(layout, options.layoutId) ?? getIndexedPanelValue(layout) ?? Number.NaN;
			if (!Number.isFinite(left)) return;

			const [nextLeft, nextRight] = normalizeSplitSizes(left, options.leftMin, options.leftMax);
			if (typeof window !== "undefined") {
				window.localStorage.setItem(options.storageKey, JSON.stringify([nextLeft, nextRight]));
			}
		},
		[options.layoutId, options.leftMax, options.leftMin, options.storageKey],
	);

	return {
		initialSplitSizes,
		handleLayoutChanged,
	};
}
