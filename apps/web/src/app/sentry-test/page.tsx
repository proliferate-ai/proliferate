"use client";

import { Button } from "@/components/ui/button";
import { orpc } from "@/lib/orpc";
import * as Sentry from "@sentry/nextjs";

export default function SentryTestPage() {
	const throwClientError = () => {
		throw new Error("Sentry Test: Client-side error thrown intentionally!");
	};

	const captureManualError = () => {
		Sentry.captureException(new Error("Sentry Test: Manually captured exception!"));
		alert("Error captured and sent to Sentry!");
	};

	const triggerServerError = async () => {
		try {
			await orpc.admin.sentryTestError.call({});
		} catch (e) {
			alert("Server error triggered - check Sentry!");
		}
	};

	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
			<h1 className="text-3xl font-bold">Sentry Integration Test</h1>
			<p className="text-muted-foreground">Click buttons below to test different error scenarios</p>

			<div className="flex flex-col gap-4">
				<Button variant="destructive" onClick={throwClientError}>
					Throw Client Error (crashes page)
				</Button>

				<Button variant="outline" onClick={captureManualError}>
					Capture Manual Exception (no crash)
				</Button>

				<Button variant="outline" onClick={triggerServerError}>
					Trigger Server-Side Error
				</Button>
			</div>

			<p className="mt-8 text-sm text-muted-foreground">
				Check your Sentry dashboard to see if errors are being captured.
			</p>
		</div>
	);
}
