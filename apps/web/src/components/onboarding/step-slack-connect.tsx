"use client";

import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2, SlackIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { useSlackConnect } from "@/hooks/use-integrations";
import { useEffect, useRef, useState } from "react";

interface StepSlackConnectProps {
	onConnected: () => void;
	onSkip: () => void;
	hasSlackConnection?: boolean;
	justConnected?: boolean;
}

export function StepSlackConnect({
	onConnected,
	onSkip,
	hasSlackConnection,
	justConnected,
}: StepSlackConnectProps) {
	const [channelName, setChannelName] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const slackConnect = useSlackConnect();

	useEffect(() => {
		if (justConnected && inputRef.current) {
			inputRef.current.focus();
		}
	}, [justConnected]);

	const handleConnect = () => {
		window.location.href = "/api/integrations/slack/oauth?returnUrl=/onboarding";
	};

	const handleSetupSlackConnect = async () => {
		if (!channelName.trim()) {
			onConnected();
			return;
		}

		try {
			await slackConnect.mutateAsync({
				channelName: `proliferate-${channelName.trim()}`,
			});
		} catch (err) {
			console.error("Failed to setup Slack Connect:", err);
		} finally {
			onConnected();
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			handleSetupSlackConnect();
		}
	};

	// Just completed OAuth - show Slack Connect setup
	if (justConnected) {
		return (
			<div className="w-full max-w-[420px]">
				<div className="rounded-2xl overflow-hidden border border-border mb-8">
					{/* Slack Icon Area */}
					<div className="relative bg-gradient-to-br from-[#4A154B] to-[#611f69] h-48 flex items-center justify-center">
						<div className="w-20 h-20 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center">
							<CheckCircle className="h-10 w-10 text-white" />
						</div>
						<div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none">
							<span className="px-4 py-1.5 font-bold text-xs tracking-[0.25em] uppercase text-white/80">
								Connected
							</span>
						</div>
					</div>

					{/* Form Content */}
					<div className="p-6 bg-card">
						<div className="mb-5 text-center">
							<h1 className="text-xl font-semibold text-foreground">Slack Connected!</h1>
							<p className="mt-2 text-sm text-muted-foreground">
								Want a shared support channel? Enter a name and we&apos;ll invite you via Slack
								Connect.
							</p>
						</div>

						<div className="space-y-4">
							<div className="flex items-center gap-0">
								<span className="bg-muted px-3 h-11 flex items-center text-sm text-muted-foreground border border-r-0 border-input rounded-l-lg">
									proliferate-
								</span>
								<Input
									ref={inputRef}
									placeholder="acme-corp"
									value={channelName}
									onChange={(e) =>
										setChannelName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
									}
									onKeyDown={handleKeyDown}
									disabled={slackConnect.isPending}
									className="h-11 rounded-l-none rounded-r-lg"
								/>
							</div>
							<div className="flex gap-3">
								<Button
									variant="outline"
									onClick={onConnected}
									disabled={slackConnect.isPending}
									className="h-11 flex-1 rounded-lg"
								>
									Skip
								</Button>
								<Button
									variant="dark"
									onClick={handleSetupSlackConnect}
									disabled={slackConnect.isPending}
									className="h-11 flex-1 rounded-lg"
								>
									{slackConnect.isPending ? (
										<>
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
											Setting up...
										</>
									) : (
										"Create Channel"
									)}
								</Button>
							</div>
						</div>
					</div>
				</div>
			</div>
		);
	}

	// Already connected (from previous session)
	if (hasSlackConnection) {
		return (
			<div className="w-full max-w-[420px]">
				<div className="rounded-2xl overflow-hidden border border-border mb-8">
					{/* Slack Icon Area */}
					<div className="relative bg-gradient-to-br from-[#4A154B] to-[#611f69] h-48 flex items-center justify-center">
						<div className="w-20 h-20 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center">
							<SlackIcon className="h-10 w-10 text-white" />
						</div>
						<div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none">
							<span className="px-4 py-1.5 font-bold text-xs tracking-[0.25em] uppercase text-white/80">
								Slack
							</span>
						</div>
					</div>

					{/* Form Content */}
					<div className="p-6 bg-card">
						<div className="mb-5 text-center">
							<h1 className="text-xl font-semibold text-foreground">Connect to Slack</h1>
							<p className="mt-2 text-sm text-muted-foreground">
								Get notified when agents complete tasks and interact with them directly from Slack.
							</p>
						</div>

						<div className="space-y-4">
							<div className="flex items-center justify-center gap-2 text-sm text-green-600">
								<CheckCircle className="h-4 w-4" />
								<span>Slack already connected</span>
							</div>
							<div className="flex gap-3">
								<Button
									variant="outline"
									onClick={handleConnect}
									className="h-11 flex-1 rounded-lg"
								>
									Reconnect
								</Button>
								<Button variant="dark" onClick={onSkip} className="h-11 flex-1 rounded-lg">
									Continue
								</Button>
							</div>
						</div>
					</div>
				</div>
			</div>
		);
	}

	// Not connected yet
	return (
		<div className="w-full max-w-[420px]">
			<div className="rounded-2xl overflow-hidden border border-border mb-8">
				{/* Slack Icon Area */}
				<div className="relative bg-gradient-to-br from-[#4A154B] to-[#611f69] h-48 flex items-center justify-center">
					<div className="w-20 h-20 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center">
						<SlackIcon className="h-10 w-10 text-white" />
					</div>
					<div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none">
						<span className="px-4 py-1.5 font-bold text-xs tracking-[0.25em] uppercase text-white/80">
							Slack
						</span>
					</div>
				</div>

				{/* Form Content */}
				<div className="p-6 bg-card">
					<div className="mb-5 text-center">
						<h1 className="text-xl font-semibold text-foreground">Connect to Slack</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							Get notified when agents complete tasks and interact with them directly from Slack.
						</p>
					</div>

					<div className="space-y-3">
						<Button variant="dark" onClick={handleConnect} className="h-11 w-full rounded-lg">
							Add to Slack
						</Button>
						<Button
							variant="ghost"
							onClick={onSkip}
							className="h-11 w-full rounded-lg text-muted-foreground"
						>
							Skip for now
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
