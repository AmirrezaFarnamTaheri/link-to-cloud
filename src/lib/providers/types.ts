import type { Session } from "@/lib/session";
import type { ProviderInfo, TransferDone, TransferEvent, TransferRequest, TransferTarget } from "@/lib/types";

export type ProviderCredentials = {
  accessToken: string;
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

export interface StorageProvider extends ProviderInfo {
  resolveCredentials(session: Session): Promise<ProviderCredentials | null>;
  uploadFile(context: ProviderTransferContext, credentials: ProviderCredentials): Promise<TransferDone>;
}

export type StorageProviderId = TransferTarget;
