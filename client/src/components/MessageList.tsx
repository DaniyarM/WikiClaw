import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ActivityItem, ChatMessage } from "../../../shared/contracts";
import type { Dictionary } from "../i18n/messages";

interface MessageListProps {
  messages: Array<ChatMessage & { pending?: boolean }>;
  dictionary: Dictionary;
  onSuggestion?: (value: string) => void;
}

function splitDelimitedCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.includes("|")) {
    return null;
  }

  const cells = trimmed
    .split(/\t+| {2,}/)
    .map((cell) => cell.trim())
    .filter(Boolean);

  return cells.length >= 2 ? cells : null;
}

function normalizeAssistantMarkdown(content: string): string {
  const lines = content.split("\n");
  const output: string[] = [];
  let index = 0;
  let inCodeFence = false;

  while (index < lines.length) {
    const line = lines[index];

    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      output.push(line);
      index += 1;
      continue;
    }

    if (inCodeFence) {
      output.push(line);
      index += 1;
      continue;
    }

    const rows: string[][] = [];
    let cursor = index;
    while (cursor < lines.length) {
      const cells = splitDelimitedCells(lines[cursor] ?? "");
      if (!cells) {
        break;
      }
      rows.push(cells);
      cursor += 1;
    }

    const maxColumns = rows[0]?.length ?? 0;
    const isTableBlock =
      rows.length >= 2 &&
      maxColumns >= 2 &&
      rows.every((row) => row.length === maxColumns);

    if (isTableBlock) {
      const [header, ...body] = rows;
      output.push(
        `| ${header.join(" | ")} |`,
        `| ${header.map(() => "---").join(" | ")} |`,
        ...body.map((row) => `| ${row.join(" | ")} |`),
      );
      index = cursor;
      continue;
    }

    output.push(line);
    index += 1;
  }

  return output.join("\n");
}

function activityLabel(kind: ActivityItem["kind"], dictionary: Dictionary): string {
  if (kind === "web") {
    return dictionary.web;
  }

  if (kind === "file") {
    return dictionary.file;
  }

  if (kind === "warning") {
    return dictionary.warning;
  }

  return dictionary.status;
}

export function MessageList(props: MessageListProps) {
  if (props.messages.length === 0) {
    const suggestions = [
      {
        title: props.dictionary.starterIngestTitle,
        body: props.dictionary.starterIngestBody,
        prompt: props.dictionary.starterIngestPrompt,
      },
      {
        title: props.dictionary.starterGapsTitle,
        body: props.dictionary.starterGapsBody,
        prompt: props.dictionary.starterGapsPrompt,
      },
      {
        title: props.dictionary.starterResearchTitle,
        body: props.dictionary.starterResearchBody,
        prompt: props.dictionary.starterResearchPrompt,
      },
    ];

    return (
      <div className="empty-state">
        <span className="eyebrow">WikiClaw</span>
        <h2>{props.dictionary.emptyTitle}</h2>
        <p>{props.dictionary.emptyBody}</p>
        <p className="muted-copy">{props.dictionary.emptyHint}</p>
        <div className="starter-grid">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.title}
              className="starter-card"
              onClick={() => props.onSuggestion?.(suggestion.prompt)}
              type="button"
            >
              <strong>{suggestion.title}</strong>
              <span>{suggestion.body}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="message-list">
      {props.messages.map((message) => (
        <article key={message.id} className={`message-card ${message.role}`}>
          <header className="message-meta">
            <span>{message.role === "assistant" ? props.dictionary.agent : props.dictionary.you}</span>
            <time>{new Date(message.createdAt).toLocaleTimeString()}</time>
          </header>

          {message.role === "assistant" && (message.activities?.length ?? 0) > 0 ? (() => {
            const latestActivity = message.activities?.at(-1);

            return (
              <details className={`activity-panel ${message.pending ? "live" : ""}`} open={message.pending}>
                <summary className={message.pending ? "live" : ""}>
                  <span>{props.dictionary.thinking}</span>
                  {message.pending ? (
                    <span className="activity-live-badge">
                      <span className="activity-live-dot" />
                      {latestActivity?.title}
                    </span>
                  ) : null}
                </summary>
              <div className="activity-list">
                {message.activities?.map((activity) => (
                  <div
                    key={activity.id}
                    className={`activity-item ${activity.kind} ${message.pending && activity.id === latestActivity?.id ? "live" : ""}`}
                  >
                    <span className="activity-kind">{activityLabel(activity.kind, props.dictionary)}</span>
                    <div>
                      <strong>{activity.title}</strong>
                      {activity.detail ? <p>{activity.detail}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
              </details>
            );
          })() : null}

          <div className="message-body">
            {message.role === "assistant" ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {normalizeAssistantMarkdown(message.content || "...")}
              </ReactMarkdown>
            ) : (
              <p>{message.content}</p>
            )}
          </div>

          {message.attachments && message.attachments.length > 0 ? (
            <div className="attachment-strip">
              {message.attachments.map((attachment) => (
                <span key={attachment.id} className="attachment-pill">
                  {attachment.name}
                </span>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
