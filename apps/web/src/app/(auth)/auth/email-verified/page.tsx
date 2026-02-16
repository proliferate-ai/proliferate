"use client";

import { Text } from "@/components/ui/text";
import { CheckCircle } from "lucide-react";
import Link from "next/link";

export default function EmailVerifiedPage() {
	return (
		<div className="relative flex min-h-screen flex-col overflow-hidden bg-black">
			<div className="absolute inset-0 bg-gradient-to-br from-neutral-900/50 via-black to-black" />
			<div className="absolute left-1/2 top-1/4 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-white/[0.02] blur-[120px]" />

			<div className="relative flex flex-1 items-center justify-center p-6">
				<div className="w-full max-w-sm">
					<div className="mb-6 flex justify-center">
						<div className="flex h-12 w-12 items-center justify-center rounded-lg border border-green-500/20 bg-green-500/10">
							<CheckCircle className="h-5 w-5 text-green-400" />
						</div>
					</div>

					<Text variant="h4" className="mb-2 text-center text-lg font-medium text-neutral-200">
						Email verified
					</Text>
					<Text variant="body" color="muted" className="mb-6 text-center text-sm text-neutral-500">
						Your email has been verified successfully.
					</Text>

					<div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
						<Link
							href="/dashboard"
							className="flex h-10 w-full items-center justify-center rounded-md bg-neutral-200 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-300"
						>
							Go to Dashboard
						</Link>
					</div>
				</div>
			</div>
		</div>
	);
}
