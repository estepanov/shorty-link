# Upgrading

Use released Git tags for self-hosted deployments. Avoid upgrading production from an arbitrary commit on `main`.

## Standard Fork Upgrade

For production forks, keep your deployment config on your own branch and merge the upstream release tag into it. Replace `v0.1.0` with the target release:

```bash
git remote add upstream git@github.com:estepanov/shorty-link.git
git fetch --tags upstream
git checkout main
git merge --ff-only v0.1.0
pnpm install --frozen-lockfile
pnpm verify
pnpm db:migrate:remote
pnpm deploy
```

If your fork uses `origin` for upstream, use `origin` instead of `upstream`. If your deployment branch has local commits, use your normal merge or rebase workflow instead of `--ff-only`.

## Before Applying Migrations

Read the GitHub release notes for the target version before running remote migrations. The notes should state:

- whether D1 migrations are required
- whether configuration or Cloudflare bindings changed
- whether any manual steps are needed
- whether the release contains breaking changes

For production databases, export or otherwise back up the D1 database before applying risky migrations.

## Configuration Changes

If a release changes `wrangler.jsonc`, compare your fork carefully. Self-hosters usually customize:

- `name`
- `d1_databases[0].database_name`
- `d1_databases[0].database_id`
- `vars.BETTER_AUTH_ALLOWED_HOSTS`
- `vars.BETTER_AUTH_FALLBACK_URL`
- `vars.PASSKEY_RP_NAME`
- `vars.PASSKEY_RP_ID`

Do not overwrite your production values when pulling upstream changes.

## Database Migration Policy

After public releases begin, migrations are append-only. If you are upgrading from a tagged release, apply all later migrations in order with:

```bash
pnpm db:migrate:remote
```

Fresh installs apply the same migration history from the beginning.

## Rollback Expectations

Worker code can usually be rolled back by checking out the previous tag and redeploying.

Database migrations are not automatically reversible. If a migration is risky, the release notes should include explicit backup or manual rollback guidance.
