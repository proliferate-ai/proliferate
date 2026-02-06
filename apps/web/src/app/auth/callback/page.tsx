"use client";

import { Text } from "@/components/ui/text";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function CallbackHandler() {
	const searchParams = useSearchParams();
	const error = searchParams.get("error");

	useEffect(() => {
		const isPopup = window.opener && window.opener !== window;

		if (isPopup) {
			window.opener.postMessage(
				{
					type: "oauth_callback",
					success: !error,
					error: error || undefined,
				},
				window.location.origin,
			);
		} else {
			if (error) {
				window.location.href = `/?error=${encodeURIComponent(error)}`;
			} else {
				window.location.href = "/";
			}
		}
	}, [error]);

	return (
		<div className="relative flex min-h-screen flex-col overflow-hidden bg-black">
			{/* Subtle gradient background */}
			<div className="absolute inset-0 bg-gradient-to-br from-neutral-900/50 via-black to-black" />

			{/* Main content */}
			<div className="relative flex flex-1 items-center justify-center p-6">
				<div className="flex flex-col items-center gap-4">
					{error ? (
						<Text variant="small" color="destructive">
							Authentication failed...
						</Text>
					) : (
						<>
							<div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
							<Text variant="small" color="muted">
								Completing sign in...
							</Text>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

export default function AuthCallbackPage() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center bg-black">
					<div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
				</div>
			}
		>
			<CallbackHandler />
		</Suspense>
	);
}
