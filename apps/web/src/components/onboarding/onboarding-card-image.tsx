"use client";

import { cn } from "@/lib/utils";
import Image from "next/image";
import type { ReactNode } from "react";

interface OnboardingCardImageProps {
	src: string;
	alt: string;
	label?: string;
	labelClassName?: string;
	labelContainerClassName?: string;
	overlay?: ReactNode;
}

export function OnboardingCardImage({
	src,
	alt,
	label,
	labelClassName,
	labelContainerClassName,
	overlay,
}: OnboardingCardImageProps) {
	return (
		<div className="relative">
			<Image src={src} alt={alt} width={1360} height={880} className="h-auto w-full" />
			{overlay ? (
				overlay
			) : label ? (
				<div
					className={cn(
						"absolute top-3 left-0 right-0 flex justify-center pointer-events-none",
						labelContainerClassName,
					)}
				>
					<span className="relative inline-block">
						<span
							aria-hidden
							className="absolute inset-0 rounded-full bg-black/60 blur-md"
							style={{ minWidth: 90, minHeight: 32 }}
						/>
						<span
							className={cn(
								"relative px-4 py-1.5 font-bold text-xs tracking-[0.25em] uppercase text-white/90",
								labelClassName,
							)}
						>
							{label}
						</span>
					</span>
				</div>
			) : null}
		</div>
	);
}
