"use client";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { CheckCircle } from "lucide-react";
import Link from "next/link";

export function EmailVerifiedContent() {
	return (
		<div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
			<div className="absolute inset-0 bg-gradient-to-br from-card/50 via-background to-background" />
			<div className="absolute left-1/2 top-1/4 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-foreground/[0.02] blur-[120px]" />

			<div className="relative flex flex-1 items-center justify-center p-6">
				<div className="w-full max-w-sm">
					<div className="mb-6 flex justify-center">
						<div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-card">
							<Text color="success" as="span">
								<CheckCircle className="h-5 w-5" />
							</Text>
						</div>
					</div>

					<Text variant="h4" className="mb-2 text-center text-lg font-medium">
						Email verified
					</Text>
					<Text variant="body" color="muted" className="mb-6 text-center text-sm">
						Your email has been verified successfully.
					</Text>

					<div className="rounded-lg border border-border bg-card/50 p-5">
						<Button asChild className="h-10 w-full">
							<Link href="/sessions">Go to Sessions</Link>
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
