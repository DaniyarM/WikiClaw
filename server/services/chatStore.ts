import fs from "node:fs/promises";
import path from "node:path";
import type { ChatMessage, ChatSession, ChatSummary, Language } from "../../shared/contracts.js";
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from "../lib/fs.js";
import { createId } from "../lib/ids.js";
import { CHATS_DIR } from "../lib/paths.js";

const chatLocks = new Map<string, Promise<void>>();
let storeLock: Promise<void> = Promise.resolve();

export function defaultChatTitle(language: Language): string {
  return language === "ru" ? "Новый чат" : "New chat";
}

function isDefaultChatTitle(title: string): boolean {
  return title === defaultChatTitle("ru") || title === defaultChatTitle("en");
}

function createEmptyChat(language: Language, wikiId: string): ChatSession {
  const now = new Date().toISOString();

  return {
    id: createId("chat_"),
    wikiId,
    title: defaultChatTitle(language),
    createdAt: now,
    updatedAt: now,
    language,
    messages: [],
  };
}

function getChatFile(chatId: string): string {
  return path.join(CHATS_DIR, `${chatId}.json`);
}

async function withChatLock<T>(chatId: string, task: () => Promise<T>): Promise<T> {
  const previous = chatLocks.get(chatId) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.catch(() => undefined).then(() => tail);
  chatLocks.set(chatId, chain);

  await previous.catch(() => undefined);

  try {
    return await task();
  } finally {
    release();
    if (chatLocks.get(chatId) === chain) {
      chatLocks.delete(chatId);
    }
  }
}

async function withStoreLock<T>(task: () => Promise<T>): Promise<T> {
  const previous = storeLock;
  let release!: () => void;
  storeLock = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous.catch(() => undefined);

  try {
    return await task();
  } finally {
    release();
  }
}

function summarizeChat(chat: ChatSession): ChatSummary {
  const lastMessage = [...chat.messages].reverse().find((message) => message.role === "assistant" || message.role === "user");

  return {
    id: chat.id,
    wikiId: chat.wikiId,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    lastMessagePreview: lastMessage?.content.slice(0, 160) ?? "",
    messageCount: chat.messages.length,
  };
}

export async function assignLegacyChatsToWiki(wikiId: string): Promise<void> {
  await withStoreLock(async () => {
    await ensureDir(CHATS_DIR);
    const files = await fs.readdir(CHATS_DIR).catch(() => []);

    await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => {
          const filePath = path.join(CHATS_DIR, file);
          const chat = await readJsonFile<ChatSession | null>(filePath, null);
          if (!chat || chat.wikiId) {
            return;
          }

          await writeJsonFile(filePath, {
            ...chat,
            wikiId,
          } satisfies ChatSession);
        }),
    );
  });
}

export async function listChats(wikiId?: string): Promise<ChatSummary[]> {
  await ensureDir(CHATS_DIR);
  const files = await fs.readdir(CHATS_DIR).catch(() => []);
  const chats = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => readJsonFile<ChatSession | null>(path.join(CHATS_DIR, file), null)),
  );

  return chats
    .filter((chat): chat is ChatSession => Boolean(chat))
    .filter((chat) => (wikiId ? chat.wikiId === wikiId : true))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(summarizeChat);
}

export async function createChat(language: Language, wikiId: string): Promise<ChatSession> {
  return withStoreLock(async () => {
    await ensureDir(CHATS_DIR);
    const chat = createEmptyChat(language, wikiId);

    await writeJsonFile(getChatFile(chat.id), chat);
    return chat;
  });
}

export async function getChat(chatId: string): Promise<ChatSession | null> {
  const filePath = getChatFile(chatId);
  if (!(await pathExists(filePath))) {
    return null;
  }

  return readJsonFile<ChatSession | null>(filePath, null);
}

export async function saveChat(chat: ChatSession): Promise<ChatSession> {
  return withChatLock(chat.id, async () => {
    await ensureDir(CHATS_DIR);
    await writeJsonFile(getChatFile(chat.id), chat);
    return chat;
  });
}

export async function appendChatMessage(chatId: string, message: ChatMessage): Promise<ChatSession> {
  return withChatLock(chatId, async () => {
    const chat = await getChat(chatId);

    if (!chat) {
      throw new Error("Chat not found");
    }

    const nextMessages = [...chat.messages, message];
    const nextTitle =
      chat.messages.length === 0 && message.role === "user"
        ? message.content.replace(/\s+/g, " ").trim().slice(0, 48) || chat.title
        : chat.title;

    const nextChat: ChatSession = {
      ...chat,
      title: nextTitle,
      updatedAt: new Date().toISOString(),
      messages: nextMessages,
    };

    await ensureDir(CHATS_DIR);
    await writeJsonFile(getChatFile(chatId), nextChat);
    return nextChat;
  });
}

export async function replaceLastAssistantMessage(chatId: string, message: ChatMessage): Promise<ChatSession> {
  return withChatLock(chatId, async () => {
    const chat = await getChat(chatId);

    if (!chat) {
      throw new Error("Chat not found");
    }

    const nextMessages = [...chat.messages];
    let index = -1;
    for (let position = nextMessages.length - 1; position >= 0; position -= 1) {
      if (nextMessages[position]?.role === "assistant") {
        index = position;
        break;
      }
    }

    if (index === -1) {
      nextMessages.push(message);
    } else {
      nextMessages[index] = message;
    }

    const nextChat: ChatSession = {
      ...chat,
      updatedAt: new Date().toISOString(),
      messages: nextMessages,
    };

    await ensureDir(CHATS_DIR);
    await writeJsonFile(getChatFile(chatId), nextChat);
    return nextChat;
  });
}

export async function getOrCreateInitialChat(language: Language, wikiId: string): Promise<ChatSession> {
  return withStoreLock(async () => {
    const chats = await listChats(wikiId);
    if (chats.length === 0) {
      await ensureDir(CHATS_DIR);
      const chat = createEmptyChat(language, wikiId);

      await writeJsonFile(getChatFile(chat.id), chat);
      return chat;
    }

    const first = await getChat(chats[0].id);
    if (!first) {
      await ensureDir(CHATS_DIR);
      const chat = createEmptyChat(language, wikiId);

      await writeJsonFile(getChatFile(chat.id), chat);
      return chat;
    }

    return first;
  });
}

export async function renameChat(chatId: string, title: string): Promise<ChatSession> {
  return withChatLock(chatId, async () => {
    const chat = await getChat(chatId);

    if (!chat) {
      throw new Error("Chat not found");
    }

    const nextTitle = title.replace(/\s+/g, " ").trim();
    if (!nextTitle) {
      throw new Error("Chat title is required");
    }

    const nextChat: ChatSession = {
      ...chat,
      title: nextTitle.slice(0, 120),
      updatedAt: new Date().toISOString(),
    };

    await ensureDir(CHATS_DIR);
    await writeJsonFile(getChatFile(chatId), nextChat);
    return nextChat;
  });
}

export async function deleteChat(chatId: string): Promise<boolean> {
  return withStoreLock(async () =>
    withChatLock(chatId, async () => {
      const filePath = getChatFile(chatId);
      if (!(await pathExists(filePath))) {
        return false;
      }

      await fs.rm(filePath, { force: true });
      return true;
    }),
  );
}

export async function relocalizeDefaultChatTitles(language: Language): Promise<void> {
  await withStoreLock(async () => {
    await ensureDir(CHATS_DIR);
    const files = await fs.readdir(CHATS_DIR).catch(() => []);

    await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => {
          const filePath = path.join(CHATS_DIR, file);
          const chat = await readJsonFile<ChatSession | null>(filePath, null);
          if (!chat || chat.messages.length > 0 || !isDefaultChatTitle(chat.title)) {
            return;
          }

          await withChatLock(chat.id, async () => {
            const nextChat: ChatSession = {
              ...chat,
              title: defaultChatTitle(language),
              language,
            };

            await writeJsonFile(filePath, nextChat);
          });
        }),
    );
  });
}

export function toChatSummary(chat: ChatSession): ChatSummary {
  return summarizeChat(chat);
}
