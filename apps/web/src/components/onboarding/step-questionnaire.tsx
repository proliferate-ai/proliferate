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
import { useState } from "react";

interface QuestionnaireData {
	referralSource?: string;
	companyWebsite?: string;
	teamSize?: string;
}

interface StepQuestionnaireProps {
	onComplete: (data: QuestionnaireData) => void;
	isSubmitting?: boolean;
}

const REFERRAL_SOURCES = [
	"Twitter / X",
	"LinkedIn",
	"Friend or colleague",
	"Blog post",
	"Search engine",
	"YouTube",
	"Conference or event",
	"Other",
];

const TEAM_SIZES = ["1-5", "6-20", "21-100", "100+"];

export function StepQuestionnaire({ onComplete, isSubmitting }: StepQuestionnaireProps) {
	const [referralSource, setReferralSource] = useState("");
	const [companyWebsite, setCompanyWebsite] = useState("");
	const [teamSize, setTeamSize] = useState("");

	const handleSubmit = () => {
		onComplete({
			referralSource: referralSource || undefined,
			companyWebsite: companyWebsite || undefined,
			teamSize: teamSize || undefined,
		});
	};

	return (
		<div className="w-full max-w-md">
			<div className="text-center mb-8">
				<h1 className="text-2xl sm:text-3xl font-bold text-foreground">Tell us about your team</h1>
				<p className="mt-3 text-muted-foreground text-sm sm:text-base">
					This helps us tailor your experience.
				</p>
			</div>

			<div className="space-y-5">
				<div className="space-y-2">
					<Label htmlFor="referral">Where did you hear about us?</Label>
					<Select value={referralSource} onValueChange={setReferralSource}>
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
						onChange={(e) => setCompanyWebsite(e.target.value)}
					/>
				</div>

				<div className="space-y-2">
					<Label>Team size</Label>
					<div className="grid grid-cols-4 gap-2">
						{TEAM_SIZES.map((size) => (
							<button
								key={size}
								type="button"
								onClick={() => setTeamSize(size)}
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

			<div className="mt-8">
				<Button
					variant="dark"
					onClick={handleSubmit}
					disabled={isSubmitting}
					className="h-11 w-full rounded-lg"
				>
					{isSubmitting ? "Saving..." : "Continue"}
				</Button>
			</div>
		</div>
	);
}
