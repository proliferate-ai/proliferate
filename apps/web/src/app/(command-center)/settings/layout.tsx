"use client";

import { usePathname } from "next/navigation";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();

	return (
		<div key={pathname} className="flex-1 min-h-0 animate-in fade-in duration-200">
			{children}
		</div>
	);
}
