# OIDC / SAML SSO Admin Sign-In Design

**Status:** approved for implementation  
**Date:** 2026-09-06  
**Scope:** one implementation cycle — Better Auth 1.7, OIDC and SAML, IdP-initiated SSO, encrypted secrets at rest, IdP group → role mapping, and SSO-enforced domains

This spec describes how Shorty Link adds enterprise SSO so an already-bootstrapped admin can register identity providers in the admin UI, and users can sign in with those providers. It does not replace passkeys for domains that are not SSO-enforced, enable passwords, or introduce Better Auth organizations.

## Problem

Shorty Link is passkey-first. The first owner bootstraps with a passkey. Later users accept an invite and register a passkey. That is correct for a single-operator deploy, but it is awkward for teams that already live in Okta, Microsoft Entra ID, Keycloak, Auth0, or Google Workspace.

The product request is: **admins configure providers**, then **users sign in with those providers**. That is a runtime, database-backed SSO problem, not a "put GitHub OAuth in `wrangler.jsonc` and redeploy" problem.

Constraints that the current codebase already imposes:

- Password login and password signup stay disabled (`src/server/auth/auth.ts`).
- Auth is Better Auth on `/api/auth`, with passkey and API-key plugins.
- Admin mutations live under `/api/admin/*` so CSRF (`Origin` must match) and Server-Timing apply.
- The `user` row requires `role_id`. Passkey onboarding inserts users with raw SQL in `src/server/auth/onboarding.ts` because Better Auth does not know about Shorty roles.
- Access is a custom `role` table plus permissions, not the Better Auth organization plugin. The app is single-tenant ("one deployment, one organization").
- `createAuth(request)` is per-request so trusted origins stay request-scoped. SSO must work in that factory, not a process-global auth object.

## Locked decisions

1. **Approach A.** Better Auth `@better-auth/sso` plus Shorty-owned admin CRUD, settings, and provisioning.
2. **Bootstrap stays passkey-only.** The first owner cannot depend on SSO. There is no admin yet to register a provider.
3. **OIDC and SAML in this cycle.** Admins pick a protocol per provider. IdP-initiated SSO is supported for both.
4. **Upgrade to Better Auth 1.7.x** (all `@better-auth/*` packages together, currently 1.7.2). Set `account.identityStrategy: "provider-id"` and add the required `account.issuer` column with a deterministic `local:{providerId}` backfill for existing rows.
5. **Do not enable the Better Auth organization plugin.** Role assignment stays on `user.role_id`.
6. **Passkeys stay available except on SSO-enforced domains.** When a provider has `enforceSso` and the user's email domain matches, passkey sign-in and passkey registration are rejected. Bootstrap remains passkey-only even if that email domain is later enforced.
7. **No open registration.** A new SSO identity becomes a Shorty user only when (a) a pending invite matches the verified email, or (b) the provider has JIT enabled and the email domain is on that provider's allowlist.
8. **JIT and group mapping never grant `system_owner`.** Owner remains the bootstrap user (or an explicit later role assignment by an existing owner). Group mapping never demotes an existing owner.
9. **Better Auth's raw SSO register/update/delete endpoints are not a public admin API.** The browser talks to `/api/admin/sso-providers`. A `before` hook rejects `/sso/register`, `/sso/update`, and `/sso/delete` unless the request is the server-side admin wrapper.
10. **Client secrets and SAML private keys stay in D1 `oidcConfig` / `samlConfig`**, encrypted at rest with AES-256-GCM keyed from `BETTER_AUTH_SECRET`. Treat D1 access plus that secret as equivalent to secret access. Do not add a second secrets store.
11. **Skip Better Auth `domainVerification` DNS TXT.** This app is single-tenant and the admin already pasted the issuer and client secret. Email-domain allowlisting is our trust boundary.
12. **IdP group mapping is first-match, ordered, on every SSO login.** Claim name is configurable (default `groups`). Unmapped groups leave the current role (or the invite / JIT default for new users).

## Approaches considered

### A. Better Auth SSO plugin + admin wrapper (chosen)

Install `@better-auth/sso` on Better Auth 1.7, add the `ssoProvider` table, and let Better Auth own discovery, PKCE, token exchange, `id_token` verification, SAML assertion checks, and callbacks.

Shorty owns admin CRUD, companion settings, provisioning, encryption of secret fields inside the plugin JSON blobs, login/invite UI, and passkey enforcement.

### B. Generic OAuth plugin + Wrangler secrets (rejected)

Not admin-setup. No SAML, no per-provider JIT, no group mapping store.

### C. Custom Elysia OIDC/SAML (rejected)

Duplicates Better Auth session and account handling.

## Architecture

```text
/admin (no session)
  GET /api/admin/sso-providers/public
  email (optional, required when any provider enforces SSO)
  [Sign in with passkey] if domain is not enforced
  [Sign in with {displayName}] for matching enabled providers
                         |
                  authClient.signIn.sso({
                    providerId,
                    callbackURL: "/admin"
                  })
                         |
                  OIDC: /api/auth/sso/callback/:id
                  SAML ACS: /api/auth/sso/saml2/sp/acs/:id
                         |
                  provisionUser / user.create hook
                         |
                  existing | invite | JIT | reject
                         |
                  apply group → role mapping
                         |
                  session cookie + redirect /admin
```

IdP-initiated:

- OIDC: `oidcConfig.allowIdpInitiated: true`; bounce uses `baseURL` then `/admin`.
- SAML: IdP POSTs to `/api/auth/sso/saml2/sp/acs/{providerId}`; `samlConfig.callbackUrl` is `/admin`. `src/server.ts` already sends every `/api/auth/*` method, including POST, to `createAuth(request).handler`.

Admin configuration (authenticated, `sso.write`):

```text
/admin/access/sso
  Eden -> /api/admin/sso-providers
       -> auth.api.registerSSOProvider / update / delete (server-side)
       -> encrypt secret fields in oidcConfig / samlConfig
       -> upsert sso_provider_settings
```

Keep this as one Worker. No new binding. Outbound `fetch` to the IdP is allowed. `nodejs_compat` is already on for SAML XML.

### Units

| Unit | Does | Depends on |
| --- | --- | --- |
| Better Auth 1.7 + `sso` plugin | Discovery, OIDC/SAML protocol, callbacks, `ssoProvider` persistence | D1 tables, `trustedOrigins`, `account.issuer` |
| `src/server/auth/sso-secrets.ts` | AES-256-GCM encrypt/decrypt of known secret JSON fields | `BETTER_AUTH_SECRET` |
| `src/server/services/sso.ts` | Admission, group mapping, domain enforcement, admin DTOs | invites, roles, settings |
| `/api/admin/sso-providers` | Permissioned CRUD + public catalog + SP metadata | CSRF, Eden |
| Access → SSO UI | Create/edit OIDC or SAML providers | Eden, `sso.*` permissions |
| Login + invite cards | Passkey and/or SSO buttons, email-first when enforcement exists | Public catalog |
| Auth hooks | Block raw SSO admin endpoints; reject enforced-domain passkeys; inject `roleId` | `createAuth` factory |

## Better Auth 1.7 upgrade

Upgrade `better-auth`, `@better-auth/api-key`, `@better-auth/drizzle-adapter`, `@better-auth/i18n`, `@better-auth/passkey` together and add `@better-auth/sso` at the same version.

Configuration changes in `createAuth`:

```ts
account: { identityStrategy: "provider-id" }
user.additionalFields.roleId
plugins: [passkey(...), apiKey(...), i18n(...), sso({...}), tanstackStartCookies()]
```

D1 migration for existing installs:

- Add `account.issuer` text, backfill `local:{provider_id}` for existing rows, then rebuild the table so `issuer` is NOT NULL and `(issuer, account_id)` is unique.
- Fresh installs get the same end state through the append-only migration (do not rewrite `0000_fresh_shorty_link.sql`).

Do not run `auth migrate apply` against D1. Hand-write the SQL to match the 1.7 provider-id backfill rules.

OIDC/SAML 1.7 rules we follow:

- Do not send `mapping.id`. Account subject is OIDC `sub` or signed SAML `NameID`.
- SAML ACS is `/api/auth/sso/saml2/sp/acs/:providerId` (the old `/sso/saml2/callback/:providerId` is gone).
- Manual SAML configs without metadata XML must set `idpMetadata.entityID`.
- `samlConfig.issuer` is the service provider entity ID.

## Data model

### Better Auth `ssoProvider`

Use camelCase column names. The SSO plugin queries those literals.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text PK | Plugin id |
| `issuer` | text not null | OIDC issuer URL, or SAML SP entity ID |
| `domain` | text not null | Comma-separated bare email domains |
| `oidcConfig` | text | JSON; secret fields encrypted at rest |
| `samlConfig` | text | JSON; private keys and passwords encrypted at rest |
| `userId` | text FK → `user.id` | Admin who registered the provider |
| `providerId` | text unique | Public slug used in callback paths |
| `organizationId` | text nullable | Always null |

Redirect URIs:

```text
OIDC:  {origin}/api/auth/sso/callback/{providerId}
SAML ACS: {origin}/api/auth/sso/saml2/sp/acs/{providerId}
SAML SP metadata: GET /api/admin/sso-providers/:providerId/sp-metadata
```

### Shorty `sso_provider_settings`

| Column | Type | Notes |
| --- | --- | --- |
| `provider_id` | text PK | Matches `ssoProvider.providerId` |
| `protocol` | text not null | `oidc` or `saml` |
| `display_name` | text not null | Button label |
| `enabled` | integer boolean not null default 1 | Hidden from login when false; callback refuses sign-in |
| `jit_enabled` | integer boolean not null default 0 | Off = invite or existing user only |
| `default_role_id` | text FK → `role.id` nullable | Required when JIT is on; never `system_owner` |
| `enforce_sso` | integer boolean not null default 0 | Matching email domains cannot use passkeys |
| `allow_idp_initiated` | integer boolean not null default 0 | Sets OIDC `allowIdpInitiated` / SAML IdP-initiated landing |
| `group_claim` | text not null default `groups` | IdP claim or SAML attribute name |
| `group_role_mappings` | text not null default `[]` | JSON `[{ "group": "eng", "roleId": "..." }]` |
| `created_at` / `updated_at` | integer | Unix seconds |

Deleting a provider deletes the settings row. Do not cascade-delete users or `account` rows.

### User / account

Add `account.issuer`. SSO identities land in `account` (`providerId` = SSO provider id, `accountId` = `sub` or `NameID`, `issuer` = provider-id namespace).

Add Better Auth `user.additionalFields` for `roleId`.

Migration appends `sso.read`, `sso.write`, `sso.delete` onto `system_owner` and `system_admin` only.

## Secret encryption at rest

Module: `src/server/auth/sso-secrets.ts`.

- Algorithm: AES-256-GCM.
- Key: SHA-256 of `BETTER_AUTH_SECRET` (or the local development fallback when `getAuthSecret` allows it).
- Wire format: `ssoenc:v1:` + base64url(`iv || ciphertext || tag`) with a 12-byte IV.
- Walk these JSON keys anywhere in `oidcConfig` / `samlConfig`: `clientSecret`, `privateKey`, `privateKeyPass`, `encPrivateKey`, `encPrivateKeyPass`.
- Encrypt on write in the admin service before persist. Decrypt on read before the SSO plugin uses the config, and before returning a redacted admin DTO.
- Idempotent: values that already start with `ssoenc:v1:` are not double-encrypted.
- Admin GET responses never include decrypted secrets; they show `********` when a secret is present.
- PATCH with a blank secret keeps the existing ciphertext.

Drizzle custom types are allowed as a second line of defense on `oidcConfig` and `samlConfig`, but the service-layer encrypt/decrypt is the source of truth so Better Auth adapter reads cannot see plaintext if they bypass column types. After `registerSSOProvider` / update, the admin service immediately rewrites the row with encrypted secret fields. Before `createAuth` builds the plugin, it decrypts provider rows into memory for `sso({ providers })` when the 1.7 plugin accepts config providers; otherwise it decrypts, writes a request-scoped decrypted copy only in memory, and the plugin reads through a decrypting wrapper around those two columns.

Tests cover: round-trip, wrong secret fails, already-encrypted idempotence, nested SAML keys, blank PATCH preserve.

## Provisioning

```ts
sso({
  disableImplicitSignUp: true,
  provisionUserOnEveryLogin: true,
  provisionUser: provisionShortySsoUser,
})
```

The client must never send `requestSignUp: true`.

`resolveSsoAdmission` inputs: verified email (lowercased), `email_verified` / SAML email, `providerId`, IdP groups, existing user-by-email.

1. Provider missing or `enabled = false` → `errors.ssoProviderDisabled`.
2. Email missing or unverified → `errors.ssoEmailUnverified`.
3. Existing user and `is_active = false` → `errors.ssoUserDisabled`.
4. Existing user and active → allow. Do not change role except via group mapping (step 7). Never change `system_owner` via mapping.
5. No user + pending unexpired invite for that email → claim invite atomically, create user with invite `role_id` and `invited_by`.
6. No user + JIT on + domain in provider list + `default_role_id` is not owner → create user with that role.
7. Apply group mappings in list order: first matching group whose `roleId` exists and is not `system_owner` wins. For new users this overrides invite/JIT role. For existing non-owner users this updates `role_id`. Unmapped groups keep the role from steps 4–6.
8. Otherwise reject (`errors.ssoNotProvisioned`).

Account linking: `accountLinking.enabled` with `trustedProviders` loaded from stored `providerId`s. Verified email only.

## SSO-enforced domains

`emailDomain(email)` is the lowercase substring after the last `@`.

`isSsoEnforcedForEmail(email)` is true when any **enabled** provider has `enforce_sso = 1` and that domain appears in its `domain` list.

Effects:

- Passkey authentication hook: if the identified user's email is enforced → `errors.ssoRequired`.
- Passkey registration hook: if the onboarding email is enforced and the context is not `bootstrap` → `errors.ssoRequired`.
- Invite GET: include `{ ssoEnforced, providerId, displayName }` so the invite page can show SSO instead of passkey.
- Login: when any enabled provider has `enforceSso`, show an email field. After the user enters an enforced-domain email, hide the passkey button and show only matching providers. Non-enforced emails still see passkey plus all enabled providers.

## Sign-in UX

`/admin` when signed out and bootstrap is complete:

1. If any provider enforces SSO, an email field and Continue.
2. Passkey button when the email is empty or not enforced.
3. One button per visible enabled provider.
4. IdP-initiated users land on `/admin` already signed in.

Bootstrap form is unchanged. Invite accept uses SSO when the invite email is enforced; otherwise passkey remains.

## Admin UX

**SSO** tab on `/admin/access`, gated on `sso.read`.

Create / edit form (TanStack Form):

- Display name, provider id (create-only, `[a-z0-9-]+`, reserved ids rejected)
- Protocol: OIDC or SAML
- Email domains
- Enabled, JIT, default role, enforce SSO, allow IdP-initiated
- Group claim + ordered group → role rows
- OIDC: issuer, client id, client secret (write-only), optional discovery override
- SAML: SP issuer, IdP metadata XML or entry point + entity ID, optional SP/IdP private keys (write-only)
- Read-only callback / ACS / metadata URLs

Elysia `t` validation. Do not accept `organizationId` from the client.

## API

| Method | Path | Permission | Behavior |
| --- | --- | --- | --- |
| GET | `/api/admin/sso-providers/public` | none | `{ providers, hasEnforcedDomain }` with `{ providerId, displayName, protocol, domains, enforceSso }` for enabled providers |
| GET | `/api/admin/sso-providers` | `sso.read` | Full list, secrets redacted |
| GET | `/api/admin/sso-providers/:providerId` | `sso.read` | One provider + callback/ACS/metadata URLs |
| GET | `/api/admin/sso-providers/:providerId/sp-metadata` | `sso.read` | SAML SP metadata XML via `auth.api.spMetadata` |
| POST | `/api/admin/sso-providers` | `sso.write` | Register, encrypt secrets, insert settings |
| PATCH | `/api/admin/sso-providers/:providerId` | `sso.write` | Update; blank secrets keep ciphertext |
| DELETE | `/api/admin/sso-providers/:providerId` | `sso.delete` | Delete plugin row + settings |

Invite GET grows optional `sso` admission hints; no extra permission.

Better Auth `/sso/register`, `/sso/update-provider`, and `/sso/delete-provider` are rejected unconditionally. Shorty owns provider writes in the admin service.

## Security

- CSRF on admin writes.
- `trustedOrigins` is Shorty hosts only. OIDC discovery runs on admin write with an issuer-origin allowlist; hydrated endpoints are stored for login.
- Redirect URIs must stay inside `trustedOrigins`.
- Reserved provider ids: `credential`, `passkey`, `apikey`, and built-in social ids.
- Secret redaction on every admin read DTO. No secrets in logs, OpenAPI examples, or Server-Timing.
- Inactive users rejected at provisioning.
- JIT and enforcement domain checks are exact lowercase suffix after `@`.
- Group mapping cannot assign `system_owner` and cannot change an existing owner.
- Agent browser login stays local-dev only.

## Error handling

| Situation | Key |
| --- | --- |
| Discovery failed | `errors.ssoDiscoveryFailed` |
| Duplicate provider id | `errors.ssoProviderExists` |
| JIT/mapping owner role | `errors.ssoOwnerRoleForbidden` |
| No matching user/invite/JIT | `errors.ssoNotProvisioned` |
| Email missing or unverified | `errors.ssoEmailUnverified` |
| User deactivated | `errors.ssoUserDisabled` |
| Provider disabled | `errors.ssoProviderDisabled` |
| Passkey used on enforced domain | `errors.ssoRequired` |
| User cancelled at IdP | `errors.ssoCancelled` |
| SAML metadata invalid | `errors.ssoSamlMetadataInvalid` |

EN and ES strings in `src/lib/i18n.ts`.

## Testing

1. `sso-secrets` unit tests.
2. `resolveSsoAdmission` and `isSsoEnforcedForEmail` unit tests, including group mapping and owner protection.
3. Admin API: permissions, CSRF, redaction, public catalog, reserved ids, blank-secret PATCH.
4. Auth hook: raw `/api/auth/sso/register` is 403; enforced-domain passkey is rejected; bootstrap passkey still works.
5. Permission migration: system roles gain `sso.*`; custom roles do not.
6. Existing passkey, invite, and API-key tests still pass after the 1.7 upgrade.

No live Okta/SAML tenant in CI.

## Documentation and operator impact

Update `docs/overview.md`, `docs/usage.md`, `docs/self-hosting.md`, `docs/admin-api.md`, `docs/upgrading.md`, `docs/configuration.md`, and regenerate OpenAPI/Postman.

Operator impact: D1 migration required (SSO tables + `account.issuer` + system-role permissions). No new Wrangler binding. `BETTER_AUTH_SECRET` now also wraps SSO secrets. IdP setup is operator-owned. Callback/ACS URLs must be registered at the IdP. Existing passkey users on a later-enforced domain must use SSO after the admin turns enforcement on.

## Out of scope

- Better Auth organization plugin / multi-tenant SSO
- Password login or signup
- Replacing passkey bootstrap
- Signing up the first owner via SSO
- A secrets manager other than encrypted D1
- Better Auth DNS domain verification
- SCIM

## Implementation order

1. Permissions + D1 tables + `account.issuer` backfill.
2. `sso-secrets` + `resolveSsoAdmission` + enforcement helpers + tests.
3. Upgrade Better Auth to 1.7.x and add `@better-auth/sso`.
4. Wire `createAuth` (identity strategy, additionalFields, hooks, SSO plugin).
5. Admin API + redaction + encrypt-on-write.
6. Access → SSO UI and login/invite buttons.
7. Docs + `pnpm docs:generate` + `pnpm format:fix` + `pnpm verify`.
