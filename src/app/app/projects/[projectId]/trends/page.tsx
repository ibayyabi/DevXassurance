import { BarChart3 } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";

export default function TrendsPage() {
  return (
    <div className="mx-auto flex min-h-[65vh] max-w-3xl items-center justify-center">
      <EmptyState
        className="w-full md:p-12"
        icon={BarChart3}
        title="Sedang Dikembangkan"
        description="Tren multi-periode akan hadir kemudian. Fitur ini akan membandingkan kondisi Anggaran, Jadwal, dan Risiko di berbagai periode pelaporan, tidak memengaruhi Assurance Review saat ini, dan tidak menampilkan persentase placeholder."
      />
    </div>
  );
}
