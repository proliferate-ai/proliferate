"use client";

import { Button } from "@/components/ui/button";
import { GithubIcon } from "@/components/ui/icons";
import { signIn } from "@/lib/auth-client";
import { useState } from "react";

export function GitHubButton() {
	const [loading, setLoading] = useState(false);

	const handleGitHubSignIn = async () => {
		setLoading(true);
		try {
			await signIn.social({
				provider: "github",
				callbackURL: "/dashboard",
			});
		} catch (err) {
			console.error("GitHub sign in failed:", err);
			setLoading(false);
		}
	};

	return (
		<Button
			type="button"
			variant="outline"
			className="w-full"
			onClick={handleGitHubSignIn}
			disabled={loading}
		>
			<GithubIcon className="mr-2 h-4 w-4" />
			{loading ? "Redirecting..." : "Continue with GitHub"}
		</Button>
	);
}
