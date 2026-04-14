import express from "express";
import multer from "multer";
import type { StreamEvent } from "../../shared/contracts.js";
import { createId } from "../lib/ids.js";
import { runAgent } from "../services/agent.js";
import {
  assignLegacyChatsToWiki,
  appendChatMessage,
  createChat,
  deleteChat,
  getChat,
  getOrCreateInitialChat,
  listChats,
  renameChat,
  toChatSummary,
} from "../services/chatStore.js";
import { getSettings, updateSettings } from "../services/settingsStore.js";
import { unloadModel } from "../services/llmClient.js";
import { activateWikiEntry, createFallbackWiki, createManagedWiki, deleteWikiEntry, syncWikiLibrary } from "../services/wikiLibrary.js";
import { ensureWikiScaffold, storeAttachments } from "../services/wikiManager.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 8,
    fileSize: 20 * 1024 * 1024,
  },
});

export const apiRouter = express.Router();

async function buildAppSnapshot() {
  const settings = await getSettings();
  await ensureWikiScaffold(settings);
  const wikiState = await syncWikiLibrary(settings);
  await assignLegacyChatsToWiki(wikiState.activeWikiId);
  const chats = await listChats(wikiState.activeWikiId);
  const currentChat =
    chats.length > 0 ? await getChat(chats[0].id) : await getOrCreateInitialChat(settings.language, wikiState.activeWikiId);

  return {
    settings,
    wikis: wikiState.summaries,
    activeWikiId: wikiState.activeWikiId,
    chats,
    currentChat,
  };
}

apiRouter.get("/bootstrap", async (_request, response, next) => {
  try {
    response.json(await buildAppSnapshot());
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/settings", async (_request, response, next) => {
  try {
    const settings = await getSettings();
    response.json(settings);
  } catch (error) {
    next(error);
  }
});

apiRouter.put("/settings", async (request, response, next) => {
  try {
    await updateSettings(request.body ?? {});
    response.json(await buildAppSnapshot());
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/chats", async (_request, response, next) => {
  try {
    const snapshot = await buildAppSnapshot();
    response.json(snapshot.chats);
  } catch (error) {
    next(error);
  }
});

apiRouter.post("/chats", async (request, response, next) => {
  try {
    const snapshot = await buildAppSnapshot();
    const settings = snapshot.settings;
    const language = request.body?.language === "en" ? "en" : settings.language;
    const chat = await createChat(language, snapshot.activeWikiId);
    response.status(201).json(chat);
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/chats/:chatId", async (request, response, next) => {
  try {
    const chat = await getChat(request.params.chatId);
    if (!chat) {
      response.status(404).json({ error: "Chat not found" });
      return;
    }

    response.json(chat);
  } catch (error) {
    next(error);
  }
});

apiRouter.patch("/chats/:chatId", async (request, response, next) => {
  try {
    const snapshot = await buildAppSnapshot();
    const existingChat = await getChat(request.params.chatId);
    if (!existingChat || existingChat.wikiId !== snapshot.activeWikiId) {
      response.status(404).json({ error: "Chat not found" });
      return;
    }

    const title = `${request.body?.title ?? ""}`.trim();
    if (!title) {
      response.status(400).json({ error: "Chat title is required" });
      return;
    }

    const chat = await renameChat(request.params.chatId, title);
    response.json({
      chat,
      chatSummary: toChatSummary(chat),
    });
  } catch (error) {
    next(error);
  }
});

apiRouter.delete("/chats/:chatId", async (request, response, next) => {
  try {
    const snapshot = await buildAppSnapshot();
    const existingChat = await getChat(request.params.chatId);
    if (!existingChat || existingChat.wikiId !== snapshot.activeWikiId) {
      response.status(404).json({ error: "Chat not found" });
      return;
    }

    const deleted = await deleteChat(request.params.chatId);
    if (!deleted) {
      response.status(404).json({ error: "Chat not found" });
      return;
    }

    let chats = await listChats(snapshot.activeWikiId);
    let fallbackChat = chats.length > 0 ? await getChat(chats[0].id) : null;

    if (!fallbackChat) {
      fallbackChat = await getOrCreateInitialChat(snapshot.settings.language, snapshot.activeWikiId);
      chats = await listChats(snapshot.activeWikiId);
    }

    response.json({
      deletedChatId: request.params.chatId,
      chats,
      fallbackChat,
    });
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/wikis", async (_request, response, next) => {
  try {
    const snapshot = await buildAppSnapshot();
    response.json({
      wikis: snapshot.wikis,
      activeWikiId: snapshot.activeWikiId,
    });
  } catch (error) {
    next(error);
  }
});

apiRouter.post("/wikis", async (request, response, next) => {
  try {
    const settings = await getSettings();
    const name = `${request.body?.name ?? ""}`.replace(/\s+/g, " ").trim();
    if (!name) {
      response.status(400).json({ error: "Wiki name is required" });
      return;
    }

    const created = await createManagedWiki(name, settings);
    await updateSettings({ wikiPath: created.path });
    response.status(201).json(await buildAppSnapshot());
  } catch (error) {
    next(error);
  }
});

apiRouter.patch("/wikis/:wikiId/activate", async (request, response, next) => {
  try {
    const target = await activateWikiEntry(request.params.wikiId);
    await updateSettings({ wikiPath: target.path });
    response.json(await buildAppSnapshot());
  } catch (error) {
    next(error);
  }
});

apiRouter.delete("/wikis/:wikiId", async (request, response, next) => {
  try {
    const settings = await getSettings();
    const snapshot = await buildAppSnapshot();
    const confirmationText = `${request.body?.confirmationText ?? ""}`;
    const remaining = await deleteWikiEntry(request.params.wikiId, confirmationText);
    const deletedActive = request.params.wikiId === snapshot.activeWikiId;

    if (remaining.length === 0) {
      const fallback = await createFallbackWiki(settings);
      await updateSettings({ wikiPath: fallback.path });
      response.json(await buildAppSnapshot());
      return;
    }

    if (deletedActive) {
      await updateSettings({ wikiPath: remaining[0].path });
    }

    response.json(await buildAppSnapshot());
  } catch (error) {
    next(error);
  }
});

apiRouter.post("/chat/stream", upload.array("files"), async (request, response, next) => {
  try {
    const snapshot = await buildAppSnapshot();
    const settings = snapshot.settings;
    await ensureWikiScaffold(settings);

    const chatId = `${request.body.chatId ?? ""}`;
    const message = `${request.body.message ?? ""}`.trim();
    const chat = await getChat(chatId);

    if (!chat || chat.wikiId !== snapshot.activeWikiId) {
      response.status(404).json({ error: "Chat not found" });
      return;
    }

    const files = (request.files as Express.Multer.File[] | undefined) ?? [];
    const attachments = await storeAttachments(settings, files);
    const userMessage = {
      id: createId("msg_"),
      role: "user" as const,
      content: message,
      createdAt: new Date().toISOString(),
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        storedPath: attachment.storedPath,
        wikiRelativePath: attachment.wikiRelativePath,
        textPreview: attachment.textPreview,
      })),
    };

    const nextChat = await appendChatMessage(chat.id, userMessage);
    const assistantMessageId = createId("msg_");

    response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();

    const sendEvent = (event: StreamEvent) => {
      response.write(`${JSON.stringify(event)}\n`);
    };

    sendEvent({
      type: "message-start",
      messageId: assistantMessageId,
      createdAt: new Date().toISOString(),
    });

    const agentResult = await runAgent({
      settings,
      chat: nextChat,
      userMessage,
      attachments,
      onActivity: (activity) => sendEvent({ type: "activity", activity }),
      onThinkingToken: (text) => sendEvent({ type: "assistant-thinking-token", text }),
      onToken: (text) => sendEvent({ type: "assistant-token", text }),
    });

    const assistantMessage = {
      id: assistantMessageId,
      role: "assistant" as const,
      content: agentResult.assistantContent,
      createdAt: new Date().toISOString(),
      thinkingSummary: agentResult.thinkingSummary,
      activities: agentResult.activities,
      webResearch: agentResult.webResearch,
    };

    const finalChat = await appendChatMessage(chat.id, assistantMessage);
    sendEvent({
      type: "assistant-final",
      message: assistantMessage,
      chatSummary: toChatSummary(finalChat),
    });
    response.end();
    void unloadModel(settings).catch(() => undefined);
  } catch (error) {
    if (!response.headersSent) {
      next(error);
      return;
    }

    response.write(
      `${JSON.stringify({
        type: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      } satisfies StreamEvent)}\n`,
    );
    response.end();
    const settings = await getSettings().catch(() => null);
    if (settings) {
      void unloadModel(settings).catch(() => undefined);
    }
  }
});
