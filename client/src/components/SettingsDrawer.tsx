import { useEffect, useState } from "react";
import type { AppSettings } from "../../../shared/contracts";
import type { Dictionary } from "../i18n/messages";

interface SettingsDrawerProps {
  open: boolean;
  settings: AppSettings | null;
  dictionary: Dictionary;
  saving: boolean;
  onClose: () => void;
  onSave: (nextSettings: AppSettings) => Promise<void>;
}

export function SettingsDrawer(props: SettingsDrawerProps) {
  const [draft, setDraft] = useState<AppSettings | null>(props.settings);

  useEffect(() => {
    setDraft(props.settings);
  }, [props.settings]);

  if (!props.open || !draft) {
    return null;
  }

  return (
    <div className="settings-backdrop" onClick={props.onClose}>
      <section className="settings-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="settings-header">
          <div>
            <h2>{props.dictionary.settings}</h2>
            <p>{props.dictionary.settingsHint}</p>
          </div>
          <button className="ghost-button" onClick={props.onClose} type="button">
            ×
          </button>
        </div>

        <div className="settings-grid">
          <label>
            <span>{props.dictionary.provider}</span>
            <select
              value={draft.provider}
              onChange={(event) => setDraft({ ...draft, provider: event.target.value as AppSettings["provider"] })}
            >
              <option value="ollama">{props.dictionary.ollama}</option>
              <option value="openai-compatible">{props.dictionary.openaiCompatible}</option>
            </select>
          </label>

          <label>
            <span>{props.dictionary.baseUrl}</span>
            <input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} />
          </label>

          <label>
            <span>{props.dictionary.model}</span>
            <input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} />
          </label>

          <label>
            <span>{props.dictionary.apiKey}</span>
            <input
              type="password"
              value={draft.apiKey}
              onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
            />
          </label>

          <label className="full-width">
            <span>{props.dictionary.wikiPath}</span>
            <input value={draft.wikiPath} onChange={(event) => setDraft({ ...draft, wikiPath: event.target.value })} />
          </label>

          <label>
            <span>{props.dictionary.language}</span>
            <select
              value={draft.language}
              onChange={(event) => setDraft({ ...draft, language: event.target.value as AppSettings["language"] })}
            >
              <option value="en">{props.dictionary.english}</option>
              <option value="ru">{props.dictionary.russian}</option>
            </select>
          </label>

          <label>
            <span>{props.dictionary.temperature}</span>
            <input
              type="number"
              min="0"
              max="1.5"
              step="0.1"
              value={draft.temperature}
              onChange={(event) => setDraft({ ...draft, temperature: Number(event.target.value) })}
            />
          </label>

          <label>
            <span>{props.dictionary.maxContextPages}</span>
            <input
              type="number"
              min="2"
              max="12"
              step="1"
              value={draft.maxContextPages}
              onChange={(event) => setDraft({ ...draft, maxContextPages: Number(event.target.value) })}
            />
          </label>

          <label className="toggle-row">
            <span>{props.dictionary.allowWebSearch}</span>
            <input
              type="checkbox"
              checked={draft.allowWebSearch}
              onChange={(event) => setDraft({ ...draft, allowWebSearch: event.target.checked })}
            />
          </label>
        </div>

        <div className="settings-footer">
          <button className="secondary-button" onClick={props.onClose} type="button">
            {props.dictionary.cancel}
          </button>
          <button className="primary-button" onClick={() => props.onSave(draft)} disabled={props.saving} type="button">
            {props.saving ? props.dictionary.saving : props.dictionary.save}
          </button>
        </div>
      </section>
    </div>
  );
}
