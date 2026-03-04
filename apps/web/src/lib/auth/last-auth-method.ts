export function setLastAuthMethod(method: "google" | "email") {
	try {
		localStorage.setItem("proliferate:last-auth-method", method);
	} catch {
		// localStorage may be unavailable in private browsing
	}
}
