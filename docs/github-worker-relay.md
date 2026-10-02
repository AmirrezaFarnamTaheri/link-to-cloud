# GitHub self-hosted worker relay

This relay runs as a persistent service on a machine that is also registered as a GitHub Actions self-hosted runner. GitHub Actions is the deployment/control plane; the file bytes are served by the Dockerized worker process on your own host, not by a GitHub-hosted runner.

## Why it is implemented this way

GitHub's Actions terms prohibit using Actions as a content delivery network or as part of a serverless application. A workflow job that stays alive to proxy arbitrary user downloads would therefore be the wrong runtime model. The self-hosted worker keeps the GitHub Actions integration while moving the long-lived relay process and bandwidth to infrastructure you control.

## Runtime invariants

- The public endpoint is `https://<GITHUB_RELAY_DOMAIN>/relay`.
- Every POST requires `Authorization: Bearer <RELAY_SHARED_SECRET>`.
- Control JSON is bounded while streaming; `Content-Length` is never trusted as the only size control.
- Only HTTP(S) sources without embedded credentials are accepted.
- Every DNS result must be public. DNS is pinned into the outbound socket lookup to prevent rebinding between validation and connect.
- Redirects are manual. Caller-provided source headers are sent only to the original origin.
- `Accept-Encoding` is controlled by the relay and forced to `identity`, preserving byte/count semantics.
- Source response bodies are streamed through the worker and Caddy without staging files on disk.

## Host prerequisites

The relay host must:

1. Be registered as a GitHub Actions self-hosted runner with these labels:
   - `self-hosted`
   - `linux`
   - `link-to-cloud-relay`
2. Have Docker Engine and Docker Compose v2 available to the runner user.
3. Have `curl` available for deployment health validation.
4. Allow inbound TCP 80 and 443 and inbound UDP 443 if HTTP/3 is desired.
5. Have a public DNS A/AAAA record for the relay domain pointing at the host.
6. Permit the runner user to manage Docker.

Caddy in `relay/github/compose.yml` obtains and renews the TLS certificate automatically, so the main application can keep its production rule that `RELAY_URL` must use HTTPS.

## Repository configuration

Create this repository secret:

- `RELAY_SHARED_SECRET`: a random value of at least 32 characters. Use the exact same value in the Link-to-Cloud application.

Create this repository Actions variable:

- `GITHUB_RELAY_DOMAIN`: only the public hostname, for example `relay.example.com`. Do not include `https://` or a path.

Then run **Deploy source relays** and choose `github` or `all`.

The workflow writes the shared secret to `~/.config/link-to-cloud/relay-shared-secret` on the self-hosted machine with owner-only permissions and exposes it to the worker through a Docker secret mount. The secret is not baked into the image.

## Main application configuration

Set:

```env
RELAY_URL=https://relay.example.com/relay
RELAY_SHARED_SECRET=<same value as the repository secret>
```

A GET to the relay endpoint is a non-sensitive health probe:

```sh
curl https://relay.example.com/relay
```

Expected response:

```json
{"ok":true,"relay":"github-self-hosted-worker"}
```

## Deployment layout

`relay/github/worker.mjs`
: Node HTTP relay engine with public-address validation, DNS pinning, redirect isolation, body streaming, and bounded control parsing.

`relay/github/Dockerfile`
: Minimal Node 22 image containing only the relay runtime files.

`relay/github/compose.yml`
: Runs the worker read-only with dropped Linux capabilities and Caddy as the public TLS reverse proxy.

`relay/github/Caddyfile`
: Streaming reverse proxy configuration for the authenticated relay endpoint.

`.github/workflows/deploy-relays.yml`
: Builds/restarts the service on the labeled self-hosted runner and fails deployment if the public HTTPS health check does not become ready.

## Rollback

On the relay host, check the current service first:

```sh
cd /path/to/the/self-hosted-runner/workspace
export RELAY_DOMAIN=relay.example.com
export RELAY_SHARED_SECRET_FILE="$HOME/.config/link-to-cloud/relay-shared-secret"
docker compose --project-name link-to-cloud-github-relay --file relay/github/compose.yml ps
```

To roll back code, check out the previously known-good repository commit on the runner workspace and run the same Compose `up --detach --build` command used by the workflow. Caddy certificate state lives in named Docker volumes and is preserved across worker image rollbacks.

## Operational boundary

Do not change the workflow to run the relay itself on `ubuntu-latest`, upload user file bodies as Actions artifacts, or publish them through GitHub Pages/Releases. Those designs turn GitHub-hosted Actions/storage into application data-plane infrastructure instead of using Actions for deployment and verification.
