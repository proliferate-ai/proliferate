/**
 * Centralized icon exports
 *
 * Re-exports from lucide-react for consistent imports across the codebase.
 * Also includes custom brand icons and other SVG icons.
 *
 * Usage:
 * import { Check, Plus, GoogleIcon, GithubIcon } from "@/components/ui/icons";
 */

import { cn } from "@/lib/utils";
import { Croissant } from "lucide-react";

// Re-export LucideIcon type for typed icon props
export type { LucideIcon } from "lucide-react";

// Re-export commonly used icons from lucide-react
export {
	AlertCircle,
	AlertTriangle,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	BarChart3,
	Box,
	Camera,
	Check,
	CheckCircle,
	CheckCircle2,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	Circle,
	Clock,
	Copy,
	Download,
	ExternalLink,
	Eye,
	EyeOff,
	File,
	FileText,
	Folder,
	FolderOpen,
	GitBranch,
	Github,
	Globe,
	Grid,
	Image,
	Info,
	Key,
	Link,
	Loader2,
	Lock,
	LogOut,
	Mail,
	Maximize2,
	MessageSquare,
	Mic,
	Minimize2,
	Moon,
	MoreHorizontal,
	MoreVertical,
	Package,
	PanelRight,
	Paperclip,
	Pencil,
	Play,
	Plus,
	RefreshCw,
	Search,
	Settings,
	Square,
	Sun,
	Trash2,
	User,
	Users,
	Video,
	X,
} from "lucide-react";

// ============================================================================
// Custom Brand Icons
// ============================================================================

interface IconProps {
	className?: string;
}

/**
 * Custom "Blocks" icon
 */
export function BlocksIcon({ className }: IconProps) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="300 300 200 200"
			className={className}
			fill="none"
		>
			<rect x="375.00" y="375.00" width="50.00" height="50.00" fill="currentColor" />
			<rect x="387.67" y="305.00" width="24.67" height="24.67" fill="currentColor" />
			<rect x="429.00" y="346.33" width="24.67" height="24.67" fill="currentColor" />
			<rect x="470.33" y="387.67" width="24.67" height="24.67" fill="currentColor" />
			<rect x="429.00" y="429.00" width="24.67" height="24.67" fill="currentColor" />
			<rect x="387.67" y="470.33" width="24.67" height="24.67" fill="currentColor" />
			<rect x="346.33" y="429.00" width="24.67" height="24.67" fill="currentColor" />
			<rect x="305.00" y="387.67" width="24.67" height="24.67" fill="currentColor" />
			<rect x="346.33" y="346.33" width="24.67" height="24.67" fill="currentColor" />
		</svg>
	);
}

/**
 * Animated loading version of the "Blocks" icon
 */
export function BlocksLoadingIcon({ className }: IconProps) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="300 300 200 200"
			className={className}
			fill="none"
		>
			<rect x="375.00" y="375.00" width="50.00" height="50.00" fill="currentColor">
				<animate
					attributeName="opacity"
					values="1;0.55;1"
					dur="1.6s"
					begin="-0.8s"
					repeatCount="indefinite"
				/>
			</rect>
			<rect x="387.67" y="305.00" width="24.67" height="24.67" fill="currentColor">
				<animate
					attributeName="opacity"
					values="0.35;1;0.35"
					dur="1.6s"
					begin="0s"
					repeatCount="indefinite"
				/>
			</rect>
			<rect x="429.00" y="346.33" width="24.67" height="24.67" fill="currentColor">
				<animate
					attributeName="opacity"
					values="0.35;1;0.35"
					dur="1.6s"
					begin="0.16s"
					repeatCount="indefinite"
				/>
			</rect>
			<rect x="470.33" y="387.67" width="24.67" height="24.67" fill="currentColor">
				<animate
					attributeName="opacity"
					values="0.35;1;0.35"
					dur="1.6s"
					begin="0.32s"
					repeatCount="indefinite"
				/>
			</rect>
			<rect x="429.00" y="429.00" width="24.67" height="24.67" fill="currentColor">
				<animate
					attributeName="opacity"
					values="0.35;1;0.35"
					dur="1.6s"
					begin="0.48s"
					repeatCount="indefinite"
				/>
			</rect>
			<rect x="387.67" y="470.33" width="24.67" height="24.67" fill="currentColor">
				<animate
					attributeName="opacity"
					values="0.35;1;0.35"
					dur="1.6s"
					begin="0.64s"
					repeatCount="indefinite"
				/>
			</rect>
			<rect x="346.33" y="429.00" width="24.67" height="24.67" fill="currentColor">
				<animate
					attributeName="opacity"
					values="0.35;1;0.35"
					dur="1.6s"
					begin="0.8s"
					repeatCount="indefinite"
				/>
			</rect>
			<rect x="305.00" y="387.67" width="24.67" height="24.67" fill="currentColor">
				<animate
					attributeName="opacity"
					values="0.35;1;0.35"
					dur="1.6s"
					begin="0.96s"
					repeatCount="indefinite"
				/>
			</rect>
			<rect x="346.33" y="346.33" width="24.67" height="24.67" fill="currentColor">
				<animate
					attributeName="opacity"
					values="0.35;1;0.35"
					dur="1.6s"
					begin="1.12s"
					repeatCount="indefinite"
				/>
			</rect>
		</svg>
	);
}
export function BlocksLoadingIcon2({ className }: IconProps) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="300 300 200 200"
			className={className}
			fill="none"
		>
			{/* Embedded CSS for a self-contained component */}
			<style>
				{`
                    @keyframes ai-pulse-wave {
                        /* 0% to 60% covers the active pulse, 60% to 100% creates a natural resting pause between waves */
                        0%, 60%, 100% {
                            opacity: 0.2;
                            transform: scale(0.6);
                        }
                        30% {
                            opacity: 1;
                            transform: scale(1);
                        }
                    }
                    .ai-block {
                        /* Ensures each block scales exactly from its own center */
                        transform-origin: center;
                        transform-box: fill-box;
                        animation: ai-pulse-wave 1.5s infinite ease-in-out;
                    }
                `}
			</style>

			{/* Column 3: Center & Top/Bottom */}
			<rect
				x="375.00"
				y="375.00"
				width="50.00"
				height="50.00"
				fill="#000"
				className="ai-block"
				style={{ animationDelay: "-1.2s" }}
			/>
			<rect
				x="387.67"
				y="305.00"
				width="24.67"
				height="24.67"
				fill="#000"
				className="ai-block"
				style={{ animationDelay: "-1.2s" }}
			/>
			<rect
				x="387.67"
				y="470.33"
				width="24.67"
				height="24.67"
				fill="#000"
				className="ai-block"
				style={{ animationDelay: "-1.2s" }}
			/>

			{/* Column 4: Top-Right & Bottom-Right */}
			<rect
				x="429.00"
				y="346.33"
				width="24.67"
				height="24.67"
				fill="#000"
				className="ai-block"
				style={{ animationDelay: "-1.05s" }}
			/>
			<rect
				x="429.00"
				y="429.00"
				width="24.67"
				height="24.67"
				fill="#000"
				className="ai-block"
				style={{ animationDelay: "-1.05s" }}
			/>

			{/* Column 5: Right Edge */}
			<rect
				x="470.33"
				y="387.67"
				width="24.67"
				height="24.67"
				fill="#000"
				className="ai-block"
				style={{ animationDelay: "-0.9s" }}
			/>

			{/* Column 2: Top-Left & Bottom-Left */}
			<rect
				x="346.33"
				y="429.00"
				width="24.67"
				height="24.67"
				fill="#000"
				className="ai-block"
				style={{ animationDelay: "-1.35s" }}
			/>
			<rect
				x="346.33"
				y="346.33"
				width="24.67"
				height="24.67"
				fill="#000"
				className="ai-block"
				style={{ animationDelay: "-1.35s" }}
			/>

			{/* Column 1: Left Edge */}
			<rect
				x="305.00"
				y="387.67"
				width="24.67"
				height="24.67"
				fill="#000"
				className="ai-block"
				style={{ animationDelay: "-1.5s" }}
			/>
		</svg>
	);
}

/**
 * Google brand icon for OAuth buttons
 */
export function GoogleIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24">
			<path
				fill="#4285F4"
				d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
			/>
			<path
				fill="#34A853"
				d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
			/>
			<path
				fill="#FBBC05"
				d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
			/>
			<path
				fill="#EA4335"
				d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
			/>
		</svg>
	);
}

/**
 * Slack brand icon (official 4-color pinwheel)
 */
export function SlackIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" role="img" aria-label="Slack">
			<path
				d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
				fill="#E01E5A"
			/>
			<path
				d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
				fill="#36C5F0"
			/>
			<path
				d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
				fill="#2EB67D"
			/>
			<path
				d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"
				fill="#ECB22E"
			/>
		</svg>
	);
}

/**
 * Sentry brand icon
 */
export function SentryIcon({ className }: IconProps) {
	return (
		<svg
			className={className}
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 -1.5 27 27"
			fill="currentColor"
		>
			<path d="m26.745 22.818c.238-.357.38-.796.38-1.268s-.142-.911-.386-1.276l.005.008-10.986-19.101c-.439-.714-1.217-1.183-2.103-1.183-.033 0-.065.001-.097.002h.005c-.903.044-1.692.497-2.19 1.176l-.006.008-3.55 6.252.845.507c2.706 1.536 4.886 3.716 6.379 6.339l.043.083c1.307 2.182 2.16 4.775 2.363 7.549l.003.057h-2.532c-.199-2.394-.93-4.581-2.072-6.493l.038.069c-1.229-2.376-3.079-4.284-5.338-5.549l-.067-.034-.847-.505-3.379 5.746.844.507c2.157 1.303 3.671 3.485 4.051 6.037l.006.046h-5.578c-.134-.019-.25-.081-.339-.17-.044-.043-.072-.103-.072-.17s.027-.127.072-.169l1.524-2.705c-.502-.484-1.131-.839-1.833-1.011l-.028-.006-1.521 2.716c-.238.357-.38.796-.38 1.268s.142.911.386 1.277l-.005-.008c.398.714 1.148 1.189 2.009 1.189.066 0 .131-.003.195-.008l-.008.001h7.775v-1.017c-.032-1.923-.53-3.724-1.386-5.301l.03.061c-.696-1.31-1.667-2.389-2.843-3.19l-.03-.02 1.188-2.194c1.548 1.16 2.842 2.562 3.849 4.162l.038.064c1.066 1.81 1.696 3.987 1.696 6.312 0 .039 0 .077-.001.116v-.006 1.017h6.59v-1.017c0-.038 0-.082 0-.127 0-3.576-1.006-6.917-2.75-9.756l.046.081c-1.459-2.72-3.523-4.944-6.021-6.551l-.069-.042 2.536-4.393c.086-.094.204-.156.337-.169h.002c.17 0 .17 0 .339.17l10.987 19.101c.044.043.072.103.072.17s-.027.127-.072.169c-.089.089-.205.15-.336.169h-.003-2.536v2.034h2.535c.139.036.299.056.463.056.755 0 1.409-.432 1.728-1.062l.005-.011z" />
		</svg>
	);
}

/**
 * PostHog brand icon
 */
export function PostHogIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 50 30" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M10.8914 17.2057c-.3685.7371-1.42031.7371-1.78884 0L8.2212 15.443c-.14077-.2815-.14077-.6129 0-.8944l.88136-1.7627c.36853-.7371 1.42034-.7371 1.78884 0l.8814 1.7627c.1407.2815.1407.6129 0 .8944l-.8814 1.7627zM10.8914 27.2028c-.3685.737-1.42031.737-1.78884 0L8.2212 25.44c-.14077-.2815-.14077-.6129 0-.8944l.88136-1.7627c.36853-.7371 1.42034-.7371 1.78884 0l.8814 1.7627c.1407.2815.1407.6129 0 .8944l-.8814 1.7628z"
				fill="#1D4AFF"
			/>
			<path
				d="M0 23.4082c0-.8909 1.07714-1.3371 1.70711-.7071l4.58338 4.5834c.62997.63.1838 1.7071-.7071 1.7071H.999999c-.552284 0-.999999-.4477-.999999-1v-4.5834zm0-4.8278c0 .2652.105357.5196.292893.7071l9.411217 9.4112c.18753.1875.44189.2929.70709.2929h5.1692c.8909 0 1.3371-1.0771.7071-1.7071L1.70711 12.7041C1.07714 12.0741 0 12.5203 0 13.4112v5.1692zm0-9.99701c0 .26521.105357.51957.292893.7071L19.7011 28.6987c.1875.1875.4419.2929.7071.2929h5.1692c.8909 0 1.3371-1.0771.7071-1.7071L1.70711 2.70711C1.07715 2.07715 0 2.52331 0 3.41421v5.16918zm9.997 0c0 .26521.1054.51957.2929.7071l17.994 17.99401c.63.63 1.7071.1838 1.7071-.7071v-5.1692c0-.2652-.1054-.5196-.2929-.7071l-17.994-17.994c-.63-.62996-1.7071-.18379-1.7071.70711v5.16918zm11.7041-5.87628c-.63-.62997-1.7071-.1838-1.7071.7071v5.16918c0 .26521.1054.51957.2929.7071l7.997 7.99701c.63.63 1.7071.1838 1.7071-.7071v-5.1692c0-.2652-.1054-.5196-.2929-.7071l-7.997-7.99699z"
				fill="#F9BD2B"
			/>
			<path
				d="M42.5248 23.5308l-9.4127-9.4127c-.63-.63-1.7071-.1838-1.7071.7071v13.1664c0 .5523.4477 1 1 1h14.5806c.5523 0 1-.4477 1-1v-1.199c0-.5523-.4496-.9934-.9973-1.0647-1.6807-.2188-3.2528-.9864-4.4635-2.1971zm-6.3213 2.2618c-.8829 0-1.5995-.7166-1.5995-1.5996 0-.8829.7166-1.5995 1.5995-1.5995.883 0 1.5996.7166 1.5996 1.5995 0 .883-.7166 1.5996-1.5996 1.5996z"
				fill="#000"
			/>
			<path
				d="M0 27.9916c0 .5523.447715 1 1 1h4.58339c.8909 0 1.33707-1.0771.70711-1.7071l-4.58339-4.5834C1.07714 22.0711 0 22.5173 0 23.4082v4.5834zM9.997 10.997L1.70711 2.70711C1.07714 2.07714 0 2.52331 0 3.41421v5.16918c0 .26521.105357.51957.292893.7071L9.997 18.9946V10.997zM1.70711 12.7041C1.07714 12.0741 0 12.5203 0 13.4112v5.1692c0 .2652.105357.5196.292893.7071L9.997 28.9916V20.994l-8.28989-8.2899z"
				fill="#1D4AFF"
			/>
			<path
				d="M19.994 11.4112c0-.2652-.1053-.5196-.2929-.7071l-7.997-7.99699c-.6299-.62997-1.70709-.1838-1.70709.7071v5.16918c0 .26521.10539.51957.29289.7071l9.7041 9.70411v-7.5834zM9.99701 28.9916h5.58339c.8909 0 1.3371-1.0771.7071-1.7071L9.99701 20.994v7.9976zM9.99701 10.997v7.5834c0 .2652.10539.5196.29289.7071l9.7041 9.7041v-7.5834c0-.2652-.1053-.5196-.2929-.7071L9.99701 10.997z"
				fill="#F54E00"
			/>
		</svg>
	);
}

/**
 * Stripe brand icon (S mark)
 */
export function StripeIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z"
				fill="#635BFF"
			/>
		</svg>
	);
}

/**
 * Firecrawl brand icon (flame)
 */
export function FirecrawlIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M14.13 1C13.15 4.08 10.06 5.98 9.04 9.85C8.45 8.41 8.07 7.37 7.13 6.25C5.74 9.49 4.99 11.24 5 13.89C5.02 19.06 8.73 23 13.26 23C17.79 23 21 19.33 21 14.16C21 9.95 18.42 4.09 14.13 1Z"
				fill="#FF6000"
			/>
		</svg>
	);
}

/**
 * Neon brand icon (official N logomark)
 */
export function NeonIcon({ className }: IconProps) {
	return (
		<svg
			className={className}
			viewBox="0 0 64 64"
			fill="currentColor"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M63 0.018V63.553L38.418 42.25V63.553H0V0L63 0.018ZM7.723 55.839H30.695V25.324L55.278 47.048V7.729L7.723 7.716V55.839Z" />
		</svg>
	);
}

/**
 * Context7 brand icon (document with 7)
 */
export function Context7Icon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<rect x="3" y="1" width="18" height="22" rx="3" stroke="currentColor" strokeWidth="2" />
			<path
				d="M9 8h6.5L11 17"
				stroke="currentColor"
				strokeWidth="2.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

/**
 * Playwright brand icon (official logo)
 */
export function PlaywrightIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M136.444 221.556C123.558 225.213 115.104 231.625 109.535 238.032C114.869 233.364 122.014 229.08 131.652 226.348C141.51 223.554 149.92 223.574 156.869 224.915V219.481C150.941 218.939 144.145 219.371 136.444 221.556ZM108.946 175.876L61.0895 188.484C61.0895 188.484 61.9617 189.716 63.5767 191.36L104.153 180.668C104.153 180.668 103.578 188.077 98.5847 194.705C108.03 187.559 108.946 175.876 108.946 175.876ZM149.005 288.347C81.6582 306.486 46.0272 228.438 35.2396 187.928C30.2556 169.229 28.0799 155.067 27.5 145.928C27.4377 144.979 27.4665 144.179 27.5336 143.446C24.04 143.657 22.3674 145.473 22.7077 150.721C23.2876 159.855 25.4633 174.016 30.4473 192.721C41.2301 233.225 76.8659 311.273 144.213 293.134C158.872 289.185 169.885 281.992 178.152 272.81C170.532 279.692 160.995 285.112 149.005 288.347ZM161.661 128.11V132.903H188.077C187.535 131.206 186.989 129.677 186.447 128.11H161.661Z"
				fill="#2D4552"
			/>
			<path
				d="M193.981 167.584C205.861 170.958 212.144 179.287 215.465 186.658L228.711 190.42C228.711 190.42 226.904 164.623 203.57 157.995C181.741 151.793 168.308 170.124 166.674 172.496C173.024 167.972 182.297 164.268 193.981 167.584ZM299.422 186.777C277.573 180.547 264.145 198.916 262.535 201.255C268.89 196.736 278.158 193.031 289.837 196.362C301.698 199.741 307.976 208.06 311.307 215.436L324.572 219.212C324.572 219.212 322.736 193.41 299.422 186.777ZM286.262 254.795L176.072 223.99C176.072 223.99 177.265 230.038 181.842 237.869L274.617 263.805C282.255 259.386 286.262 254.795 286.262 254.795ZM209.867 321.102C122.618 297.71 133.166 186.543 147.284 133.865C153.097 112.156 159.073 96.0203 164.029 85.204C161.072 84.5953 158.623 86.1529 156.203 91.0746C150.941 101.747 144.212 119.124 137.7 143.45C123.586 196.127 113.038 307.29 200.283 330.682C241.406 341.699 273.442 324.955 297.323 298.659C274.655 319.19 245.714 330.701 209.867 321.102Z"
				fill="#2D4552"
			/>
			<path
				d="M161.661 262.296V239.863L99.3324 257.537C99.3324 257.537 103.938 230.777 136.444 221.556C146.302 218.762 154.713 218.781 161.661 220.123V128.11H192.869C189.471 117.61 186.184 109.526 183.423 103.909C178.856 94.612 174.174 100.775 163.545 109.665C156.059 115.919 137.139 129.261 108.668 136.933C80.1966 144.61 57.179 142.574 47.5752 140.911C33.9601 138.562 26.8387 135.572 27.5049 145.928C28.0847 155.062 30.2605 169.224 35.2445 187.928C46.0272 228.433 81.663 306.481 149.01 288.342C166.602 283.602 179.019 274.233 187.626 262.291H161.661V262.296ZM61.0848 188.484L108.946 175.876C108.946 175.876 107.551 194.288 89.6087 199.018C71.6614 203.743 61.0848 188.484 61.0848 188.484Z"
				fill="#E2574C"
			/>
			<path
				d="M341.786 129.174C329.345 131.355 299.498 134.072 262.612 124.185C225.716 114.304 201.236 97.0224 191.537 88.8994C177.788 77.3834 171.74 69.3802 165.788 81.4857C160.526 92.163 153.797 109.54 147.284 133.866C133.171 186.543 122.623 297.706 209.867 321.098C297.093 344.47 343.53 242.92 357.644 190.238C364.157 165.917 367.013 147.5 367.799 135.625C368.695 122.173 359.455 126.078 341.786 129.174ZM166.497 172.756C166.497 172.756 180.246 151.372 203.565 158C226.899 164.628 228.706 190.425 228.706 190.425L166.497 172.756ZM223.42 268.713C182.403 256.698 176.077 223.99 176.077 223.99L286.262 254.796C286.262 254.791 264.021 280.578 223.42 268.713ZM262.377 201.495C262.377 201.495 276.107 180.126 299.422 186.773C322.736 193.411 324.572 219.208 324.572 219.208L262.377 201.495Z"
				fill="#2EAD33"
			/>
			<path
				d="M139.88 246.04L99.3324 257.532C99.3324 257.532 103.737 232.44 133.607 222.496L110.647 136.33L108.663 136.933C80.1918 144.611 57.1742 142.574 47.5704 140.911C33.9554 138.563 26.834 135.572 27.5001 145.929C28.08 155.063 30.2557 169.224 35.2397 187.929C46.0225 228.433 81.6583 306.481 149.005 288.342L150.989 287.719L139.88 246.04ZM61.0848 188.485L108.946 175.876C108.946 175.876 107.551 194.288 89.6087 199.018C71.6615 203.743 61.0848 188.485 61.0848 188.485Z"
				fill="#D65348"
			/>
			<path
				d="M225.27 269.163L223.415 268.712C182.398 256.698 176.072 223.99 176.072 223.99L232.89 239.872L262.971 124.281L262.607 124.185C225.711 114.304 201.232 97.0224 191.532 88.8994C177.783 77.3834 171.735 69.3802 165.783 81.4857C160.526 92.163 153.797 109.54 147.284 133.866C133.171 186.543 122.623 297.706 209.867 321.097L211.655 321.5L225.27 269.163ZM166.497 172.756C166.497 172.756 180.246 151.372 203.565 158C226.899 164.628 228.706 190.425 228.706 190.425L166.497 172.756Z"
				fill="#1D8D22"
			/>
			<path
				d="M141.946 245.451L131.072 248.537C133.641 263.019 138.169 276.917 145.276 289.195C146.513 288.922 147.74 288.687 149 288.342C152.302 287.451 155.364 286.348 158.312 285.145C150.371 273.361 145.118 259.789 141.946 245.451ZM137.7 143.451C132.112 164.307 127.113 194.326 128.489 224.436C130.952 223.367 133.554 222.371 136.444 221.551L138.457 221.101C136.003 188.939 141.308 156.165 147.284 133.866C148.799 128.225 150.318 122.978 151.832 118.085C149.393 119.637 146.767 121.228 143.776 122.867C141.759 129.093 139.722 135.898 137.7 143.451Z"
				fill="#C04B41"
			/>
		</svg>
	);
}

/**
 * Zapier brand icon (Z lightning bolt)
 */
export function ZapierIcon({ className }: IconProps) {
	return (
		<svg
			className={className}
			viewBox="0 0 24 24"
			fill="currentColor"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M15.535 8.465h3.293l-7.39 7.39v-3.683l-.001-.003a4.413 4.413 0 0 1-.508.03c-.174 0-.345-.011-.514-.03v3.686l-7.39-7.39h3.683c-.019-.169-.03-.34-.03-.514 0-.175.011-.346.03-.515H2.925l7.39-7.39v3.683c.169-.019.34-.03.514-.03.175 0 .346.011.515.03V.465l7.39 7.39h-3.683c.019.169.03.34.03.515 0 .174-.011.345-.03.514l-.516-.419zm-1.47 0a4.413 4.413 0 0 1-.858 1.742l2.469 2.469h-2.469l-.858-1.742a4.425 4.425 0 0 1-1.742.858l-2.469-2.469v2.469l1.742.858a4.425 4.425 0 0 1-.858 1.742H6.07l2.469-2.469-1.742-.858a4.413 4.413 0 0 1 .858-1.742l-2.469-2.469h2.469l.858 1.742a4.425 4.425 0 0 1 1.742-.858l2.469 2.469v-2.469l-1.742-.858a4.425 4.425 0 0 1 .858-1.742H14.065z" />
		</svg>
	);
}

/**
 * Supabase brand icon
 */
export function SupabaseIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 109 113" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M63.708 110.284c-2.86 3.601-8.658 1.628-8.727-2.97l-1.007-67.251h45.22c8.19 0 12.758 9.46 7.665 15.874L63.708 110.284z"
				fill="currentColor"
				opacity="0.5"
			/>
			<path
				d="M45.317 2.071c2.86-3.601 8.657-1.628 8.726 2.97l.442 67.251H9.83c-8.19 0-12.759-9.46-7.665-15.875L45.317 2.072z"
				fill="currentColor"
			/>
		</svg>
	);
}

/**
 * Asana brand icon (three dots)
 */
export function AsanaIcon({ className }: IconProps) {
	return (
		<svg
			className={className}
			viewBox="0 0 24 24"
			fill="currentColor"
			xmlns="http://www.w3.org/2000/svg"
		>
			<circle cx="12" cy="5.5" r="4.5" />
			<circle cx="4.5" cy="16.5" r="4.5" />
			<circle cx="19.5" cy="16.5" r="4.5" />
		</svg>
	);
}

/**
 * Semgrep brand icon (shield with code brackets)
 */
export function SemgrepIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M12 2L3 7v6c0 5.25 3.83 10.16 9 11.34C17.17 23.16 21 18.25 21 13V7l-9-5z"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinejoin="round"
			/>
			<path
				d="M9 10L6.5 12.5 9 15"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M15 10l2.5 2.5L15 15"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

/**
 * DeepWiki brand icon (book with magnifying glass)
 */
export function DeepWikiIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
			<path
				d="M14.2 12.2L16.5 14.5"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
		</svg>
	);
}

/**
 * Apify brand icon (hexagon with A)
 */
export function ApifyIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M12 2l8.66 5v10L12 22l-8.66-5V7L12 2z"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinejoin="round"
			/>
			<path
				d="M12 7l-3.5 10h2l.8-2.5h3.4l.8 2.5h2L12 7zm0 3.5l1.2 3h-2.4l1.2-3z"
				fill="currentColor"
			/>
		</svg>
	);
}

/**
 * Linear brand icon
 */
export function LinearIcon({ className }: IconProps) {
	return (
		<svg
			className={className}
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="currentColor"
		>
			<path d="M3.03509 12.9431C3.24245 14.9227 4.10472 16.8468 5.62188 18.364C7.13904 19.8811 9.0631 20.7434 11.0428 20.9508L3.03509 12.9431Z" />
			<path d="M3 11.4938L12.4921 20.9858C13.2976 20.9407 14.0981 20.7879 14.8704 20.5273L3.4585 9.11548C3.19793 9.88771 3.0451 10.6883 3 11.4938Z" />
			<path d="M3.86722 8.10999L15.8758 20.1186C16.4988 19.8201 17.0946 19.4458 17.6493 18.9956L4.99021 6.33659C4.54006 6.89125 4.16573 7.487 3.86722 8.10999Z" />
			<path d="M5.66301 5.59517C9.18091 2.12137 14.8488 2.135 18.3498 5.63604C21.8508 9.13708 21.8645 14.8049 18.3907 18.3228L5.66301 5.59517Z" />
		</svg>
	);
}

/**
 * OpenCode logo - terminal-style icon
 */
export function OpenCodeIcon({ className }: IconProps) {
	return (
		<svg
			className={cn("h-4 w-4", className)}
			viewBox="0 0 240 300"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<g clipPath="url(#clip0_opencode)">
				<mask
					id="mask0_opencode"
					style={{ maskType: "luminance" }}
					maskUnits="userSpaceOnUse"
					x="0"
					y="0"
					width="240"
					height="300"
				>
					<path d="M240 0H0V300H240V0Z" fill="white" />
				</mask>
				<g mask="url(#mask0_opencode)">
					<path d="M180 240H60V120H180V240Z" fill="currentColor" opacity="0.5" />
					<path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" fill="currentColor" />
				</g>
			</g>
			<defs>
				<clipPath id="clip0_opencode">
					<rect width="240" height="300" fill="white" />
				</clipPath>
			</defs>
		</svg>
	);
}

/**
 * Claude/Anthropic logo
 */
export function ClaudeIcon({ className }: IconProps) {
	return (
		<svg
			className={cn("h-4 w-4", className)}
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
				fill="#D97757"
				fillRule="nonzero"
			/>
		</svg>
	);
}

/**
 * OpenAI logo
 */
export function OpenAIIcon({ className }: IconProps) {
	return (
		<svg
			className={cn("h-4 w-4", className)}
			viewBox="0 0 24 24"
			fill="currentColor"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
		</svg>
	);
}

/**
 * Google Gemini logo
 */
export function GeminiIcon({ className }: IconProps) {
	return (
		<svg
			className={cn("h-4 w-4", className)}
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M12 24C12 18.2 12 15.3 12 12C12 8.7 12 5.8 12 0C14.4 3.5 17 6.2 21 8.1C24 9.5 24 9.5 24 12C24 14.5 24 14.5 21 15.9C17 17.8 14.4 20.5 12 24Z"
				fill="#4285F4"
			/>
			<path
				d="M12 24C12 18.2 12 15.3 12 12C12 8.7 12 5.8 12 0C9.6 3.5 7 6.2 3 8.1C0 9.5 0 9.5 0 12C0 14.5 0 14.5 3 15.9C7 17.8 9.6 20.5 12 24Z"
				fill="#4285F4"
			/>
		</svg>
	);
}

/**
 * DeepSeek brand icon
 */
export function DeepSeekIcon({ className }: IconProps) {
	return (
		<svg
			className={cn("h-4 w-4", className)}
			viewBox="0 0 24 24"
			fill="currentColor"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.5 14.5c-2.49 0-4.5-2.01-4.5-4.5s2.01-4.5 4.5-4.5c1.23 0 2.34.5 3.15 1.3l-1.27 1.27A2.976 2.976 0 0010.5 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c1.3 0 2.4-.83 2.82-2h-2.82v-1.75h4.74c.06.3.09.62.09.95 0 2.79-2.01 4.8-4.83 4.8v-.5zm7.5-4.25h-1.75V10.5H18v1.75zm0 3.5h-1.75V14H18v1.75z" />
		</svg>
	);
}

/**
 * xAI brand icon
 */
export function XAIIcon({ className }: IconProps) {
	return (
		<svg
			className={cn("h-4 w-4", className)}
			viewBox="0 0 24 24"
			fill="currentColor"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M2 4l8.5 8L2 20h2.5l7-6.5L18.5 20H21l-8.5-8L21 4h-2.5l-7 6.5L4.5 4H2z" />
		</svg>
	);
}

/**
 * Mistral brand icon
 */
export function MistralIcon({ className }: IconProps) {
	return (
		<svg
			className={cn("h-4 w-4", className)}
			viewBox="0 0 24 24"
			fill="currentColor"
			xmlns="http://www.w3.org/2000/svg"
		>
			<rect x="1" y="3" width="4" height="4" />
			<rect x="19" y="3" width="4" height="4" />
			<rect x="1" y="10" width="4" height="4" />
			<rect x="7" y="10" width="4" height="4" />
			<rect x="13" y="10" width="4" height="4" />
			<rect x="19" y="10" width="4" height="4" />
			<rect x="1" y="17" width="4" height="4" />
			<rect x="19" y="17" width="4" height="4" />
			<rect x="7" y="3" width="10" height="4" fill="currentColor" opacity="0.5" />
			<rect x="7" y="17" width="10" height="4" fill="currentColor" opacity="0.5" />
		</svg>
	);
}

// ============================================================================
// Generic UI Icons
// ============================================================================

/**
 * Pause circle icon (for paused sessions)
 */
export function PauseCircleIcon({ className }: IconProps) {
	return (
		<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
			/>
		</svg>
	);
}

export function BoltIcon({ className }: IconProps) {
	return (
		<svg
			className={className}
			xmlns="http://www.w3.org/2000/svg"
			width="200"
			height="200"
			viewBox="0 0 16 16"
			fill="none"
		>
			<path
				fill="currentColor"
				d="M11.251.068a.5.5 0 0 1 .227.58L9.677 6.5H13a.5.5 0 0 1 .364.843l-8 8.5a.5.5 0 0 1-.842-.49L6.323 9.5H3a.5.5 0 0 1-.364-.843l8-8.5a.5.5 0 0 1 .615-.09zM4.157 8.5H7a.5.5 0 0 1 .478.647L6.11 13.59l5.732-6.09H9a.5.5 0 0 1-.478-.647L9.89 2.41L4.157 8.5z"
			/>
		</svg>
	);
}

/**
 * Monitor/Desktop icon (for preview panel)
 */
export function MonitorIcon({ className }: IconProps) {
	return (
		<svg
			className={className}
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			aria-hidden="true"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
			/>
		</svg>
	);
}

export function GithubIcon({ className }: IconProps) {
	return (
		<svg
			className={className}
			width="128"
			height="128"
			viewBox="0 0 128 128"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M56.7937 84.9688C44.4187 83.4688 35.7 74.5625 35.7 63.0313C35.7 58.3438 37.3875 53.2813 40.2 49.9063C38.9812 46.8125 39.1687 40.25 40.575 37.5313C44.325 37.0625 49.3875 39.0313 52.3875 41.75C55.95 40.625 59.7 40.0625 64.2937 40.0625C68.8875 40.0625 72.6375 40.625 76.0125 41.6563C78.9187 39.0313 84.075 37.0625 87.825 37.5313C89.1375 40.0625 89.325 46.625 88.1062 49.8125C91.1062 53.375 92.7 58.1563 92.7 63.0313C92.7 74.5625 83.9812 83.2813 71.4187 84.875C74.6062 86.9375 76.7625 91.4375 76.7625 96.5938L76.7625 106.344C76.7625 109.156 79.1062 110.75 81.9187 109.625C98.8875 103.156 112.2 86.1875 112.2 65.1875C112.2 38.6563 90.6375 17 64.1062 17C37.575 17 16.2 38.6562 16.2 65.1875C16.2 86 29.4187 103.25 47.2312 109.719C49.7625 110.656 52.2 108.969 52.2 106.438L52.2 98.9375C50.8875 99.5 49.2 99.875 47.7 99.875C41.5125 99.875 37.8562 96.5 35.2312 90.2188C34.2 87.6875 33.075 86.1875 30.9187 85.9063C29.7937 85.8125 29.4187 85.3438 29.4187 84.7813C29.4187 83.6563 31.2937 82.8125 33.1687 82.8125C35.8875 82.8125 38.2312 84.5 40.6687 87.9688C42.5437 90.6875 44.5125 91.9063 46.8562 91.9063C49.2 91.9063 50.7 91.0625 52.8562 88.9063C54.45 87.3125 55.6687 85.9063 56.7937 84.9688Z"
				fill="currentColor"
			/>
		</svg>
	);
}

/**
 * Folder minus icon (folder with minus sign)
 */
export function FolderMinusIcon({ className }: IconProps) {
	return (
		<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={1.5}
				d="M15 13.5H9m4.06-7.19l-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
			/>
		</svg>
	);
}

/**
 * Folder plus icon (folder with plus sign)
 */
export function FolderPlusIcon({ className }: IconProps) {
	return (
		<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={1.5}
				d="M12 10.5v6m3-3H9m4.06-7.19l-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
			/>
		</svg>
	);
}

/**
 * Sidebar expand icon (panel on right - sidebar is collapsed)
 */
export function SidebarExpandIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 16 16" fill="currentColor">
			<path d="M16 3a2 2 0 0 0-2-2H2a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3zm-5-1v12H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h9zm1 0h2a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-2V2z" />
		</svg>
	);
}

/**
 * Sidebar collapse icon (panel on left - sidebar is expanded)
 */
export function SidebarCollapseIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 16 16" fill="currentColor">
			<path d="M0 3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3zm5-1v12h9a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H5zM4 2H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h2V2z" />
		</svg>
	);
}

export function AutomationsIcon({ className }: IconProps) {
	return (
		<svg
			className={className}
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 20 20"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M7.29183 5.625V9.16667C6.3118 10.3917 4.74726 11.7612 4.1643 13.3928M7.29183 5.625H12.7085M7.29183 5.625H6.4585M4.1643 13.3928C4.03384 13.758 3.9585 14.1318 3.9585 14.5135C3.9585 16.278 5.38885 17.7083 7.1533 17.7083H12.847C14.6115 17.7083 16.0418 16.278 16.0418 14.5135C16.0418 14.1318 15.9665 13.758 15.836 13.3928M4.1643 13.3928C4.1643 13.3928 6.39669 12.9228 7.84242 12.9613C9.5605 13.0072 10.4398 13.7786 12.1579 13.8244C13.6037 13.863 15.836 13.3928 15.836 13.3928M12.7085 5.625V9.16667C13.6885 10.3917 15.2531 11.7612 15.836 13.3928M12.7085 5.625H13.5418" />
			<path d="M8.54167 3.33334C8.54167 3.44839 8.44842 3.54167 8.33334 3.54167M8.54167 3.33334C8.54167 3.21828 8.44842 3.125 8.33334 3.125M8.54167 3.33334H8.33334M8.33334 3.54167C8.21828 3.54167 8.125 3.44839 8.125 3.33334M8.33334 3.54167V3.33334M8.33334 3.125C8.21828 3.125 8.125 3.21828 8.125 3.33334M8.33334 3.125V3.33334M8.33334 3.33334H8.125M8.33334 3.33334L8.18602 3.48065M8.33334 3.33334L8.48067 3.18602M8.33334 3.33334L8.18602 3.18602M8.33334 3.33334L8.48067 3.48065M8.18602 3.48065C8.26738 3.56201 8.39925 3.56201 8.48067 3.48065M8.18602 3.48065C8.10466 3.39929 8.10466 3.26738 8.18602 3.18602M8.48067 3.18602C8.562 3.26738 8.562 3.39929 8.48067 3.48065M8.48067 3.18602C8.39925 3.10466 8.26738 3.10466 8.18602 3.18602" />
			<path d="M11.875 2.08334C11.875 2.42852 11.5952 2.70834 11.25 2.70834C10.9048 2.70834 10.625 2.42852 10.625 2.08334C10.625 1.73817 10.9048 1.45834 11.25 1.45834C11.5952 1.45834 11.875 1.73817 11.875 2.08334Z" />
		</svg>
	);
}

export function RunsIcon({ className }: IconProps) {
	return (
		<svg
			className={className}
			viewBox="0 0 20 20"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			color="currentColor"
		>
			<path
				d="M16.8792 14.2083V8.625C16.8792 8.15829 16.8792 7.92493 16.7883 7.74667C16.7084 7.58987 16.581 7.46239 16.4242 7.38249C16.2459 7.29167 16.0126 7.29167 15.5458 7.29167H4.45833C3.99162 7.29167 3.75827 7.29167 3.58001 7.38249C3.42321 7.46239 3.29572 7.58987 3.21582 7.74667C3.125 7.92493 3.125 8.15829 3.125 8.625V14.2083C3.125 15.1417 3.125 15.6085 3.30666 15.965C3.46644 16.2786 3.72141 16.5336 4.03502 16.6933C4.39153 16.875 4.85824 16.875 5.79167 16.875H14.2125C15.1459 16.875 15.6127 16.875 15.9692 16.6933C16.2827 16.5336 16.5378 16.2786 16.6975 15.965C16.8792 15.6085 16.8792 15.1417 16.8792 14.2083Z"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M4.7915 6.66667V3.125C4.7915 2.66477 5.1646 2.29167 5.62484 2.29167H8.05948C8.5015 2.29167 8.92542 2.46726 9.238 2.77983L10.1724 3.71426C10.3287 3.87053 10.5407 3.95833 10.7617 3.95833H14.3748C14.8351 3.95833 15.2082 4.33143 15.2082 4.79167V6.66667"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M6.4585 10.625H9.79183"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

// ============================================================================
// Automation Template Icons
// ============================================================================

/**
 * Sentry Auto-Fixer: Bug with a wrench overlay
 */
export function TemplateIconSentryFixer({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
			{/* Bug body */}
			<ellipse cx="14" cy="17" rx="6" ry="7" stroke="currentColor" strokeWidth="1.8" />
			<line x1="14" y1="10" x2="14" y2="24" stroke="currentColor" strokeWidth="1.5" />
			<line x1="8" y1="16" x2="20" y2="16" stroke="currentColor" strokeWidth="1.5" />
			{/* Bug legs */}
			<path d="M8.5 13.5L5.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			<path d="M8 17.5L4.5 17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			<path d="M8.5 21L5.5 23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			<path d="M19.5 13.5L22.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			{/* Bug antennae */}
			<path d="M11 11L9 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			<path d="M17 11L19 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			{/* Wrench */}
			<path d="M24 20L28 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
			<circle cx="23" cy="19" r="2.5" stroke="currentColor" strokeWidth="1.5" />
		</svg>
	);
}

/**
 * Linear PR Drafter: Ticket shape flowing into a git merge/branch
 */
export function TemplateIconLinearPr({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
			{/* Ticket / card */}
			<rect x="3" y="7" width="13" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
			<line
				x1="6.5"
				y1="11.5"
				x2="12.5"
				y2="11.5"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
			<line
				x1="6.5"
				y1="14.5"
				x2="10.5"
				y2="14.5"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
			<line
				x1="6.5"
				y1="17.5"
				x2="11.5"
				y2="17.5"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
			{/* Arrow flowing right */}
			<path d="M16 16H22" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
			<path
				d="M20 13.5L22.5 16L20 18.5"
				stroke="currentColor"
				strokeWidth="1.8"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			{/* Git branch symbol */}
			<circle cx="27" cy="11" r="2" stroke="currentColor" strokeWidth="1.5" />
			<circle cx="27" cy="21" r="2" stroke="currentColor" strokeWidth="1.5" />
			<path d="M27 13V19" stroke="currentColor" strokeWidth="1.5" />
		</svg>
	);
}

/**
 * GitHub Issue Solver: Issue circle with an inner check
 */
export function TemplateIconGithubSolver({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
			{/* Outer issue circle */}
			<circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="1.8" />
			{/* Inner dot (GitHub issue icon style) morphing into a check */}
			<path
				d="M11.5 16.5L14.5 19.5L21 13"
				stroke="currentColor"
				strokeWidth="2.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			{/* Small spark lines radiating — solution found */}
			<path d="M16 2.5V4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			<path d="M16 27.5V29.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			<path d="M2.5 16H4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			<path d="M27.5 16H29.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	);
}

/**
 * CI Failure Fixer: Pipeline with a lightning bolt repair
 */
export function TemplateIconCiFixer({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
			{/* Pipeline stages */}
			<rect x="2" y="11" width="7" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
			<rect x="23" y="11" width="7" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
			{/* Connecting lines */}
			<path d="M9 16H12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
			<path d="M20 16H23" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
			{/* Lightning bolt in center — the fix */}
			<path
				d="M17.5 9L14 17H18L14.5 25"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			{/* Check in the last stage */}
			<path
				d="M25 15.5L26.5 17L28 14.5"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function ChatBubbleIcon({ className }: IconProps) {
	return (
		<svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M17.9167 10C17.9167 5.83334 14.838 3.33334 10 3.33334C5.16208 3.33334 2.08337 5.83334 2.08337 10C2.08337 11.0786 2.82855 12.908 2.94717 13.1924C2.95802 13.2184 2.96875 13.2421 2.97845 13.2685C3.05967 13.49 3.38597 14.6519 2.08337 16.3699C3.84263 17.2033 5.71096 15.8333 5.71096 15.8333C7.00358 16.5129 8.54162 16.6667 10 16.6667C14.838 16.6667 17.9167 14.1667 17.9167 10Z"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="square"
				strokeLinejoin="round"
			/>
			<path d="M10.0331 8V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			<path d="M7 9V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			<path d="M13.0331 9V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	);
}
