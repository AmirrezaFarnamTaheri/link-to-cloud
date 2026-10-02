import type { Session } from "@/lib/session";
import type { ProviderInfo, TransferDone, TransferEvent, TransferRequest } from "@/lib/types";

export type ProviderCredentials = {
  accessToken: string;
  /** Immutable account key used to isolate history across connected accounts. */
  owner: string;
};

export type ProviderTransferContext = {
  request: TransferRequest;
  source: Response;
  name: string;
  size: number | null;
  emit: (event: TransferEvent) => void;
  signal: AbortSignal;
};

/**
 * A trusted server-side storage adapter. Modules configured through
 * LINK_TO_CLOUD_PROVIDER_MODULES run with the deployment's Node privileges;
 * they are an operator extension point, never a browser-uploaded plugin API.
 */
export interface StorageProvider extends ProviderInfo {
  resolveCredentials(session: Session): Promise<ProviderCredentials | null>;
  uploadFile(context: ProviderTransferContext, credentials: ProviderCredentials): Promise<TransferDone>;
  /** Validate the constrained `{ destination: ... }` object for an external provider module. */
  validateDestination?(value: Record<string, unknown>): Record<string, string>;
}

export type StorageProviderId = string;
