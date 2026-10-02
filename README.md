# Link-to-Cloud

A Next.js service that fetches a public HTTP(S) URL from the server and transfers the response into the signed-in user's GitHub repository or Google Drive. The browser sends transfer instructions and receives progress events; it does not receive the file body.

## Data path and internet usage

```text
Browser -- URL/options --> Link-to-Cloud server -- GET --> source host
Browser <-- progress events -- Link-to-Cloud server -- upload --> GitHub or Google Drive
```

Where the server runs determines whose connection carries the file:

- **Hosted remotely:** your computer or phone exchanges control and progress traffic with the app, not the file contents. The deployed server fetches the source and uploads to the destination. Its bandwidth, egress charges, request timeouts, and provider quotas apply.
- **Run on `localhost`:** your computer is also the server. It receives the file from the source and sends it to the destination, so both legs use your own internet connection. For Google Drive this is roughly one file's worth of download plus one file's worth of upload if your ISP counts both directions. Actual usage varies with retries, protocol overhead, and ISP accounting.
- **No persistent file copy:** the transfer code does not write payloads to disk. This does **not** mean zero server memory use: GitHub requires a buffered payload, while Drive uses bounded chunks. A local run still consumes local bandwidth even when it leaves no file on disk.

The app emits periodic progress events, so browser control traffic is small relative to a file transfer but is not a fixed number of kilobytes. Source URLs and redirects are checked against public addresses (including reserved and documentation ranges), and each HTTP request is pinned to the validated DNS result to prevent a rebinding hostname from reaching internal services.

## Destination transfer behavior

| Destination | Upload method | Resource / size behavior |
| --- | --- | --- |
| **Google Drive** | Resumable upload in chunks of up to 8 MiB; unknown source lengths are supported. Chunk requests use Drive's 256 KiB alignment rules and can query the resumable session after an interrupted request. | Backpressure is preserved: Relay reads another source chunk after Drive acknowledges the current one. No file is written to disk; application buffering is bounded to one upload chunk plus normal network/runtime buffers. Google and hosting limits still apply. |
| **GitHub** | GitHub Contents API commit. | The Contents API requires the complete base64 file payload, so Relay buffers each file in server memory and creates an expanded JSON payload. The implementation rejects files over 100 MiB; GitHub warns for files above 50 MiB. Prefer Drive for large files and avoid concurrent large GitHub transfers. When `skip` finds an existing file, Relay cancels the source before reading its body; the known size is recorded if available, and no SHA-256 is produced for that skipped file. |

The server allows at most one active GitHub transfer and two active Drive transfers per Node process; excess requests receive `503` with `Retry-After`. These are per-process limits, so also set service concurrency and maximum instances when deploying multiple containers. The in-memory rate limiter is likewise per process and bounded to 5,000 recent keys. By default it uses the rightmost syntactically valid `X-Forwarded-For` address as a best-effort bucket. This is trustworthy only when your ingress controls or appends the header and direct access cannot bypass that ingress; depending on the proxy chain, the value may identify a shared proxy rather than an individual client. Optionally set `CLIENT_IP_HEADER` to a single-IP header that your trusted ingress overwrites, and block direct access that could spoof it. A configured but missing or invalid value, or a request without a valid default XFF value, maps to one `unknown` bucket. Neither source is an identity or authorization signal. Use an external rate-limit store for global quotas across instances. The 100 MiB GitHub limit reflects GitHub's regular repository file limit, not a generic transfer or browser request-body limit. See [GitHub's large-file documentation](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github) and [Google Drive's upload guide](https://developers.google.com/workspace/drive/api/guides/manage-uploads).

## Run locally

Requirements: Node.js 22, npm, and PostgreSQL.

```sh
npm ci
cp .env.example .env.local
# Start PostgreSQL and set DATABASE_URL in .env.local.
npm run dev
```

The app listens on `0.0.0.0:3000`. Transfer history and `/api/health` use PostgreSQL; the history table and index are created idempotently on first use, so the configured database role needs the corresponding DDL permissions. History stores transfer metadata and the result link; source URL credentials, query strings, and fragments are stripped before persistence. The UI returns the most recent 40 rows across connected accounts. Rows remain until cleared for their owner key; there is no automatic retention period. New sessions scope history to immutable provider IDs, while only legacy sessions without those IDs use old login/email keys, avoiding cross-account matches on names that can change or be reused. After a legacy session is upgraded, its old-key rows are not automatically linked and may require database cleanup. GitHub and Google OAuth are optional for development, but provider credentials are required to transfer. GitHub personal access token login is also available.

For OAuth, register these callback URLs for the origin where the app runs:

- GitHub: `https://YOUR_HOST/api/auth/github/callback`
- Google: `https://YOUR_HOST/api/auth/google/callback`

Use `http://localhost:3000` for local development. Google OAuth uses the narrow `drive.file` scope. The GitHub OAuth flow uses the existing `repo` scope; the app does not request the `workflow` scope.

### Environment

- `DATABASE_URL` — PostgreSQL connection string; required by the app.
- `APP_ORIGIN` — canonical origin (scheme and host only) for OAuth callbacks and browser mutation checks. Required in production and must be your HTTPS public origin; the app does not derive it from forwarded/host headers. Use `http://localhost:3000` for local development.
- `CLIENT_IP_HEADER` — optional single-IP header supplied by a trusted ingress for rate-limit bucketing. Set it only if the ingress overwrites the header and direct access cannot bypass the proxy; otherwise leave it unset.
- `SESSION_SECRET` — unique random secret, at least 32 bytes in production. Generate one with `openssl rand -base64 48`. Production sessions do not fall back to OAuth client secrets or a development key.
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — optional GitHub OAuth app credentials.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — optional Google OAuth web client credentials.

The session is AES-GCM sealed in an `httpOnly`, `SameSite=Lax` cookie. State-changing JSON routes require same-origin requests and bounded request bodies. Production cookies are marked `Secure`; serve the app over HTTPS. Keep `.env.local` and all deployment secrets out of source control.

## Deploy as a container

The repository includes a multi-stage `Dockerfile`; it builds Next.js in standalone mode and runs as a non-root user. Supply runtime secrets through your platform's secret manager rather than baking them into the image.

```sh
docker build -t link-to-cloud .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL='postgresql://USER:PASSWORD@DB_HOST:5432/DB_NAME' \
  -e APP_ORIGIN='https://YOUR_PUBLIC_HOST' \
  -e SESSION_SECRET='REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_BYTES' \
  -e GITHUB_CLIENT_ID='...' -e GITHUB_CLIENT_SECRET='...' \
  -e GOOGLE_CLIENT_ID='...' -e GOOGLE_CLIENT_SECRET='...' \
  link-to-cloud
```

A reachable PostgreSQL database is required. Configure OAuth redirect URLs to match the public HTTPS hostname. The health check includes PostgreSQL connectivity.

### Cloud Run example

Cloud Run is a suitable container host for this request-bound streaming design. Its service request timeout defaults to 5 minutes and can be configured up to 60 minutes; configure the timeout and concurrency to fit your expected transfer sizes, memory budget, and costs. The 100 MiB GitHub route creates a base64 payload and expanded JSON in memory, so 512 MiB instances may be too small; an isolated Node 22 reproduction of the optimized 100 MiB buffering/encoding path reached about 460 MiB RSS before the Next.js service and database runtime are included. The example starts at 1 GiB with concurrency 1. Load-test at the largest intended file size and raise the memory limit if measured peak RSS requires it. This app does not turn transfers into background jobs: the request and browser connection remain open until completion or cancellation. Cloud Run documents that a timed-out request closes its network connection without terminating the container; ensure the platform propagates cancellation, and do not treat a long timeout as durable resumption. Drive can recover an interrupted chunk during the same request, but transfer checkpoints are not persisted for a later request.

After configuring a Cloud Run service account, Artifact Registry/build, PostgreSQL network access, and Secret Manager bindings, a deployment can use settings like:

```sh
gcloud run deploy link-to-cloud \
  --source . \
  --region REGION \
  --port 3000 \
  --timeout 3500s \
  --memory 1Gi \
  --concurrency 1 \
  --max 3 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,APP_ORIGIN=https://YOUR_PUBLIC_HOST \
  --set-secrets DATABASE_URL=link-to-cloud-database-url:latest,SESSION_SECRET=link-to-cloud-session-secret:latest
```

Use your actual secret names, region, and canonical HTTPS origin; register that same origin's callback URLs with GitHub and Google. If using Cloud Run's generated hostname, deploy once to learn it, then set `APP_ORIGIN` and the OAuth callback URLs to that hostname. Add the GitHub and Google OAuth secrets to `--set-secrets` only when enabling those sign-in methods. `--allow-unauthenticated` is appropriate only when the app itself is meant to be publicly reachable; otherwise require identity at the platform boundary. Restrict maximum instances and concurrency to control spend and memory. See [Cloud Run request timeouts](https://cloud.google.com/run/docs/configuring/request-timeout).

### Vercel

Vercel can run the Node route for transfers that fit the configured function duration. This repository declares `maxDuration = 300` for `/api/transfer`, so five minutes is this route's current cap unless it is deliberately changed; the selected Vercel plan's limits still apply. Vercel's 4.5 MB function request/response payload limit is not the file-size limit here: the browser sends bounded control data and receives progress events, while the function fetches the source file and uploads it to the destination. Invocation duration—including streamed response time—and the browser/streaming lifecycle still constrain a transfer. See [Vercel Function limits](https://vercel.com/docs/functions/limitations).

### Cloudflare Workers

Cloudflare Workers is not a drop-in deployment target. Workers currently have 128 MB of memory per isolate; the app's possible GitHub buffer and base64 encoding alone need a design review against that budget. Workers' incoming request-body limits are account-plan limits (currently 100 MB on Free and Pro, 200 MB on Business, and up to 5 GB on Enterprise), but they do not describe this app's source-file size: the browser sends only control data and the server fetches the source file outbound. HTTP Workers have no hard wall-clock limit while the client stays connected, but client disconnects, CPU limits (10 ms on Free; paid plans default to 30 seconds and can be configured up to five minutes), subrequests, and streaming behavior still matter.

A port must preserve the current SSRF protections and data model. This implementation resolves DNS with Node APIs, uses an Undici dispatcher pinned to a validated address for outbound requests, and uses PostgreSQL. It would require a deliberately designed Workers-compatible DNS/connection-pinning strategy and PostgreSQL connection approach—not merely a build-target change. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/); do not treat an edge Worker as an unrestricted raw-file proxy.

### AWS Lambda and other hosts

A regular synchronous AWS Lambda invocation has a maximum configured timeout of 900 seconds (15 minutes), so it is still a request-bound deployment rather than a durable transfer worker. The app does not use Lambda's `/tmp` storage (which AWS configures from 512 MB to 10,240 MB), and it does not rely on staging a file there. A Lambda deployment would need a suitable Next.js adapter, tested response streaming and cancellation through the chosen ingress, and a PostgreSQL connection strategy; validate the specific runtime and proxy instead of assuming Node streaming carries over unchanged. See [Lambda timeouts](https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html) and [Lambda ephemeral storage](https://docs.aws.amazon.com/lambda/latest/dg/configuration-ephemeral-storage.html).

Railway, Render, Fly.io, and VPS/container hosts can also work when their ingress timeouts, outbound networking, memory, database access, and bandwidth/egress pricing are configured and tested for the workload. None should be assumed to provide unlimited request time or free bandwidth.

## Provider adapters

The server has a **compile-time** provider registry (`src/lib/providers/registry.ts`) with working GitHub and Google Drive adapters. It is an imported, application-owned adapter list, not a runtime-installable plugin system. `GET /api/providers` exposes public descriptors, and the destination selector uses that registry rather than maintaining a second list of labels. Provider-specific OAuth routes and destination forms remain explicit because authentication scopes, folder/repository semantics, and upload protocols differ.

Adding a real destination requires a provider ID and request types, request validation, credential resolution, an account/OAuth flow where needed, destination UI, a complete upload adapter, and unit/integration tests. No OneDrive, Dropbox, S3, or Rclone adapter is registered or implied; choose and configure the first additional provider before implementing one. Rclone is not bundled: supporting it would require isolated credentials/configuration, restricted operations, subprocess lifecycle and cancellation controls, packaging, and backend tests. A command that first downloads a file to `/tmp` before invoking Rclone stages the complete file, so it is neither disk-free nor streaming.

## GitHub Actions relay and desktop installers

The GitHub Actions relay described in the proposal is deliberately **not implemented**. The current OAuth scope is not broadened, no user-controlled workflow-dispatch endpoint is exposed, and no arbitrary file-transfer workflow is shipped or dispatched. The proposed shell-workflow pattern is unsafe as a relay: interpolating user input into shell source can permit command injection, workflow credentials can be exposed, and downloading a file to `/tmp` stages the complete payload instead of streaming it. Do not ship or dispatch that sample.

GitHub's current [Actions terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features) say GitHub-hosted runners must not be used for activity unrelated to production, testing, deployment, or publication of the associated software project. A general-purpose transfer relay is unrelated work and creates token/secret exposure and account-enforcement risks. Use a permitted long-running container/VPS or a purpose-built transfer service instead.

This repository is a web app, not an Electron/Tauri desktop app. It has no desktop runtime, installer configuration, local PostgreSQL bundle, or installer signing/release process. Therefore there is no tag-triggered installer workflow; running a wrapped local server would again route file traffic through the user's own internet connection. Add desktop packaging only as a separate product decision with a complete runtime and distribution design—the sample `electron-builder` invocation alone cannot produce valid installers here.

## Validation

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

The tests cover strict transfer-request validation and bounded/timed JSON bodies, same-origin configuration, bounded rate-limit state and trusted client-IP header selection, provider-profile identity and refresh-token continuity, token revocation without URL leakage, SSRF address filtering, provider registration/capacity and creation events, GitHub skip behavior and bounded buffering, Drive chunk boundaries, unknown and zero-byte sources, content-length mismatches, resumable recovery after an interrupted chunk, upload-session URL validation, source-body idle timeout/cancellation/no-prefetch behavior, and source-link cap/removal reporting. The CI workflow runs the checks on pushes and pull requests and builds the production container image.
