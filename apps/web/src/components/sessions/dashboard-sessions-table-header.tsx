export function DashboardSessionsTableHeader() {
	return (
		<div className="flex items-center px-4 py-1.5 border-b border-border/50 bg-muted/20 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
			<span className="flex-1 min-w-0">Session</span>
			<span className="w-24 shrink-0 hidden md:block">Repo</span>
			<span className="w-28 shrink-0 hidden md:block">Branch</span>
			<span className="w-20 shrink-0">Status</span>
			<span className="w-24 shrink-0">Attention</span>
			<span className="w-20 shrink-0 hidden md:block">Origin</span>
			<span className="w-20 shrink-0 hidden md:block">Creator</span>
			<span className="w-20 shrink-0">Updated</span>
			<span className="w-6 shrink-0" />
		</div>
	);
}
