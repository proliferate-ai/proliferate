"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { REFERRAL_SOURCES, TEAM_SIZES } from "@/config/onboarding";
import { useOnboardingStore } from "@/stores/onboarding";
import { OnboardingCardImage } from "./onboarding-card-image";

interface StepQuestionnaireProps {
	onComplete: (data: {
		referralSource?: string;
		companyWebsite?: string;
		teamSize?: string;
	}) => void;
	isSubmitting?: boolean;
}

export function StepQuestionnaire({ onComplete, isSubmitting }: StepQuestionnaireProps) {
	const questionnaire = useOnboardingStore((s) => s.questionnaire);
	const setQuestionnaire = useOnboardingStore((s) => s.setQuestionnaire);
	const { referralSource, companyWebsite, teamSize } = questionnaire;

	const handleSubmit = () => {
		onComplete({
			referralSource: referralSource || undefined,
			companyWebsite: companyWebsite || undefined,
			teamSize: teamSize || undefined,
		});
	};

	return (
		<div className="w-[480px]">
			<div className="rounded-2xl overflow-hidden border border-border">
				<OnboardingCardImage src="/about2.png" alt="Tell us about your team" label="About You" />

				<div className="p-6 bg-card">
					<div className="mb-5 text-center">
						<h1 className="text-xl font-semibold text-foreground">Tell us about your team</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							This helps us tailor your experience.
						</p>
					</div>

					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="referral">Where did you hear about us?</Label>
							<Select
								value={referralSource}
								onValueChange={(v) => setQuestionnaire({ referralSource: v })}
							>
								<SelectTrigger id="referral">
									<SelectValue placeholder="Select one..." />
								</SelectTrigger>
								<SelectContent>
									{REFERRAL_SOURCES.map((source) => (
										<SelectItem key={source} value={source}>
											{source}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-2">
							<Label htmlFor="website">Company website</Label>
							<Input
								id="website"
								type="url"
								placeholder="https://example.com"
								value={companyWebsite}
								onChange={(e) => setQuestionnaire({ companyWebsite: e.target.value })}
							/>
						</div>

						<div className="space-y-2">
							<Label>Team size</Label>
							<div className="grid grid-cols-4 gap-2">
								{TEAM_SIZES.map((size) => (
									<button
										key={size}
										type="button"
										onClick={() => setQuestionnaire({ teamSize: size })}
										className={`rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
											teamSize === size
												? "border-primary bg-primary/5 text-foreground ring-1 ring-primary/20"
												: "border-border bg-card text-muted-foreground hover:border-foreground/20"
										}`}
									>
										{size}
									</button>
								))}
							</div>
						</div>
					</div>

					<Button
						variant="contrast"
						onClick={handleSubmit}
						disabled={isSubmitting}
						className="h-11 w-full rounded-lg mt-5"
					>
						{isSubmitting ? "Saving..." : "Continue"}
					</Button>
				</div>
			</div>
		</div>
	);
}
