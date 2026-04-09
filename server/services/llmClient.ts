import type { AppSettings } from "../../shared/contracts.js";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  settings: AppSettings;
  messages: LlmMessage[];
  temperature?: number;
}

function joinUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/g, "")}${suffix}`;
}

function normalizeAssistantContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
          return item.text;
        }

        return "";
      })
      .join("");
  }

  return "";
}

function extractJsonBlock(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  throw new Error("Model did not return valid JSON");
}

function assertProviderSettings(settings: AppSettings): void {
  if (!settings.baseUrl.trim()) {
    throw new Error("LLM base URL is not configured");
  }

  if (!settings.model.trim()) {
    throw new Error("LLM model is not configured");
  }
}

async function callOpenAiCompatible(request: LlmRequest): Promise<string> {
  const response = await fetch(joinUrl(request.settings.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(request.settings.apiKey ? { authorization: `Bearer ${request.settings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: request.settings.model,
      temperature: request.temperature ?? request.settings.temperature,
      messages: request.messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM request failed with ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  return normalizeAssistantContent(content);
}

async function callOllama(request: LlmRequest): Promise<string> {
  const response = await fetch(joinUrl(request.settings.baseUrl, "/api/chat"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: request.settings.model,
      stream: false,
      options: {
        temperature: request.temperature ?? request.settings.temperature,
      },
      messages: request.messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed with ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    message?: { content?: string };
  };

  return data.message?.content ?? "";
}

export async function completeText(request: LlmRequest): Promise<string> {
  assertProviderSettings(request.settings);

  if (request.settings.provider === "openai-compatible") {
    return callOpenAiCompatible(request);
  }

  return callOllama(request);
}

export async function completeJson<T>(request: LlmRequest): Promise<T> {
  const text = await completeText(request);
  return JSON.parse(extractJsonBlock(text)) as T;
}

async function streamOpenAiCompatible(
  request: LlmRequest,
  onToken: (token: string) => void,
): Promise<string> {
  const response = await fetch(joinUrl(request.settings.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(request.settings.apiKey ? { authorization: `Bearer ${request.settings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: request.settings.model,
      temperature: request.temperature ?? request.settings.temperature,
      messages: request.messages,
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`LLM stream failed with ${response.status}: ${await response.text()}`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }

      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") {
        continue;
      }

      try {
        const payload = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const token = payload.choices?.[0]?.delta?.content ?? "";
        if (token) {
          fullText += token;
          onToken(token);
        }
      } catch {
        continue;
      }
    }
  }

  return fullText;
}

async function streamOllama(request: LlmRequest, onToken: (token: string) => void): Promise<string> {
  const response = await fetch(joinUrl(request.settings.baseUrl, "/api/chat"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: request.settings.model,
      stream: true,
      options: {
        temperature: request.temperature ?? request.settings.temperature,
      },
      messages: request.messages,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Ollama stream failed with ${response.status}: ${await response.text()}`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const payload = JSON.parse(trimmed) as { message?: { content?: string } };
        const token = payload.message?.content ?? "";
        if (token) {
          fullText += token;
          onToken(token);
        }
      } catch {
        continue;
      }
    }
  }

  return fullText;
}

export async function streamText(
  request: LlmRequest,
  onToken: (token: string) => void,
): Promise<string> {
  assertProviderSettings(request.settings);

  if (request.settings.provider === "openai-compatible") {
    return streamOpenAiCompatible(request, onToken);
  }

  return streamOllama(request, onToken);
}

export async function unloadModel(settings: AppSettings): Promise<void> {
  if (settings.provider !== "ollama") {
    return;
  }

  const response = await fetch(joinUrl(settings.baseUrl, "/api/generate"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: settings.model,
      keep_alive: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama unload failed with ${response.status}: ${await response.text()}`);
  }
}
