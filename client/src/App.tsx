import { startTransition, useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatSession, ChatSummary, WikiSummary } from "../../shared/contracts";
import {
  activateWiki,
  createChat,
  createWiki,
  deleteChat,
  deleteWiki,
  getBootstrap,
  getChat,
  renameChat,
  saveSettings,
  streamChat,
  type AppSnapshotPayload,
} from "./api";
import { ChatSidebar } from "./components/ChatSidebar";
import { Composer } from "./components/Composer";
import { MessageList } from "./components/MessageList";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { WikiManagerDialog } from "./components/WikiManagerDialog";
import { getDictionary } from "./i18n/messages";

type UiMessage = ChatMessage & { pending?: boolean };
type UiChat = Omit<ChatSession, "messages"> & { messages: UiMessage[] };

export default function App() {
  const [settings, setSettings] = useState<AppSnapshotPayload["settings"] | null>(null);
  const [wikis, setWikis] = useState<WikiSummary[]>([]);
  const [activeWikiId, setActiveWikiId] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [currentChat, setCurrentChat] = useState<UiChat | null>(null);
  const [composerValue, setComposerValue] = useState("");
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wikiManagerOpen, setWikiManagerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [wikiBusy, setWikiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);

  function applySnapshot(snapshot: AppSnapshotPayload) {
    startTransition(() => {
      setSettings(snapshot.settings);
      setWikis(snapshot.wikis);
      setActiveWikiId(snapshot.activeWikiId);
      setChats(snapshot.chats);
      setCurrentChat(snapshot.currentChat as UiChat | null);
    });
  }

  async function loadBootstrap() {
    const payload = await getBootstrap();
    applySnapshot(payload);
  }

  useEffect(() => {
    void (async () => {
      try {
        await loadBootstrap();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Bootstrap failed");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const node = chatScrollRef.current;
    if (!node) {
      return;
    }

    const updateAutoScroll = () => {
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
      autoScrollRef.current = distanceFromBottom <= 24;
    };

    updateAutoScroll();
    node.addEventListener("scroll", updateAutoScroll, { passive: true });
    return () => node.removeEventListener("scroll", updateAutoScroll);
  }, [currentChat?.id]);

  useEffect(() => {
    const node = chatScrollRef.current;
    if (!node || !autoScrollRef.current) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [currentChat?.id, currentChat?.messages]);

  const dictionary = getDictionary(settings?.language ?? "en");
  const activeWiki = wikis.find((wiki) => wiki.id === activeWikiId) ?? null;

  async function handleSelectChat(chatId: string) {
    setLoading(true);
    setError(null);

    try {
      const chat = await getChat(chatId);
      startTransition(() => setCurrentChat(chat as UiChat));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Chat load failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateChat() {
    if (!settings) {
      return;
    }

    try {
      const chat = await createChat(settings.language);
      startTransition(() => {
        setCurrentChat(chat as UiChat);
        setChats((previous) => [chat, ...previous.filter((item) => item.id !== chat.id)]);
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Chat creation failed");
    }
  }

  async function handleCreateWiki(name: string) {
    setWikiBusy(true);
    setError(null);

    try {
      const payload = await createWiki(name);
      applySnapshot(payload);
      setComposerValue("");
      setQueuedFiles([]);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Wiki creation failed");
      throw caughtError;
    } finally {
      setWikiBusy(false);
    }
  }

  async function handleActivateWiki(wikiId: string) {
    setWikiBusy(true);
    setError(null);

    try {
      const payload = await activateWiki(wikiId);
      applySnapshot(payload);
      setComposerValue("");
      setQueuedFiles([]);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Wiki switch failed");
      throw caughtError;
    } finally {
      setWikiBusy(false);
    }
  }

  async function handleDeleteWiki(wikiId: string, confirmationText: string) {
    setWikiBusy(true);
    setError(null);

    try {
      const payload = await deleteWiki(wikiId, confirmationText);
      applySnapshot(payload);
      setComposerValue("");
      setQueuedFiles([]);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Wiki deletion failed");
      throw caughtError;
    } finally {
      setWikiBusy(false);
    }
  }

  async function handleRenameChat(chatId: string, title: string) {
    setError(null);

    try {
      const payload = await renameChat(chatId, title);
      startTransition(() => {
        setChats((previous) => [payload.chatSummary, ...previous.filter((chat) => chat.id !== payload.chatSummary.id)]);
        setCurrentChat((previous) => (previous?.id === payload.chat.id ? (payload.chat as UiChat) : previous));
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Chat rename failed");
      throw caughtError;
    }
  }

  async function handleDeleteChat(chatId: string) {
    setError(null);

    try {
      const payload = await deleteChat(chatId);
      startTransition(() => {
        setChats(payload.chats);
        setCurrentChat((previous) => (previous?.id === chatId ? (payload.fallbackChat as UiChat | null) : previous));
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Chat deletion failed");
      throw caughtError;
    }
  }

  async function handleSaveSettings(nextSettings: NonNullable<typeof settings>) {
    setSavingSettings(true);
    setError(null);

    try {
      const saved = await saveSettings(nextSettings);
      applySnapshot(saved);
      setSettingsOpen(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Settings save failed");
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleSubmit() {
    if (!currentChat || sending || (!composerValue.trim() && queuedFiles.length === 0)) {
      return;
    }

    setSending(true);
    setError(null);

    const localUserMessage: UiMessage = {
      id: `local-user-${crypto.randomUUID()}`,
      role: "user",
      content: composerValue.trim(),
      createdAt: new Date().toISOString(),
      attachments: queuedFiles.map((file, index) => ({
        id: `local-att-${index}`,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
      })),
    };

    let activeAssistantId = "";
    const filesForUpload = queuedFiles;
    const messageText = composerValue.trim();

    startTransition(() => {
      setCurrentChat((previous) =>
        previous
          ? {
              ...previous,
              messages: [...previous.messages, localUserMessage],
            }
          : previous,
      );
      setComposerValue("");
      setQueuedFiles([]);
    });

    try {
      await streamChat({
        chatId: currentChat.id,
        message: messageText,
        files: filesForUpload,
        onEvent: (event) => {
          if (event.type === "message-start") {
            activeAssistantId = event.messageId;
            startTransition(() => {
              setCurrentChat((previous) =>
                previous
                  ? {
                      ...previous,
                      messages: [
                        ...previous.messages,
                        {
                          id: event.messageId,
                          role: "assistant",
                          content: "",
                          createdAt: event.createdAt,
                          activities: [],
                          pending: true,
                        },
                      ],
                    }
                  : previous,
              );
            });
            return;
          }

          if (event.type === "activity") {
            startTransition(() => {
              setCurrentChat((previous) =>
                previous
                  ? {
                      ...previous,
                      messages: previous.messages.map((message) =>
                        message.id === activeAssistantId
                          ? {
                              ...message,
                              activities: [...(message.activities ?? []), event.activity],
                            }
                          : message,
                      ),
                    }
                  : previous,
              );
            });
            return;
          }

          if (event.type === "assistant-token") {
            startTransition(() => {
              setCurrentChat((previous) =>
                previous
                  ? {
                      ...previous,
                      messages: previous.messages.map((message) =>
                        message.id === activeAssistantId
                          ? {
                              ...message,
                              content: `${message.content}${event.text}`,
                            }
                          : message,
                      ),
                    }
                  : previous,
              );
            });
            return;
          }

          if (event.type === "assistant-final") {
            startTransition(() => {
              setCurrentChat((previous) =>
                previous
                  ? {
                      ...previous,
                      updatedAt: event.chatSummary.updatedAt,
                      messages: previous.messages.map((message) =>
                        message.id === event.message.id
                          ? { ...event.message, pending: false }
                          : message,
                      ),
                    }
                  : previous,
              );
              setChats((previous) => {
                const existing = previous.filter((chat) => chat.id !== event.chatSummary.id);
                return [event.chatSummary, ...existing];
              });
            });
            return;
          }

          if (event.type === "error") {
            setError(event.error);
          }
        },
      });
    } catch (caughtError) {
      startTransition(() => {
        setCurrentChat((previous) =>
          previous
            ? {
                ...previous,
                messages: previous.messages.filter((message) => message.id !== activeAssistantId),
              }
            : previous,
        );
      });
      setError(caughtError instanceof Error ? caughtError.message : "Streaming failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <main className="workspace">
        <header className="app-header">
          <div className="brand-block">
            <img src="/icon.png" alt="WikiClaw icon" className="brand-icon" />
            <div className="brand-copy">
              <h1>{dictionary.appName}</h1>
              {dictionary.appTagline ? <p className="brand-subtitle">{dictionary.appTagline}</p> : null}
            </div>
          </div>

          <div className="header-actions">
            <button
              className="wiki-switcher-button"
              onClick={() => setWikiManagerOpen(true)}
              type="button"
              disabled={loading || sending || wikiBusy}
              title={dictionary.openWikiManager}
            >
              <span className="eyebrow">{dictionary.activeWiki}</span>
              <strong>{activeWiki?.name ?? dictionary.loading}</strong>
              <span className="wiki-switcher-meta">
                {activeWiki ? `${activeWiki.pageCount} ${dictionary.pagesLabel}` : settings?.wikiPath ?? ""}
              </span>
            </button>
            <button className="secondary-button" onClick={() => setSettingsOpen(true)} type="button">
              {dictionary.settings}
            </button>
          </div>
        </header>

        <section className="main-panel">
          <ChatSidebar
            chats={chats}
            activeChatId={currentChat?.id}
            busy={loading || sending || wikiBusy}
            dictionary={dictionary}
            onSelect={handleSelectChat}
            onCreate={() => void handleCreateChat()}
            onRename={(chatId, title) => handleRenameChat(chatId, title)}
            onDelete={(chatId) => handleDeleteChat(chatId)}
          />

          <section className="chat-panel">
            <div className="chat-toolbar">
              <div className="chat-toolbar-copy">
                <strong>{activeWiki?.name ?? dictionary.appName}</strong>
                <span>{dictionary.chatToolbar}</span>
              </div>
            </div>

            <div className="chat-scroll" ref={chatScrollRef}>
              {loading ? <p className="muted-copy">{dictionary.loading}</p> : null}
              {error ? <div className="error-banner">{error}</div> : null}
              {currentChat ? (
                <MessageList
                  messages={currentChat.messages}
                  dictionary={dictionary}
                  onSuggestion={(value) => setComposerValue(value)}
                />
              ) : null}
            </div>

            <Composer
              value={composerValue}
              files={queuedFiles}
              disabled={sending || !currentChat}
              dictionary={dictionary}
              onChange={setComposerValue}
              onAddFiles={(files) => setQueuedFiles((previous) => [...previous, ...(files ? Array.from(files) : [])])}
              onRemoveFile={(index) => setQueuedFiles((previous) => previous.filter((_, itemIndex) => itemIndex !== index))}
              onSubmit={handleSubmit}
            />
          </section>
        </section>
      </main>

      <SettingsDrawer
        open={settingsOpen}
        settings={settings}
        dictionary={dictionary}
        saving={savingSettings}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
      />

      <WikiManagerDialog
        open={wikiManagerOpen}
        wikis={wikis}
        activeWikiId={activeWikiId ?? undefined}
        busy={loading || sending || wikiBusy}
        dictionary={dictionary}
        onClose={() => setWikiManagerOpen(false)}
        onCreate={handleCreateWiki}
        onActivate={handleActivateWiki}
        onDelete={handleDeleteWiki}
      />
    </div>
  );
}
