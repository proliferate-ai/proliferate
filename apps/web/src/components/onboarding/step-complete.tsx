"use client";

import { Button } from "@/components/ui/button";
import { Loader2 } from "@/components/ui/icons";
import Image from "next/image";

interface StepCompleteProps {
	onComplete: () => void;
	isSubmitting?: boolean;
	error?: string;
}

export function StepComplete({ onComplete, isSubmitting, error }: StepCompleteProps) {
	return (
		<div className="w-[480px]">
			<div className="rounded-2xl overflow-hidden border border-border">
				{/* Image Area - wider aspect ratio */}
				<div className="relative bg-black" style={{ aspectRatio: "1360 / 880" }}>
					<Image src="/final.png" alt="Setup complete" fill className="object-cover" />
					<div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none">
						<span className="relative inline-block">
							<span
								aria-hidden
								className="absolute inset-0 rounded-full bg-white/75 blur-md"
								style={{ minWidth: 90, minHeight: 32 }}
							/>
							<span className="relative px-4 py-1.5 font-bold text-xs tracking-[0.25em] uppercase text-black">
								Ready
							</span>
						</span>
					</div>
				</div>

				{/* Content */}
				<div className="p-6 bg-card">
					<div className="mb-5 text-center">
						<h1 className="text-2xl font-semibold text-foreground">You're all set!</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							Your repositories are connected. Head to the dashboard to start a session — just pick
							a repo, describe what you need, and an agent gets to work.
						</p>
					</div>

					{error && (
						<p className="mb-3 text-sm text-destructive text-center">
							Failed to complete onboarding. Please try again.
						</p>
					)}

					<Button
						variant="dark"
						onClick={onComplete}
						disabled={isSubmitting}
						className="h-11 w-full rounded-lg"
					>
						{isSubmitting ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Finishing...
							</>
						) : (
							"Go to Dashboard"
						)}
					</Button>
				</div>
			</div>
		</div>
	);
}
