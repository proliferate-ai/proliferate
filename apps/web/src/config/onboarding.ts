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
import type { PlanId } from "@/config/billing";

export interface OnboardingPlan {
	id: PlanId;
	name: string;
	price: string;
	priceNote?: string;
	description: string;
	features: string[];
	cta: string;
	popular?: boolean;
}

export const ONBOARDING_PLANS: OnboardingPlan[] = [
	{
		id: "dev",
		name: "Developer",
		price: "$20",
		priceNote: "/month",
		description: "For solo builders and small projects",
		features: ["1,000 free trial credits", "10 concurrent sessions", "5 snapshots"],
		cta: "Start free trial",
	},
	{
		id: "pro",
		name: "Professional",
		price: "$500",
		priceNote: "/month",
		description: "For teams shipping fast",
		features: [
			"1,000 free trial credits",
			"7,500 credits/month",
			"100 concurrent sessions",
			"200 snapshots",
		],
		cta: "Start free trial",
		popular: true,
	},
];

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
