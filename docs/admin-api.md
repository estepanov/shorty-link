# Admin API

Shorty Link exposes its admin API from the same Worker under `/api/admin/*`.

Authentication works with:

- Better Auth session cookies
- Better Auth API keys in `x-api-key` or `Authorization`

Passkey registration and sign-in stay under `/api/auth/*` because they rely on Better Auth's WebAuthn flows.

## Endpoints

### Bootstrap and onboarding

- `GET /api/admin/bootstrap`
- `POST /api/admin/onboarding/bootstrap`
- `GET /api/admin/invites/:token`
- `POST /api/admin/onboarding/invite`

### Dashboard and profile

- `GET /api/admin/dashboard`
- `GET /api/admin/profile`
- `PATCH /api/admin/profile`

### Links

- `GET /api/admin/links`
- `POST /api/admin/links`
- `GET /api/admin/links/:id`
- `PATCH /api/admin/links/:id`
- `DELETE /api/admin/links/:id`
- `GET /api/admin/links/:id/stats`
- `GET /api/admin/suggest-slug`

### Domains

- `GET /api/admin/domains`
- `POST /api/admin/domains`
- `GET /api/admin/domains/:id`
- `PATCH /api/admin/domains/:id`
- `DELETE /api/admin/domains/:id`

### Users and invites

- `GET /api/admin/users`
- `PATCH /api/admin/users/:id`
- `DELETE /api/admin/users/:id`
- `GET /api/admin/invites`
- `POST /api/admin/invites`
- `DELETE /api/admin/invites` with body `{ "id": "invite-id" }`

### Sessions

- `GET /api/admin/sessions`
- `POST /api/admin/sessions/revoke` with body `{ "token": "..." }`
- `POST /api/admin/sessions/revoke-other`
- `DELETE /api/admin/sessions/current`

### API keys

- `GET /api/admin/api-keys`
- `POST /api/admin/api-keys`
- `PATCH /api/admin/api-keys/:id`
- `DELETE /api/admin/api-keys/:id`

## Examples

Create an API key:

```bash
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H 'content-type: application/json' \
  -H 'x-api-key: sl_your_key_here' \
  -d '{"name":"CI","expiresInDays":30}'
```

Revoke one session:

```bash
curl -X POST http://localhost:3000/api/admin/sessions/revoke \
  -H 'content-type: application/json' \
  -H 'x-api-key: sl_your_key_here' \
  -d '{"token":"session-token"}'
```

List links:

```bash
curl 'http://localhost:3000/api/admin/links?page=1&pageSize=25&active=all' \
  -H 'x-api-key: sl_your_key_here'
```
