import { AlertCircle, CheckCircle2, Clock, Hand, Loader2, Timer, XCircle } from "lucide-react";

export function getRunStatusDisplay(status: string) {
	switch (status) {
		case "succeeded":
			return { icon: CheckCircle2, label: "Succeeded", className: "text-emerald-500" };
		case "failed":
			return { icon: XCircle, label: "Failed", className: "text-destructive" };
		case "needs_human":
			return { icon: Hand, label: "Needs attention", className: "text-amber-500" };
		case "timed_out":
			return { icon: Timer, label: "Timed out", className: "text-orange-500" };
		case "running":
			return { icon: Loader2, label: "Running", className: "text-emerald-500" };
		case "queued":
		case "enriching":
		case "ready":
			return {
				icon: Clock,
				label: status.charAt(0).toUpperCase() + status.slice(1),
				className: "text-muted-foreground",
			};
		default:
			return { icon: AlertCircle, label: status, className: "text-muted-foreground" };
	}
}
