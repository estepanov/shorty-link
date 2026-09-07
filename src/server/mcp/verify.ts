import {
	createDpopReplayStore,
	enforceDpopBinding,
	isDpopBindingError,
	parseAccessTokenAuthorization,
	requestToResourceInput,
	verifyJwsAccessToken,
} from "better-auth/oauth2";
import type { JSONWebKeySet, JWTPayload } from "jose";

type DpopReservations = Parameters<typeof createDpopReplayStore>[0];

export type McpJwksAuth = {
	handler: (request: Request) => Promise<Response>;
	$context: Promise<{ internalAdapter: DpopReservations }>;
};

export async function loadAuthorizationServerJwks(
	auth: Pick<McpJwksAuth, "handler">,
	issuer: string,
): Promise<JSONWebKeySet> {
	const response = await auth.handler(new Request(`${issuer}/jwks`));
	if (!response.ok) {
		throw new TypeError(`JWKS unavailable: ${response.status}`);
	}

	const body: unknown = await response.json();
	if (
		!body ||
		typeof body !== "object" ||
		!Array.isArray((body as JSONWebKeySet).keys)
	) {
		throw new TypeError("JWKS response is not a JSON Web Key Set");
	}

	return body as JSONWebKeySet;
}

export async function verifyMcpAccessToken(
	request: Request,
	options: {
		auth: McpJwksAuth;
		issuer: string;
		audience: string;
	},
): Promise<JWTPayload> {
	const input = requestToResourceInput(request);
	const authorization = parseAccessTokenAuthorization(
		input.authorizationHeader,
	);
	if (!authorization?.token) {
		throw new TypeError("missing authorization header");
	}
	if (authorization.scheme === "Unknown") {
		throw new TypeError("authorization scheme must be Bearer or DPoP");
	}

	const jwks = await loadAuthorizationServerJwks(options.auth, options.issuer);
	const payload = await verifyJwsAccessToken(authorization.token, {
		jwksFetch: async () => jwks,
		verifyOptions: {
			audience: options.audience,
			issuer: options.issuer,
		},
	});

	const { internalAdapter } = await options.auth.$context;
	try {
		await enforceDpopBinding({
			authorization,
			method: input.method,
			payload,
			proofJwt: input.dpopProofJwt,
			replayStore: createDpopReplayStore(internalAdapter),
			url: input.url,
		});
	} catch (error) {
		if (isDpopBindingError(error)) {
			throw new TypeError(error.message);
		}
		throw error;
	}

	return payload;
}
