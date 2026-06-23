"use client";

import Link from "next/link";
import { ArrowRight, Bot, Send, UserRound } from "lucide-react";
import { useActionState, useState } from "react";

import {
  askAssistant,
  type AssistantActionState,
} from "@/features/assistant/actions/assistant-actions";
import type { AssistantAnswer } from "@/features/assistant/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const suggestedPrompts = [
  "Why is the project Amber?",
  "What should be escalated?",
  "Summarize this week's risks",
];

const initialState: AssistantActionState = {
  messages: [],
};

export function AssistantChat({
  projectId,
  aiRuntime,
}: {
  projectId: string;
  aiRuntime: {
    provider: string;
    model: string;
    configured: boolean;
  };
}) {
  const [state, formAction, pending] = useActionState(askAssistant, initialState);
  const [question, setQuestion] = useState("");
  const latest = state.messages.at(-1);

  return (
    <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
      <section className="flex min-h-[620px] flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4">
          <h2 className="font-semibold">AI Assistant</h2>
          <p className="text-sm text-slate-500">
            Ask evidence-led questions about this project workspace.
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-auto rounded-md bg-slate-50 p-3">
          {state.messages.length === 0 ? (
            <AssistantBubble
              message={{
                question: "",
                answer:
                  "Ask about project health, escalation needs, risks, cost, schedule, or governance. Answers are limited to this project evidence.",
                insufficientEvidence: false,
                sources: [],
                inferredClaims: [],
                recommendations: [],
              }}
            />
          ) : (
            state.messages.map((message, index) => (
              <div key={`${message.question}-${index}`} className="space-y-3">
                <UserBubble question={message.question} />
                <AssistantBubble message={message} />
              </div>
            ))
          )}
        </div>

        <form action={formAction} className="mt-4 flex gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <Input
            name="question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask a question about your project..."
            required
          />
          <Button
            type="submit"
            disabled={pending}
            className="bg-blue-700 hover:bg-blue-800"
            onClick={() => {
              window.setTimeout(() => setQuestion(""), 0);
            }}
          >
            <Send className="h-4 w-4" />
            {pending ? "Sending" : "Send"}
          </Button>
        </form>
      </section>

      <aside className="space-y-5">
        <RuntimePanel runtime={aiRuntime} />
        <SuggestedPrompts onSelect={setQuestion} />
        <EvidencePanel answer={latest} />
        <RecommendationsPanel answer={latest} />
      </aside>
    </div>
  );
}

function UserBubble({ question }: { question: string }) {
  return (
    <div className="ml-auto max-w-[82%] rounded-lg bg-blue-700 px-4 py-3 text-sm text-white">
      <div className="mb-1 flex items-center justify-end gap-2 text-blue-100">
        <span>You</span>
        <UserRound className="h-4 w-4" />
      </div>
      {question}
    </div>
  );
}

function AssistantBubble({ message }: { message: AssistantAnswer }) {
  return (
    <div className="max-w-[86%] rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
      <div className="mb-2 flex items-center gap-2 font-medium text-slate-950">
        <Bot className="h-4 w-4 text-blue-700" />
        Assistant
      </div>
      {message.insufficientEvidence && (
        <p className="mb-2 rounded-md bg-amber-50 p-2 text-amber-800">
          Insufficient evidence
        </p>
      )}
      <FormattedAnswer text={message.answer} />
      {(message.sources.length > 0 || message.inferredClaims.length > 0) && (
        <details className="mt-3 rounded-md bg-slate-50 p-2">
          <summary className="cursor-pointer text-xs font-semibold text-blue-700">
            Sources ({message.sources.length}) and inference notes
          </summary>
          <SourceList message={message} />
        </details>
      )}
    </div>
  );
}

function RuntimePanel({
  runtime,
}: {
  runtime: { provider: string; model: string; configured: boolean };
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Local AI Runtime</h2>
          <p className="mt-1 text-sm text-slate-500">
            Assistant answers use project evidence and the configured model.
          </p>
        </div>
        <span
          className={
            runtime.configured
              ? "rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"
              : "rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700"
          }
        >
          {runtime.configured ? "Ready" : "Fallback"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <p className="text-xs text-slate-500">Provider</p>
          <p className="font-semibold capitalize text-slate-900">{runtime.provider}</p>
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <p className="text-xs text-slate-500">Model</p>
          <p className="truncate font-semibold text-slate-900">{runtime.model}</p>
        </div>
      </div>
    </section>
  );
}

function FormattedAnswer({ text }: { text: string }) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const items = lines.length > 1 ? lines : splitSentences(text);

  return (
    <div className="space-y-2 leading-6">
      {items.map((item, index) => {
        const cleaned = item.replace(/^[-*]\s*/, "").replace(/^\d+[.)]\s*/, "");
        const bullet = /^[-*]\s+/.test(item) || /^\d+[.)]\s+/.test(item) || items.length > 1;

        return bullet ? (
          <div key={`${cleaned}-${index}`} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
            <p className="min-w-0 break-words">{cleaned}</p>
          </div>
        ) : (
          <p key={`${cleaned}-${index}`} className="break-words">
            {cleaned}
          </p>
        );
      })}
    </div>
  );
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
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="font-semibold">Suggested prompts</h2>
      <div className="mt-3 grid gap-2">
        {suggestedPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onSelect(prompt)}
            className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:border-blue-300 hover:bg-blue-50"
          >
            <span>{prompt}</span>
            <ArrowRight className="h-4 w-4 text-blue-700" />
          </button>
        ))}
      </div>
    </section>
  );
}

function EvidencePanel({ answer }: { answer?: AssistantAnswer }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="font-semibold">Evidence & Sources</h2>
      {answer?.sources.length ? (
        <SourceList message={answer} />
      ) : (
        <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
          Sources will appear after an evidence-grounded answer.
        </p>
      )}
    </section>
  );
}

function SourceList({ message }: { message: AssistantAnswer }) {
  return (
    <div className="mt-3 grid gap-2">
      {message.sources.map((source, index) => (
        <div key={`${source.documentTitle}-${index}`} className="rounded-md border border-slate-200 p-3">
          <p className="text-sm font-medium text-slate-950">
            {source.documentTitle}
          </p>
          <p className="mt-1 text-xs text-slate-600">{source.excerpt}</p>
          <p className="mt-2 text-xs text-slate-500">
            Page {source.pageNumber ?? "n/a"} • {source.sectionLabel ?? "No section"} • Confidence{" "}
            {source.confidence === null ? "n/a" : `${Math.round(source.confidence * 100)}%`}
          </p>
        </div>
      ))}
      {message.inferredClaims.map((claim) => (
        <div key={claim} className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
          Inference: {claim}
        </div>
      ))}
    </div>
  );
}

function RecommendationsPanel({ answer }: { answer?: AssistantAnswer }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="font-semibold">Recommendations / Next Actions</h2>
      <div className="mt-3 grid gap-2">
        {answer?.recommendations.length ? (
          answer.recommendations.map((recommendation) => (
            <Link
              key={recommendation.id}
              href={recommendation.sourcePath}
              className="rounded-md border border-slate-200 p-3 hover:border-blue-300"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-slate-950">
                  {recommendation.title}
                </p>
                <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                  {recommendation.priority}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Owner: {recommendation.ownerName ?? "Unassigned"}
              </p>
            </Link>
          ))
        ) : (
          <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            No recommendations returned yet.
          </p>
        )}
      </div>
    </section>
  );
}
