"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/display/utils";
import { ChevronRight, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";

interface SecretEntry {
	key: string;
	value: string;
}

interface SecretsEditorProps {
	secrets: SecretEntry[];
	onChange: (secrets: SecretEntry[]) => void;
	existingCount: number;
}

export function SecretsEditor({ secrets, onChange, existingCount }: SecretsEditorProps) {
	const [inputValue, setInputValue] = useState("");
	const [existingOpen, setExistingOpen] = useState(false);

	const mergeSecrets = (existing: SecretEntry[], incoming: SecretEntry[]): SecretEntry[] => {
		const map = new Map(existing.map((s) => [s.key, s]));
		for (const entry of incoming) {
			map.set(entry.key, entry); // later entries overwrite earlier ones
		}
		return [...map.values()];
	};

	const handleInputChange = (value: string) => {
		// Detect .env paste: contains = and newlines
		if (value.includes("=") && value.includes("\n")) {
			const parsed = parseEnvText(value);
			if (parsed.length > 0) {
				onChange(mergeSecrets(secrets, parsed));
				setInputValue("");
				return;
			}
		}
		setInputValue(value);
	};

	const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter" && inputValue.trim()) {
			const key = inputValue.trim().toUpperCase();
			if (!secrets.some((s) => s.key === key)) {
				onChange([...secrets, { key, value: "" }]);
			}
			setInputValue("");
		}
	};

	const handlePaste = useCallback(
		(e: React.ClipboardEvent<HTMLInputElement>) => {
			const text = e.clipboardData.getData("text");
			if (text.includes("=") && text.includes("\n")) {
				e.preventDefault();
				const parsed = parseEnvText(text);
				if (parsed.length > 0) {
					onChange(mergeSecrets(secrets, parsed));
				}
			}
		},
		[secrets, onChange],
	);

	const updateSecret = (index: number, field: "key" | "value", val: string) => {
		const updated = [...secrets];
		updated[index] = { ...updated[index], [field]: field === "key" ? val.toUpperCase() : val };
		onChange(updated);
	};

	const removeSecret = (index: number) => {
		onChange(secrets.filter((_, i) => i !== index));
	};

	return (
		<div>
			<h3 className="text-sm font-medium mb-2">Secrets</h3>
			<p className="text-xs text-muted-foreground mb-3">
				Add environment variables your project needs. These are injected as env vars at session
				start.
			</p>

			{/* Secret rows */}
			{secrets.length > 0 && (
				<div className="space-y-2 mb-3">
					{secrets.map((secret, i) => (
						<div key={i} className="grid grid-cols-[1fr_1fr_28px] gap-2 items-center">
							<Input
								value={secret.key}
								onChange={(e) => updateSecret(i, "key", e.target.value)}
								placeholder="KEY"
								className="h-8 text-sm font-mono"
								aria-label={`Secret name ${i + 1}`}
							/>
							<Input
								value={secret.value}
								onChange={(e) => updateSecret(i, "value", e.target.value)}
								placeholder="value"
								type="password"
								className="h-8 text-sm"
								aria-label={`Secret value for ${secret.key || `entry ${i + 1}`}`}
							/>
							<Button
								variant="ghost"
								size="icon"
								className="h-7 w-7"
								onClick={() => removeSecret(i)}
								aria-label={`Remove ${secret.key || "secret"}`}
							>
								<Trash2 className="h-3 w-3" />
							</Button>
						</div>
					))}
				</div>
			)}

			{/* Smart input */}
			<Input
				value={inputValue}
				onChange={(e) => handleInputChange(e.target.value)}
				onKeyDown={handleInputKeyDown}
				onPaste={handlePaste}
				placeholder="Paste your .env or type a secret name (optional)"
				className="h-8 text-sm"
			/>

			{/* Existing secrets toggle */}
			{existingCount > 0 && (
				<div className="mt-3">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setExistingOpen(!existingOpen)}
						aria-expanded={existingOpen}
						className="h-auto p-0 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
					>
						<ChevronRight
							className={cn("h-3 w-3 transition-transform", existingOpen && "rotate-90")}
						/>
						Existing Secrets ({existingCount})
					</Button>
					{existingOpen && (
						<div className="mt-2">
							<p className="text-xs text-muted-foreground">
								{existingCount} secret{existingCount !== 1 ? "s" : ""} already configured for this
								repository. They will be automatically available in the setup session.
							</p>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

/** Parse .env format text into key-value pairs. */
function parseEnvText(text: string): SecretEntry[] {
	const entries: SecretEntry[] = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIndex = trimmed.indexOf("=");
		if (eqIndex <= 0) continue;
		const key = trimmed.slice(0, eqIndex).trim();
		let value = trimmed.slice(eqIndex + 1).trim();
		// Strip surrounding quotes
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		entries.push({ key: key.toUpperCase(), value });
	}
	return entries;
}
