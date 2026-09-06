# OIDC / SSO Admin Sign-In Design

**Status:** proposed  
**Date:** 2026-09-06  
**Scope:** one implementation cycle — OIDC only, admin-configured providers, additive to passkeys

This spec describes how Shorty Link should add OpenID Connect sign-in so an already-bootstrapped admin can register identity providers in the admin UI, and users can sign in with those providers. It does not replace passkeys, enable passwords, or introduce Better Auth organizations.

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

These are the defaults this spec commits to. Change them before implementation if they are wrong; do not leave them implicit.

1. **Bootstrap stays passkey-only.** The first owner cannot depend on SSO. There is no admin yet to register a provider.
2. **OIDC only in this cycle.** SAML, IdP-initiated SSO, and Better Auth domain-verification DNS TXT records are out of scope.
3. **Stay on Better Auth 1.6.x.** Add `@better-auth/sso` at the same 1.6.23 line as `better-auth`. Do not fold a 1.7 upgrade into this work. Generic OAuth was rewritten in 1.7 (`signIn.social`); the 1.6 SSO plugin is the matching API.
4. **Do not enable the Better Auth organization plugin.** Role assignment stays on `user.role_id`.
5. **Passkeys stay available.** SSO is a second sign-in method. Existing users can keep using passkeys. New SSO users may add a passkey later from profile.
6. **No open registration.** A new SSO identity becomes a Shorty user only when (a) a pending invite matches the verified email, or (b) the provider has JIT enabled and the email domain is on that provider's allowlist.
7. **JIT never grants `system_owner`.** Owner remains the bootstrap user (or an explicit later role assignment by an existing owner).
8. **Better Auth's raw SSO register/update/delete endpoints are not a public admin API.** The browser talks to `/api/admin/sso-providers`. A `before` hook rejects `/sso/register`, `/sso/update`, and `/sso/delete` (and equivalents) unless the request is the server-side admin wrapper.
9. **Client secrets live in D1** in Better Auth's `oidcConfig` JSON, same as the plugin expects. Treat D1 access as secret access. Do not add at-rest encryption in this cycle.
10. **Skip Better Auth `domainVerification`.** This app is single-tenant and the admin already pasted the issuer and client secret. Email-domain allowlisting is our trust boundary, not a DNS TXT challenge.

## Approaches considered

### A. Better Auth SSO plugin + admin wrapper (recommended)

Install `@better-auth/sso`, add the `ssoProvider` table, and let Better Auth own discovery, PKCE, token exchange, `id_token` verification, and `/api/auth/sso/callback/:providerId`.

Shorty owns:

- Admin CRUD under `/api/admin/sso-providers`
- A companion settings row (display name, enabled, JIT, default role)
- Provisioning that maps a verified IdP email onto invite / JIT / existing user
- Login buttons on `/admin`
- Permission gates (`sso.read` / `sso.write` / `sso.delete`)

**Why this wins:** it is the only Better Auth path built for *runtime* provider registration. `authClient.sso.register` and `authClient.signIn.sso({ providerId })` exist specifically for "admin sets up Okta later." Discovery means the admin form can be issuer + client id + client secret + email domains.

**Cost:** a new D1 table, a permission migration, careful hooks so Better Auth cannot insert a `user` without `role_id`, and a public catalog that must never leak `clientSecret`.

### B. Generic OAuth plugin + Wrangler secrets

Configure one or more OIDC providers in `createAuth()` from environment secrets. Users click "Sign in with Okta." Adding a provider requires a secret + redeploy.

**Why reject as the primary design:** the request is admin-setup providers. Generic OAuth is compile-time / env-time. It also has no domain-matching or per-provider JIT settings unless we reinvent them. Keep it in mind only as a later escape hatch for an air-gapped single IdP.

### C. Custom Elysia OIDC

Store providers ourselves, implement authorization-code + PKCE + JWKS verification, write `account` and `session` rows by hand.

**Why reject:** duplicates Better Auth's `account` table and token checks. The passkey and API-key plugins already expect Better Auth sessions. A second protocol stack in the Worker is the highest-risk option for the least product gain.

**Recommendation:** Approach A.

## Architecture

```text
/admin (no session)
  GET /api/admin/sso-providers/public  -> [{ providerId, displayName }]
  [Sign in with passkey] | [Sign in with {displayName}]
           |                          |
           |                          v
           |              authClient.signIn.sso({
           |                providerId,
           |                callbackURL: "/admin"
           |              })
           |                          |
           v                          v
  Better Auth passkey        GET/POST /api/auth/sso/callback/:id
                                    |
                                    v
                         provisionUser / user.create hook
                                    |
                    existing user | invite | JIT | reject
                                    |
                                    v
                         session cookie + redirect /admin
```

Admin configuration (authenticated, `sso.write`):

```text
/admin/access/sso
  Eden -> /api/admin/sso-providers
       -> auth.api.registerSSOProvider / update / delete (server-side)
       -> upsert sso_provider_settings
```

Keep this as one Worker. `/api/auth/*` already goes to Elysia via `src/server.ts`. No new binding. Outbound `fetch` to the IdP (discovery, token, JWKS) is allowed on Workers.

### Units

| Unit | Does | Depends on |
| --- | --- | --- |
| `sso` Better Auth plugin | Discovery, authorize redirect, token + `id_token` verify, callback, `ssoProvider` persistence | D1 `ssoProvider` table, `trustedOrigins` |
| `src/server/services/sso.ts` | Validate admin input, redact secrets, decide invite / JIT / reject, assign `roleId` | `adminInvites`, `roles`, `sso_provider_settings` |
| `/api/admin/sso-providers` | Permissioned CRUD + public catalog | `requireSecurePermission`, CSRF, Eden |
| Access → SSO UI | TanStack Form to create/edit/disable providers | Eden, `sso.*` permissions |
| Login card | Passkey + one button per enabled provider | Public catalog, `ssoClient()` |
| Auth hooks | Block raw SSO admin endpoints; reject inactive users; inject `roleId` on create | `createAuth` factory |

Each unit has one job. The service is the only place that decides whether a new email may become a user.

## Data model

### Better Auth `ssoProvider`

Add the plugin table (camelCase column names — the 1.6 SSO plugin queries those literals and does not honor snake_case field maps).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text PK | Plugin id |
| `issuer` | text not null | IdP issuer URL |
| `domain` | text not null | Comma-separated bare email domains (`example.com,example.org`) |
| `oidcConfig` | text | JSON: `clientId`, `clientSecret`, optional endpoints, `pkce`, `scopes`, `mapping` |
| `samlConfig` | text | Unused in this cycle; column exists because the plugin schema requires it |
| `userId` | text FK → `user.id` | Admin who registered the provider |
| `providerId` | text unique | Public slug used in the callback path |
| `organizationId` | text nullable | Always null; we do not use the organization plugin |

Redirect URI the operator pastes into the IdP:

```text
{origin}/api/auth/sso/callback/{providerId}
```

`{origin}` must be a trusted host (`BETTER_AUTH_ALLOWED_HOSTS` / request origin). Same rule as passkeys.

### Shorty `sso_provider_settings`

Better Auth does not store display name, enabled, or JIT. Own those in a companion table keyed by `providerId`.

| Column | Type | Notes |
| --- | --- | --- |
| `provider_id` | text PK | Matches `ssoProvider.providerId` |
| `display_name` | text not null | Button label, e.g. `Company Okta` |
| `enabled` | integer boolean not null default 1 | Hidden from login when false; callback still must refuse sign-in |
| `jit_enabled` | integer boolean not null default 0 | Off = invite or existing user only |
| `default_role_id` | text FK → `role.id` | Required when `jit_enabled`; forbidden to be `system_owner` |
| `created_at` / `updated_at` | integer | Unix seconds |

Deleting a provider deletes the settings row in the same admin operation. Do not cascade-delete users or `account` rows.

### User / account

No new user columns. SSO identities land in the existing `account` table (`providerId` = SSO `providerId`, `accountId` = verified OIDC `sub`).

Add Better Auth `user.additionalFields` for `roleId` (required for plugin-created users) and keep `locale`. Passkey onboarding can keep its raw insert; SSO cannot.

Migration `0007` style: append `sso.read`, `sso.write`, `sso.delete` onto `system_owner` and `system_admin` permission JSON. Custom roles do not gain SSO permissions automatically.

## Provisioning

Global SSO options:

```ts
sso({
  disableImplicitSignUp: true,
  provisionUserOnEveryLogin: false,
  provisionUser: provisionShortySsoUser,
})
```

`disableImplicitSignUp: true` means Better Auth will not create a user just because the IdP said yes. The client must never send `requestSignUp: true` — that would let any visitor opt into signup.

Server-side algorithm in `provisionShortySsoUser` / `user.create` before-hook (single function, `resolveSsoAdmission`):

Inputs: verified email (lowercased), `email_verified` claim, `providerId`, existing user-by-email.

1. If the matching Shorty user exists and `is_active = false` → reject (`errors.ssoUserDisabled`).
2. If the matching Shorty user exists and `is_active = true` → allow. Link the SSO account if not already linked. Do not change `role_id`.
3. If no user exists and a pending, unexpired invite matches that email → claim the invite (same atomic pattern as `completePasskeyRegistrationUser`), create the user with the invite's `role_id` and `invited_by`, allow.
4. If no user exists, settings.jit_enabled is true, settings.enabled is true, the email domain is in the provider `domain` list, and `default_role_id` is not `system_owner` → create the user with that role, `invited_by` null, allow.
5. Otherwise reject (`errors.ssoNotProvisioned`).

Rules:

- Require `email` and treat `email_verified === false` as reject (`errors.ssoEmailUnverified`). Do not link or JIT on an unverified email.
- Account linking: enable Better Auth `accountLinking` with `trustedProviders` loaded from D1 `ssoProvider.providerId` values inside `createAuth(request)`. Linking is allowed only after the verified-email check, and only onto the user row with that same email. Do not add a second linking path in application SQL.
- `provisionUserOnEveryLogin` stays false so nightly IdP profile changes cannot rewrite Shorty roles or names unexpectedly. Name/image updates can be a later checkbox.
- Invite claim must stay atomic with user insert, matching the existing `admin_invite` `accepted_at` compare-and-set.

## Sign-in UX

`/admin` when `!session && !bootstrap.canBootstrap`:

1. Existing passkey button.
2. If the public catalog is non-empty, one secondary button per provider: `Sign in with {displayName}`.
3. No email-first "enter your work email" step in this cycle. Provider buttons are enough for a single-tenant admin. Domain-matching `signIn.sso({ email })` can wait.

Bootstrap form is unchanged (name, email, locale, passkey). Invite accept page stays passkey registration. After an invite is accepted, that user can also use SSO on the next visit (step 2 of provisioning).

Optional later (not this cycle): "Accept invite with SSO" on `/admin/invite/:token` so the first session never needs a passkey.

## Admin UX

Add an **SSO** tab on `/admin/access` next to Users / Invites / Roles, gated on `sso.read`.

List: display name, provider id, issuer, domains, enabled, JIT, default role, created by.

Create / edit form (TanStack Form, Eden):

- Display name
- Provider id (create-only, `[a-z0-9-]+`, cannot be `credential`, `passkey`, or a built-in social id)
- Issuer URL
- Client id
- Client secret (write-only; edit form shows a placeholder, blank means keep existing)
- Email domains (comma-separated)
- Enabled
- JIT enabled
- Default role (assignable roles only; never `system_owner`)
- Read-only callback URL for copy

Elysia `t` validation on the admin body. Do not accept `samlConfig` or `organizationId` from the client.

## API

All of these except the public catalog require cookie or API-key auth plus the named permission. Writes use `requireSecurePermission` (CSRF).

| Method | Path | Permission | Behavior |
| --- | --- | --- | --- |
| GET | `/api/admin/sso-providers/public` | none | `{ providers: [{ providerId, displayName }] }` for `enabled = true` only |
| GET | `/api/admin/sso-providers` | `sso.read` | Full list, secrets redacted (`clientSecret` absent or `"********"`) |
| GET | `/api/admin/sso-providers/:providerId` | `sso.read` | One provider, secret redacted, plus callback URL |
| POST | `/api/admin/sso-providers` | `sso.write` | Register via `auth.api.registerSSOProvider`, insert settings |
| PATCH | `/api/admin/sso-providers/:providerId` | `sso.write` | Update OIDC fields and/or settings. Blank secret keeps the old secret |
| DELETE | `/api/admin/sso-providers/:providerId` | `sso.delete` | Delete plugin row + settings |

Public catalog is under `/api/admin/*` so Server-Timing stays consistent. It is read-only and secret-free.

On create, call Better Auth with the admin session headers so `userId` is the acting admin. If the plugin requires a session and API-key callers have one (`enableSessionForAPIKeys: true`), that is enough.

Hook in `createAuth`:

- If path is an SSO management path and the caller is not the admin wrapper (use an internal request header set only by the Elysia handler, e.g. `x-shorty-sso-admin: 1`, stripped from incoming client requests in `src/server.ts` or the Elysia derive), throw `FORBIDDEN`.
- Existing `/api-key/create` permission hook stays as-is.

## Security

- CSRF: admin writes already require a matching `Origin`.
- Redirect URIs: Better Auth already rejects callback URLs outside `trustedOrigins`. Keep using `resolveTrustedRequestOrigin`.
- Provider id collisions: reject reserved ids so an SSO provider cannot inherit passkey or credential account-linking trust.
- Secret redaction on every admin read DTO.
- Strip `clientSecret` from logs. Do not put the full `oidcConfig` in Server-Timing or OpenAPI examples.
- Inactive users: reject at provisioning and keep the existing `loadAuthContext` null-session behavior.
- JIT domain check uses the provider's stored `domain` list, exact suffix after `@`, lowercase.
- Do not trust unsigned IdP extra claims for role mapping in this cycle. Role comes from invite or `default_role_id` only.
- Agent browser login (`/api/dev/agent-login`) is unchanged and stays local-dev only.

## Error handling

Map plugin failures to existing i18n `errors.*` keys (EN + ES, matching `src/lib/i18n.ts`):

| Situation | Key |
| --- | --- |
| IdP discovery failed on register | `errors.ssoDiscoveryFailed` |
| Duplicate `providerId` | `errors.ssoProviderExists` |
| JIT default role is owner | `errors.ssoOwnerRoleForbidden` |
| Sign-in with no matching user/invite/JIT | `errors.ssoNotProvisioned` |
| Email missing or unverified | `errors.ssoEmailUnverified` |
| User deactivated | `errors.ssoUserDisabled` |
| Provider disabled | `errors.ssoProviderDisabled` |
| User cancelled at IdP | `errors.ssoCancelled` |

Login card shows the notice + retry, same pattern as `PasskeyLogin` in `src/routes/admin.tsx`.

## Testing

Automated tests are the proof for this cycle. A live Okta tenant is not required.

1. **`resolveSsoAdmission` unit tests** — existing active user; existing inactive user; pending invite claim; expired invite; JIT on matching domain; JIT off; JIT with owner role rejected; unverified email; domain mismatch; disabled provider.
2. **Admin API tests** — `sso.write` required for POST; CSRF 403 without `Origin`; public catalog omits secrets and disabled providers; PATCH with blank secret preserves secret; DELETE removes both rows; reserved `providerId` rejected.
3. **Auth hook tests** — direct `/api/auth/sso/register` from a normal session is 403; wrapper-originated call succeeds.
4. **Permission migration test or SQL assertion** — `system_owner` and `system_admin` JSON contain the three new permissions; a custom role fixture does not.
5. Existing passkey bootstrap, invite, and API-key tests must still pass.

Do not add a Playwright IdP mock in this cycle. If we later want a browser demo, use a local mock OIDC (e.g. a tiny discovery/token stub) behind `pnpm test`, not production Okta.

## Documentation and operator impact

Update after implementation (not part of this spec PR):

- `docs/overview.md` — passkey-first, optional SSO
- `docs/usage.md` — configure a provider, copy callback URL, sign-in buttons
- `docs/self-hosting.md` — IdP redirect URI, trusted hosts
- `docs/admin-api.md` and `pnpm docs:generate`
- `docs/roadmap.md` — mark SSO as implemented when it ships

Operator impact when implemented: D1 migration required; no new Wrangler binding; no breaking change to passkey or API-key clients. IdP setup is operator-owned (create an OIDC app, paste issuer/client/secret, add the callback URL).

## Out of scope

- SAML 2.0 and IdP-initiated flows
- Better Auth 1.7 upgrade and generic-OAuth rewrite
- Better Auth organization plugin / multi-tenant SSO
- Password login or signup
- Replacing passkey bootstrap
- Signing up the first owner via SSO
- Encrypting `clientSecret` at rest
- DNS domain verification
- Mapping IdP groups/roles onto Shorty roles
- Enforcing "this email domain must use SSO" (disabling passkey for a domain)
- Accept-invite-with-SSO on the invite page
- Visual redesign of the admin shell

## Implementation order

When this spec is approved, the implementation plan should land in this order so each step is testable:

1. Permissions + D1 tables + Drizzle schema + `pnpm cf-typegen` is unnecessary (no binding change).
2. `resolveSsoAdmission` + tests (no plugin yet).
3. Wire `@better-auth/sso` into `createAuth`, additionalFields, hooks.
4. Admin API + redaction + hook lockout.
5. Access → SSO UI.
6. Login buttons + i18n.
7. Docs + `pnpm docs:generate` + `pnpm format:fix` + `pnpm verify`.

## Spec self-review

- No TBD/TODO placeholders.
- Approach A is the only implementation path; B and C are rejected with reasons.
- Invite-gated vs JIT is explicit and per-provider, not global.
- `role_id` on plugin-created users is called out; this is the main integration risk.
- Scope is one cycle (OIDC + admin UI + provisioning). SAML and 1.7 are excluded.
