import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";

import {
	loadAuthorizationServerJwks,
	verifyMcpAccessToken,
} from "../src/server/mcp/verify";

async function signedAccessToken(audience: string, issuer: string) {
	const { privateKey, publicKey } = await generateKeyPair("EdDSA");
	const jwk = await exportJWK(publicKey);
	const token = await new SignJWT({
		sub: "user-1",
		scope: "openid",
	})
		.setProtectedHeader({ alg: "EdDSA", kid: "test-key", typ: "JWT" })
		.setIssuer(issuer)
		.setAudience(audience)
		.setIssuedAt()
		.setExpirationTime("5m")
		.sign(privateKey);

	return {
		token,
		jwks: { keys: [{ ...jwk, kid: "test-key", alg: "EdDSA" }] },
	};
}

describe("mcp access token verification", () => {
	it("loads JWKS from the in-process auth handler", async () => {
		const handler = vi.fn(async () => Response.json({ keys: [{ kid: "k1" }] }));

		const jwks = await loadAuthorizationServerJwks(
			{ handler, $context: Promise.resolve({ internalAdapter: {} }) },
			"http://localhost/api/auth",
		);

		expect(jwks.keys).toEqual([{ kid: "k1" }]);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(new URL(handler.mock.calls[0][0].url).href).toBe(
			"http://localhost/api/auth/jwks",
		);
	});

	it("rejects a JWKS response that is not a key set", async () => {
		await expect(
			loadAuthorizationServerJwks(
				{
					handler: async () => Response.json({ error: "nope" }),
					$context: Promise.resolve({ internalAdapter: {} }),
				},
				"http://localhost/api/auth",
			),
		).rejects.toThrow(/JSON Web Key Set/i);
	});

	it("accepts a JWT verified against in-process JWKS", async () => {
		const issuer = "http://localhost/api/auth";
		const audience = "http://localhost/mcp";
		const { token, jwks } = await signedAccessToken(audience, issuer);
		const handler = vi.fn(async () => Response.json(jwks));

		const payload = await verifyMcpAccessToken(
			new Request(audience, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
			}),
			{
				auth: {
					handler,
					$context: Promise.resolve({ internalAdapter: {} }),
				},
				issuer,
				audience,
			},
		);

		expect(payload.sub).toBe("user-1");
		expect(handler).toHaveBeenCalledTimes(1);
	});
});
