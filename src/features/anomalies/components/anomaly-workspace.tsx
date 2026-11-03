"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Filter,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  createManagementAction,
  markAnomalyFalsePositive,
  markAnomalyReviewed,
} from "@/features/anomalies/actions/anomaly-actions";
import {
  anomalyCategories,
  anomalyCategoryLabels,
  severityRank,
  type AnomalyCategory,
} from "@/features/anomalies/lib/constants";
import type { Anomaly } from "@/features/anomalies/lib/queries";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/filter-chip";
import { Input } from "@/components/ui/input";
import { MetaPill, StatusPill } from "@/components/ui/status-pill";

const severityLabels = {
  critical: "Kritis",
  high: "Tinggi",
  medium: "Sedang",
  low: "Rendah",
} as const;

export function AnomalyWorkspace({
  projectId,
  anomalies,
}: {
  projectId: string;
  anomalies: Anomaly[];
}) {
  const [category, setCategory] = useState<AnomalyCategory | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(
    anomalies[0]?.id ?? null,
  );

  const visibleAnomalies = useMemo(
    () =>
      anomalies
        .filter((anomaly) => category === "all" || anomaly.category === category)
        .sort((a, b) => severityRank[b.severity] - severityRank[a.severity]),
    [anomalies, category],
  );

  const selected =
    visibleAnomalies.find((anomaly) => anomaly.id === selectedId) ??
    visibleAnomalies[0] ??
    null;

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_0.85fr]">
      <section className="rounded-2xl border border-ui-border bg-surface p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-semibold">Anomali yang Terdeteksi</h2>
            <p className="text-sm text-ink-muted">
              Filter berdasarkan kategori dan urutkan berdasarkan keparahan.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-ink-muted" />
            {(["all", ...anomalyCategories] as const).map((item) => (
              <FilterChip
                key={item}
                pressed={category === item}
                onToggle={() => setCategory(item)}
              >
                {anomalyCategoryLabels[item]}
              </FilterChip>
            ))}
          </div>
        </div>

        <div className="grid gap-3">
          {visibleAnomalies.length === 0 ? (
            <div className="rounded-md border border-dashed border-ui-border p-6 text-sm text-ink-muted">
              Tidak ada anomali yang cocok dengan filter ini.
            </div>
          ) : (
            visibleAnomalies.map((anomaly) => (
              <button
                key={anomaly.id}
                type="button"
                onClick={() => setSelectedId(anomaly.id)}
                className={
                  selected?.id === anomaly.id
                    ? "rounded-md border border-status-neutral bg-plan-track p-4 text-left"
                    : "rounded-md border border-ui-border p-4 text-left hover:border-ui-border"
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{anomaly.title}</p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {anomaly.affectedItem}
                    </p>
                  </div>
                  <StatusPill tone="critical">{severityLabels[anomaly.severity]}</StatusPill>
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  {anomalyCategoryLabels[anomaly.category]}, Dampak:{" "}
                  {anomaly.impactRating}, Status: {anomaly.status}
                </p>
              </button>
            ))
          )}
        </div>
      </section>

      <AnomalyDetail projectId={projectId} anomaly={selected} />
    </div>
  );
}

function AnomalyDetail({
  projectId,
  anomaly,
}: {
  projectId: string;
  anomaly: Anomaly | null;
}) {
  if (!anomaly) {
    return (
      <section className="rounded-2xl border border-ui-border bg-surface p-6 shadow-sm">
        <h2 className="font-semibold">Detail Anomali</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Pilih anomali untuk memeriksa bukti, dampak, dan tindakan yang disarankan.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{anomaly.title}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {anomalyCategoryLabels[anomaly.category]}, {anomaly.status}
          </p>
        </div>
        <StatusPill tone="critical">{severityLabels[anomaly.severity]}</StatusPill>
      </div>

      <div className="mt-5 grid gap-4">
        <DetailBlock
          icon={<AlertTriangle className="h-4 w-4" />}
          title="Bukti"
          body={`${anomaly.explanation} Sumber bukti: ${anomaly.evidenceCount}. Label ketidakhadiran: ${anomaly.absenceType.replaceAll("_", " ")}.`}
        />
        <DetailBlock
          icon={<ShieldAlert className="h-4 w-4" />}
          title="Dampak"
          body={`${anomaly.impact} Peringkat dampak: ${anomaly.impactRating}.`}
        />
        <DetailBlock
          icon={<CheckCircle2 className="h-4 w-4" />}
          title="Tindakan yang Disarankan"
          body={anomaly.recommendedAction}
        />
        {anomaly.suggestedOwners.length > 0 && (
          <div>
            <p className="text-sm font-semibold">Penanggung jawab yang disarankan</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {anomaly.suggestedOwners.map((owner) => (
                <MetaPill key={owner}>{owner}</MetaPill>
              ))}
            </div>
          </div>
        )}
      </div>

      <form action={createManagementAction} className="mt-6 rounded-md border border-ui-border p-3">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="anomalyId" value={anomaly.id} />
        <h3 className="font-semibold">Buat Tindakan</h3>
        <div className="mt-3 grid gap-2">
          <Input name="title" defaultValue={anomaly.recommendedAction} required />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input name="ownerName" placeholder="Penanggung jawab" required />
            <Input name="dueDate" type="date" required />
          </div>
          <select
            name="priority"
            defaultValue={anomaly.severity === "high" || anomaly.severity === "critical" ? "high" : "medium"}
            className="h-9 rounded-md border border-ui-border bg-surface px-3 text-sm"
          >
            <option value="high">Tinggi</option>
            <option value="medium">Sedang</option>
            <option value="low">Rendah</option>
          </select>
          <Button type="submit" className="bg-brand text-brand-foreground hover:bg-brand/90">
            Buat Tindakan
          </Button>
        </div>
      </form>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <form action={markAnomalyReviewed}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="anomalyId" value={anomaly.id} />
          <Button type="submit" variant="outline" className="w-full">
            Tandai Sudah Ditinjau
          </Button>
        </form>
        <form action={markAnomalyFalsePositive}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="anomalyId" value={anomaly.id} />
          <Button type="submit" variant="outline" className="w-full">
            <XCircle className="h-4 w-4" />
            Positif Palsu
          </Button>
        </form>
      </div>
    </section>
  );
}

function DetailBlock({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-md bg-base p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-ink-muted">{body}</p>
    </div>
  );
}
