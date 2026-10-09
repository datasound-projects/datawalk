# Security policy

## Report a vulnerability

Do not open a public issue for a security problem. Use
[private vulnerability reporting](https://github.com/datasound-projects/datawalk/security/advisories/new)
on GitHub. Describe the problem, the affected version, and the steps to reproduce it.

You get an answer within 7 days. When the problem is confirmed, we fix it, publish a
release, and credit you in the advisory (unless you prefer not).

## Supported versions

| Version | Security fixes |
|---|---|
| 0.1.x (alpha) | Yes |

## How DataWalk protects your data

- No cloud service and no AI service. The local viewer listens on `127.0.0.1` only.
- Every export shows a review of what leaves your computer before anything is written.
- Exported HTML files make no network requests (a strict Content-Security-Policy).
- Reports from other people cannot run code: DataWalk removes JavaScript from charts and
  cleans SVG images.
- The hub encrypts reports and comments at rest, checks every request, and keeps an audit
  log. See [docs/hub.md](docs/hub.md) and [docs/architecture.md](docs/architecture.md#security).
