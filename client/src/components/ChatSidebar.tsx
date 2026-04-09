import { useEffect, useState } from "react";
import type { ChatSummary } from "../../../shared/contracts";
import type { Dictionary } from "../i18n/messages";

interface ChatSidebarProps {
  chats: ChatSummary[];
  activeChatId?: string;
  busy: boolean;
  dictionary: Dictionary;
  onSelect: (chatId: string) => void;
  onCreate: () => void;
  onRename: (chatId: string, title: string) => Promise<void>;
  onDelete: (chatId: string) => Promise<void>;
}

function isSystemUntitled(title: string): boolean {
  return title === "New chat" || title === "Новый чат";
}

export function ChatSidebar(props: ChatSidebarProps) {
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [pendingChatId, setPendingChatId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<ChatSummary | null>(null);

  useEffect(() => {
    if (!editingChatId) {
      return;
    }

    if (!props.chats.some((chat) => chat.id === editingChatId)) {
      setEditingChatId(null);
      setDraftTitle("");
    }
  }, [editingChatId, props.chats]);

  useEffect(() => {
    if (!deleteCandidate) {
      return;
    }

    if (!props.chats.some((chat) => chat.id === deleteCandidate.id)) {
      setDeleteCandidate(null);
    }
  }, [deleteCandidate, props.chats]);

  useEffect(() => {
    if (!deleteCandidate) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pendingChatId !== deleteCandidate.id) {
        setDeleteCandidate(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteCandidate, pendingChatId]);

  function displayTitle(chat: ChatSummary): string {
    if (chat.messageCount === 0 && isSystemUntitled(chat.title)) {
      return props.dictionary.untitledChat;
    }

    return chat.title;
  }

  function startEditing(chat: ChatSummary) {
    setEditingChatId(chat.id);
    setDraftTitle(displayTitle(chat));
  }

  function cancelEditing() {
    setEditingChatId(null);
    setDraftTitle("");
  }

  async function submitRename(chatId: string) {
    const nextTitle = draftTitle.trim();
    if (!nextTitle) {
      return;
    }

    setPendingChatId(chatId);
    try {
      await props.onRename(chatId, nextTitle);
      cancelEditing();
    } catch {
      return;
    } finally {
      setPendingChatId(null);
    }
  }

  async function confirmDelete(chatId: string) {
    setPendingChatId(chatId);
    try {
      await props.onDelete(chatId);
      setDeleteCandidate(null);
      if (editingChatId === chatId) {
        cancelEditing();
      }
    } catch {
      return;
    } finally {
      setPendingChatId(null);
    }
  }

  return (
    <>
      <aside className="history-panel">
        <button className="primary-button history-new-chat" onClick={props.onCreate} disabled={props.busy}>
          {props.dictionary.newChat}
        </button>

        <div className="history-header">
          <span>{props.dictionary.history}</span>
        </div>

        <div className="history-list">
          {props.chats.length === 0 ? (
            <p className="muted-copy">{props.dictionary.noChats}</p>
          ) : (
            props.chats.map((chat) => (
              <div key={chat.id} className={`history-item ${chat.id === props.activeChatId ? "active" : ""}`}>
                {editingChatId === chat.id ? (
                  <div className="history-edit">
                    <input
                      className="history-edit-input"
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      placeholder={props.dictionary.renamePlaceholder}
                      disabled={props.busy || pendingChatId === chat.id}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void submitRename(chat.id);
                        }

                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelEditing();
                        }
                      }}
                      autoFocus
                    />

                    <div className="history-edit-actions">
                      <button
                        className="secondary-button history-action-button"
                        onClick={() => void submitRename(chat.id)}
                        disabled={props.busy || pendingChatId === chat.id || !draftTitle.trim()}
                        type="button"
                      >
                        {props.dictionary.save}
                      </button>
                      <button
                        className="ghost-button history-action-button"
                        onClick={cancelEditing}
                        disabled={props.busy || pendingChatId === chat.id}
                        type="button"
                      >
                        {props.dictionary.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="history-item-shell">
                    <button
                      className="history-select"
                      onClick={() => props.onSelect(chat.id)}
                      type="button"
                      disabled={props.busy && chat.id !== props.activeChatId}
                    >
                      <strong>{displayTitle(chat)}</strong>
                      <span>{chat.lastMessagePreview || "..."}</span>
                    </button>

                    <div className="history-item-actions">
                      <button
                        className="ghost-button history-icon-button"
                        onClick={() => startEditing(chat)}
                        disabled={props.busy || pendingChatId === chat.id}
                        type="button"
                        title={props.dictionary.renameChat}
                      >
                        {props.dictionary.renameChat}
                      </button>
                      <button
                        className="ghost-button history-icon-button destructive"
                        onClick={() => setDeleteCandidate(chat)}
                        disabled={props.busy || pendingChatId === chat.id}
                        type="button"
                        title={props.dictionary.deleteChat}
                      >
                        {props.dictionary.deleteChat}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </aside>

      {deleteCandidate ? (
        <div
          className="confirm-backdrop"
          onClick={() => {
            if (pendingChatId !== deleteCandidate.id) {
              setDeleteCandidate(null);
            }
          }}
        >
          <section className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
            <span className="eyebrow">{props.dictionary.deleteChat}</span>
            <h3>{props.dictionary.deleteChatTitle}</h3>
            <p>{props.dictionary.deleteChatBody}</p>
            <div className="confirm-chat-preview">
              <strong>{displayTitle(deleteCandidate)}</strong>
              <span>{deleteCandidate.lastMessagePreview || "..."}</span>
            </div>
            <div className="confirm-actions">
              <button
                className="secondary-button"
                onClick={() => setDeleteCandidate(null)}
                disabled={pendingChatId === deleteCandidate.id}
                type="button"
              >
                {props.dictionary.cancel}
              </button>
              <button
                className="primary-button confirm-delete-button"
                onClick={() => void confirmDelete(deleteCandidate.id)}
                disabled={pendingChatId === deleteCandidate.id}
                type="button"
              >
                {props.dictionary.deleteChatAction}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
