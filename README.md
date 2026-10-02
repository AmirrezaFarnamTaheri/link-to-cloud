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

The app emits periodic progress events, so browser control traffic is small relative to a file transfer but is not a fixed number of kilobytes. Source URLs and redirects are checked against public addresses, and each HTTP request is pinned to the validated DNS result to prevent a rebinding hostname from reaching internal services.

## Destination transfer behavior

| Destination | Upload method | Resource / size behavior |
| --- | --- | --- |
| **Google Drive** | Resumable upload in chunks of up to 8 MiB; unknown source lengths are supported. Chunk requests use Drive's 256 KiB alignment rules and can query the resumable session after an interrupted request. | Backpressure is preserved: Relay reads another source chunk after Drive acknowledges the current one. No file is written to disk; application buffering is bounded to one upload chunk plus normal network/runtime buffers. Google and hosting limits still apply. |
| **GitHub** | GitHub Contents API commit. | The Contents API requires the complete base64 file payload, so Relay buffers each file in server memory and creates an expanded JSON payload. The implementation rejects files over 100 MiB; GitHub warns for files above 50 MiB. Prefer Drive for large files and avoid concurrent large GitHub transfers. |

The server allows at most one active GitHub transfer and two active Drive transfers per Node process; excess requests receive `503` with `Retry-After`. These are per-process limits, so also set service concurrency and maximum instances when deploying multiple containers. The 100 MiB GitHub limit reflects GitHub's regular repository file limit, not a generic transfer or browser request-body limit. See [GitHub's large-file documentation](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github) and [Google Drive's upload guide](https://developers.google.com/workspace/drive/api/guides/manage-uploads).

## Run locally

Requirements: Node.js 22, npm, and PostgreSQL.

```sh
npm ci
cp .env.example .env.local
# Start PostgreSQL and set DATABASE_URL in .env.local.
npm run dev
```

The app listens on `0.0.0.0:3000`. Transfer history and `/api/health` use PostgreSQL; the history table is created idempotently when first needed. GitHub and Google OAuth are optional for development, but provider credentials are required to transfer. GitHub personal access token login is also available.

For OAuth, register these callback URLs for the origin where the app runs:

- GitHub: `https://YOUR_HOST/api/auth/github/callback`
- Google: `https://YOUR_HOST/api/auth/google/callback`

Use `http://localhost:3000` for local development. Google OAuth uses the narrow `drive.file` scope. The GitHub OAuth flow uses the existing `repo` scope; the app does not request the `workflow` scope.

### Environment

- `DATABASE_URL` — PostgreSQL connection string; required by the app.
- `SESSION_SECRET` — unique random secret, at least 32 bytes in production. Generate one with `openssl rand -base64 48`. Production sessions do not fall back to OAuth client secrets or a development key.
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — optional GitHub OAuth app credentials.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — optional Google OAuth web client credentials.

The session is AES-GCM sealed in an `httpOnly`, `SameSite=Lax` cookie. Production cookies are marked `Secure`; serve the app over HTTPS. Keep `.env.local` and all deployment secrets out of source control.

## Deploy as a container

The repository includes a multi-stage `Dockerfile`; it builds Next.js in standalone mode and runs as a non-root user. Supply runtime secrets through your platform's secret manager rather than baking them into the image.

```sh
docker build -t link-to-cloud .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL='postgresql://USER:PASSWORD@DB_HOST:5432/DB_NAME' \
  -e SESSION_SECRET='REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_BYTES' \
  -e GITHUB_CLIENT_ID='...' -e GITHUB_CLIENT_SECRET='...' \
  -e GOOGLE_CLIENT_ID='...' -e GOOGLE_CLIENT_SECRET='...' \
  link-to-cloud
```

A reachable PostgreSQL database is required. Configure OAuth redirect URLs to match the public HTTPS hostname. The health check includes PostgreSQL connectivity.

### Cloud Run example

Cloud Run is a suitable container host for this request-bound streaming design. Its service request timeout defaults to 5 minutes and can be configured up to 60 minutes; configure the timeout and concurrency to fit your expected transfer sizes, memory budget, and costs. This app does not turn transfers into background jobs: the request and browser connection remain open until completion or cancellation.

After configuring a Cloud Run service account, Artifact Registry/build, PostgreSQL network access, and Secret Manager bindings, a deployment can use settings like:

```sh
gcloud run deploy link-to-cloud \
  --source . \
  --region REGION \
  --port 3000 \
  --timeout 3500s \
  --concurrency 1 \
  --max 3 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production \
  --set-secrets DATABASE_URL=link-to-cloud-database-url:latest,SESSION_SECRET=link-to-cloud-session-secret:latest
```

Use your actual secret names and region; add the GitHub and Google OAuth secrets to `--set-secrets` only when enabling those sign-in methods. `--allow-unauthenticated` is appropriate only when the app itself is meant to be publicly reachable; otherwise require identity at the platform boundary. Restrict maximum instances and concurrency to control spend and memory. See [Cloud Run request timeouts](https://cloud.google.com/run/docs/configuring/request-timeout).

Vercel can run the Node route for transfers that fit the configured function duration. This repository declares `maxDuration = 300` for `/api/transfer`; platform plan limits still apply. Vercel's 4.5 MB function request/response body limit concerns data crossing the function boundary: the file is fetched by the function and is not posted by the browser, so it is not the file-size limit for this app. The invocation-duration and streaming lifecycle are the relevant constraints. See [Vercel Function limits](https://vercel.com/docs/functions/limitations).

Cloudflare Workers is not a drop-in deployment target: this app uses the Node.js runtime, Node networking/DNS APIs, and PostgreSQL. Porting it would require a runtime/data-layer adaptation and a separate review of Workers' body, subrequest, CPU, and execution limits. Do not treat an edge Worker as an unrestricted raw-file proxy. Railway, Render, Fly.io, and VPS/container hosts can also work when their request timeouts, outbound networking, memory, database access, and bandwidth limits are configured for the workload.

## Provider adapters

The server has a provider registry (`src/lib/providers/registry.ts`) with working GitHub and Google Drive adapters. `GET /api/providers` exposes their public descriptors, and the destination selector uses that registry rather than maintaining a second list of labels. Provider-specific OAuth routes and destination forms remain explicit because authentication scopes, folder/repository semantics, and upload protocols differ.

To add a real destination, implement its credential resolution and complete streaming upload adapter, register it, extend the request validator and provider-specific UI/account flow, and add unit/integration tests. No OneDrive, Dropbox, S3, or Rclone adapter is registered or implied; choose and configure the first additional provider before implementing one.

## GitHub Actions relay and desktop installers

The GitHub Actions relay described in the proposal is deliberately **not implemented**. The current OAuth scope is not broadened, no user-controlled workflow dispatch endpoint is exposed, and no arbitrary file-transfer workflow is shipped. GitHub's current [Actions terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features) say GitHub-hosted runners must not be used for activity unrelated to production, testing, deployment, or publication of the associated software project. A general-purpose transfer relay is unrelated work and creates token/secret exposure and account-enforcement risks. Use a permitted long-running container/VPS or a purpose-built transfer service instead.

This repository is a web app, not an Electron/Tauri desktop app. It has no desktop runtime, installer configuration, local PostgreSQL bundle, or installer signing/release process. Therefore there is no tag-triggered installer workflow; running a wrapped local server would again route file traffic through the user's own internet connection. Add desktop packaging only as a separate product decision with a complete runtime and distribution design—the sample `electron-builder` invocation alone cannot produce valid installers here.

## Validation

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

The tests cover strict transfer-request validation, request-size limits, SSRF address filtering, provider registration/capacity, Drive chunk boundaries, unknown and zero-byte sources, content-length mismatches, resumable recovery after an interrupted chunk, upload-session URL validation, and source-fetch cancellation during body streaming. The CI workflow runs the same checks on pushes and pull requests.
