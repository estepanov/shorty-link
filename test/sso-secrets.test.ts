import { describe, expect, it } from "vitest";

import {
	decryptSsoConfigJson,
	encryptSsoConfigJson,
	redactSsoConfigJson,
	SSO_SECRET_PREFIX,
	ssoConfigHasSecret,
} from "../src/server/auth/sso-secrets";

const SECRET = "test-better-auth-secret-for-sso";

describe("sso secret encryption", () => {
	it("round-trips OIDC client secrets", async () => {
		const json = JSON.stringify({
			clientId: "public-id",
			clientSecret: "super-secret",
			scopes: ["openid", "email"],
		});

		const encrypted = await encryptSsoConfigJson(json, SECRET);
		const parsed = JSON.parse(encrypted) as {
			clientId: string;
			clientSecret: string;
		};

		expect(parsed.clientId).toBe("public-id");
		expect(parsed.clientSecret.startsWith(SSO_SECRET_PREFIX)).toBe(true);
		expect(parsed.clientSecret).not.toContain("super-secret");

		const decrypted = JSON.parse(
			await decryptSsoConfigJson(encrypted, SECRET),
		) as {
			clientSecret: string;
		};
		expect(decrypted.clientSecret).toBe("super-secret");
	});

	it("encrypts nested SAML private keys and passwords", async () => {
		const json = JSON.stringify({
			entryPoint: "https://idp.example.com/sso",
			idpMetadata: {
				metadata: "<EntityDescriptor />",
				privateKey:
					"-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
				privateKeyPass: "idp-pass",
				encPrivateKey:
					"-----BEGIN RSA PRIVATE KEY-----\ndef\n-----END RSA PRIVATE KEY-----",
				encPrivateKeyPass: "enc-pass",
			},
			spMetadata: {
				privateKey: "sp-key",
			},
		});

		const encrypted = JSON.parse(await encryptSsoConfigJson(json, SECRET)) as {
			entryPoint: string;
			idpMetadata: Record<string, string>;
			spMetadata: Record<string, string>;
		};

		expect(encrypted.entryPoint).toBe("https://idp.example.com/sso");
		expect(encrypted.idpMetadata.metadata).toBe("<EntityDescriptor />");
		expect(encrypted.idpMetadata.privateKey.startsWith(SSO_SECRET_PREFIX)).toBe(
			true,
		);
		expect(
			encrypted.idpMetadata.privateKeyPass.startsWith(SSO_SECRET_PREFIX),
		).toBe(true);
		expect(encrypted.spMetadata.privateKey.startsWith(SSO_SECRET_PREFIX)).toBe(
			true,
		);

		const decrypted = JSON.parse(
			await decryptSsoConfigJson(JSON.stringify(encrypted), SECRET),
		);
		expect(decrypted.idpMetadata.privateKey).toContain("BEGIN RSA PRIVATE KEY");
		expect(decrypted.idpMetadata.privateKeyPass).toBe("idp-pass");
		expect(decrypted.spMetadata.privateKey).toBe("sp-key");
	});

	it("does not double-encrypt already encrypted values", async () => {
		const json = JSON.stringify({ clientSecret: "once" });
		const first = await encryptSsoConfigJson(json, SECRET);
		const second = await encryptSsoConfigJson(first, SECRET);
		expect(second).toBe(first);
		expect(
			JSON.parse(await decryptSsoConfigJson(second, SECRET)).clientSecret,
		).toBe("once");
	});

	it("reports whether a config blob contains a secret key", () => {
		expect(
			ssoConfigHasSecret(JSON.stringify({ clientId: "public", issuer: "x" })),
		).toBe(false);
		expect(ssoConfigHasSecret(JSON.stringify({ clientSecret: "hidden" }))).toBe(
			true,
		);
		expect(ssoConfigHasSecret(null)).toBe(false);
	});

	it("redacts secret keys without dropping public fields", () => {
		expect(
			redactSsoConfigJson(
				JSON.stringify({
					clientId: "public-id",
					clientSecret: "super-secret",
				}),
			),
		).toEqual({
			clientId: "public-id",
			clientSecret: "********",
		});
	});

	it("fails closed with the wrong secret", async () => {
		const encrypted = await encryptSsoConfigJson(
			JSON.stringify({ clientSecret: "once" }),
			SECRET,
		);
		await expect(
			decryptSsoConfigJson(encrypted, "wrong-secret"),
		).rejects.toThrow(/errors\.ssoSecretDecryptFailed/);
	});
});
