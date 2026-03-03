"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UsePolledReadinessOptions {
	checkFn: () => Promise<boolean>;
	enabled: boolean;
	maxAttempts?: number;
	baseIntervalMs?: number;
	maxIntervalMs?: number;
}

interface UsePolledReadinessResult {
	status: "polling" | "ready" | "failed";
	retry: () => void;
}

export function usePolledReadiness({
	checkFn,
	enabled,
	maxAttempts = 8,
	baseIntervalMs = 1000,
	maxIntervalMs = 10000,
}: UsePolledReadinessOptions): UsePolledReadinessResult {
	const [status, setStatus] = useState<"polling" | "ready" | "failed">(
		enabled ? "polling" : "failed",
	);
	const [retryKey, setRetryKey] = useState(0);
	const checkFnRef = useRef(checkFn);
	checkFnRef.current = checkFn;

	const retry = useCallback(() => {
		setStatus("polling");
		setRetryKey((k) => k + 1);
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: retryKey triggers re-polling
	useEffect(() => {
		if (!enabled) {
			return;
		}

		let cancelled = false;
		let attempt = 0;

		function schedule() {
			if (cancelled) return;
			if (attempt >= maxAttempts) {
				setStatus("failed");
				return;
			}

			const delay = Math.min(baseIntervalMs * 2 ** attempt, maxIntervalMs);

			setTimeout(async () => {
				if (cancelled) return;

				try {
					const ready = await checkFnRef.current();
					if (cancelled) return;

					if (ready) {
						setStatus("ready");
					} else {
						attempt++;
						schedule();
					}
				} catch {
					if (cancelled) return;
					attempt++;
					schedule();
				}
			}, delay);
		}

		setStatus("polling");
		schedule();

		return () => {
			cancelled = true;
		};
	}, [enabled, maxAttempts, baseIntervalMs, maxIntervalMs, retryKey]);

	return { status, retry };
}
