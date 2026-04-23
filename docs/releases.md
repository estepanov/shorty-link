# Release Policy

Shorty Link is versioned as one deployable application: the Worker code, admin UI, Cloudflare binding shape, and D1 schema move together.

## Version Source

The application version lives in `package.json` and is released as a Git tag named `vX.Y.Z`.

Use tagged releases for self-hosted deployments. `main` is the development branch and can contain unreleased changes.

## Semantic Versioning

Shorty Link uses Semantic Versioning for public releases.

- `PATCH`: bug fixes, documentation fixes, safe dependency updates, and internal changes that do not require database or configuration changes.
- `MINOR`: new backwards-compatible features, additive D1 migrations, new optional configuration, and non-breaking UI/API additions.
- `MAJOR`: breaking configuration changes, required Cloudflare binding changes, destructive or manual migrations, redirect behavior changes, auth/session contract changes, or admin API removals.

Before `1.0.0`, minor releases may contain breaking changes while the project stabilizes. Those changes must still be called out in release notes.

## Database Migrations

D1 migrations are part of the release contract.

- After the first public release, committed migrations are append-only.
- Do not edit or delete a migration that may have shipped in a tagged release.
- Every schema change must include a new migration.
- Every release note must say whether a remote database migration is required.
- Risky migrations need explicit backup and rollback notes.

The first migration creates the full schema for fresh installs. Later migrations describe upgrades from older released versions.

## Cloudflare Bindings

Cloudflare bindings and Wrangler variables are part of the operator contract.

Any release that changes `wrangler.jsonc`, binding names, required vars, compatibility flags, or required secrets must include an upgrade note. Required binding changes are breaking after `1.0.0`.

After Wrangler binding changes, run:

```bash
pnpm cf-typegen
```

## Release Process

Releases are managed by Release Please.

1. Merge Conventional Commit PRs into `main`.
2. Release Please opens or updates a release PR.
3. Review the generated changelog and version bump.
4. Ensure release notes include database, config, and operator impact.
5. Merge the release PR.
6. Release Please creates the GitHub release and `vX.Y.Z` tag.

Before manually cutting any release, run:

```bash
pnpm verify
```

## Commit Format

Use Conventional Commits:

```text
feat: add bulk link import
fix: preserve hostname fallback redirect behavior
docs: clarify D1 setup
chore: bump wrangler
feat!: change API key permission model
```

Use `!` or a `BREAKING CHANGE:` footer for breaking changes.
