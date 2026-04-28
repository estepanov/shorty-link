# Using Shorty Link

This page covers day-to-day use after Shorty Link is deployed and you have an admin passkey.

## Sign in

Open `/admin` on your deployed hostname. Sign in with the passkey you registered during onboarding.

If a teammate sent you an invite link, follow the invite URL first to register your passkey, then return to `/admin`.

## Create a link

1. From the admin dashboard, open **Links** and click **New link**.
2. Enter the **target URL** — the destination users will be redirected to.
3. Choose a **slug**:
   - Type your own (letters, numbers, dashes).
   - Or click **Suggest** to get an AI-generated slug from the target URL. This requires the optional Cloudflare AI binding; without it, suggestions fall back to a deterministic generator.
4. Optionally pick a **hostname**. If you manage multiple domains, this binds the slug to a specific host. Leave blank to use the default host.
5. Optionally choose a **redirect status code**:
   - `301` — permanent, cacheable
   - `302` — temporary (default)
   - `303` — see other (forces GET)
   - `307` — temporary, preserves method
   - `308` — permanent, preserves method
6. Save. The link is live immediately.

## Edit, disable, or delete a link

- **Edit** changes the target, status code, or slug.
- **Disable** marks a link inactive without deleting it. Inactive links return a 404 instead of redirecting, but their click history is preserved.
- **Delete** removes the link and its history permanently.

## View click stats

Open any link's detail page to see total clicks and recent activity. Click counts are tracked in `waitUntil` so they never block the redirect itself.

## Manage domains

Open **Domains** in the admin UI to register hostnames you've routed to the Worker.

Redirect resolution is two-step:

1. Try the **exact hostname plus slug** first.
2. Fall back to the **default hostname** with the same slug.

This means the same slug can mean different things on different brands — `/launch` on `links.brand-a.com` can point somewhere different than `/launch` on `links.brand-b.com`.

To add a new hostname:

1. In Cloudflare, route the hostname to the Worker (custom domain or route).
2. In the admin UI, create a domain entry with that hostname.
3. Mark exactly one domain as the default if you want hostname-agnostic fallbacks.

## Invite a teammate

Open **Users → Invites** and click **New invite**. Send the invite link to your teammate. They open the link, register a passkey, and become an admin.

To revoke an unused invite, delete it from the invites list.

## Create an API key

1. Open **API Keys** and click **New key**.
2. Give it a name (e.g. `CI`, `marketing-tooling`).
3. Optionally set an expiry in days.
4. Copy the key immediately — it's only shown once.

Use the key in API requests via either header:

```text
x-api-key: sl_your_key_here
```

```text
Authorization: Bearer sl_your_key_here
```

Revoke a key from the same page when it's no longer needed.

## Use the Admin API

Every admin action is also available over HTTP under `/api/admin/*`. See the [Admin API reference](/admin-api/) for the full endpoint list. Quick examples:

Create a link:

```bash
curl -X POST https://links.example.com/api/admin/links \
  -H 'content-type: application/json' \
  -H 'x-api-key: sl_your_key_here' \
  -d '{"slug":"pricing","targetUrl":"https://example.com/pricing","statusCode":308}'
```

List links with paging:

```bash
curl 'https://links.example.com/api/admin/links?page=1&pageSize=25&active=all' \
  -H 'x-api-key: sl_your_key_here'
```

Update a link:

```bash
curl -X PATCH https://links.example.com/api/admin/links/<id> \
  -H 'content-type: application/json' \
  -H 'x-api-key: sl_your_key_here' \
  -d '{"targetUrl":"https://example.com/new-pricing"}'
```

## Manage your sessions

Open **Profile → Sessions** to see every active session signed in with your passkey. From there you can:

- **Revoke one** — sign out a specific device.
- **Revoke others** — keep the current session, sign out everywhere else.
- **Sign out current** — end this session.

## Tips

- Keep the default redirect status as `302` unless you have a specific reason to use `301` or `308`. Permanent redirects are aggressively cached by browsers and are hard to undo.
- For host-agnostic short links, only use the default-host fallback. For brand-specific links, always pick a hostname when creating.
- Rotate API keys periodically. Use one key per integration so revocation is targeted.
- Inactive links keep their slug reserved — re-enable instead of recreating if you want to keep history.
