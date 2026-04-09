import type { AppSettings, ChatSession, ChatSummary, StreamEvent, WikiSummary } from "../../shared/contracts";

export interface AppSnapshotPayload {
  settings: AppSettings;
  wikis: WikiSummary[];
  activeWikiId: string;
  chats: ChatSummary[];
  currentChat: ChatSession | null;
}

interface UpdateChatPayload {
  chat: ChatSession;
  chatSummary: ChatSummary;
}

interface DeleteChatPayload {
  deletedChatId: string;
  chats: ChatSummary[];
  fallbackChat: ChatSession | null;
}

interface WikiCollectionPayload {
  wikis: WikiSummary[];
  activeWikiId: string;
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function getBootstrap(): Promise<AppSnapshotPayload> {
  return parseJson<AppSnapshotPayload>(await fetch("/api/bootstrap"));
}

export async function getChat(chatId: string): Promise<ChatSession> {
  return parseJson<ChatSession>(await fetch(`/api/chats/${chatId}`));
}

export async function createChat(language: AppSettings["language"]): Promise<ChatSession> {
  return parseJson<ChatSession>(
    await fetch("/api/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language }),
    }),
  );
}

export async function renameChat(chatId: string, title: string): Promise<UpdateChatPayload> {
  return parseJson<UpdateChatPayload>(
    await fetch(`/api/chats/${chatId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  );
}

export async function deleteChat(chatId: string): Promise<DeleteChatPayload> {
  return parseJson<DeleteChatPayload>(
    await fetch(`/api/chats/${chatId}`, {
      method: "DELETE",
    }),
  );
}

export async function saveSettings(payload: Partial<AppSettings>): Promise<AppSnapshotPayload> {
  return parseJson<AppSnapshotPayload>(
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function createWiki(name: string): Promise<AppSnapshotPayload> {
  return parseJson<AppSnapshotPayload>(
    await fetch("/api/wikis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  );
}

export async function activateWiki(wikiId: string): Promise<AppSnapshotPayload> {
  return parseJson<AppSnapshotPayload>(
    await fetch(`/api/wikis/${wikiId}/activate`, {
      method: "PATCH",
    }),
  );
}

export async function deleteWiki(wikiId: string, confirmationText: string): Promise<AppSnapshotPayload> {
  return parseJson<AppSnapshotPayload>(
    await fetch(`/api/wikis/${wikiId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmationText }),
    }),
  );
}

export async function getWikis(): Promise<WikiCollectionPayload> {
  return parseJson<WikiCollectionPayload>(await fetch("/api/wikis"));
}

export async function streamChat(params: {
  chatId: string;
  message: string;
  files: File[];
  onEvent: (event: StreamEvent) => void;
}): Promise<void> {
  const form = new FormData();
  form.set("chatId", params.chatId);
  form.set("message", params.message);
  for (const file of params.files) {
    form.append("files", file);
  }

  const response = await fetch("/api/chat/stream", {
    method: "POST",
    body: form,
  });

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Streaming failed with ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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

      params.onEvent(JSON.parse(trimmed) as StreamEvent);
    }
  }
}
