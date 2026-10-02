# Operator-installed storage provider modules

Link-to-Cloud can load a trusted provider package at server startup. This is an extension mechanism for the **deployment operator**, not a browser-facing marketplace: a package executes with the Node.js privileges of the application container. Never accept a package name, archive, source code, endpoint, or credential configuration from an ordinary signed-in user.

## Install and load a module

1. Package the adapter as a CommonJS package, or install it in the image alongside the application.
2. Make sure the package remains available in the standalone runtime image (`node_modules` or an explicitly mounted, trusted extension directory).
3. Set `LINK_TO_CLOUD_PROVIDER_MODULES` to a comma-separated list of package names, for example:

   ```sh
   LINK_TO_CLOUD_PROVIDER_MODULES=@acme/link-to-cloud-webdav,link-to-cloud-s3
   ```

Only package names are accepted; relative and absolute paths are rejected. A bad or missing configured package prevents startup instead of silently removing a destination.

A package may export `provider`, `providers`, or a default export. Each exported adapter implements the `StorageProvider` shape in `src/lib/providers/types.ts`.

```js
// index.cjs
const provider = {
  id: "acme-webdav",
  displayName: "Acme WebDAV",
  icon: "cloud",
  maxFileBytes: null,
  uploadMode: "chunked-stream",
  destinationFields: [
    { key: "folder", label: "Remote folder", placeholder: "uploads/2026", maxLength: 1024 },
  ],

  validateDestination(input) {
    if (typeof input.folder !== "string" || input.folder.length > 1024 || input.folder.includes("..")) {
      throw new Error("Invalid remote folder");
    }
    return { folder: input.folder.trim() };
  },

  async resolveCredentials(session) {
    // Resolve only credentials that belong to this signed-in user or to this
    // deployment. Do not trust data from destination fields as credentials.
    return null;
  },

  async uploadFile(context, credentials) {
    // `context.source.body` is the source stream. Preserve backpressure,
    // obey context.signal, bound memory, and return TransferDone metadata.
    throw new Error("Implement the adapter");
  },
};

module.exports = { provider };
```

The import path in the JSDoc example is illustrative. Plugin packages should compile against a versioned SDK/package contract published by the deployment owner, or use structural TypeScript declarations copied from the project. Do not couple a third-party plugin to unversioned internal paths without pinning the application version.

## Request and UI contract

The browser sends custom modules an envelope shaped like:

```json
{
  "target": "plugin:acme-webdav",
  "url": "https://public-source.example/file.iso",
  "destination": { "folder": "uploads/2026" }
}
```

The core validates the source URL, bounds the complete control request to 16 KiB, and allows only `url`, `target`, optional `filename`/`header`, and `destination` for plugin transfers. The adapter **must** validate every `destination` value before using it. It should reject traversal, control characters, unexpected keys, oversized strings, private-network endpoints, and values that would become shell arguments.

`destinationFields` is intentionally limited to declarative text inputs. It is not a way to inject HTML, JavaScript, shell commands, arbitrary HTTP endpoints, OAuth callbacks, or secrets into the UI. Plugins that need account linking should be shipped with a reviewed, application-owned OAuth/session integration; they must not ask users to paste long-lived destination credentials into a transfer request.

## Security and reliability requirements

A production adapter must:

- preserve the application's DNS-pinned SSRF checks for source downloads and independently validate any provider-generated upload URLs before following them;
- keep credentials out of URLs, logs, history, error messages, and browser control payloads;
- respect `context.signal`, cancel upstream work on disconnect, and use bounded buffers/backpressure rather than staging complete files on disk;
- bound upload retries and verify provider acknowledgements before advancing a streamed source;
- supply an immutable `owner` key from `resolveCredentials` so transfer history remains isolated by account;
- define per-process capacity appropriate to its memory and provider quotas, and add tests for malformed request data, cancellation, short/unknown sources, provider errors, and upload-session URL validation.

Do not use this mechanism to install Rclone wrappers or arbitrary command launchers. Running user-controlled subprocess arguments or loading user-controlled module code would turn a transfer service into a remote-code-execution service.
