"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { useSession } from "@/lib/auth-client";
import { orpc } from "@/lib/orpc";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

function DevicePageContent() {
	const { data: session, isPending: sessionLoading } = useSession();
	const searchParams = useSearchParams();
	const [code, setCode] = useState("");
	const autoSubmittedRef = useRef(false);

	const authorizeDevice = useMutation(orpc.cli.auth.authorizeDevice.mutationOptions());

	// Format code as user types (ABCD-1234)
	const handleCodeChange = useCallback((value: string) => {
		const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
		if (cleaned.length <= 8) {
			if (cleaned.length > 4) {
				setCode(`${cleaned.slice(0, 4)}-${cleaned.slice(4)}`);
			} else {
				setCode(cleaned);
			}
		}
	}, []);

	// Submit handler
	const submitCode = useCallback(
		(codeToSubmit: string) => {
			if (!codeToSubmit.trim() || codeToSubmit.length < 9) return;
			authorizeDevice.mutate({ userCode: codeToSubmit });
		},
		[authorizeDevice],
	);

	// Auto-populate code from URL
	useEffect(() => {
		const codeParam = searchParams.get("code");
		if (codeParam && !code) {
			handleCodeChange(codeParam);
		}
	}, [searchParams, code, handleCodeChange]);

	// Auto-submit when code is pre-filled and user is logged in
	useEffect(() => {
		const codeParam = searchParams.get("code");
		if (
			codeParam &&
			code.length === 9 &&
			session?.user &&
			authorizeDevice.isIdle &&
			!autoSubmittedRef.current
		) {
			autoSubmittedRef.current = true;
			const timer = setTimeout(() => {
				submitCode(code);
			}, 400);
			return () => clearTimeout(timer);
		}
	}, [code, session, authorizeDevice.isIdle, searchParams, submitCode]);

	// Try to close window after success
	useEffect(() => {
		if (authorizeDevice.isSuccess) {
			const timer = setTimeout(() => {
				window.close();
			}, 1500);
			return () => clearTimeout(timer);
		}
	}, [authorizeDevice.isSuccess]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		submitCode(code);
	};

	if (sessionLoading) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background dark:bg-neutral-950">
				<div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
			</div>
		);
	}

	if (!session?.user) {
		const codeParam = searchParams.get("code");
		const deviceUrl = codeParam ? `/device?code=${codeParam}` : "/device";
		const returnUrl = encodeURIComponent(deviceUrl);
		if (typeof window !== "undefined") {
			window.location.href = `/sign-in?redirect=${returnUrl}`;
		}
		return (
			<div className="flex min-h-screen items-center justify-center bg-background dark:bg-neutral-950">
				<Text color="muted">Redirecting to login...</Text>
			</div>
		);
	}

	// Success state
	if (authorizeDevice.isSuccess) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background dark:bg-neutral-950 p-6">
				<div className="w-full max-w-[360px] text-center">
					<Text variant="h3" className="mb-2">
						Device Authorized
					</Text>
					<Text color="muted" className="mb-1">
						Closing this window...
					</Text>
					<Text variant="small" color="muted">
						If it doesn't close, you can close it manually.
					</Text>
				</div>
			</div>
		);
	}

	// Code entry state
	return (
		<div className="flex min-h-screen items-center justify-center bg-background dark:bg-neutral-950 p-6">
			<div className="w-full max-w-[360px]">
				<div className="mb-7 text-center">
					<Text variant="h3">Authorize CLI</Text>
					<Text color="muted" className="mt-2">
						Enter the code shown in your terminal
					</Text>
				</div>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-1.5">
						<Label htmlFor="code" className="text-sm font-medium">
							Authorization code
						</Label>
						<Input
							id="code"
							type="text"
							placeholder="ABCD-1234"
							value={code}
							onChange={(e) => handleCodeChange(e.target.value)}
							className="h-12 rounded-lg text-center font-mono text-xl tracking-widest"
							maxLength={9}
							autoFocus
							autoComplete="off"
							spellCheck={false}
						/>
						{authorizeDevice.isError && (
							<Text variant="small" className="text-destructive">
								{authorizeDevice.error.message || "Something went wrong. Please try again."}
							</Text>
						)}
					</div>

					<Button
						type="submit"
						variant="dark"
						className="h-11 w-full rounded-lg"
						disabled={code.length < 9 || authorizeDevice.isPending}
					>
						{authorizeDevice.isPending ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Authorizing...
							</>
						) : (
							"Authorize"
						)}
					</Button>

					<Text variant="small" color="muted" className="text-center">
						Signed in as {session.user.email}
					</Text>
				</form>
			</div>
		</div>
	);
}

export default function DevicePage() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center bg-background dark:bg-neutral-950">
					<div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
				</div>
			}
		>
			<DevicePageContent />
		</Suspense>
	);
}
