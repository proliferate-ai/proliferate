import { AlertTriangle, Check, CheckCircle, Clock, Loader2, Timer, XCircle } from "lucide-react";

export const statusConfig: Record<
	string,
	{
		label: string;
		variant: "default" | "secondary" | "destructive" | "outline";
		icon: typeof Check;
	}
> = {
	pending: { label: "Pending", variant: "outline", icon: Clock },
	approved: { label: "Approved", variant: "secondary", icon: Check },
	executing: { label: "Executing", variant: "secondary", icon: Loader2 },
	completed: { label: "Completed", variant: "default", icon: CheckCircle },
	denied: { label: "Denied", variant: "destructive", icon: XCircle },
	failed: { label: "Failed", variant: "destructive", icon: AlertTriangle },
	expired: { label: "Expired", variant: "outline", icon: Timer },
};

export const riskColors: Record<string, string> = {
	read: "text-muted-foreground border-muted-foreground/30",
	write: "text-warning border-warning/30",
	danger: "text-destructive border-destructive/30",
};
