import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/** Shared list footer: "Showing X–Y of Z" plus Previous/Next and page counter. */
export function PaginationFooter({ rangeLabel, page, pageCount, onPrevious, onNext, previousDisabled, nextDisabled }: {
  rangeLabel: ReactNode;
  page: number;
  pageCount: number;
  onPrevious: () => void;
  onNext: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-ink-muted">{rangeLabel}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onPrevious} disabled={previousDisabled}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Sebelumnya
        </Button>
        <span className="rounded-lg border border-ui-border bg-surface px-3 py-1.5 text-sm text-ink">
          Halaman {page} dari {pageCount}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={onNext} disabled={nextDisabled}>
          Berikutnya
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
