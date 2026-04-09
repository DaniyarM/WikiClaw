import { useEffect, useState } from "react";
import type { WikiSummary } from "../../../shared/contracts";
import type { Dictionary } from "../i18n/messages";

interface WikiManagerDialogProps {
  open: boolean;
  wikis: WikiSummary[];
  activeWikiId?: string;
  busy: boolean;
  dictionary: Dictionary;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onActivate: (wikiId: string) => Promise<void>;
  onDelete: (wikiId: string, confirmationText: string) => Promise<void>;
}

export function WikiManagerDialog(props: WikiManagerDialogProps) {
  const [draftName, setDraftName] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<WikiSummary | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) {
      setDraftName("");
      setDeleteCandidate(null);
      setConfirmationText("");
      setPendingAction(null);
    }
  }, [props.open]);

  useEffect(() => {
    if (!deleteCandidate) {
      return;
    }

    if (!props.wikis.some((wiki) => wiki.id === deleteCandidate.id)) {
      setDeleteCandidate(null);
      setConfirmationText("");
    }
  }, [deleteCandidate, props.wikis]);

  useEffect(() => {
    if (!props.open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || pendingAction) {
        return;
      }

      if (deleteCandidate) {
        setDeleteCandidate(null);
        setConfirmationText("");
        return;
      }

      props.onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteCandidate, pendingAction, props.onClose, props.open]);

  if (!props.open) {
    return null;
  }

  async function handleCreate() {
    const nextName = draftName.replace(/\s+/g, " ").trim();
    if (!nextName) {
      return;
    }

    setPendingAction("create");
    try {
      await props.onCreate(nextName);
      props.onClose();
    } finally {
      setPendingAction(null);
    }
  }

  async function handleActivate(wikiId: string) {
    setPendingAction(`activate:${wikiId}`);
    try {
      await props.onActivate(wikiId);
      props.onClose();
    } finally {
      setPendingAction(null);
    }
  }

  async function handleDelete() {
    if (!deleteCandidate) {
      return;
    }

    setPendingAction(`delete:${deleteCandidate.id}`);
    try {
      await props.onDelete(deleteCandidate.id, confirmationText);
      setDeleteCandidate(null);
      setConfirmationText("");
      props.onClose();
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <>
      <div className="settings-backdrop" onClick={() => !pendingAction && props.onClose()}>
        <section className="wiki-manager-dialog" onClick={(event) => event.stopPropagation()}>
          <div className="settings-header">
            <div>
              <h2>{props.dictionary.wikiManagerTitle}</h2>
              <p>{props.dictionary.wikiManagerHint}</p>
            </div>
            <button className="ghost-button" onClick={props.onClose} type="button" disabled={Boolean(pendingAction)}>
              ×
            </button>
          </div>

          <div className="wiki-create-card">
            <div>
              <span className="eyebrow">{props.dictionary.newWiki}</span>
              <h3>{props.dictionary.wikiCreateTitle}</h3>
              <p>{props.dictionary.wikiCreateHint}</p>
            </div>

            <div className="wiki-create-form">
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder={props.dictionary.wikiNamePlaceholder}
                disabled={props.busy || pendingAction === "create"}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleCreate();
                  }
                }}
              />
              <button
                className="primary-button"
                onClick={() => void handleCreate()}
                type="button"
                disabled={props.busy || pendingAction === "create" || !draftName.trim()}
              >
                {props.dictionary.createWikiAction}
              </button>
            </div>
          </div>

          <div className="wiki-list">
            {props.wikis.map((wiki) => {
              const isActive = wiki.id === props.activeWikiId;
              const deleting = pendingAction === `delete:${wiki.id}`;
              const activating = pendingAction === `activate:${wiki.id}`;

              return (
                <article key={wiki.id} className={`wiki-card ${isActive ? "active" : ""}`}>
                  <div className="wiki-card-header">
                    <div>
                      <h3>{wiki.name}</h3>
                      <div className="wiki-card-badges">
                        <span className={`wiki-badge ${isActive ? "accent" : ""}`}>
                          {isActive ? props.dictionary.currentWikiAction : props.dictionary.switchWikiAction}
                        </span>
                        <span className="wiki-badge subtle">
                          {wiki.managed ? props.dictionary.managedWiki : props.dictionary.linkedWiki}
                        </span>
                      </div>
                    </div>

                    <div className="wiki-card-stats">
                      {wiki.pageCount} {props.dictionary.pagesLabel}
                    </div>
                  </div>

                  <p className="wiki-card-path">{wiki.path}</p>

                  <div className="wiki-card-actions">
                    <button
                      className="secondary-button"
                      onClick={() => void handleActivate(wiki.id)}
                      type="button"
                      disabled={props.busy || isActive || activating || deleting}
                    >
                      {isActive ? props.dictionary.currentWikiAction : props.dictionary.switchWikiAction}
                    </button>

                    {wiki.canDelete ? (
                      <button
                        className="ghost-button history-icon-button destructive"
                        onClick={() => {
                          setDeleteCandidate(wiki);
                          setConfirmationText("");
                        }}
                        type="button"
                        disabled={props.busy || activating || deleting}
                      >
                        {props.dictionary.deleteChat}
                      </button>
                    ) : (
                      <span className="wiki-badge protected">{props.dictionary.protectedWiki}</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      {deleteCandidate ? (
        <div
          className="critical-backdrop"
          onClick={() => {
            if (!pendingAction) {
              setDeleteCandidate(null);
              setConfirmationText("");
            }
          }}
        >
          <section className="critical-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="critical-sign" aria-hidden="true">
              !
            </div>
            <span className="eyebrow">{props.dictionary.deleteWikiAction}</span>
            <h3>{props.dictionary.deleteWikiTitle}</h3>
            <p>{props.dictionary.deleteWikiBody}</p>

            <div className="critical-target">
              <strong>{deleteCandidate.name}</strong>
              <span>{deleteCandidate.path}</span>
            </div>

            <label className="critical-confirm-field">
              <span>{props.dictionary.deleteWikiPrompt}</span>
              <input
                value={confirmationText}
                onChange={(event) => setConfirmationText(event.target.value)}
                placeholder={deleteCandidate.name}
                disabled={Boolean(pendingAction)}
                autoFocus
              />
            </label>

            <p className="critical-warning">{props.dictionary.deleteWikiWarning}</p>

            <div className="confirm-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  setDeleteCandidate(null);
                  setConfirmationText("");
                }}
                type="button"
                disabled={Boolean(pendingAction)}
              >
                {props.dictionary.cancel}
              </button>
              <button
                className="primary-button critical-delete-button"
                onClick={() => void handleDelete()}
                type="button"
                disabled={Boolean(pendingAction) || confirmationText.trim() !== deleteCandidate.name}
              >
                {props.dictionary.deleteWikiAction}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
