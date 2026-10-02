import { HttpError } from "./net";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DEFAULT_BODY_TIMEOUT_MS = 15_000;

/** Read small JSON control messages with streamed byte and time limits and strict media-type checks. */
export async function readJsonRequest(
  req: Request,
  maxBytes: number,
  label = "Request",
  timeoutMs = DEFAULT_BODY_TIMEOUT_MS,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("maxBytes must be a positive safe integer");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("timeoutMs must be a positive safe integer");
  const mediaType = req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") throw new HttpError("Content-Type must be application/json", 415);

  const rawLength = req.headers.get("content-length");
  if (rawLength !== null) {
    if (!/^\d+$/.test(rawLength)) throw new HttpError("Invalid Content-Length", 400);
    const declaredLength = Number(rawLength);
    if (!Number.isSafeInteger(declaredLength)) throw new HttpError("Invalid Content-Length", 400);
    if (declaredLength > maxBytes) throw new HttpError(`${label} body is too large`, 413);
  }
  if (!req.body) throw new HttpError("Request body is required", 400);

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HttpError(`${label} body timed out`, 408)), timeoutMs);
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timedOut]);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new HttpError(`${label} body is too large`, 413);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof HttpError) throw error;
    throw new HttpError("Could not read request body", 400);
  } finally {
    if (timer) clearTimeout(timer);
    reader.releaseLock();
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
  } catch {
    throw new HttpError("Request body must be valid UTF-8 JSON", 400);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError("Request body must be valid JSON", 400);
  }
}

export async function readJsonObjectRequest(
  req: Request,
  maxBytes: number,
  label = "Request",
  timeoutMs = DEFAULT_BODY_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const value = await readJsonRequest(req, maxBytes, label, timeoutMs);
  if (!isRecord(value)) throw new HttpError("Request body must be a JSON object", 400);
  return value;
}
