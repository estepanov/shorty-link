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

export function isMcpAuthorizationServerMetadataPath(pathname: string) {
	return (
		pathname === "/.well-known/oauth-authorization-server" ||
		pathname === "/.well-known/oauth-authorization-server/api/auth" ||
		pathname === "/api/auth/.well-known/oauth-authorization-server"
	);
}

export function isMcpOpenIdConfigurationPath(pathname: string) {
	return (
		pathname === "/.well-known/openid-configuration" ||
		pathname === "/.well-known/openid-configuration/api/auth" ||
		pathname === "/api/auth/.well-known/openid-configuration"
	);
}

export function isMcpProtectedResourceMetadataPath(pathname: string) {
	return (
		pathname === "/.well-known/oauth-protected-resource" ||
		pathname.startsWith("/.well-known/oauth-protected-resource/") ||
		pathname === "/api/auth/.well-known/oauth-protected-resource"
	);
}

export function isMcpWellKnownPath(pathname: string) {
	return (
		isMcpAuthorizationServerMetadataPath(pathname) ||
		isMcpOpenIdConfigurationPath(pathname) ||
		isMcpProtectedResourceMetadataPath(pathname)
	);
}

export function isMcpHandledPath(pathname: string) {
	return (
		isMcpJsonRpcPath(pathname) ||
		isMcpWellKnownPath(pathname) ||
		isMcpAuthCorsPath(pathname)
	);
}
