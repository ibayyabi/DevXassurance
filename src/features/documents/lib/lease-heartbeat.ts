// Lease heartbeat: keeps a processing attempt's 15-minute lease alive across
// lengthy checkpoint-free phases (document parse/OCR, final summary, persist
// chain) and detects lost ownership early so a stale attempt stops before
// wasting provider quota or fighting a newer claim. Fencing itself stays in
// the database: every durable write is still verified by claim token + live
// lease in the same transaction; the heartbeat only decides when to stop work
// early. A `setInterval`/timer seam lets deterministic tests drive renewals
// with a simulated clock.
export type LeaseRenewResult = {
  error: { message?: string } | null;
};

export type LeaseHeartbeat = {
  /** True once the database rejected a renewal because this attempt no longer owns the job. */
  lost(): boolean;
  stop(): void;
};

/**
 * Minimal shape used from the Supabase client. The Postgrest RPC builder is a
 * thenable (it has `.then` but is not a real Promise), so the renewer accepts
 * anything awaitable that resolves to a result with an optional error.
 */
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
  let lostOwnership = false;
  const renew = async () => {
    try {
      const { error } = await renewer.rpc("extend_document_job_lease", {
        p_job_id: jobId,
        p_claim_token: claimToken,
        p_minutes: 15,
      });
      if (error && ownershipRejected(error)) lostOwnership = true;
      // Transient renewal failures are tolerated: the lease has several
      // intervals of headroom and the next tick retries; the database remains
      // the authority on ownership for every durable write.
    } catch (error) {
      if (ownershipRejected(error)) lostOwnership = true;
    }
  };
  const cancel = schedule(renew, intervalMs);
  return {
    lost: () => lostOwnership,
    stop: cancel,
  };
}
