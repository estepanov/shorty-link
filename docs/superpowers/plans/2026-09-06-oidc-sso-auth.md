# OIDC / SAML SSO Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-configured OIDC and SAML SSO on Better Auth 1.7, with encrypted D1 secrets, IdP-initiated flows, group-to-role mapping, and SSO-enforced domains.

**Architecture:** `@better-auth/sso` owns protocol and callbacks. Shorty owns `/api/admin/sso-providers`, direct provider persistence, `sso_provider_settings`, AES-GCM encryption of secret JSON fields, `resolveSsoAdmission`, and passkey enforcement. The selected provider's email-domain allowlist applies to existing users, invite claims, and JIT provisioning.

**Tech Stack:** Better Auth 1.7.x, `@better-auth/sso`, Elysia, Drizzle/D1, TanStack Form, Eden, Vitest.

## Global Constraints

- One Worker. No `apps/admin` split.
- Password login and signup stay disabled.
- Bootstrap stays passkey-only.
- Admin writes under `/api/admin/*` with CSRF.
- Use TanStack Form and Eden.
- After code changes: `pnpm format:fix`.
- Do not grant `system_owner` via JIT or group mapping.

---

### Task 1: Secrets, admission, enforcement

**Files:**
- Create: `src/server/auth/sso-secrets.ts`
- Create: `src/server/auth/sso-adapter.ts`
- Create: `src/server/services/sso-admission.ts`, `src/server/services/sso-providers.ts`
- Test: `test/sso-secrets.test.ts`, `test/sso-admission.test.ts`

**Interfaces:**
- Produces: `encryptSsoConfigJson`, `decryptSsoConfigJson`, `withSsoConfigCrypto`, `resolveSsoAdmission`, provider CRUD, `isSsoEnforcedForEmail`, `emailDomain`

- [ ] Write failing tests, then implement helpers described in the spec.

### Task 2: Schema, permissions, migration

**Files:**
- Modify: `src/lib/permissions.ts`, `src/server/db/schema.ts`
- Create: `migrations/0011_sso_providers.sql`, `migrations/0012_sso_invite_claim.sql`

- [ ] Add `sso.read|write|delete`, `ssoProvider`, `ssoProviderSettings`, `account.issuer` backfill, atomic invite-claim correlation, and the system-role permission JSON update.

### Task 3: Better Auth 1.7 + plugin wiring

**Files:**
- Modify: `package.json` / lockfile
- Modify: `src/server/auth/auth.ts`, `src/lib/auth-client.ts`, `src/server.ts`

- [ ] Upgrade packages together to 1.7.3. Add `account.issuer`, `sso()`, and `ssoClient()`. Block raw SSO admin paths unconditionally. Reject enforced-domain passkeys except bootstrap.

### Task 4: Admin API

**Files:**
- Create: `src/server/api/sso-routes.ts`
- Create: `src/server/services/sso-providers.ts`
- Modify: `src/server/api/app.ts`
- Test: `test/admin-api-wrappers.test.ts` (extend)

- [ ] Shorty-owned CRUD + public catalog + SP metadata. Encrypt before the first D1 write. Redact on read.

### Task 5: Admin and login UI

**Files:**
- Modify: `src/routes/admin.access.tsx`, `src/routes/admin.tsx`, `src/routes/admin.invite.$token.tsx`, `src/lib/i18n.ts`
- Create: `src/routes/admin.access.sso.tsx`, `src/routes/admin.access.sso.new.tsx`, `src/routes/admin.access.sso.$providerId.tsx`

- [ ] Access → SSO tab. Login/invite SSO buttons and email-first enforcement.

### Task 6: Docs and verify

**Files:**
- Modify: `docs/overview.md`, `docs/usage.md`, `docs/self-hosting.md`, `docs/admin-api.md`, `docs/upgrading.md`, `docs/configuration.md`

- [ ] Document operator setup. `pnpm docs:generate`. `pnpm verify`.
