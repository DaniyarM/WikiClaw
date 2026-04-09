import type { Dictionary } from "../i18n/messages";

interface ComposerProps {
  value: string;
  files: File[];
  disabled: boolean;
  dictionary: Dictionary;
  onChange: (value: string) => void;
  onAddFiles: (files: FileList | null) => void;
  onRemoveFile: (index: number) => void;
  onSubmit: () => void;
}

export function Composer(props: ComposerProps) {
  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    props.onSubmit();
  }

  return (
    <div className="composer-shell">
      {props.files.length > 0 ? (
        <div className="queued-files">
          <span className="queued-label">{props.dictionary.attachedFiles}</span>
          <div className="queued-list">
            {props.files.map((file, index) => (
              <button
                key={`${file.name}-${index}`}
                className="attachment-pill removable"
                onClick={() => props.onRemoveFile(index)}
                type="button"
              >
                {file.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="composer">
        <textarea
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={props.dictionary.composerPlaceholder}
          rows={4}
          disabled={props.disabled}
        />

        <div className="composer-actions">
          <label className="secondary-button file-picker">
            {props.dictionary.attach}
            <input
              type="file"
              multiple
              accept=".md,.txt,.pdf"
              onChange={(event) => props.onAddFiles(event.target.files)}
              disabled={props.disabled}
            />
          </label>

          <button className="primary-button" onClick={props.onSubmit} disabled={props.disabled} type="button">
            {props.dictionary.send}
          </button>
        </div>
      </div>
    </div>
  );
}
