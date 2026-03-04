import { AUTH_INTEGRATIONS } from "@/config/auth";

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
			className="relative flex min-h-screen flex-col bg-background text-foreground"
			style={darkModeVars}
		>
			{/* Subtle radial gradient background */}
			<div className="pointer-events-none absolute inset-0 overflow-hidden">
				<div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-muted/20 blur-[120px]" />
			</div>

			{/* Content wrapper — flex-1 to fill space, centers vertically */}
			<div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-12">
				<div className="flex w-full max-w-[380px] flex-col items-center">
					{/* Logo */}
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img src="/proliferate-logo-inverted.svg" alt="Proliferate" className="mb-8 h-8 w-8" />

					{/* Auth form */}
					{children}

					{/* Integration badges */}
					<div className="mt-12 flex flex-col items-center gap-3">
						<span className="text-xs text-muted-foreground">Works with</span>
						<div className="flex items-center gap-2">
							{AUTH_INTEGRATIONS.map(({ icon: Icon, label }) => (
								<div
									key={label}
									className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card/60"
								>
									<Icon className="h-3.5 w-3.5 text-muted-foreground" />
								</div>
							))}
						</div>
					</div>
				</div>
			</div>

			{/* Footer — pinned to bottom, doesn't affect centering */}
			<div className="relative z-10 flex shrink-0 items-center justify-center gap-3 pb-6 text-xs text-muted-foreground/60">
				<a
					href="https://proliferate.com"
					target="_blank"
					rel="noopener noreferrer"
					className="transition-colors hover:text-muted-foreground"
				>
					proliferate.com
				</a>
				<span>&middot;</span>
				<a
					href="https://proliferate.com/privacy"
					target="_blank"
					rel="noopener noreferrer"
					className="transition-colors hover:text-muted-foreground"
				>
					Privacy
				</a>
				<span>&middot;</span>
				<a
					href="https://proliferate.com/terms"
					target="_blank"
					rel="noopener noreferrer"
					className="transition-colors hover:text-muted-foreground"
				>
					Terms
				</a>
			</div>
		</div>
	);
}
