export const PAGE_TITLES: Record<string, string> = {
	"/": "Home",
	"/dashboard": "Home",
	"/sessions": "Sessions",
	"/coworkers": "Coworkers",
	"/integrations": "Integrations",
	"/settings": "Settings",
	"/settings/profile": "Profile",
	"/settings/general": "General",
	"/settings/members": "Members",
	"/settings/secrets": "Secrets",
	"/settings/billing": "Billing",
	"/settings/connections": "Connections",
	"/settings/repositories": "Repositories",
	"/settings/tools": "Tools",
};

export function getPageTitle(pathname: string): string {
	if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
	for (const [path, title] of Object.entries(PAGE_TITLES)) {
		if (pathname.startsWith(`${path}/`)) return title;
	}
	return "";
}
