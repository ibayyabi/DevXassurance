export async function requestJson<T extends { message?: string }>(
  url: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as T | null;
  if (!response.ok) {
    throw new Error(payload?.message ?? "The upload could not be completed. Retry this file.");
  }
  return payload ?? ({} as T);
}
