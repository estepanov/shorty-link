# Contributing

Thanks for helping improve Shorty Link.

## Development

Install dependencies:

```bash
pnpm install
```

Run the local app:

```bash
pnpm dev
```

Before opening a PR:

```bash
pnpm verify
```

## Project Shape

Shorty Link is one deployable Cloudflare Worker. Keep routing, admin UI, redirects, auth, and D1 schema in this repo.

Do not reintroduce old split app or package boundaries such as `apps/admin`, `apps/redirector`, or `packages/core`.

## Code Guidelines

- Use pnpm.
- Keep Tailwind enabled.
- Keep password login and password signup disabled.
- Use TanStack Form for admin forms.
- Use Eden for admin API calls where possible.
- Use Elysia `t` validation for API inputs.
- Keep admin API routes under `/api/admin/*`.
- Preserve redirect lookup order: exact hostname plus slug first, default hostname fallback second.
- Keep redirect writes in `waitUntil`.
- Avoid request-scoped globals.

## Migrations

After public releases begin, D1 migrations are append-only.

- Do not edit migrations that shipped in a tagged release.
- Add a new migration for every schema change.
- Run migration generation checks before submitting schema changes.
- Call out operator impact in the PR description.

## Commit Messages

Use Conventional Commits:

```text
feat: add bulk link import
fix: preserve redirect fallback behavior
docs: clarify D1 setup
chore: bump wrangler
feat!: change auth configuration
```

Breaking changes must use `!` or a `BREAKING CHANGE:` footer.
