"use client";

import { CodingSessionModal } from "@/components/coding-session/coding-session-modal";
import { HelpSheet } from "@/components/help";
import {
	IntercomProvider,
	PostHogPageView,
	PostHogProvider,
	PostHogUserIdentity,
	ThemeProvider,
} from "@/components/providers";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						staleTime: 60 * 1000, // 1 minute
					},
				},
			}),
	);

	return (
		<PostHogProvider>
			<QueryClientProvider client={queryClient}>
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					disableTransitionOnChange
				>
					{children}
					<CodingSessionModal />
					<HelpSheet />
					<IntercomProvider />
					<PostHogPageView />
					<PostHogUserIdentity />
				</ThemeProvider>
			</QueryClientProvider>
		</PostHogProvider>
	);
}
