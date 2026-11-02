import { setTimeout as delay } from "node:timers/promises";
export type DocumentWriteError = {
  code?: string;
  message?: string;
  status?: number;
};

export async function retryDocumentWrite<T extends DocumentWriteError, R extends { error: T | null }>(
  write: () => Promise<R>,
) {
  let response: R | null = null;
  let error: T | DocumentWriteError | null = null;
  let transient = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await write();
      ({ error } = response);
      if (!error) return { ...response, transient: false };
      transient = isTransientResponse(error);
      if (!transient || attempt === 3) break;
    } catch (caught) {
      if (!isTransientDocumentWriteFailure(caught)) {
        error = {
          code: caught instanceof Error && "code" in caught ? String(caught.code) : undefined,
          message: caught instanceof Error ? caught.message : "Database write failed",
        };
        transient = false;
        break;
      }
      error = {
        code: caught instanceof Error && "code" in caught ? String(caught.code) : undefined,
        message: caught instanceof Error ? caught.message : "Network write failed",
      };
      transient = true;
      if (attempt === 3) break;
    }
    await delay(attempt * 100);
  }
  return { ...((response ?? {}) as R), error, transient };
}

function isTransientResponse(error: DocumentWriteError) {
  const status = Number(error.status);
  return status === 408 || status === 429 || status >= 500 ||
    ["08000", "08003", "08006", "08001", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(error.code ?? "");
}

export function isTransientDocumentWriteFailure(error: unknown) {
  if (error instanceof Error) {
    const networkCodes = [
      "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH",
      "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC",
    ];
    const hasNetworkCode = (value: unknown) =>
      typeof value === "object" &&
      value !== null &&
      "code" in value &&
      networkCodes.includes(String(value.code));
    return hasNetworkCode(error) || hasNetworkCode(error.cause) ||
      (error instanceof TypeError && error.message === "fetch failed");
  }
  return false;
}

