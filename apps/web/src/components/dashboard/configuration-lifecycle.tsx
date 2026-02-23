import { cn } from "@/lib/utils";

type ConfigurationStatus = string | null | undefined;

type BadgeTone = "neutral" | "muted" | "warning" | "success" | "error";

interface BadgeModel {
	label: string;
	tone: BadgeTone;
}

interface LifecycleState {
	status: BadgeModel;
	nextStep: string;
}

function getBadgeToneClass(tone: BadgeTone): string {
	switch (tone) {
		case "success":
			return "border-border/70 bg-muted/50 text-foreground";
		case "warning":
			return "border-border bg-background text-foreground";
		case "error":
			return "border-destructive/40 bg-destructive/10 text-destructive";
		case "muted":
			return "border-border/60 bg-muted/30 text-muted-foreground";
		default:
			return "border-border/60 bg-muted/40 text-foreground";
	}
}

export function getConfigurationLifecycleState(status: ConfigurationStatus): LifecycleState {
	switch (status) {
		case "building":
			return {
				status: { label: "Preparing", tone: "warning" },
				nextStep:
					"Environment is being prepared. You can start setup now or wait until it's ready.",
			};
		case "default":
			return {
				status: { label: "Needs setup", tone: "warning" },
				nextStep: "Run a setup session and save it to finish configuring this environment.",
			};
		case "ready":
			return {
				status: { label: "Ready", tone: "success" },
				nextStep: "This environment is ready. Start coding or run setup again to update it.",
			};
		case "failed":
			return {
				status: { label: "Failed", tone: "error" },
				nextStep:
					"Something went wrong. Check linked repos and integrations, then recreate or retry.",
			};
		default:
			return {
				status: { label: "Queued", tone: "muted" },
				nextStep: "This configuration is queued and will be ready shortly.",
			};
	}
}

export function ConfigurationStatusBadges({
	status,
	align = "center",
}: {
	status: ConfigurationStatus;
	align?: "center" | "start";
}) {
	const lifecycle = getConfigurationLifecycleState(status);
	return (
		<div
			className={cn(
				"flex flex-wrap gap-1.5",
				align === "center" ? "justify-center" : "justify-start",
			)}
		>
			<span
				className={cn(
					"inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium",
					getBadgeToneClass(lifecycle.status.tone),
				)}
			>
				{lifecycle.status.label}
			</span>
		</div>
	);
}
