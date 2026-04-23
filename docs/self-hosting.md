# Self-Hosting

Shorty Link is designed to be forked and deployed to your own Cloudflare account as one Worker.

## Requirements

- Cloudflare account
- Node.js 22
- pnpm 10
- Wrangler access to your Cloudflare account
- A Cloudflare D1 database
- One or more hostnames routed to the Worker

## Fresh Install

1. Fork the repository.
2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Create a D1 database:

   ```bash
   pnpm exec wrangler d1 create shorty-link
   ```

4. Edit `wrangler.jsonc`:

   - set your Worker `name`
   - optionally set your D1 `database_name`
   - set your D1 `database_id`
   - set `BETTER_AUTH_ALLOWED_HOSTS`
   - set `BETTER_AUTH_FALLBACK_URL`
   - set `PASSKEY_RP_NAME`
   - optionally set `PASSKEY_RP_ID`

   Keep binding names such as `DB` and `AI` unchanged. The committed config is a starter config, not the maintainer's private deployment config.

5. Set the auth secret:

   ```bash
   pnpm exec wrangler secret put BETTER_AUTH_SECRET
   ```

6. Apply D1 migrations:

   ```bash
   pnpm db:migrate:remote
   ```

7. Deploy:

   ```bash
   pnpm deploy
   ```

8. Open `/admin` on your deployed hostname and create the first admin with a passkey.

## Automated Deploys

The repository includes GitHub Actions for PR checks, D1 migrations, and Worker deployment.

Production migration and deploy workflows are opt-in on push to `main`. This keeps the public starter config from trying to deploy before a self-hoster has configured Cloudflare.

For deploy automation in your fork, add repository variable:

- `SHORTY_LINK_DEPLOY_ENABLED`: set to `true`

This variable is strictly for gating Github actions.

Then add repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Use a Cloudflare API token with the least privileges needed for Workers and D1 deployment.

If the variable is unset, the production migration and deploy jobs are skipped on push. Manual workflow runs remain available after your fork is configured.

## Custom Domains

Route each redirect hostname to the Worker using Cloudflare Worker custom domains or routes.

In the admin UI, create managed domain entries for host-specific links. Redirect lookup checks exact hostname plus slug first, then falls back to the default hostname entry.

## Production Notes

- Keep password login and password signup disabled.
- Use tagged releases for production.
- Read release notes before applying D1 migrations.
- Back up production D1 data before risky upgrades.
- Keep `BETTER_AUTH_SECRET` stable across deploys.
