"use client";

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState(false);

	useEffect(() => {
		const mediaQuery = window.matchMedia(query);

		// Set initial value
		setMatches(mediaQuery.matches);

		// Listen for changes
		const handler = (event: MediaQueryListEvent) => {
			setMatches(event.matches);
		};

		mediaQuery.addEventListener("change", handler);
		return () => mediaQuery.removeEventListener("change", handler);
	}, [query]);

	return matches;
}
