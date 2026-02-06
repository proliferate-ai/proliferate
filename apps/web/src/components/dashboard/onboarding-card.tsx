"use client";

import { CardButton } from "@/components/ui/card-button";
import { cn } from "@/lib/utils";
import { ChevronRight, X } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

type GradientType = "github" | "slack" | "automation" | "repo" | "demo";

const gradients: Record<GradientType, string> = {
	github: "from-[#24292e] to-[#1a1e22]",
	slack: "from-[#4A154B] to-[#611f69]",
	automation: "from-amber-500 to-orange-600",
	repo: "from-blue-500 to-indigo-600",
	demo: "from-emerald-500 to-teal-600",
};

interface OnboardingCardProps {
	icon: ReactNode;
	title: string;
	description: string;
	ctaLabel: string;
	onCtaClick: () => void;
	onDismiss?: () => void;
	isLoading?: boolean;
	className?: string;
	gradient?: GradientType;
	image?: string;
}

export function OnboardingCard({
	icon,
	title,
	description,
	ctaLabel,
	onCtaClick,
	onDismiss,
	isLoading = false,
	className,
	gradient,
	image,
}: OnboardingCardProps) {
	// Card with image header (like onboarding path choice)
	if (image) {
		return (
			<CardButton
				onClick={onCtaClick}
				disabled={isLoading}
				className={cn(
					"group relative w-56 min-w-[224px] rounded-2xl flex-shrink-0 overflow-hidden",
					"border border-border hover:border-foreground/20 bg-card",
					"transition-all duration-200",
					isLoading && "opacity-60 cursor-wait",
					className,
				)}
			>
				{/* Image header */}
				<div className="relative aspect-[3/2] bg-black">
					<Image src={image} alt={title} fill className="object-cover" />
					{/* Dismiss button */}
					{onDismiss && (
						<span
							role="button"
							tabIndex={0}
							onClick={(e) => {
								e.stopPropagation();
								onDismiss();
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.stopPropagation();
									onDismiss();
								}
							}}
							className="absolute right-2 top-2 p-1 rounded-lg text-white/40 hover:text-white/80 transition-colors"
							aria-label="Dismiss"
						>
							<X className="h-3.5 w-3.5" />
						</span>
					)}
				</div>

				{/* Content */}
				<div className="p-4 flex flex-col flex-grow">
					<h3 className="text-sm font-medium text-foreground">{title}</h3>
					<p className="text-sm text-muted-foreground mt-1.5 leading-relaxed flex-grow">
						{description}
					</p>
					<span className="mt-3 font-medium flex items-center gap-1 text-sm text-muted-foreground group-hover:text-foreground transition-colors">
						<span>{ctaLabel}</span>
						<ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
					</span>
				</div>
			</CardButton>
		);
	}

	// Card with gradient header (onboarding flow style)
	if (gradient) {
		return (
			<CardButton
				onClick={onCtaClick}
				disabled={isLoading}
				className={cn(
					"group relative w-56 min-w-[224px] rounded-2xl flex-shrink-0 overflow-hidden",
					"border border-border hover:border-foreground/20 bg-card",
					"transition-all duration-200",
					isLoading && "opacity-60 cursor-wait",
					className,
				)}
			>
				{/* Gradient header with icon */}
				<div
					className={cn(
						"relative aspect-[3/2] flex items-center justify-center bg-gradient-to-br",
						gradients[gradient],
					)}
				>
					<div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center text-white">
						{icon}
					</div>
					{/* Dismiss button */}
					{onDismiss && (
						<span
							role="button"
							tabIndex={0}
							onClick={(e) => {
								e.stopPropagation();
								onDismiss();
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.stopPropagation();
									onDismiss();
								}
							}}
							className="absolute right-2 top-2 p-1 rounded-lg text-white/40 hover:text-white/80 transition-colors"
							aria-label="Dismiss"
						>
							<X className="h-3.5 w-3.5" />
						</span>
					)}
				</div>

				{/* Content */}
				<div className="p-4 flex flex-col flex-grow">
					<h3 className="text-sm font-medium text-foreground">{title}</h3>
					<p className="text-sm text-muted-foreground mt-1.5 leading-relaxed flex-grow">
						{description}
					</p>
					<span className="mt-3 font-medium flex items-center gap-1 text-sm text-muted-foreground group-hover:text-foreground transition-colors">
						<span>{ctaLabel}</span>
						<ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
					</span>
				</div>
			</CardButton>
		);
	}

	// Simple card (original style)
	return (
		<CardButton
			onClick={onCtaClick}
			disabled={isLoading}
			className={cn(
				"group relative w-56 min-w-[224px] p-4 rounded-2xl flex-shrink-0",
				"border border-border hover:border-foreground/20 bg-card",
				"transition-all duration-200",
				isLoading && "opacity-60 cursor-wait",
				className,
			)}
		>
			{/* Dismiss button */}
			{onDismiss && (
				<span
					role="button"
					tabIndex={0}
					onClick={(e) => {
						e.stopPropagation();
						onDismiss();
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.stopPropagation();
							onDismiss();
						}
					}}
					className="absolute right-3 top-3 p-1 rounded-lg text-muted-foreground/40 hover:text-muted-foreground transition-colors"
					aria-label="Dismiss"
				>
					<X className="h-3.5 w-3.5" />
				</span>
			)}

			{/* Icon */}
			<div className="mb-3 text-muted-foreground">{icon}</div>

			{/* Title */}
			<h3 className="text-sm font-medium text-foreground">{title}</h3>

			{/* Description */}
			<p className="text-sm text-muted-foreground mt-1.5 leading-relaxed flex-grow">
				{description}
			</p>

			{/* CTA with arrow */}
			<span className="mt-4 font-medium flex items-center gap-1 text-sm text-muted-foreground group-hover:text-foreground transition-colors">
				<span>{ctaLabel}</span>
				<ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
			</span>
		</CardButton>
	);
}
