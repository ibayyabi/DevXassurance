export type OllamaChatResult =
  | {
      ok: true;
      content: string;
      provider: "ollama" | "ollama_cloud" | "openai-compatible" | "gemini" | "groq";
      model: string;
    }
  | {
      ok: false;
      warning: string;
      provider: "disabled" | "ollama" | "ollama_cloud" | "openai-compatible" | "gemini" | "groq";
      model: string | null;
    };

type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function runOllamaChat({
  system,
  user,
  temperature = 0.1,
  format,
}: {
  system: string;
  user: string;
  temperature?: number;
  format?: "json";
}): Promise<OllamaChatResult> {
  const provider = process.env.XASS_LLM_PROVIDER ?? "ollama";

  if (provider === "ollama") {
    return runOllamaRequest({ system, user, temperature, format });
  }

  if (provider === "ollama_cloud") {
    return runOllamaCloudRequest({ system, user, temperature, format });
  }

  if (provider === "openai-compatible" || provider === "groq") {
    return runOpenAiCompatibleRequest({
      provider,
      system,
      user,
      temperature,
      format,
    });
  }

  if (provider === "gemini") {
    return runGeminiRequest({ system, user, temperature, format });
  }

  return {
    ok: false,
    provider: "disabled",
    model: null,
    warning: `LLM provider '${provider}' is not enabled for this demo.`,
  };
}

async function runOllamaRequest({
  system,
  user,
  temperature,
  format,
}: {
  system: string;
  user: string;
  temperature: number;
  format?: "json";
}): Promise<OllamaChatResult> {
  const model = process.env.OLLAMA_MODEL ?? "qwen2.5:3b";
  const baseUrl = process.env.OLLAMA_BASE_URL;

  if (!baseUrl) {
    return {
      ok: false,
      provider: "ollama",
      model,
      warning: "OLLAMA_BASE_URL is not configured.",
    };
  }

  const messages: OllamaMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      signal: AbortSignal.timeout(llmTimeoutMs()),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages,
        ...(format ? { format } : {}),
        options: { temperature },
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        provider: "ollama",
        model,
        warning: `Ollama returned HTTP ${response.status}.`,
      };
    }

    const payload = (await response.json()) as {
      message?: { content?: string };
      response?: string;
    };
    const content = (payload.message?.content ?? payload.response ?? "").trim();

    if (!content) {
      return {
        ok: false,
        provider: "ollama",
        model,
        warning: "Ollama returned an empty response.",
      };
    }

    return { ok: true, provider: "ollama", model, content };
  } catch (error) {
    return {
      ok: false,
      provider: "ollama",
      model,
      warning:
        error instanceof Error
          ? error.message
          : "Ollama request failed.",
    };
  }
}

async function runOllamaCloudRequest({
  system,
  user,
  temperature,
  format,
}: {
  system: string;
  user: string;
  temperature: number;
  format?: "json";
}): Promise<OllamaChatResult> {
  const model = process.env.OLLAMA_CLOUD_MODEL ?? "gpt-oss:20b";
  const baseUrl = process.env.OLLAMA_CLOUD_BASE_URL ?? "https://ollama.com/api";
  const apiKey = process.env.OLLAMA_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      provider: "ollama_cloud",
      model,
      warning: "OLLAMA_API_KEY is not configured.",
    };
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat`, {
      method: "POST",
      signal: AbortSignal.timeout(llmTimeoutMs()),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(format ? { format } : {}),
        options: { temperature },
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        provider: "ollama_cloud",
        model,
        warning: `Ollama Cloud returned HTTP ${response.status}.`,
      };
    }

    const payload = (await response.json()) as {
      message?: { content?: string };
      response?: string;
    };
    const content = (payload.message?.content ?? payload.response ?? "").trim();

    if (!content) {
      return {
        ok: false,
        provider: "ollama_cloud",
        model,
        warning: "Ollama Cloud returned an empty response.",
      };
    }

    return { ok: true, provider: "ollama_cloud", model, content };
  } catch (error) {
    return {
      ok: false,
      provider: "ollama_cloud",
      model,
      warning:
        error instanceof Error
          ? error.message
          : "Ollama Cloud request failed.",
    };
  }
}

async function runOpenAiCompatibleRequest({
  provider,
  system,
  user,
  temperature,
  format,
}: {
  provider: "openai-compatible" | "groq";
  system: string;
  user: string;
  temperature: number;
  format?: "json";
}): Promise<OllamaChatResult> {
  const model = provider === "groq"
    ? process.env.GROQ_MODEL
    : process.env.XASS_CLOUD_LLM_MODEL ?? "gpt-oss:20b";
  const baseUrl = provider === "groq"
    ? process.env.GROQ_API_BASE_URL ?? "https://api.groq.com/openai/v1"
    : process.env.XASS_CLOUD_LLM_BASE_URL ?? "https://ollama.com/v1";
  const apiKey = provider === "groq"
    ? process.env.GROQ_API_KEY
    : process.env.XASS_CLOUD_LLM_API_KEY ?? process.env.OLLAMA_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      provider,
      model: model ?? null,
      warning: provider === "groq" ? "GROQ_API_KEY is not configured." : "Cloud LLM API key is not configured.",
    };
  }
  if (!model) {
    return {
      ok: false,
      provider,
      model: null,
      warning: provider === "groq" ? "GROQ_MODEL is not configured." : "Cloud LLM model is not configured.",
    };
  }

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        signal: AbortSignal.timeout(llmTimeoutMs()),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature,
          stream: false,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          ...(format ? { response_format: { type: "json_object" } } : {}),
        }),
      },
    );

    if (!response.ok) {
      return {
        ok: false,
        provider,
        model,
        warning: `Cloud LLM returned HTTP ${response.status}.`,
      };
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = (payload.choices?.[0]?.message?.content ?? "").trim();

    if (!content) {
      return {
        ok: false,
        provider,
        model,
        warning: "Cloud LLM returned an empty response.",
      };
    }

    return { ok: true, provider, model, content };
  } catch (error) {
    return {
      ok: false,
      provider,
      model,
      warning:
        error instanceof Error ? error.message : "Cloud LLM request failed.",
    };
  }
}

async function runGeminiRequest({
  system,
  user,
  temperature,
  format,
}: {
  system: string;
  user: string;
  temperature: number;
  format?: "json";
}): Promise<OllamaChatResult> {
  const model = process.env.GEMINI_MODEL;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, provider: "gemini", model: model ?? null, warning: "GEMINI_API_KEY is not configured." };
  }
  if (!model) {
    return { ok: false, provider: "gemini", model: null, warning: "GEMINI_MODEL is not configured." };
  }
  const baseUrl = process.env.GEMINI_API_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        signal: AbortSignal.timeout(llmTimeoutMs()),
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            temperature,
            ...(format ? { responseMimeType: "application/json" } : {}),
          },
        }),
      },
    );

    if (!response.ok) {
      return { ok: false, provider: "gemini", model, warning: `Gemini returned HTTP ${response.status}.` };
    }

    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const content = (payload.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!content) {
      return { ok: false, provider: "gemini", model, warning: "Gemini returned an empty response." };
    }
    return { ok: true, provider: "gemini", model, content };
  } catch (error) {
    return {
      ok: false,
      provider: "gemini",
      model,
      warning: error instanceof Error ? error.message : "Gemini request failed.",
    };
  }
}

export function parseJsonObject(raw: string) {
  const cleaned = raw
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function llmTimeoutMs() {
  const configured = Number(process.env.XASS_LLM_TIMEOUT_MS ?? 120000);

  if (!Number.isFinite(configured)) return 120000;
  return Math.max(5000, Math.min(300000, configured));
}
