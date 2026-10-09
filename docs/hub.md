# DataWalk Hub

The hub is an optional, self-hosted server for sharing reports inside an organization. It is
a separate package (`datawalk-hub`) and a Docker image. The `datawalk` library never needs
it: every other feature works offline without it.

## Run the hub

```bash
docker build -f packages/hub/Dockerfile -t datawalk-hub .
docker run -p 8800:8800 -v hub-data:/data \
  -e HUB_BASE_URL=https://hub.example.internal \
  -e HUB_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  -e HUB_SECRET_KEY="$(openssl rand -base64 32)" \
  datawalk-hub
docker exec -it <container> datawalk-hub create-user admin@example.org --admin --sso-only
```

`--sso-only` creates the account without a password: the first sign-in through single
sign-on with this e-mail address opens it. Leave out `--sso-only` for a password account
(local sign-in).

Put a reverse proxy with HTTPS in front of the hub. Keep `HUB_ENCRYPTION_KEY` in a secret
store, not on the data volume. Without the variable, the hub writes a key file into the data
directory and shows a warning on the Administration page (development only).

Without Docker: `pip install ./packages/hub`, then `datawalk-hub serve --host 0.0.0.0`.

| Variable | Meaning |
|---|---|
| `HUB_BASE_URL` | The public address. Sign-in callbacks and links use it. `https://` turns on secure cookies |
| `HUB_DATA_DIR` | Database and encrypted archives (Docker: `/data`) |
| `HUB_ENCRYPTION_KEY` | 32 bytes, base64: AES-256-GCM key for archives and comments |
| `HUB_SECRET_KEY` | Signs the short-lived sign-in state of OIDC and SAML |
| `HUB_LOCAL_ACCOUNTS` | `0` turns off password sign-in (SSO only) |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_NAME` | OpenID Connect sign-in |
| `SAML_IDP_ENTITY_ID`, `SAML_IDP_SSO_URL`, `SAML_IDP_CERT_FILE`, `SAML_SP_ENTITY_ID`, `SAML_NAME` | SAML 2.0 sign-in |

## Sign-in

- **OIDC** (Microsoft Entra ID, Okta, Google, Keycloak, ...): authorization code flow with
  PKCE. Register the redirect URI `<HUB_BASE_URL>/sso/oidc/callback`.
- **SAML 2.0**: HTTP-Redirect request, HTTP-POST response. Give the identity provider the
  metadata at `<HUB_BASE_URL>/saml/metadata`. The hub checks the signature with the identity
  provider's certificate, and reads only the signed part. It checks the issuer, the audience,
  the recipient, the validity time, and the request id. One signed assertion signs in once
  (the hub remembers assertion ids, also when the response is encoded differently).
- **Local accounts** for small teams: passwords with 12 or more characters, stored as scrypt
  hashes.
- Multi-factor authentication is the identity provider's task.

**Accounts and single sign-on.** The first SSO sign-in creates an account with the e-mail
address from the identity provider, or opens an account that an administrator created with
`--sso-only`. An e-mail address alone never opens an account that has a password: its owner
signs in with the password and selects **Connect** under **Single sign-on** on the
**Account** page. The hub does not use an OIDC e-mail address that the identity provider
marks as not verified (`email_verified: false`).

## Publish and pull

Create an API token on the **Account** page. Then:

```bash
export DATAWALK_HUB=https://hub.example.internal   # or give --hub to each command
export DATAWALK_HUB_TOKEN=dwh_...
datawalk publish report.dwk
datawalk pull <report id> -o report.dwk
```

The commands send the token and the report only over HTTPS (`http://` only for
`localhost` and `127.0.0.1`).

The first publish creates the report; the publisher is its owner. The report id is the id
in the `.dwk` file, so a later publish of the same report adds a revision. Owners and
editors publish revisions. `pull` gives editors the latest revision with its presentation
edits (see the CI recipe in [governance.md](governance.md)).

## Permissions and links

| Role | Can |
|---|---|
| Viewer | Open the report, comment, ask questions, download attached datasets |
| Editor | Also: publish revisions, export offline copies (with the export review), present live, pull |
| Owner | Also: share, create links, see the audit log of the report, delete the report |

Give a role to a user (by e-mail) or a group, per report. Administrators manage users,
groups, and settings, and have every role.

- **Share links** need sign-in by default. Revoke a link at any time. A link can expire.
- **Public links** (no sign-in) are off by default. An administrator turns them on and sets
  their longest life (they always expire). A classification label can forbid them.

## Revisions

Every publish creates a revision. The report page shows, for each revision, what changed
since the revision before: added, removed, and updated charts, and the change of every KPI
(for example "Revenue: 10 → 12.5 (+2.5 EUR)"). `/r/<id>/v/<n>/` opens an earlier revision.

## Comments, mentions, and questions

Comments are threads on a chart (the inspector's **Comments and questions** section). Write
`@person@example.org` to mention a person who has access; the hub lists the mention on their
home page. The author, editors, and owners can resolve a thread. Questions from live
meetings are comments of the kind "question".

## Audit log

The hub records sign-ins (also failed ones), views, publishes, downloads, exports,
permission and link changes, setting changes, and deletions. Owners download the log of their
report (CSV); administrators download the complete log (CSV, or JSON from `GET /api/audit`).

## Data handling

- **Encryption at rest:** report archives and comment text use AES-256-GCM with a key per
  installation. The authenticated context binds each value to its record. Put the database
  (names, permissions, audit log) on an encrypted volume too.
- **Retention:** keep at most N revisions, or delete revisions older than N days. The latest
  revision always stays. The hub records each deletion in the audit log.
- **Deletion on request:** an owner deletes a report with all its revisions, comments, links,
  and permissions. The audit log keeps the record of the deletion.

## Embedding

An administrator adds the sites that may embed reports (for example
`https://contoso.sharepoint.com`, `https://teams.microsoft.com`). Then use:

```html
<iframe src="https://hub.example.internal/r/<id>/" width="1280" height="720" allow="fullscreen"></iframe>
```

The hub then sends cross-site session cookies (HTTPS only). When the frame has no session,
the viewer shows **Sign in**; the sign-in opens in a popup window, because identity providers
do not show their pages in frames.

## View analytics

Off by default. When an administrator turns them on, the hub counts views per chart and day
(no person data), owners and editors see the counts on the report page, and every viewer sees
the notice "This hub counts views per chart (no personal data)."

## Live follow

See [presenting.md](presenting.md#live-follow-needs-the-hub).
