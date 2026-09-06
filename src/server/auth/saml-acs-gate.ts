import { and, eq } from "drizzle-orm";

import type { AppDb } from "../db/client";
import { ssoProvider, ssoProviderSettings } from "../db/schema";

const SAML_ACS_PATH_PREFIX = "/api/auth/sso/saml2/sp/acs/";
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const MAX_SAML_ACS_BODY_BYTES = 1024 * 1024;
export const MAX_SAML_RESPONSE_BASE64_BYTES = 256 * 1024;

export type SamlAcsGateResult =
	| { allowed: true }
	| {
			allowed: false;
			reason: "invalid_request" | "idp_initiated_not_allowed";
			status: 400 | 403;
	  };

type SamlResponseKind = "idp_initiated" | "sp_initiated";

function getSamlAcsProviderId(request: Request) {
	if (request.method !== "POST") {
		return { isAcsRequest: false as const };
	}
	const pathname = new URL(request.url).pathname;
	if (!pathname.startsWith(SAML_ACS_PATH_PREFIX)) {
		return { isAcsRequest: false as const };
	}
	try {
		const providerId = decodeURIComponent(
			pathname.slice(SAML_ACS_PATH_PREFIX.length),
		);
		return {
			isAcsRequest: true as const,
			providerId: PROVIDER_ID_PATTERN.test(providerId) ? providerId : null,
		};
	} catch {
		return { isAcsRequest: true as const, providerId: null };
	}
}

async function readBoundedBody(request: Request) {
	const declaredLength = request.headers.get("content-length");
	if (declaredLength !== null) {
		const length = Number(declaredLength);
		if (
			!Number.isSafeInteger(length) ||
			length < 0 ||
			length > MAX_SAML_ACS_BODY_BYTES
		) {
			throw new Error("Invalid SAML ACS body length");
		}
	}

	const reader = request.clone().body?.getReader();
	if (!reader) {
		return new Uint8Array();
	}
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			total += value.byteLength;
			if (total > MAX_SAML_ACS_BODY_BYTES) {
				await reader.cancel();
				throw new Error("SAML ACS body is too large");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

function extractSamlResponse(body: Uint8Array, contentType: string) {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
	if (contentType === "application/x-www-form-urlencoded") {
		const values = new URLSearchParams(text).getAll("SAMLResponse");
		return values.length === 1 ? values[0] : null;
	}
	if (contentType === "application/json") {
		const parsed: unknown = JSON.parse(text);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return null;
		}
		const value = (parsed as Record<string, unknown>).SAMLResponse;
		return typeof value === "string" ? value : null;
	}
	return null;
}

function decodeSamlResponse(value: string) {
	if (
		new TextEncoder().encode(value).byteLength > MAX_SAML_RESPONSE_BASE64_BYTES
	) {
		throw new Error("SAML response is too large");
	}
	const normalized = value.replace(/\s+/g, "");
	if (
		normalized.length === 0 ||
		normalized.length % 4 !== 0 ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
	) {
		throw new Error("Invalid SAML response encoding");
	}
	const binary = atob(normalized);
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function isNameStart(character: string | undefined) {
	return character !== undefined && /[A-Za-z_]/.test(character);
}

function isNameCharacter(character: string | undefined) {
	return character !== undefined && /[A-Za-z0-9_.:-]/.test(character);
}

function skipXmlPreamble(xml: string, initialOffset: number) {
	let offset = initialOffset;
	while (true) {
		while (/\s/.test(xml[offset] ?? "")) {
			offset += 1;
		}
		if (xml.startsWith("<?", offset)) {
			const end = xml.indexOf("?>", offset + 2);
			if (end === -1) {
				throw new Error("Invalid XML processing instruction");
			}
			offset = end + 2;
			continue;
		}
		if (xml.startsWith("<!--", offset)) {
			const end = xml.indexOf("-->", offset + 4);
			if (end === -1) {
				throw new Error("Invalid XML comment");
			}
			offset = end + 3;
			continue;
		}
		return offset;
	}
}

function classifyDecodedSamlResponse(xml: string): SamlResponseKind {
	let offset = skipXmlPreamble(xml, xml.charCodeAt(0) === 0xfeff ? 1 : 0);
	if (xml[offset] !== "<" || xml.startsWith("<!", offset)) {
		throw new Error("Invalid SAML response root");
	}
	offset += 1;
	if (!isNameStart(xml[offset])) {
		throw new Error("Invalid SAML response element");
	}
	const nameStart = offset;
	while (isNameCharacter(xml[offset])) {
		offset += 1;
	}
	const rootName = xml.slice(nameStart, offset);
	if (rootName.split(":").at(-1) !== "Response") {
		throw new Error("Invalid SAML response root");
	}

	let hasInResponseTo = false;
	let sawInResponseTo = false;
	while (offset < xml.length) {
		let hadWhitespace = false;
		while (/\s/.test(xml[offset] ?? "")) {
			hadWhitespace = true;
			offset += 1;
		}
		if (xml[offset] === ">") {
			return hasInResponseTo ? "sp_initiated" : "idp_initiated";
		}
		if (xml.startsWith("/>", offset) || !hadWhitespace) {
			throw new Error("Invalid SAML response start tag");
		}
		if (!isNameStart(xml[offset])) {
			throw new Error("Invalid SAML response attribute");
		}
		const attributeStart = offset;
		while (isNameCharacter(xml[offset])) {
			offset += 1;
		}
		const attributeName = xml.slice(attributeStart, offset);
		while (/\s/.test(xml[offset] ?? "")) {
			offset += 1;
		}
		if (xml[offset] !== "=") {
			throw new Error("Invalid SAML response attribute");
		}
		offset += 1;
		while (/\s/.test(xml[offset] ?? "")) {
			offset += 1;
		}
		const quote = xml[offset];
		if (quote !== '"' && quote !== "'") {
			throw new Error("Invalid SAML response attribute value");
		}
		offset += 1;
		const valueStart = offset;
		const valueEnd = xml.indexOf(quote, valueStart);
		if (valueEnd === -1 || xml.slice(valueStart, valueEnd).includes("<")) {
			throw new Error("Invalid SAML response attribute value");
		}
		if (attributeName === "InResponseTo") {
			if (sawInResponseTo) {
				throw new Error("Duplicate InResponseTo attribute");
			}
			sawInResponseTo = true;
			hasInResponseTo = xml.slice(valueStart, valueEnd).trim().length > 0;
		}
		offset = valueEnd + 1;
	}
	throw new Error("Invalid SAML response start tag");
}

async function classifySamlAcsRequest(request: Request) {
	const mediaType = request.headers
		.get("content-type")
		?.split(";", 1)[0]
		?.trim()
		.toLowerCase();
	const body = await readBoundedBody(request);
	const samlResponse = extractSamlResponse(body, mediaType ?? "");
	if (!samlResponse) {
		throw new Error("SAMLResponse is required");
	}
	return classifyDecodedSamlResponse(decodeSamlResponse(samlResponse));
}

export async function validateSamlAcsRequest(
	request: Request,
	db: AppDb,
): Promise<SamlAcsGateResult> {
	const target = getSamlAcsProviderId(request);
	if (!target.isAcsRequest) {
		return { allowed: true };
	}
	if (!target.providerId) {
		return { allowed: false, reason: "invalid_request", status: 400 };
	}
	const providerId = target.providerId;

	let responseKind: SamlResponseKind;
	try {
		responseKind = await classifySamlAcsRequest(request);
	} catch {
		return { allowed: false, reason: "invalid_request", status: 400 };
	}
	if (responseKind === "sp_initiated") {
		return { allowed: true };
	}

	const rows = await db
		.select({ providerId: ssoProvider.providerId })
		.from(ssoProvider)
		.innerJoin(
			ssoProviderSettings,
			eq(ssoProvider.providerId, ssoProviderSettings.providerId),
		)
		.where(
			and(
				eq(ssoProvider.providerId, providerId),
				eq(ssoProviderSettings.protocol, "saml"),
				eq(ssoProviderSettings.enabled, true),
				eq(ssoProviderSettings.allowIdpInitiated, true),
			),
		)
		.limit(1);
	if (!rows[0]) {
		return {
			allowed: false,
			reason: "idp_initiated_not_allowed",
			status: 403,
		};
	}
	return { allowed: true };
}
