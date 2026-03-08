import { AUTH_INTEGRATIONS, darkModeVars } from "@/config/auth";

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
