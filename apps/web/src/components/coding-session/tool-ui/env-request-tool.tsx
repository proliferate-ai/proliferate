"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { makeAssistantToolUI, useThreadRuntime } from "@assistant-ui/react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle, Key, Loader2, Settings } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

// Context for session info needed by the tool UI
interface SessionContextValue {
	sessionId: string;
	repoId?: string;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSessionContext() {
	const ctx = useContext(SessionContext);
	if (!ctx) {
		throw new Error("useSessionContext must be used within SessionContext.Provider");
	}
	return ctx;
}

interface Suggestion {
	label: string;
	value?: string;
	instructions?: string;
}

interface EnvVariable {
	key: string;
	description?: string;
	type?: "env" | "secret";
	required?: boolean;
	suggestions?: Suggestion[];
}

interface EnvRequestArgs {
	keys: EnvVariable[];
}

export const EnvRequestToolUI = makeAssistantToolUI<EnvRequestArgs, string>({
	toolName: "request_env_variables",
	render: function EnvRequestUI({ args, status }) {
		const [values, setValues] = useState<Record<string, string>>({});
		const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
		const [overrides, setOverrides] = useState<Set<string>>(new Set());
		const [skipped, setSkipped] = useState<Set<string>>(new Set());
		const [saveToSnapshot, setSaveToSnapshot] = useState(true);
		const [submitting, setSubmitting] = useState(false);
		const [submitted, setSubmitted] = useState(false);
		const [loading, setLoading] = useState(true);

		// Get session context - may be null if not provided
		const sessionCtx = useContext(SessionContext);
		const threadRuntime = useThreadRuntime();

		const isRunning = status.type === "running";

		// Memoize variables to ensure stable reference
		const variables = useMemo(() => args?.keys || [], [args?.keys]);

		// Memoize secret keys to prevent infinite API calls on re-renders
		const secretKeys = useMemo(
			() => variables.filter((v) => v.type === "secret").map((v) => v.key),
			[variables],
		);
		const repoId = sessionCtx?.repoId;

		const checkSecretsMutation = useMutation(orpc.secrets.check.mutationOptions());
		const submitEnvMutation = useMutation(orpc.sessions.submitEnv.mutationOptions());
		const checkSecrets = checkSecretsMutation.mutateAsync;

		useEffect(() => {
			if (!repoId) {
				setLoading(false);
				return;
			}

			async function checkExistingSecrets() {
				if (secretKeys.length === 0) {
					setLoading(false);
					return;
				}

				try {
					const response = await checkSecrets({
						keys: secretKeys,
						repo_id: repoId,
					});
					const existing = new Set(response.keys.filter((k) => k.exists).map((k) => k.key));
					setExistingKeys(existing);
				} catch (err) {
					console.error("Failed to check existing secrets:", err);
				} finally {
					setLoading(false);
				}
			}
			checkExistingSecrets();
		}, [secretKeys, repoId, checkSecrets]);

		const handleSuggestionClick = (key: string, suggestion: Suggestion) => {
			const valueToUse = suggestion.value || suggestion.instructions || "";
			// Toggle: if already selected, clear it
			setValues((prev) => ({
				...prev,
				[key]: prev[key] === valueToUse ? "" : valueToUse,
			}));
		};

		const handleSubmit = async () => {
			if (!sessionCtx) return;

			setSubmitting(true);

			try {
				const secretsToSubmit = variables
					.filter((v) => v.type === "secret" && values[v.key])
					.map((v) => ({
						key: v.key,
						value: values[v.key],
						description: v.description,
					}));

				const envsToSubmit = variables
					.filter((v) => v.type !== "secret" && values[v.key])
					.map((v) => ({
						key: v.key,
						value: values[v.key],
					}));

				await submitEnvMutation.mutateAsync({
					sessionId: sessionCtx.sessionId,
					secrets: secretsToSubmit,
					envVars: envsToSubmit,
					saveToPrebuild: saveToSnapshot,
				});

				setSubmitted(true);

				// Send a user message to signal the agent to continue
				threadRuntime.append({
					role: "user",
					content: [{ type: "text", text: "Configuration submitted." }],
				});
			} catch (err) {
				console.error("Failed to submit environment variables:", err);
			} finally {
				setSubmitting(false);
			}
		};

		// Check if all variables are satisfied (required ones must have value, optional ones can be skipped)
		const allRequiredSatisfied = variables.every((v) => {
			// Optional variables are satisfied if skipped or have a value
			if (v.required === false) {
				return (
					skipped.has(v.key) || values[v.key] || (v.type === "secret" && existingKeys.has(v.key))
				);
			}
			// Required variables must have a value or already exist
			if (v.type === "secret") {
				return existingKeys.has(v.key) || values[v.key];
			}
			return values[v.key];
		});

		const handleSkip = (key: string) => {
			setSkipped((prev) => new Set([...prev, key]));
			// Clear any value if skipping
			setValues((prev) => {
				const { [key]: _, ...rest } = prev;
				return rest;
			});
		};

		const handleUnskip = (key: string) => {
			setSkipped((prev) => {
				const next = new Set(prev);
				next.delete(key);
				return next;
			});
		};

		const hasSecrets = variables.some((v) => v.type === "secret");

		// If submitted, show success state
		if (submitted) {
			return (
				<div className="my-2 py-3">
					<div className="flex items-center gap-2 text-green-600">
						<CheckCircle className="h-4 w-4" />
						<span className="text-sm font-medium">Configuration submitted</span>
					</div>
				</div>
			);
		}

		// If still running or no args yet, show minimal state
		if (isRunning || !args?.keys) {
			return (
				<div className="my-2 py-3">
					<div className="flex items-center gap-2 text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						<span className="text-sm">Requesting configuration...</span>
					</div>
				</div>
			);
		}

		// If no session context, show error
		if (!sessionCtx) {
			return (
				<div className="my-2 py-3">
					<div className="flex items-center gap-2 text-destructive">
						<Settings className="h-4 w-4" />
						<span className="text-sm">Configuration form unavailable</span>
					</div>
				</div>
			);
		}

		return (
			<div className="my-2 py-4 space-y-4">
				<div className="flex items-center gap-2 text-muted-foreground">
					{hasSecrets ? <Key className="h-4 w-4" /> : <Settings className="h-4 w-4" />}
					<h3 className="font-medium text-sm">
						{hasSecrets ? "Configuration Required" : "Environment Variables"}
					</h3>
				</div>

				<p className="text-xs text-muted-foreground">
					The agent needs the following to continue setup.
				</p>

				{loading ? (
					<div className="flex items-center gap-2 text-muted-foreground">
						<Loader2 className="h-3 w-3 animate-spin" />
						<span className="text-xs">Checking existing configuration...</span>
					</div>
				) : (
					<div className="space-y-3">
						{variables.map((variable) => {
							const isOptional = variable.required === false;
							const isSkipped = skipped.has(variable.key);

							return (
								<div key={variable.key} className="space-y-1.5">
									<div className="flex items-center gap-2">
										<Label htmlFor={`env-${variable.key}`} className="text-xs font-medium">
											{variable.key} {!isOptional && <span className="text-destructive">*</span>}
										</Label>
										{variable.type === "secret" && (
											<span className="text-[10px] bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 px-1 py-0.5 rounded">
												secret
											</span>
										)}
										{isOptional && !isSkipped && (
											<span className="text-[10px] text-muted-foreground">(optional)</span>
										)}
									</div>
									{variable.description && (
										<p className="text-[10px] text-muted-foreground">{variable.description}</p>
									)}

									{/* Skipped state for optional variables */}
									{isSkipped ? (
										<div className="flex items-center gap-2 text-xs text-muted-foreground">
											<span>Skipped</span>
											<Button
												variant="link"
												size="sm"
												className="p-0 h-auto text-xs"
												onClick={() => handleUnskip(variable.key)}
											>
												Undo
											</Button>
										</div>
									) : (
										<>
											{/* Suggestions */}
											{variable.suggestions && variable.suggestions.length > 0 && (
												<div className="flex flex-wrap gap-1.5">
													{variable.suggestions.map((suggestion) => (
														<Button
															key={suggestion.label}
															variant="outline"
															onClick={() => handleSuggestionClick(variable.key, suggestion)}
															className={cn(
																"text-[10px] h-auto px-2 py-0.5 rounded-full",
																values[variable.key] ===
																	(suggestion.value || suggestion.instructions)
																	? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
																	: "bg-background hover:bg-muted",
															)}
														>
															{suggestion.label}
														</Button>
													))}
												</div>
											)}

											{/* Existing secret indicator */}
											{variable.type === "secret" &&
											existingKeys.has(variable.key) &&
											!overrides.has(variable.key) ? (
												<div className="flex items-center gap-2 text-xs text-green-600">
													<CheckCircle className="h-3 w-3" />
													<span>Value already set</span>
													<Button
														variant="link"
														size="sm"
														className="p-0 h-auto text-xs"
														onClick={() => setOverrides((prev) => new Set([...prev, variable.key]))}
													>
														Override
													</Button>
												</div>
											) : (
												<div className="flex items-center gap-2">
													<Input
														id={`env-${variable.key}`}
														type={variable.type === "secret" ? "password" : "text"}
														value={values[variable.key] || ""}
														onChange={(e) =>
															setValues((prev) => ({
																...prev,
																[variable.key]: e.target.value,
															}))
														}
														placeholder={`Enter ${variable.key}`}
														className="h-8 text-xs flex-1"
													/>
													{isOptional && (
														<Button
															variant="ghost"
															size="sm"
															className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
															onClick={() => handleSkip(variable.key)}
														>
															Skip
														</Button>
													)}
												</div>
											)}
										</>
									)}
								</div>
							);
						})}
					</div>
				)}

				{/* Save to snapshot option */}
				{hasSecrets && !loading && (
					<div className="flex items-center gap-2">
						<Checkbox
							id="save-snapshot-inline"
							checked={saveToSnapshot}
							onCheckedChange={(checked) => setSaveToSnapshot(checked === true)}
							className="h-3 w-3"
						/>
						<Label htmlFor="save-snapshot-inline" className="text-[10px] font-normal">
							Save secrets to this snapshot
						</Label>
					</div>
				)}

				{!loading && (
					<div className="flex justify-end">
						<Button
							size="sm"
							onClick={handleSubmit}
							disabled={submitting || !allRequiredSatisfied}
							className="h-7 text-xs"
						>
							{submitting ? "Submitting..." : "Submit"}
						</Button>
					</div>
				)}
			</div>
		);
	},
});
