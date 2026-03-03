import {
	Context7Icon,
	FirecrawlIcon,
	GithubIcon,
	LinearIcon,
	NeonIcon,
	PlaywrightIcon,
	PostHogIcon,
	SentryIcon,
	SlackIcon,
	StripeIcon,
} from "@/components/ui/icons";

export const REFERRAL_SOURCES = [
	"Twitter / X",
	"LinkedIn",
	"Friend or colleague",
	"Blog post",
	"Search engine",
	"YouTube",
	"Conference or event",
	"Other",
] as const;

export const TEAM_SIZES = ["1-5", "6-20", "21-100", "100+"] as const;

export const ONBOARDING_TOOLS = [
	{
		id: "github",
		name: "GitHub",
		description: "Source control and pull requests",
		icon: GithubIcon,
	},
	{
		id: "slack",
		name: "Slack",
		description: "Notifications and automations",
		icon: SlackIcon,
	},
	{
		id: "linear",
		name: "Linear",
		description: "Issue tracking and project management",
		icon: LinearIcon,
	},
	{
		id: "sentry",
		name: "Sentry",
		description: "Error monitoring and debugging",
		icon: SentryIcon,
	},
	{
		id: "posthog",
		name: "PostHog",
		description: "Product analytics and insights",
		icon: PostHogIcon,
	},
	{
		id: "context7",
		name: "Context7",
		description: "Up-to-date docs and code examples",
		icon: Context7Icon,
	},
	{
		id: "stripe",
		name: "Stripe",
		description: "Payment processing and billing",
		icon: StripeIcon,
	},
	{
		id: "firecrawl",
		name: "Firecrawl",
		description: "Web scraping and crawling",
		icon: FirecrawlIcon,
	},
	{
		id: "neon",
		name: "Neon",
		description: "Serverless Postgres databases",
		icon: NeonIcon,
	},
	{
		id: "playwright",
		name: "Playwright",
		description: "Browser testing and automation",
		icon: PlaywrightIcon,
	},
] as const;
