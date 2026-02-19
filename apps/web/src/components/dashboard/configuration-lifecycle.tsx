import { cn } from "@/lib/utils";
import { CheckCircle2, CircleAlert, Hammer, Settings2 } from "lucide-react";

type ConfigurationStatus = string | null | undefined;

type BadgeTone = "neutral" | "muted" | "warning" | "success" | "error";

interface BadgeModel {
	label: string;
	value: string;
	tone: BadgeTone;
}

interface LifecycleState {
	build: BadgeModel;
	configure: BadgeModel;
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
				build: { label: "Build", value: "In progress", tone: "warning" },
				configure: { label: "Configure", value: "Waiting", tone: "muted" },
				nextStep:
					"Snapshot build is running. You can start setup now or wait for build completion.",
			};
		case "default":
			return {
				build: { label: "Build", value: "Complete", tone: "success" },
				configure: { label: "Configure", value: "Needs setup", tone: "warning" },
				nextStep: "Run one setup session and save it to finish configuring this environment.",
			};
		case "ready":
			return {
				build: { label: "Build", value: "Complete", tone: "success" },
				configure: { label: "Configure", value: "Configured", tone: "success" },
				nextStep: "This environment is ready. Start coding or run setup again to update it.",
			};
		case "failed":
			return {
				build: { label: "Build", value: "Failed", tone: "error" },
				configure: { label: "Configure", value: "Blocked", tone: "error" },
				nextStep:
					"Build failed. Check linked repos and integrations, then recreate or retry setup.",
			};
		default:
			return {
				build: { label: "Build", value: "Queued", tone: "muted" },
				configure: { label: "Configure", value: "Waiting", tone: "muted" },
				nextStep: "This configuration is waiting to start building.",
			};
	}
}

function StatusBadge({
	label,
	value,
	tone,
	className,
}: BadgeModel & {
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium",
				getBadgeToneClass(tone),
				className,
			)}
		>
			<span className="text-muted-foreground mr-1">{label}:</span>
			{value}
		</span>
	);
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
			<StatusBadge {...lifecycle.build} />
			<StatusBadge {...lifecycle.configure} />
		</div>
	);
}

export function ConfigurationLifecycleExplainer() {
	return (
		<div className="rounded-xl border border-border/80 bg-muted/20 p-4">
			<div className="flex items-start gap-3">
				<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
					<CircleAlert className="h-4 w-4 text-muted-foreground" />
				</div>
				<div className="min-w-0">
					<p className="text-sm font-medium">Build and Configure are separate phases</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Build prepares a reusable snapshot from your selected repos. Configure is your setup
						session where the agent installs extra services, adds secrets, and you save the final
						environment.
					</p>
				</div>
			</div>

			<div className="mt-3 grid gap-2 sm:grid-cols-3">
				<div className="rounded-md border border-border/70 bg-background px-3 py-2">
					<div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
						<Hammer className="h-3.5 w-3.5 text-muted-foreground" />
						1. Create
					</div>
					<p className="mt-1 text-xs text-muted-foreground">
						Choose repos and create the configuration.
					</p>
				</div>
				<div className="rounded-md border border-border/70 bg-background px-3 py-2">
					<div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
						<Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
						2. Build
					</div>
					<p className="mt-1 text-xs text-muted-foreground">
						We build the base snapshot automatically in the background.
					</p>
				</div>
				<div className="rounded-md border border-border/70 bg-background px-3 py-2">
					<div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
						<CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
						3. Configure
					</div>
					<p className="mt-1 text-xs text-muted-foreground">
						Run setup and save to mark the environment fully configured.
					</p>
				</div>
			</div>
		</div>
	);
}
