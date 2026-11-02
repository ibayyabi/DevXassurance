export function modelTargetUrl(requestPath, upstreamBase) {
  return new URL(requestPath, new URL(upstreamBase).origin);
}
