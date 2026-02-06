"use client";

import { Button } from "@/components/ui/button";

export default function PostHogTestPage() {
	const throwError = () => {
		throw new Error("PostHog Test: Intentional JavaScript error!");
	};

	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
			<h1 className="text-3xl font-bold">PostHog Test Page</h1>
			<p className="text-muted-foreground">Test dead clicks, rage clicks, and exception capture</p>

			<div className="flex flex-col gap-6">
				<div className="flex flex-col gap-2">
					<span className="text-sm font-medium">1. Dead Click Test</span>
					<div className="cursor-pointer rounded-md bg-primary px-4 py-2 text-center text-primary-foreground">
						Click me (I do nothing)
					</div>
					<span className="text-xs text-muted-foreground">
						This div looks like a button but has no click handler
					</span>
				</div>

				<div className="flex flex-col gap-2">
					<span className="text-sm font-medium">2. Rage Click Test</span>
					<Button
						variant="secondary"
						onClick={() => {
							// intentionally empty for rage click testing
						}}
					>
						Click me rapidly
					</Button>
					<span className="text-xs text-muted-foreground">
						Click this button many times quickly to trigger rage click detection
					</span>
				</div>

				<div className="flex flex-col gap-2">
					<span className="text-sm font-medium">3. Exception Test</span>
					<Button variant="destructive" onClick={throwError}>
						Throw Error
					</Button>
					<span className="text-xs text-muted-foreground">
						This will throw a JavaScript error to test exception capture
					</span>
				</div>
			</div>
		</div>
	);
}
