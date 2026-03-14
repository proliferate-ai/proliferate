"use client";

import { Button } from "@/components/ui/button";
import { OnboardingCardImage } from "./onboarding-card-image";

interface StepCompleteProps {
	onComplete: () => void;
}

export function StepComplete({ onComplete }: StepCompleteProps) {
	return (
		<div className="w-[480px]">
			<div className="rounded-2xl overflow-hidden border border-border">
				{/* Image Area */}
				<OnboardingCardImage
					src="/final.png"
					alt="Setup complete"
					overlay={
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
					}
				/>

				{/* Content */}
				<div className="p-6 bg-card">
					<div className="mb-5 text-center">
						<h1 className="text-2xl font-semibold text-foreground">You're all set!</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							Your organization is ready. Head to the sessions page to get started.
						</p>
					</div>

					<Button
						variant="contrast"
						onClick={onComplete}
						className="h-11 w-full rounded-lg"
					>
						Go to Sessions
					</Button>
				</div>
			</div>
		</div>
	);
}
