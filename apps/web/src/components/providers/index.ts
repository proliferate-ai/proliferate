/**
 * Provider components for app-wide context.
 * These are composed together in app/providers.tsx.
 */

export { IntercomProvider, openIntercomMessenger } from "./intercom";
export {
	PostHogProvider,
	PostHogPageView,
	PostHogUserIdentity,
} from "./posthog";
export { ThemeProvider } from "./theme-provider";
