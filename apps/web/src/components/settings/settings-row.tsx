"use client";

export function SettingsCard({ children }: { children: React.ReactNode }) {
	return (
		<div className="rounded-lg border border-border/80 bg-background">
			<ul className="divide-y divide-border/60">{children}</ul>
		</div>
	);
}

export function SettingsRow({
	label,
	description,
	children,
}: {
	label: string;
	description?: string;
	children: React.ReactNode;
}) {
	return (
		<li className="flex items-center justify-between gap-4 px-4 py-3">
			<div className="flex flex-col gap-0.5 flex-1 min-w-0">
				<span className="text-sm font-medium">{label}</span>
				{description && <span className="text-xs text-muted-foreground">{description}</span>}
			</div>
			<div className="flex items-center shrink-0">{children}</div>
		</li>
	);
}

export function SettingsSection({
	title,
	children,
}: {
	title?: string;
	children: React.ReactNode;
}) {
	return (
		<section className="space-y-2">
			{title && <h3 className="text-sm font-medium">{title}</h3>}
			{children}
		</section>
	);
}
