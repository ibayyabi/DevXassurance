"use client";

import Link from "next/link";
import {
  ArrowRight,
  Bot,
  FileSearch,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  Send,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  askAssistant,
  type AssistantActionState,
} from "@/features/assistant/actions/assistant-actions";
import type { AssistantAnswer } from "@/features/assistant/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/section-card";

const suggestedPrompts = [
  "Apa kondisi proyek yang paling penting saat ini?",
  "Bagaimana perkiraan terkini dibandingkan dengan anggaran yang disetujui?",
  "Apa yang sebaiknya dilakukan manajemen selanjutnya?",
  "Bukti apa yang masih kurang?",
];

export function AssistantChat({
  projectId,
  initialState,
}: {
  projectId: string;
  initialState: AssistantActionState;
}) {
  const [state, setState] = useState(initialState);
  const [transitionPending, startTransition] = useTransition();
  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState("");
  const conversationRef = useRef<HTMLDivElement>(null);
  const isThinking = transitionPending;
  const latest = state.messages.at(-1);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    conversation.scrollTo({
      top: conversation.scrollHeight,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [isThinking, state.messages.length]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const submittedQuestion = question.trim();
    if (!submittedQuestion || isThinking) return;

    const formData = new FormData(event.currentTarget);
    setPendingQuestion(submittedQuestion);
    setQuestion("");
    startTransition(async () => {
      setState(await askAssistant(state, formData));
      setPendingQuestion("");
    });
  }

  function handleNewConversation() {
    if (isThinking) return;
    setState({
      conversationId: crypto.randomUUID(),
      activeReviewId: state.activeReviewId,
      messages: [],
    });
    setPendingQuestion("");
    setQuestion("");
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
      <section
        className="flex min-h-[640px] flex-col overflow-hidden rounded-2xl border border-ui-border bg-surface shadow-sm"
        aria-busy={isThinking}
      >
        <div className="border-b border-analysis/40 bg-analysis-soft p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-analysis p-2.5 text-brand-foreground">
                <Bot className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-semibold text-ink">Tanya tentang proyek ini</h2>
                <p className="text-sm text-ink-muted">Jawaban jelas, berdasarkan bukti yang diunggah</p>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={isThinking} onClick={handleNewConversation}>
              Percakapan baru
            </Button>
          </div>
        </div>

        <div
          ref={conversationRef}
          className="flex-1 space-y-5 overflow-auto bg-base/70 p-4 md:p-5"
        >
          {state.messages.length === 0 && !isThinking ? (
            <WelcomeMessage activeReview={state.activeReviewId !== null} />
          ) : (
            state.messages.map((message, index) => (
              <div key={`${message.question}-${index}`} className="space-y-3">
                <UserBubble question={message.question} />
                <AssistantBubble message={message} />
              </div>
            ))
          )}
          {isThinking && pendingQuestion ? (
            <div className="space-y-3">
              <UserBubble question={pendingQuestion} />
              <ThinkingBubble activeReview={state.activeReviewId !== null} />
            </div>
          ) : null}
        </div>

        <form
          onSubmit={handleSubmit}
          className="border-t border-ui-border bg-surface p-4"
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="conversationId" value={state.conversationId} />
          <input type="hidden" name="activeReviewId" value={state.activeReviewId ?? ""} />
          <label htmlFor="advisor-question" className="sr-only">Tanya AI Advisor</label>
          <div className="flex gap-2">
            <Input
              id="advisor-question"
              name="question"
              value={question}
              maxLength={1000}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Tanya tentang anggaran, tenggat, risiko, atau tindakan berikutnya"
              readOnly={isThinking}
              required
              className="h-11"
            />
            <Button
              type="submit"
              disabled={isThinking || !question.trim()}
              className="h-11 bg-brand text-brand-foreground hover:bg-brand/90"
            >
              {isThinking ? (
                <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {isThinking ? "Berpikir" : "Tanya"}
            </Button>
          </div>
        </form>
      </section>

      <aside className="space-y-5">
        <SuggestedPrompts onSelect={setQuestion} />
        <EvidencePanel answer={latest} />
        <RecommendationsPanel answer={latest} />
      </aside>
    </div>
  );
}

function ThinkingBubble({ activeReview }: { activeReview: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="max-w-[94%] rounded-2xl rounded-tl-md border border-analysis/40 bg-analysis-soft p-5 shadow-sm"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Bot className="h-4 w-4 text-analysis" />
        AI Advisor
      </div>
      <div className="mt-4 flex items-center gap-3 text-sm text-ink-muted">
        <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        <span>Berpikir</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-ink-muted">
        {activeReview
          ? "Mencari bukti proyek terbaru dalam tinjauan yang aktif."
          : "Mencari bukti proyek terbaru di seluruh proyek ini."}
      </p>
    </div>
  );
}

function WelcomeMessage({ activeReview }: { activeReview: boolean }) {
  return (
    <div className="rounded-2xl border border-analysis/40 bg-analysis-soft p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-analysis">
        Penasihat berbasis bukti
      </p>
      <h3 className="mt-2 text-2xl font-semibold text-ink">
        Ajukan satu pertanyaan dengan bahasa yang sederhana.
      </h3>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-muted">
        Penasihat mencari bukti proyek terbaru dan menyebutkan lokasi
        sumbernya. {activeReview
          ? "Tinjauan yang aktif membatasi pencarian ini."
          : "Tidak ada tinjauan aktif yang dipilih, sehingga pencarian menggunakan cakupan proyek."}
        {" "}Pertanyaan historis dan komparatif dapat menelusuri periode yang relevan.
        Jika bukti belum cukup kuat, penasihat akan menyampaikan apa yang kurang
        alih-alih mengarang jawaban.
      </p>
    </div>
  );
}

function UserBubble({ question }: { question: string }) {
  return (
    <div className="ml-auto max-w-[88%] rounded-2xl rounded-br-md border border-ui-border bg-plan-track px-4 py-3 text-sm text-ink">
      <div className="mb-1 flex items-center justify-end gap-2 text-xs text-ink-muted">
        <span>Anda</span>
        <UserRound className="h-3.5 w-3.5" />
      </div>
      {question}
    </div>
  );
}

function AssistantBubble({ message }: { message: AssistantAnswer }) {
  return (
    <div className="max-w-[94%] rounded-2xl rounded-tl-md border border-analysis/40 bg-analysis-soft p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Bot className="h-4 w-4 text-analysis" />
        Jawaban langsung
      </div>
      {message.insufficientEvidence && (
        <p className="mt-3 rounded-xl bg-status-warn-bg p-3 text-sm font-medium text-status-warn-text">
          Bukti yang tersedia belum cukup untuk memberikan jawaban yang andal.
        </p>
      )}
      <div className="mt-4">
        <FormattedAnswer text={message.answer} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-ui-border pt-3 text-xs text-ink-muted">
        <span>{message.sources.length} sumber</span>
        {message.inferredClaims.length > 0 && (
          <span>· {message.inferredClaims.length} catatan metode</span>
        )}
      </div>
    </div>
  );
}

function FormattedAnswer({ text }: { text: string }) {
  const lines = text
    .replace(/\*\*/g, "")
    .replace(/[–—‑]/g, "-")
    .replace(/^#{1,6}\s*/gm, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !/^\|?[\s:|-]+\|?$/.test(line))
    .map((line) => normalizeTableLine(line));
  const items = lines.length > 1 ? lines : splitSentences(text.replace(/\*\*/g, ""));

  return (
    <div className="space-y-3 text-[15px] leading-7 text-ink-muted">
      {items.map((item, index) => {
        const cleaned = item
          .replace(/^[-*]\s*/, "")
          .replace(/^\d+[.)]\s*/, "")
          .replace(/\*+$/g, "");
        if (cleaned.toLowerCase() === "direct answer") return null;
        if (["Evidence", "Next actions", "General guidance"].includes(cleaned)) {
          return (
            <h3 key={`${cleaned}-${index}`} className="pt-2 font-semibold text-ink">
              {cleaned}
            </h3>
          );
        }
        const bullet = /^[-*]\s+/.test(item) || /^\d+[.)]\s+/.test(item);
        return bullet ? (
          <div key={`${cleaned}-${index}`} className="flex gap-3">
            <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-status-neutral" />
            <p className="min-w-0 break-words">{cleaned}</p>
          </div>
        ) : (
          <p key={`${cleaned}-${index}`} className="break-words">{cleaned}</p>
        );
      })}
    </div>
  );
}

function normalizeTableLine(line: string) {
  if (!line.startsWith("|") || !line.endsWith("|")) return line;
  const cells = line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
  return cells.join(". ");
}

function splitSentences(text: string) {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences.length > 1 ? sentences : [text];
}

function SuggestedPrompts({ onSelect }: { onSelect: (value: string) => void }) {
  return (
    <SectionCard icon={Lightbulb} iconTone="analysis" title="Pertanyaan yang berguna">
      <div className="grid gap-2">
        {suggestedPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onSelect(prompt)}
            className="flex items-center justify-between gap-3 rounded-xl border border-ui-border px-3 py-3 text-left text-sm leading-5 text-ink-muted hover:bg-base hover:text-ink"
          >
            <span>{prompt}</span>
            <ArrowRight className="h-4 w-4 shrink-0 text-ink-muted" />
          </button>
        ))}
      </div>
    </SectionCard>
  );
}

function EvidencePanel({ answer }: { answer?: AssistantAnswer }) {
  return (
    <SectionCard icon={FileSearch} iconTone="neutral" title="Sumber yang digunakan">
      {answer?.sources.length ? (
        <div className="grid gap-3">
          {answer.sources.map((source, index) => (
            <details key={source.id} className="rounded-xl border border-ui-border p-3">
              <summary className="cursor-pointer text-sm font-medium text-ink">
                S{index + 1} · {source.documentTitle} · Chunk {source.chunkIndex + 1}
              </summary>
              <p className="mt-2 text-xs leading-5 text-ink-muted">{source.excerpt}</p>
              <p className="mt-2 text-xs text-ink-muted/70">{formatSourceLocation(source)}</p>
              <p className="mt-1 text-[11px] text-ink-muted/60">ID Sumber: {source.id}</p>
              {source.reportingPeriod || source.evidenceRole ? (
                <p className="mt-1 text-[11px] text-ink-muted/60">
                  {source.reportingPeriod ? `Periode terkonfirmasi: ${source.reportingPeriod}` : ""}
                  {source.reportingPeriod && source.evidenceRole ? " · " : ""}
                  {source.evidenceRole ? `Peran terkonfirmasi: ${source.evidenceRole}` : ""}
                </p>
              ) : null}
            </details>
          ))}
          {answer.inferredClaims.length > 0 && (
            <details className="rounded-xl bg-status-warn-bg p-3">
              <summary className="cursor-pointer text-sm font-medium text-status-warn-text">
                Catatan metode
              </summary>
              <ul className="mt-2 space-y-2 text-xs leading-5 text-status-warn-text/80">
                {answer.inferredClaims.map((claim) => <li key={claim}>{claim}</li>)}
              </ul>
            </details>
          )}
        </div>
      ) : (
        <p className="rounded-xl bg-base p-3 text-sm leading-6 text-ink-muted">
          Dokumen sumber akan muncul setelah jawaban pertama.
        </p>
      )}
    </SectionCard>
  );
}

function formatSourceLocation(source: AssistantAnswer["sources"][number]) {
  const location = source.sourceLocation ?? {};
  const parts: string[] = [];
  const pageNumber = source.pageNumber ?? location.pageNumber;
  if (typeof pageNumber === "number") parts.push(`Halaman ${pageNumber}`);
  if (typeof location.sheetName === "string") parts.push(`Sheet ${location.sheetName}`);
  if (typeof location.slideNumber === "number") parts.push(`Slide ${location.slideNumber}`);
  if (typeof location.rowStart === "number") {
    parts.push(
      location.rowStart === location.rowEnd
        ? `Baris ${location.rowStart}`
        : `Baris ${location.rowStart}-${location.rowEnd}`,
    );
  }
  if (typeof location.cellRangeStart === "string") {
    parts.push(`Sel ${location.cellRangeStart}-${String(location.cellRangeEnd ?? location.cellRangeStart)}`);
  }
  if (typeof location.paragraphStart === "number") {
    parts.push(
      location.paragraphStart === location.paragraphEnd
        ? `Paragraf ${location.paragraphStart}`
        : `Paragraf ${location.paragraphStart}-${location.paragraphEnd}`,
    );
  }
  if (typeof location.imageName === "string") parts.push(location.imageName);
  if (source.sectionLabel) parts.push(source.sectionLabel);
  return parts.length ? parts.join(" · ") : "Lokasi tidak tersedia";
}

function RecommendationsPanel({ answer }: { answer?: AssistantAnswer }) {
  return (
    <SectionCard icon={ListChecks} iconTone="neutral" title="Tindakan lanjutan">
      <div className="grid gap-3">
        {answer?.recommendations.length ? (
          answer.recommendations.map((recommendation) => (
            <Link
              key={recommendation.id}
              href={recommendation.sourcePath}
              className="rounded-xl border border-ui-border p-3 hover:bg-base"
            >
              <p className="text-sm font-medium leading-6 text-ink">{recommendation.title}</p>
              <p className="mt-1 text-xs text-ink-muted/70">
                {recommendation.ownerName ?? "Penanggung jawab belum ditugaskan"} · prioritas {recommendation.priority}
              </p>
            </Link>
          ))
        ) : (
          <p className="text-sm leading-6 text-ink-muted">
            Tindakan manajemen yang relevan akan muncul bersama jawaban.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
