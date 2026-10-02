import { createRequire } from "node:module";
import type { ProviderInfo } from "@/lib/types";
import { dropboxProvider } from "./dropbox";
import { googleDriveProvider } from "./google-drive";
import { githubProvider } from "./github";
import { oneDriveProvider } from "./onedrive";
import type { StorageProvider } from "./types";

const providers = new Map<string, StorageProvider>();
const PROVIDER_ID_RE = /^[a-z][a-z0-9-]{1,62}$/;
const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function registerProvider(provider: StorageProvider): void {
  if (!PROVIDER_ID_RE.test(provider.id)) throw new Error(`Storage provider ID "${provider.id}" is invalid`);
  if (providers.has(provider.id)) throw new Error(`Storage provider "${provider.id}" is already registered`);
  providers.set(provider.id, provider);
}

export function getProvider(id: string): StorageProvider | null {
  return providers.get(id) ?? null;
}

export function getAllProviders(): ProviderInfo[] {
  return [...providers.values()].map(({ id, displayName, icon, maxFileBytes, uploadMode, destinationFields }) => ({
    id,
    displayName,
    icon,
    maxFileBytes,
    uploadMode,
    ...(destinationFields?.length ? { destinationFields } : {}),
  }));
}

function pluginProviders(value: unknown): StorageProvider[] {
  const exportsValue = value as { default?: unknown; provider?: unknown; providers?: unknown };
  const exported = exportsValue.providers ?? exportsValue.provider ?? exportsValue.default ?? exportsValue;
  const list = Array.isArray(exported) ? exported : [exported];
  if (!list.length || list.some((provider) => !provider || typeof provider !== "object")) {
    throw new Error("must export a provider or providers array");
  }
  return list as StorageProvider[];
}

/**
 * Load trusted, operator-installed CommonJS provider packages. The environment
 * variable is intentionally deployment-only: allowing a signed-in user to name
 * a module would be arbitrary code execution on the server.
 */
function loadOperatorProviders() {
  const configured = process.env.LINK_TO_CLOUD_PROVIDER_MODULES?.trim();
  if (!configured) return;
  const requireFromApp = createRequire(`${process.cwd()}/package.json`);
  for (const packageName of configured.split(",").map((value) => value.trim()).filter(Boolean)) {
    if (!PACKAGE_NAME_RE.test(packageName)) {
      throw new Error(`Invalid provider module name "${packageName}"; only installed package names are allowed`);
    }
    let loaded: unknown;
    try {
      loaded = requireFromApp(packageName);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      throw new Error(`Could not load provider module "${packageName}": ${message}`);
    }
    for (const provider of pluginProviders(loaded)) registerProvider(provider);
  }
}

registerProvider(githubProvider);
registerProvider(googleDriveProvider);
registerProvider(oneDriveProvider);
registerProvider(dropboxProvider);
loadOperatorProviders();
