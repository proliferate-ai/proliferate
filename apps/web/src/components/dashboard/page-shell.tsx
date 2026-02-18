import { cn } from "@/lib/utils";

const MAX_WIDTH_MAP = {
	"2xl": "max-w-2xl",
	"3xl": "max-w-3xl",
	"4xl": "max-w-4xl",
	"5xl": "max-w-5xl",
	"6xl": "max-w-6xl",
} as const;

interface PageShellProps {
	title: string;
	subtitle?: string;
	actions?: React.ReactNode;
	maxWidth?: keyof typeof MAX_WIDTH_MAP;
	children: React.ReactNode;
}

export function PageShell({
	title,
	subtitle,
	actions,
	maxWidth = "4xl",
	children,
}: PageShellProps) {
	return (
		<div className="flex-1 overflow-y-auto">
			<div className={cn("mx-auto px-6 py-6", MAX_WIDTH_MAP[maxWidth])}>
				<div className="flex items-center justify-between mb-6">
					<div>
						<h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
						{subtitle && <p className="text-[13px] text-muted-foreground mt-1">{subtitle}</p>}
					</div>
					{actions && <div className="flex items-center gap-2">{actions}</div>}
				</div>
				{children}
			</div>
		</div>
	);
}
