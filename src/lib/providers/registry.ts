import type { ProviderInfo, TransferTarget } from "@/lib/types";
import { googleDriveProvider } from "./google-drive";
import { githubProvider } from "./github";
import type { StorageProvider } from "./types";

const providers = new Map<TransferTarget, StorageProvider>();

export function registerProvider(provider: StorageProvider): void {
  if (providers.has(provider.id)) throw new Error(`Storage provider "${provider.id}" is already registered`);
  providers.set(provider.id, provider);
}

export function getProvider(id: string): StorageProvider | null {
  return providers.get(id as TransferTarget) ?? null;
}

export function getAllProviders(): ProviderInfo[] {
  return [...providers.values()].map(({ id, displayName, icon, maxFileBytes, uploadMode }) => ({
    id,
    displayName,
    icon,
    maxFileBytes,
    uploadMode,
  }));
}

registerProvider(githubProvider);
registerProvider(googleDriveProvider);
