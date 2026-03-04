export function SessionsTableHeader() {
	return (
		<div className="hidden md:flex items-center px-4 py-1.5 border-b border-border/50 bg-muted/20 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
			<span className="flex-1">Session</span>
			<span className="w-28 shrink-0">Configuration</span>
		</div>
	);
}
