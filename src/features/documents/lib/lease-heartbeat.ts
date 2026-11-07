// Lease heartbeat: keeps a processing attempt's 30-minute lease alive across
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
  /** True once a renewal was rejected because this attempt no longer owns the job. */
  lost(): boolean;
  /** False after a rejected renewal or the last known lease expiry. */
  owns(): boolean;
  /** Aborted at ownership loss/known expiry so an in-flight provider fetch can stop. */
  ownershipSignal: AbortSignal;
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
type LeaseHeartbeatOptions = {
  intervalMs?: number;
  /** Monotonic instant immediately before the RPC that granted the current lease. */
  initialLeaseStartedAt?: number;
  now?: () => number;
  schedule?: (callback: () => void | Promise<void>, ms: number) => () => void;
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
// Matches the widened document-job lease window (supabase migration
// 202611040001 + the route's initial `extend_document_job_lease` call): the
// lease granted is 30 minutes, so both the local dead-man deadline and each
// renewal must assume 30 minutes, not the pre-widening 15.
const LEASE_DURATION_MS = 30 * 60_000;
const LEASE_DURATION_MINUTES = 30;


export function createLeaseHeartbeat(
  renewer: LeaseRenewer,
  jobId: string,
  claimToken: string,
  options: LeaseHeartbeatOptions = {},
): LeaseHeartbeat {
  const now = options.now ?? (() => performance.now());
  const intervalMs = options.intervalMs ?? LEASE_HEARTBEAT_INTERVAL_MS;
  const initialLeaseStartedAt = options.initialLeaseStartedAt ?? now();
  const controller = new AbortController();
  let rejected = false;
  let revoked = false;
  let leaseExpiresAt = initialLeaseStartedAt + LEASE_DURATION_MS;
  let lastSuccessfulRenewalStartedAt = Number.NEGATIVE_INFINITY;
  const revoke = () => {
    revoked = true;
    controller.abort();
  };
  const owns = () => {
    if (!revoked && now() >= leaseExpiresAt) revoke();
    return !revoked;
  };
  const renew = async () => {
    if (!owns()) return;
    const startedAt = now();
    try {
      const { error } = await renewer.rpc("extend_document_job_lease", {
        p_job_id: jobId,
        p_claim_token: claimToken,
        p_minutes: LEASE_DURATION_MINUTES,
      });
      if (error) {
        if (ownershipRejected(error)) {
          rejected = true;
          revoke();
        }
        return;
      }
      if (revoked || startedAt >= leaseExpiresAt) {
        revoke();
        return;
      }
      if (startedAt >= lastSuccessfulRenewalStartedAt) {
        lastSuccessfulRenewalStartedAt = startedAt;
        leaseExpiresAt = startedAt + LEASE_DURATION_MS;
      }
      owns();
    } catch (error) {
      if (ownershipRejected(error)) {
        rejected = true;
        revoke();
      }
    }
  };
  const schedule = options.schedule ?? ((callback, ms) => {
    const timer = setInterval(() => void callback(), ms);
    timer.unref?.();
    return () => clearInterval(timer);
  });
  const cancel = schedule(renew, intervalMs);
  return {
    lost: () => rejected,
    owns,
    ownershipSignal: controller.signal,
    stop: cancel,
  };
}
