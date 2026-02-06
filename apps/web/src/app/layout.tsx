import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
	title: "Keystone | The Autonomous Engineering Organization",
	description:
		"A single workspace for coding agents, engineers, and operators to build together, faster. Ship features, fix bugs, and automate maintenance with AI agents.",
	keywords: [
		"AI coding agents",
		"autonomous engineering",
		"AI software development",
		"coding automation",
		"AI pair programming",
		"developer productivity",
		"AI code generation",
		"engineering automation",
	],
	authors: [{ name: "Keystone" }],
	creator: "Keystone",
	publisher: "Keystone",

	// Open Graph meta tags for social media sharing
	openGraph: {
		type: "website",
		locale: "en_US",
		url: "https://withkeystone.com",
		title: "Keystone | The Autonomous Engineering Organization",
		description:
			"A single workspace for coding agents, engineers, and operators to build together, faster. Ship features, fix bugs, and automate maintenance with AI agents.",
		siteName: "Keystone",
		images: [
			{
				url: "https://d1uh4o7rpdqkkl.cloudfront.net/og.png?v=3",
				width: 1200,
				height: 630,
				alt: "Keystone - The Autonomous Engineering Organization",
				type: "image/png",
			},
		],
	},

	// Twitter Card meta tags
	twitter: {
		card: "summary_large_image",
		site: "@withkeystone",
		creator: "@withkeystone",
		title: "Keystone | The Autonomous Engineering Organization",
		description:
			"A single workspace for coding agents, engineers, and operators to build together, faster.",
		images: ["https://d1uh4o7rpdqkkl.cloudfront.net/og.png?v=3"],
	},

	// Icons
	icons: {
		icon: "/favicon.ico",
		apple: "https://d1uh4o7rpdqkkl.cloudfront.net/logo.webp",
	},

	// Additional meta tags
	robots: {
		index: true,
		follow: true,
		googleBot: {
			index: true,
			follow: true,
			"max-video-preview": -1,
			"max-image-preview": "large",
			"max-snippet": -1,
		},
	},
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<meta name="theme-color" content="#000000" />
				<meta name="msapplication-TileColor" content="#000000" />
				<meta
					name="msapplication-TileImage"
					content="https://d1uh4o7rpdqkkl.cloudfront.net/logo.webp"
				/>
			</head>
			<body>
				<Providers>{children}</Providers>
				<Toaster
					position="top-center"
					theme="system"
					toastOptions={{
						classNames: {
							toast: "!bg-background !border-border",
							title: "!text-foreground",
							description: "!text-foreground !opacity-70",
						},
					}}
				/>
			</body>
		</html>
	);
}
