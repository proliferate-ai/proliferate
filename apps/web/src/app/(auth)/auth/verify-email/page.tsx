"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft, Mail } from "@/components/ui/icons";
import { Text } from "@/components/ui/text";
import { sendVerificationEmail, useSession } from "@/lib/auth-client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function VerifyEmailContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { data: session, isPending } = useSession();

	const emailFromQuery = searchParams.get("email");
	const email = session?.user?.email || emailFromQuery;

	const [isResending, setIsResending] = useState(false);
	const [resent, setResent] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!isPending && session?.user?.emailVerified) {
			router.push("/dashboard");
		}
	}, [session, isPending, router]);

	const handleResend = async () => {
		if (!email) return;
		setIsResending(true);
		setError(null);
		setResent(false);

		try {
			const result = await sendVerificationEmail({ email });
			if (result.error) {
				setError(result.error.message || "Failed to send verification email");
			} else {
				setResent(true);
			}
		} catch (err) {
			setError("Failed to send verification email");
		} finally {
			setIsResending(false);
		}
	};

	if (isPending) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-black">
				<div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-400" />
			</div>
		);
	}

	if (session?.user?.emailVerified) {
		return null;
	}

	return (
		<div className="relative flex min-h-screen flex-col overflow-hidden bg-black">
			<div className="absolute inset-0 bg-gradient-to-br from-neutral-900/50 via-black to-black" />
			<div className="absolute left-1/2 top-1/4 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-white/[0.02] blur-[120px]" />

			<div className="relative flex flex-1 items-center justify-center p-6">
				<div className="w-full max-w-sm">
					<div className="mb-6 flex justify-center">
						<div className="flex h-12 w-12 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.02]">
							<Mail className="h-5 w-5 text-neutral-400" />
						</div>
					</div>

					<Text variant="h4" className="mb-2 text-center text-lg font-medium text-neutral-200">
						Check your email
					</Text>
					<Text variant="body" color="muted" className="mb-6 text-center text-sm text-neutral-500">
						{email ? (
							<>
								We sent a verification link to{" "}
								<Text as="span" variant="small" className="text-neutral-300">
									{email}
								</Text>
							</>
						) : (
							"We sent a verification link to your email"
						)}
					</Text>

					<div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
						<Text
							variant="small"
							color="muted"
							className="mb-4 text-center text-xs text-neutral-500"
						>
							Click the link in the email to verify your account. Check spam if you don&apos;t see
							it.
						</Text>

						{resent && (
							<Text variant="small" color="success" className="mb-3 text-center text-xs">
								Verification email sent!
							</Text>
						)}
						{error && (
							<Text variant="small" color="destructive" className="mb-3 text-center text-xs">
								{error}
							</Text>
						)}

						<div className="space-y-2">
							{email && (
								<Button
									variant="light"
									size="lg"
									className="w-full"
									onClick={handleResend}
									disabled={isResending || resent}
									type="button"
								>
									{isResending ? "Sending..." : resent ? "Email sent" : "Resend verification email"}
								</Button>
							)}
							<Link
								href="/sign-in"
								className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md text-sm text-neutral-500 hover:text-neutral-300"
							>
								<ArrowLeft className="h-3.5 w-3.5" />
								Back to sign in
							</Link>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default function VerifyEmailPage() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center bg-black">
					<div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-400" />
				</div>
			}
		>
			<VerifyEmailContent />
		</Suspense>
	);
}
