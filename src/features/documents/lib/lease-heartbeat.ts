// Lease heartbeat: keeps a processing attempt's 15-minute lease alive across
// lengthy checkpoint-free phases (document parse/OCR, final summary, persist
// chain) and detects lost ownership early so a stale attempt stops before
// wasting provider quota or fighting a newer claim. Fencing itself stays in
// the database: every durable write is still verified by claim token + live
// lease in the same transaction; the heartbeat only decides when to stop work
// early. A scheduler seam lets deterministic tests drive renewals with a
// simulated clock.
export type LeaseRenewResult = {
  error: { message?: string } | null;
};

export type LeaseHeartbeat = {
  /** True once the database rejected a renewal because this attempt no longer owns the job. */
  lost(): boolean;
  /**
   * Ownership guard for the extraction layer: false once renewal was rejected
   * OR the lease is assumed expired (repeated transient renewal failures with
   * no successful renewal since the last known expiry), so a stale attempt
   * cannot run provider requests indefinitely on a dead lease.
   */
  owns(): boolean;
  stop(): void;
};

/** Minimal shape used from the Supabase client. The Postgrest RPC builder is a
 * thenable (it has `.then` but is not a real Promise), so the renewer accepts
 * anything awaitable that resolves to a result with an optional error. */
export type LeaseRenewer = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => AwaitableRenewResult;
};

type AwaitableRenewResult = {
  then: <TResult1 = LeaseRenewResult, TResult2 = never>(
    onfulfilled?: ((value: LeaseRenewResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => PromiseLike<TResult1 | TResult2>;
};

export function ownershipRejected(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string" &&
      (error.message.includes("Ownership rejected") ||
        error.message.includes("Lease extension rejected")),
  );
}

export const LEASE_HEARTBEAT_INTERVAL_MS = 5 * 60_000;

export function createLeaseHeartbeat(
  renewer: LeaseRenewer,
  jobId: string,
  claimToken: string,
  intervalMs: number = LEASE_HEARTBEAT_INTERVAL_MS,
  schedule: (
    callback: () => void | Promise<void>,
    ms: number,
  ) => () => void = (callback, ms) => {
    const timer = setInterval(() => void callback(), ms);
    timer.unref?.();
    return () => clearInterval(timer);
  },
): LeaseHeartbeat {
  let rejected = false;
  // A successful renewal means the lease is live for at least the claim
  // interval; transient failures consume that headroom without extending it.
  // Once more consecutive failures than the lease allows have passed, the
  // attempt must assume the lease expired and stop new provider work — the
  // database still fences every durable write either way.
  let consecutiveTransientFailures = 0;
  const maxToleratedFailures = Math.max(1, Math.floor(15 * 60_000 / intervalMs) - 1);
  const renew = async () => {
    try {
      const { error } = await renewer.rpc("extend_document_job_lease", {
        p_job_id: jobId,
        p_claim_token: claimToken,
        p_minutes: 15,
      });
      if (error && ownershipRejected(error)) {
        rejected = true;
        return;
      }
      consecutiveTransientFailures = 0;
    } catch (error) {
      if (ownershipRejected(error)) rejected = true;
      else consecutiveTransientFailures += 1;
    }
  };
  const cancel = schedule(renew, intervalMs);
  return {
    lost: () => rejected,
    owns: () =>
      !rejected && consecutiveTransientFailures <= maxToleratedFailures,
    stop: cancel,
  };
}
