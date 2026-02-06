"use client";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		Sentry.captureException(error);
	}, [error]);

	return (
		<html lang="en">
			<body>
				<div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
					<Text variant="h4">Something went wrong</Text>
					<Text variant="body" color="muted">
						An unexpected error occurred.
					</Text>
					<Button type="button" onClick={reset}>
						Try again
					</Button>
				</div>
			</body>
		</html>
	);
}
