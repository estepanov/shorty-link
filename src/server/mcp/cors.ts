export const MCP_CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers":
		"Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id",
	"Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Session-Id",
	"Access-Control-Max-Age": "86400",
} as const;

export function withMcpCors(response: Response) {
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(MCP_CORS_HEADERS)) {
		headers.set(key, value);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export function mcpOptionsResponse() {
	return new Response(null, {
		status: 204,
		headers: MCP_CORS_HEADERS,
	});
}

export function mcpResourceMetadataUrl(origin: string) {
	return `${origin}/.well-known/oauth-protected-resource`;
}

export function mcpWwwAuthenticate(origin: string) {
	return `Bearer resource_metadata="${mcpResourceMetadataUrl(origin)}"`;
}
