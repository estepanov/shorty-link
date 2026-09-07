export const MCP_OAUTH_HOOK_PATHS = [
	"/oauth2/authorize",
	"/oauth2/consent",
	"/oauth2/introspect",
	"/oauth2/register",
	"/oauth2/revoke",
	"/oauth2/token",
	"/oauth2/userinfo",
] as const;

export function isMcpJsonRpcPath(pathname: string) {
	return pathname === "/mcp" || pathname === "/mcp/";
}

export function isMcpOAuthHookPath(pathname: string) {
	return (MCP_OAUTH_HOOK_PATHS as readonly string[]).includes(pathname);
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
