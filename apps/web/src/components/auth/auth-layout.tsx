import { GithubIcon, LinearIcon, PostHogIcon, SentryIcon, SlackIcon } from "@/components/ui/icons";
import type { ComponentType, SVGProps } from "react";

const INTEGRATIONS: { icon: ComponentType<SVGProps<SVGSVGElement>>; label: string }[] = [
	{ icon: GithubIcon, label: "GitHub" },
	{ icon: SlackIcon, label: "Slack" },
	{ icon: LinearIcon, label: "Linear" },
	{ icon: SentryIcon, label: "Sentry" },
	{ icon: PostHogIcon, label: "PostHog" },
];

/**
 * Force dark-mode CSS custom properties so all shadcn components
 * inside the auth page render in dark mode regardless of theme.
 */
const darkModeVars: React.CSSProperties = {
	"--background": "0 0% 4%",
	"--foreground": "0 0% 98%",
	"--card": "0 0% 6%",
	"--card-foreground": "0 0% 98%",
	"--popover": "0 0% 6%",
	"--popover-foreground": "0 0% 98%",
	"--primary": "0 0% 98%",
	"--primary-foreground": "0 0% 0%",
	"--secondary": "0 0% 12%",
	"--secondary-foreground": "0 0% 98%",
	"--muted": "0 0% 12%",
	"--muted-foreground": "0 0% 55%",
	"--accent": "0 0% 15%",
	"--accent-foreground": "0 0% 98%",
	"--border": "0 0% 15%",
	"--input": "0 0% 15%",
	"--ring": "0 0% 100%",
	"--destructive": "0 63% 31%",
	"--destructive-foreground": "0 0% 98%",
} as React.CSSProperties;

export function AuthLayout({ children }: { children: React.ReactNode }) {
	return (
		<div
			className="relative flex min-h-screen flex-col bg-neutral-950 text-neutral-50"
			style={darkModeVars}
		>
			{/* Subtle radial gradient background */}
			<div className="pointer-events-none absolute inset-0 overflow-hidden">
				<div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-neutral-800/20 blur-[120px]" />
			</div>

			{/* Content wrapper — flex-1 to fill space, centers vertically */}
			<div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-12">
				<div className="flex w-full max-w-[380px] flex-col items-center">
					{/* Logo */}
					{/* eslint-disable-next-line @next/next/no-img-element */}
					{/* <img
						src="https://d1uh4o7rpdqkkl.cloudfront.net/logotype-inverted.webp"
						alt="Proliferate"
						className="mb-10 h-5 w-auto"
					/> */}

					{/* Auth form */}
					{children}

					{/* Integration badges */}
					<div className="mt-12 flex flex-col items-center gap-3">
						<span className="text-xs text-neutral-500">Works with</span>
						<div className="flex items-center gap-2">
							{INTEGRATIONS.map(({ icon: Icon, label }) => (
								<div
									key={label}
									className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/60"
								>
									<Icon className="h-3.5 w-3.5 text-neutral-500" />
								</div>
							))}
						</div>
					</div>
				</div>
			</div>

			{/* Footer — pinned to bottom, doesn't affect centering */}
			<div className="relative z-10 flex shrink-0 items-center justify-center gap-3 pb-6 text-xs text-neutral-600">
				<a
					href="https://proliferate.com"
					target="_blank"
					rel="noopener noreferrer"
					className="transition-colors hover:text-neutral-400"
				>
					proliferate.com
				</a>
				<span>&middot;</span>
				<a
					href="https://proliferate.com/privacy"
					target="_blank"
					rel="noopener noreferrer"
					className="transition-colors hover:text-neutral-400"
				>
					Privacy
				</a>
				<span>&middot;</span>
				<a
					href="https://proliferate.com/terms"
					target="_blank"
					rel="noopener noreferrer"
					className="transition-colors hover:text-neutral-400"
				>
					Terms
				</a>
			</div>
		</div>
	);
}
