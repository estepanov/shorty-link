# Security Policy

## Supported Versions

Shorty Link is in preview before `1.0.0`.

Security fixes target the latest release. Backports to earlier releases may be made when practical and when users are known to be affected.

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability.

Report security issues through GitHub private vulnerability reporting if it is enabled for the repository. If private reporting is unavailable, contact the maintainer privately through the repository owner's published contact channel.

Include:

- affected version or commit
- deployment context
- steps to reproduce
- impact
- any relevant logs or request examples with secrets removed

## Security-Sensitive Areas

Pay special attention to:

- Better Auth session handling
- passkey onboarding and invites
- API key authentication
- redirect target validation
- hostname and slug normalization
- D1 migrations that affect auth or link ownership
- analytics data collection

Do not commit secrets, production D1 database IDs for private deployments, API tokens, or `.dev.vars`.
