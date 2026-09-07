export function isMcpJsonRpcPath(pathname: string) {
	return pathname === "/mcp" || pathname === "/mcp/";
}

export function isMcpOAuthHookPath(pathname: string) {
	return pathname === "/oauth2" || pathname.startsWith("/oauth2/");
}

export function isMcpAuthCorsPath(pathname: string) {
	return (
		pathname.startsWith("/api/auth/oauth2/") ||
		pathname.startsWith("/api/auth/.well-known/")
	);
}

export function isMcpWellKnownPath(pathname: string) {
	return (
		pathname === "/.well-known/oauth-authorization-server" ||
		pathname === "/.well-known/oauth-protected-resource" ||
		pathname.startsWith("/.well-known/oauth-protected-resource/") ||
		pathname === "/api/auth/.well-known/oauth-authorization-server" ||
		pathname === "/api/auth/.well-known/oauth-protected-resource"
	);
}

export function isMcpHandledPath(pathname: string) {
	return (
		isMcpJsonRpcPath(pathname) ||
		isMcpWellKnownPath(pathname) ||
		isMcpAuthCorsPath(pathname)
	);
}
