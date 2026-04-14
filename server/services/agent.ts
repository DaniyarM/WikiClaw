import path from "node:path";
import type {
  ActivityItem,
  AppSettings,
  ChatMessage,
  ChatSession,
  Language,
  WebResearchBundle as StoredWebResearchBundle,
} from "../../shared/contracts.js";
import { createId } from "../lib/ids.js";
import {
  completeText,
  describeLlmTemporaryUnavailability,
  isLlmTemporarilyUnavailable,
  streamText,
  type LlmMessage,
} from "./llmClient.js";
import {
  appendLogEntry,
  applyWikiWrites,
  getPageIndex,
  getWikiDiagnostics,
  readWikiSchema,
  reindexWiki,
  searchRelevantPages,
  type AttachmentDocument,
  type FileOperation,
} from "./wikiManager.js";
import { enrichResult, sanitizeWebQuery, searchWeb } from "./webSearch.js";

type AgentIntent = "ingest" | "query" | "lint" | "update" | "chat";
const LLM_RETRY_DELAY_MS = 3_000;

interface PlannerDecision {
  intent: AgentIntent;
  goal: string;
  needsWikiWrite: boolean;
  needsWebSearch: boolean;
  webQueries: string[];
  relevantTerms: string[];
}

interface AgentDraft {
  operations: FileOperation[];
  logTitle: string;
  logBody: string;
  answerBrief: string;
  missingTopics: string[];
  followUpQuestions: string[];
}

export interface AgentRunInput {
  settings: AppSettings;
  chat: ChatSession;
  userMessage: ChatMessage;
  attachments: AttachmentDocument[];
  onActivity: (activity: ActivityItem) => void;
  onThinkingToken: (token: string) => void;
  onToken: (token: string) => void;
}

export interface AgentRunResult {
  activities: ActivityItem[];
  thinkingSummary: string;
  assistantContent: string;
  changedPaths: string[];
  missingTopics: string[];
  webQueries: string[];
  webResearch: StoredWebResearchBundle[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createActivity(kind: ActivityItem["kind"], title: string, detail?: string): ActivityItem {
  return {
    id: createId("act_"),
    kind,
    title,
    detail,
    createdAt: new Date().toISOString(),
  };
}

function getUiText(language: Language) {
  if (language === "ru") {
    const intentLabels: Record<AgentIntent, string> = {
      ingest: "добавление",
      query: "вопрос",
      lint: "проверка базы",
      update: "правка базы",
      chat: "диалог",
    };

    return {
      loadedWiki: (wikiPath: string) => `Загружена wiki: ${wikiPath}`,
      scanComplete: "Сканирование wiki завершено",
      planningStart: "Определение намерения",
      planningStartDetail: "Агент определяет, это добавление, вопрос, актуализация или правка базы.",
      planningProgress: (seconds: number) => `Планирование всё ещё выполняется (${seconds} с)`,
      planningProgressDetail: "Локальная модель анализирует запрос и подбирает стратегию.",
      intentTitle: (intent: AgentIntent) => `Намерение: ${intentLabels[intent]}`,
      selectedContext: "Подобран контекст wiki",
      draftingStartWrite: "Подготовка изменений wiki",
      draftingStartRead: "Подготовка ответа",
      draftingProgress: (seconds: number) => `Подготовка всё ещё идёт (${seconds} с)`,
      draftingProgressDetailWrite: "Модель формирует безопасные правки файлов и итоговый ответ.",
      draftingProgressDetailRead: "Модель формирует ответ на основе текущей wiki.",
      updatedFiles: "Обновлены файлы wiki",
      missingEvidence: "Пока не хватает подтверждённых данных",
      searchingWeb: "Выполняется web-поиск",
      webSearchFailed: "Web-поиск недоступен",
      webSearchEmpty: "Web-поиск не дал надёжных результатов",
      writingAnswer: "Формирование ответа",
      writingAnswerDetail: "Запрос отправлен модели, ожидаю первый токен.",
      thinkingSummary: "Thinking",
      thinkingSummaryDetail: "Показываю поток размышлений, который сама модель возвращает через API.",
      answerStreaming: "Ответ выводится в чат",
      answerStreamingDetail: "Модель начала потоковую генерацию ответа.",
      llmUnavailable: "LLM недоступна",
      llmUnavailableDetail: (detail: string) =>
        `${detail} Автоматически переподключаюсь и продолжу работу после восстановления.`,
      llmRecovered: "Связь с LLM восстановлена",
      llmRecoveredDetail: "Продолжаю работу с того же шага.",
      heuristicIngest: "Интегрировать приложенные материалы в базу знаний.",
      heuristicLint: "Перепроверить и актуализировать базу знаний: найти пропущенные связи, обновить карточки и выявить пробелы.",
      heuristicUpdate: "Внести запрошенное изменение в wiki.",
      heuristicQuery: "Ответить на вопрос по текущему состоянию wiki.",
      noAnswer: "Готово.",
    };
  }

  return {
    loadedWiki: (wikiPath: string) => `Loaded wiki: ${wikiPath}`,
    scanComplete: "Wiki scan complete",
    planningStart: "Determining intent",
    planningStartDetail: "The agent is deciding whether this is ingest, query, lint, or a wiki edit.",
    planningProgress: (seconds: number) => `Planning still running (${seconds}s)`,
    planningProgressDetail: "The local model is analyzing the request and choosing a strategy.",
    intentTitle: (intent: AgentIntent) => `Intent: ${intent}`,
    selectedContext: "Selected wiki context",
    draftingStartWrite: "Preparing wiki changes",
    draftingStartRead: "Preparing answer",
    draftingProgress: (seconds: number) => `Preparation still running (${seconds}s)`,
    draftingProgressDetailWrite: "The model is preparing safe file edits and the final reply.",
    draftingProgressDetailRead: "The model is preparing an answer from the current wiki.",
    updatedFiles: "Updated wiki files",
    missingEvidence: "Still missing grounded evidence",
    searchingWeb: "Searching the web",
    webSearchFailed: "Web search unavailable",
    webSearchEmpty: "Web search returned no grounded results",
    writingAnswer: "Writing answer",
    writingAnswerDetail: "The request was sent to the model and is waiting for the first token.",
    thinkingSummary: "Thinking",
    thinkingSummaryDetail: "Showing the model thinking stream returned by the provider.",
    answerStreaming: "Reply streaming into chat",
    answerStreamingDetail: "The model has started streaming the final answer.",
    llmUnavailable: "LLM unavailable",
    llmUnavailableDetail: (detail: string) =>
      `${detail} I will keep retrying automatically and resume work when the model comes back.`,
    llmRecovered: "LLM connection restored",
    llmRecoveredDetail: "Resuming work from the same step.",
    heuristicIngest: "Integrate the attached material into the knowledge base.",
    heuristicLint: "Audit and refresh the wiki: repair missed links, update pages when grounded, and report remaining gaps.",
    heuristicUpdate: "Apply the requested wiki update.",
    heuristicQuery: "Answer the question from the current wiki.",
    noAnswer: "Done.",
  };
}

function sanitizeBriefForMode(text: string, allowWrites: boolean): string {
  const lines = text
    .split("\n")
    .map((line) => line.trimEnd());

  const filtered: string[] = [];
  let skipFollowingFileBullets = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      skipFollowingFileBullets = false;
      filtered.push(line);
      continue;
    }

    const referencesFiles = /(`[^`]+\.md`|pages\/|sources\/|notes\/|файл|файлы|страниц|страницы|page|pages|file|files|база знаний|knowledge base|wiki)/i.test(trimmed);
    const claimsWrite = /(созда|добавл|обновл|измен|created|added|updated|changed)/i.test(trimmed);

    if (/^\*\*Измен[её]нные файлы:/i.test(trimmed) || /^Changed files:/i.test(trimmed)) {
      skipFollowingFileBullets = true;
      continue;
    }

    if (skipFollowingFileBullets && /^[-*]\s+/.test(trimmed)) {
      continue;
    }

    if (!allowWrites && referencesFiles && claimsWrite) {
      continue;
    }

    filtered.push(line);
  }

  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildFinalAnswer(options: {
  language: Language;
  intent: AgentIntent;
  brief: string;
  changedPaths: string[];
  missingTopics: string[];
  webQueries: string[];
  webBundles?: StoredWebResearchBundle[];
}): string {
  const isRussian = options.language === "ru";
  const sections: string[] = [];
  const allowWrites = options.changedPaths.length > 0;
  const sanitizedBrief = sanitizeBriefForMode(options.brief, allowWrites);
  const fallbackBrief =
    options.intent === "query" || options.intent === "chat"
      ? isRussian
        ? "Недостаточно контекста в этом чате, чтобы ответить точнее."
        : "There is not enough context in this chat to answer more precisely."
      : isRussian
        ? "Готово."
        : "Done.";
  const effectiveBrief = sanitizedBrief || fallbackBrief;

  if (allowWrites) {
    sections.push(
      isRussian ? "## Изменения" : "## Changes",
      ...options.changedPaths.map((filePath) => `- \`${filePath}\``),
      "",
    );
  } else {
    sections.push(isRussian ? "## Статус" : "## Status", isRussian ? "Файлы не изменялись." : "No files were changed.", "");
  }

  sections.push(effectiveBrief, "");

  if (options.missingTopics.length > 0) {
    sections.push(
      isRussian ? "## Недостающие темы" : "## Missing Topics",
      ...options.missingTopics.map((topic) => `- ${topic}`),
      "",
    );
  }

  if (options.webBundles && options.webBundles.length > 0) {
    sections.push(
      isRussian ? "## Web-поиск" : "## Web Research",
      ...options.webBundles.flatMap((bundle) => {
        const header = [`- ${bundle.query}`];
        const refs = bundle.results
          .slice(0, 3)
          .map((result: StoredWebResearchBundle["results"][number]) => `  - ${result.title}: ${result.url}`);
        return [...header, ...refs];
      }),
      "",
    );
  } else if (options.webQueries.length > 0) {
    sections.push(
      isRussian ? "## Web-поиск" : "## Web Research",
      ...options.webQueries.map((query) => `- ${query}`),
      "",
    );
  }

  return sections.join("\n").trim();
}

function buildFinalAnswerMessages(options: {
  language: Language;
  intent: AgentIntent;
  userRequest: string;
  brief: string;
  changedPaths: string[];
  missingTopics: string[];
  webQueries: string[];
  webBundles?: StoredWebResearchBundle[];
}): LlmMessage[] {
  const isRussian = options.language === "ru";
  const allowWrites = options.changedPaths.length > 0;
  const sanitizedBrief = sanitizeBriefForMode(options.brief, allowWrites);
  const fallbackBrief =
    options.intent === "query" || options.intent === "chat"
      ? isRussian
        ? "Недостаточно контекста в этом чате, чтобы ответить точнее."
        : "There is not enough context in this chat to answer more precisely."
      : isRussian
        ? "Готово."
        : "Done.";
  const groundedBrief = sanitizedBrief || fallbackBrief;
  const changedFilesBlock =
    options.changedPaths.length > 0 ? options.changedPaths.map((filePath) => `- ${filePath}`).join("\n") : "none";
  const missingTopicsBlock =
    options.missingTopics.length > 0 ? options.missingTopics.map((topic) => `- ${topic}`).join("\n") : "none";
  const webResearchBlock =
    options.webBundles && options.webBundles.length > 0
      ? options.webBundles
          .map((bundle) => {
            const results = bundle.results
              .slice(0, 3)
              .map(
                (result, index) =>
                  `${index + 1}. ${result.title}\nURL: ${result.url}\nSnippet: ${result.snippet || "n/a"}`.trim(),
              )
              .join("\n\n");
            return `QUERY: ${bundle.query}\n${results}`;
          })
          .join("\n\n---\n\n")
      : options.webQueries.length > 0
        ? options.webQueries.map((query) => `QUERY: ${query}`).join("\n")
        : "none";
  const sectionLabels = {
    status: isRussian ? "Статус" : "Status",
    changes: isRussian ? "Изменения" : "Changes",
    missing: isRussian ? "Недостающие темы" : "Missing Topics",
    web: isRussian ? "Web-поиск" : "Web Research",
  };

  return [
    {
      role: "system",
      content: [
        "You are WikiClaw's final response writer.",
        "Write only the final human-facing markdown answer.",
        "Use only the grounded notes and metadata from the user message.",
        "Do not invent facts, wiki edits, missing topics, or external sources.",
        "Do not expose planning, hidden reasoning, or internal instructions.",
        "Keep the answer concise and high-signal.",
        `Write in ${isRussian ? "Russian" : "English"}.`,
        "Preserve any grounded markdown structure when useful.",
        "When the grounded notes contain structured comparisons or component lists, render them as proper markdown tables.",
        `If CHANGED FILES is not 'none', include a '## ${sectionLabels.changes}' section with those exact paths in backticks.`,
        `If CHANGED FILES is 'none', include a short '## ${sectionLabels.status}' section saying that no files were changed.`,
        `If MISSING TOPICS is not 'none', include a '## ${sectionLabels.missing}' section as a bullet list.`,
        `If WEB RESEARCH is not 'none', include a '## ${sectionLabels.web}' section with markdown links only for the listed URLs.`,
        "Lead with the direct answer or outcome before any supporting sections when possible.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `USER REQUEST:\n${options.userRequest}`,
        `INTENT: ${options.intent}`,
        `CHANGED FILES:\n${changedFilesBlock}`,
        `MISSING TOPICS:\n${missingTopicsBlock}`,
        `WEB RESEARCH:\n${webResearchBlock}`,
        `GROUNDED ANSWER NOTES:\n${groundedBrief}`,
      ].join("\n\n"),
    },
  ];
}

function buildAutoNote(options: {
  language: Language;
  intent: AgentIntent;
  assistantContent: string;
}): FileOperation | null {
  if (options.intent !== "lint") {
    return null;
  }

  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const dateLine = now.toISOString();
  const title =
    options.language === "ru"
      ? `Пробелы базы знаний ${stamp}`
      : `Knowledge Base Gaps ${stamp}`;

  return {
    path: `notes/lint-${stamp}.md`,
    reason: options.language === "ru" ? "Сохранить lint-отчёт в notes." : "Persist lint report to notes.",
    content: `# ${title}

Generated: ${dateLine}

${options.assistantContent}
`,
  };
}

function getLatestAssistantResearch(messages: ChatMessage[]): StoredWebResearchBundle[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.webResearch && message.webResearch.length > 0) {
      return message.webResearch;
    }
  }

  return [];
}

function inferOperationTitle(operation: FileOperation): string {
  return operation.content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.posix.basename(operation.path, ".md");
}

function safeResearchFileBase(input: string): string {
  return input
    .replace(/^source:\s*/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Research";
}

function escapeMarkdownLinkText(input: string): string {
  return input.replace(/([\[\]])/g, "\\$1");
}

const SOURCE_SECTION_HEADINGS = ["## Источники", "## Sources"] as const;
const RELATION_SECTION_HEADINGS = ["## Связи", "## Relationships"] as const;

function pickSectionHeading(content: string, headings: readonly string[], preferredHeading: string): string {
  return headings.find((heading) => new RegExp(`^${heading}$`, "m").test(content)) ?? preferredHeading;
}

function appendSourceSection(content: string, language: Language, lines: string[]): string {
  const heading = pickSectionHeading(
    content,
    SOURCE_SECTION_HEADINGS,
    language === "ru" ? "## Источники" : "## Sources",
  );
  const sourceBlock = `${heading}\n\n${lines.join("\n")}`;

  if (new RegExp(`^${heading}$`, "m").test(content)) {
    const existing = content.trimEnd();
    const nextLines = lines.filter((line) => !existing.includes(line));
    if (nextLines.length === 0) {
      return content;
    }
    return `${existing}\n${nextLines.join("\n")}\n`;
  }

  return `${content.trimEnd()}\n\n${sourceBlock}\n`;
}

function appendRelationSection(
  content: string,
  language: Language,
  references: Array<{ target: string; label?: string }>,
): string {
  const heading = pickSectionHeading(
    content,
    RELATION_SECTION_HEADINGS,
    language === "ru" ? "## Связи" : "## Relationships",
  );
  const lines = [
    ...new Set(
      references.map((reference) =>
        reference.label && reference.label !== reference.target
          ? `- [[${reference.target}|${reference.label}]]`
          : `- [[${reference.target}]]`,
      ),
    ),
  ];
  if (lines.length === 0) {
    return content;
  }

  const relationBlock = `${heading}\n\n${lines.join("\n")}`;

  if (new RegExp(`^${heading}$`, "m").test(content)) {
    const existing = content.trimEnd();
    const nextLines = lines.filter((line) => !existing.includes(line));
    if (nextLines.length === 0) {
      return content;
    }
    return `${existing}\n${nextLines.join("\n")}\n`;
  }

  return `${content.trimEnd()}\n\n${relationBlock}\n`;
}

function extractWikiLinkReferences(content: string): Array<{ target: string; label?: string }> {
  return [...content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g)]
    .map((match) => ({
      target: `${match[1] ?? ""}`.trim(),
      label: `${match[2] ?? ""}`.trim() || undefined,
    }))
    .filter((reference) => reference.target);
}

function normalizeSourceSectionWikiLinks(
  content: string,
  language: Language,
): { content: string; references: Array<{ target: string; label?: string }> } {
  const heading = pickSectionHeading(
    content,
    SOURCE_SECTION_HEADINGS,
    language === "ru" ? "## Источники" : "## Sources",
  );
  const lines = content.split("\n");
  const nextLines: string[] = [];
  const references: Array<{ target: string; label?: string }> = [];
  let inSources = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === heading) {
      inSources = true;
      nextLines.push(line);
      continue;
    }

    if (inSources && /^##\s+/.test(trimmed)) {
      inSources = false;
    }

    if (inSources) {
      const lineReferences = extractWikiLinkReferences(line);
      if (lineReferences.length > 0) {
        references.push(...lineReferences);
        continue;
      }
    }

    nextLines.push(line);
  }

  return {
    content: nextLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd(),
    references,
  };
}

function sanitizeUnknownWikiLinks(content: string, knownTargets: Set<string>): string {
  return content.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, rawTarget, alias) => {
    const target = `${rawTarget ?? ""}`.trim();
    if (knownTargets.has(target.toLowerCase())) {
      return _match;
    }

    return `${alias ?? target}`.trim();
  });
}

function buildWebSourceOperation(webBundles: StoredWebResearchBundle[]): FileOperation | null {
  if (webBundles.length === 0) {
    return null;
  }

  const sourceLabel = webBundles[0]?.query?.trim() || "Research";
  const title = `Source: ${sourceLabel}`;
  const lines = [`# ${title}`, "", `Generated: ${new Date().toISOString()}`, ""];

  for (const bundle of webBundles) {
    lines.push(`## ${bundle.query}`, "");
    for (const result of bundle.results.slice(0, 5)) {
      lines.push(`- [${escapeMarkdownLinkText(result.title)}](${result.url})`);
      if (result.snippet) {
        lines.push(`  - ${result.snippet}`);
      }
    }
    lines.push("");
  }

  return {
    path: `sources/Source ${safeResearchFileBase(sourceLabel)}.md`,
    reason: "Persist the raw web result as a source note.",
    content: `${lines.join("\n").trim()}\n`,
  };
}

function groundOperationsWithResearch(options: {
  language: Language;
  operations: FileOperation[];
  existingTitles: string[];
  sourceOperation: FileOperation | null;
  webBundles: StoredWebResearchBundle[];
  dropNonCanonicalSourceFiles?: boolean;
  relevantExistingPages?: Array<{ path: string; target: string; title: string; content: string }>;
}): FileOperation[] {
  const extraOperations = options.sourceOperation ? [options.sourceOperation] : [];
  const canonicalSourcePath = options.sourceOperation?.path.replace(/\\/g, "/");
  const initialBatch = [...options.operations, ...extraOperations].filter((operation) => {
    if (!options.dropNonCanonicalSourceFiles) {
      return true;
    }

    const normalizedPath = operation.path.replace(/\\/g, "/");
    if (!normalizedPath.startsWith("sources/")) {
      return true;
    }

    return canonicalSourcePath ? normalizedPath === canonicalSourcePath : false;
  });

  const sourceLines: string[] = [];
  for (const bundle of options.webBundles) {
    for (const result of bundle.results.slice(0, 3)) {
      sourceLines.push(`- ${result.url}`);
    }
  }
  const uniqueSourceLines = [...new Set(sourceLines)];
  const newPageReferences: Array<{ target: string; title: string }> = initialBatch
    .filter((operation: FileOperation) => operation.path.replace(/\\/g, "/").startsWith("pages/"))
    .map((operation: FileOperation) => ({
      title: inferOperationTitle(operation),
      target: path.posix.basename(operation.path, ".md"),
    }))
    .filter(
      ({ title, target }: { title: string; target: string }) =>
        !options.existingTitles.some((existingTitle) => {
          const normalized = existingTitle.toLowerCase();
          return normalized === title.toLowerCase() || normalized === target.toLowerCase();
        }),
    )
    .map(({ target, title }: { target: string; title: string }) => ({ target, title }));

  const supplementalExistingPageOperations: FileOperation[] =
    newPageReferences.length === 0
      ? []
      : (options.relevantExistingPages ?? [])
          .filter((page) => {
            const normalizedPath = page.path.replace(/\\/g, "/");
            return !initialBatch.some((operation) => operation.path.replace(/\\/g, "/") === normalizedPath);
          })
          .map((page) => {
            let content = page.content;
            if (uniqueSourceLines.length > 0) {
              content = appendSourceSection(content, options.language, uniqueSourceLines);
            }
            content = appendRelationSection(
              content,
              options.language,
              newPageReferences.map((reference) => ({
                target: reference.target,
                label: reference.title,
              })),
            );

            if (content.trim() === page.content.trim()) {
              return null;
            }

            return {
              path: page.path,
              reason:
                options.language === "ru"
                  ? "Автоматически добавить связи с новыми карточками."
                  : "Automatically add links to newly created pages.",
              content,
            } satisfies FileOperation;
          })
          .filter((operation): operation is FileOperation => Boolean(operation));

  const batch: FileOperation[] = [...initialBatch, ...supplementalExistingPageOperations];
  const knownTargets = new Set<string>();
  for (const title of options.existingTitles) {
    knownTargets.add(title.toLowerCase());
  }
  for (const operation of batch) {
    knownTargets.add(inferOperationTitle(operation).toLowerCase());
    knownTargets.add(path.posix.basename(operation.path, ".md").toLowerCase());
  }

  return batch.map((operation) => {
    const isPage = operation.path.replace(/\\/g, "/").startsWith("pages/");
    const operationTitle = inferOperationTitle(operation);
    const operationBase = path.posix.basename(operation.path, ".md");
    const isNewPage =
      isPage &&
      !options.existingTitles.some((title) => {
        const normalized = title.toLowerCase();
        return normalized === operationTitle.toLowerCase() || normalized === operationBase.toLowerCase();
      });
    let content = sanitizeUnknownWikiLinks(operation.content, knownTargets);
    let sourceSectionReferences: Array<{ target: string; label?: string }> = [];

    if (isPage && uniqueSourceLines.length > 0) {
      content = appendSourceSection(content, options.language, uniqueSourceLines);
    }

    if (isPage) {
      const normalizedSources = normalizeSourceSectionWikiLinks(content, options.language);
      content = normalizedSources.content;
      sourceSectionReferences = normalizedSources.references;
    }

    const relationCandidates = isNewPage
      ? (options.relevantExistingPages ?? []).map((page) => ({ target: page.target, title: page.title }))
      : newPageReferences;
    if (isPage && relationCandidates.length > 0) {
      const relatedReferences = relationCandidates
        .concat(sourceSectionReferences.map((reference) => ({ target: reference.target, title: reference.label ?? reference.target })))
        .filter(
          (reference, index, list) =>
            list.findIndex(
              (candidate) =>
                candidate.target === reference.target && (candidate.title ?? candidate.target) === (reference.title ?? reference.target),
            ) === index,
        )
        .filter((reference) => {
          const normalizedTarget = reference.target.toLowerCase();
          const normalizedTitle = reference.title.toLowerCase();
          if (
            normalizedTarget === operationTitle.toLowerCase() ||
            normalizedTarget === operationBase.toLowerCase() ||
            normalizedTitle === operationTitle.toLowerCase() ||
            normalizedTitle === operationBase.toLowerCase()
          ) {
            return false;
          }
          return !content.toLowerCase().includes(`[[${normalizedTarget}`);
        })
        .slice(0, 3);

      if (relatedReferences.length > 0) {
        content = appendRelationSection(
          content,
          options.language,
          relatedReferences.map((reference) => ({
            target: reference.target,
            label: reference.title,
          })),
        );
      }
    }

    return {
      ...operation,
      content,
    };
  });
}

function compactConversation(messages: ChatMessage[], characterLimit = 8_500): string {
  const lines: string[] = [];
  let used = 0;

  for (const message of [...messages].reverse()) {
    const header = `${message.role.toUpperCase()} @ ${message.createdAt}`;
    const body = message.content.trim();
    const attachments =
      message.attachments && message.attachments.length > 0
        ? `\nAttachments: ${message.attachments.map((attachment) => attachment.name).join(", ")}`
        : "";
    const research =
      message.webResearch && message.webResearch.length > 0
        ? `\nWeb research: ${message.webResearch.map((bundle) => bundle.query).join(", ")}`
        : "";
    const chunk = `${header}\n${body}${attachments}${research}`.trim();

    if (used + chunk.length > characterLimit && lines.length > 0) {
      break;
    }

    lines.unshift(chunk);
    used += chunk.length;
  }

  return lines.join("\n\n");
}

function extractExplicitResearchTopic(message: string): string | null {
  const patterns = [
    /найди\s+(?:точную\s+)?информацию\s+по\s+(.+?)(?:[.?!]|$)/i,
    /найди\s+(?:точную\s+)?информацию\s+о\s+(.+?)(?:[.?!]|$)/i,
    /find\s+(?:accurate\s+)?information\s+about\s+(.+?)(?:[.?!]|$)/i,
    /what\s+is\s+(.+?)(?:[.?!]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern)?.[1]?.trim();
    if (match) {
      return match.replace(/^["'“”]+|["'“”]+$/g, "").trim();
    }
  }

  return null;
}

function hasDirectWikiHit(pageIndex: Awaited<ReturnType<typeof getPageIndex>>, topic: string): boolean {
  const normalizedTopic = topic.toLowerCase();
  return pageIndex.some((entry) => {
    const title = entry.title.toLowerCase();
    const pathBase = entry.path.toLowerCase().replace(/^.*\//, "").replace(/\.md$/i, "");
    return title === normalizedTopic || pathBase === normalizedTopic || title.includes(normalizedTopic);
  });
}

function formatRelevantPages(
  pages: Awaited<ReturnType<typeof searchRelevantPages>>,
): string {
  if (pages.length === 0) {
    return "No relevant wiki pages found.";
  }

  return pages
    .map(
      ({ entry, content }) =>
        `PATH: ${entry.path}\nTITLE: ${entry.title}\nSUMMARY: ${entry.summary || "n/a"}\nCONTENT:\n${content}`,
    )
    .join("\n\n---\n\n");
}

function formatAttachments(attachments: AttachmentDocument[]): string {
  if (attachments.length === 0) {
    return "No attachments.";
  }

  return attachments
    .map(
      (attachment) =>
        `NAME: ${attachment.name}\nMIME: ${attachment.mimeType}\nSTORED: ${attachment.wikiRelativePath}\nCONTENT:\n${attachment.truncatedText}`,
    )
    .join("\n\n---\n\n");
}

function formatWebResearch(webResults: StoredWebResearchBundle[]): string {
  if (webResults.length === 0) {
    return "No web research used.";
  }

  return webResults
    .map((bundle) => {
      const results = bundle.results
        .map(
          (result: StoredWebResearchBundle["results"][number], index: number) =>
            `${index + 1}. ${result.title}\nURL: ${result.url}\nSnippet: ${result.snippet}\nPage: ${result.pageText ?? ""}`.trim(),
        )
        .join("\n\n");
      return `QUERY: ${bundle.query}\n${results}`;
    })
    .join("\n\n---\n\n");
}

function heuristicsFallback(
  language: Language,
  message: string,
  attachments: AttachmentDocument[],
): PlannerDecision {
  const lowered = message.toLowerCase();
  const t = getUiText(language);

  if (attachments.length > 0 || /добав|ingest|внеси|import|загруз/i.test(lowered)) {
    return {
      intent: attachments.length > 0 ? "ingest" : "update",
      goal: t.heuristicIngest,
      needsWikiWrite: true,
      needsWebSearch: false,
      webQueries: [],
      relevantTerms: [],
    };
  }

  if (/актуализ|lint|missing|не хватает|health|orphan|gap/i.test(lowered)) {
    return {
      intent: "lint",
      goal: t.heuristicLint,
      needsWikiWrite: true,
      needsWebSearch: false,
      webQueries: [],
      relevantTerms: [],
    };
  }

  return {
    intent: "query",
    goal: t.heuristicQuery,
    needsWikiWrite: false,
    needsWebSearch: false,
    webQueries: [],
    relevantTerms: [],
  };
}

function detectIntentHeuristically(
  language: Language,
  message: string,
  attachments: AttachmentDocument[],
): PlannerDecision | null {
  const lowered = message.toLowerCase();
  const t = getUiText(language);
  const explicitResearchTopic = extractExplicitResearchTopic(message);

  if (explicitResearchTopic) {
    return {
      intent: "query",
      goal:
        language === "ru"
          ? `Найти точную информацию по теме: ${explicitResearchTopic}`
          : `Find accurate information about: ${explicitResearchTopic}`,
      needsWikiWrite: false,
      needsWebSearch: true,
      webQueries: [explicitResearchTopic],
      relevantTerms: [explicitResearchTopic],
    };
  }

  if (attachments.length > 0) {
    return {
      intent: "ingest",
      goal: t.heuristicIngest,
      needsWikiWrite: true,
      needsWebSearch: false,
      webQueries: [],
      relevantTerms: [],
    };
  }

  if (/(чего[^.?!]*не хватает|что[^.?!]*не хватает|актуализ|актуальн|проверь базу|проверь связи|перепроверь базу|наведи порядок|приведи базу в порядок|lint|health check|health-check|missing topics|what(?:'s| is) missing|gaps? in the wiki|refresh the wiki|audit the wiki|check the links)/i.test(lowered)) {
    return {
      intent: "lint",
      goal: t.heuristicLint,
      needsWikiWrite: true,
      needsWebSearch: false,
      webQueries: [],
      relevantTerms: [],
    };
  }

  if (/(добавь в базу|внеси в базу|обнови базу|обнови страницу|исправь страницу|запиши в базу|add to the wiki|update the wiki|record this|save this to the wiki)/i.test(lowered)) {
    return {
      intent: "update",
      goal: t.heuristicUpdate,
      needsWikiWrite: true,
      needsWebSearch: false,
      webQueries: [],
      relevantTerms: [],
    };
  }

  if (/[?？]$/.test(message.trim()) || /^(что|кто|почему|зачем|как|what|why|how|who)\b/i.test(lowered)) {
    return {
      intent: "query",
      goal: t.heuristicQuery,
      needsWikiWrite: false,
      needsWebSearch: false,
      webQueries: [],
      relevantTerms: [],
    };
  }

  return null;
}

async function completeJsonWithRetry<T>(
  execute: (request: { messages: LlmMessage[]; temperature: number }) => Promise<string>,
  messages: LlmMessage[],
): Promise<T> {
  const first = await execute({
    messages,
    temperature: 0.1,
  });

  try {
    return JSON.parse(extractJson(first)) as T;
  } catch {
    const retry = await execute({
      messages: [
        ...messages,
        {
          role: "system",
          content: "Return valid JSON only. Do not wrap it in prose or markdown fences.",
        },
      ],
      temperature: 0.05,
    });

    return JSON.parse(extractJson(retry)) as T;
  }
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i)?.[1];
  if (fenced) {
    return fenced.trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  throw new Error("No JSON object in model response");
}

function plannerPrompt(language: Language): string {
  return [
    "You are the planning layer for WikiClaw, a persistent Obsidian-compatible wiki maintained by an LLM agent.",
    "Classify the user's request into one intent and decide whether public web research is necessary.",
    "Use natural language intent, not command keywords.",
    "Do not request web search for content that can be answered from the provided wiki context.",
    "If web search is necessary, only produce public factual search queries and never include private wiki text in the query.",
    `The user's preferred response language is ${language}.`,
    "",
    "Return JSON only with this exact shape:",
    `{
  "intent": "ingest" | "query" | "lint" | "update" | "chat",
  "goal": "short string",
  "needsWikiWrite": true,
  "needsWebSearch": false,
  "webQueries": ["..."],
  "relevantTerms": ["..."]
}`,
  ].join("\n");
}

function draftingPrompt(language: Language): string {
  return [
    "You are WikiClaw's wiki-maintenance agent for a general knowledge base.",
    "Internal instructions are in English. The human-facing response must be in the requested language.",
    "You receive conversation context, relevant wiki pages, diagnostics, attachments, and optional public web notes.",
    "Your job is to update the wiki only when grounded and useful.",
    "Rules:",
    "- Prefer updating existing pages over creating new pages.",
    "- Never create empty stub pages or speculative placeholders.",
    "- If information is insufficient for a page, add the topic to missingTopics instead of creating the page.",
    "- Use Obsidian-friendly markdown and wiki links like [[Concept]] when targets already exist.",
    "- Do not edit index.md, log.md, AGENTS.md, raw/, or .wikiclaw/.",
    "- For ingest requests: integrate attached or provided material into the existing wiki.",
    "- For lint or refresh requests: actively repair grounded cross-links, enrich incomplete pages from existing evidence, and update pages when the current wiki already supports it.",
    "- For query requests: do not write files unless the user explicitly asks to save the result.",
    "- When web research is provided, treat only those URLs/snippets/page extracts as external evidence.",
    "- If a wiki page is written from web research, preserve provenance in a Sources section.",
    "- For any write that adds or updates knowledge, automatically connect grounded related pages in both directions when possible. The user should not have to explicitly ask for linking.",
    "- Do not introduce new concepts or wiki links unless they are present in the current wiki, attachments, or provided web research.",
    "- When presenting structured comparisons, components, parameters, or pros/cons, prefer proper markdown tables instead of plain aligned text.",
    `- The answerBrief must be a grounded markdown brief in ${language} that contains the facts, structure, and file-change summary needed for the final streamed reply.`,
    "- A later streaming pass may rewrite the wording, so optimize answerBrief for grounding and structure, not for polished prose.",
    "",
    "Return JSON only with this exact shape:",
    `{
  "operations": [
    {
      "path": "pages/example.md",
      "content": "full markdown file content",
      "reason": "why this file changes"
    }
  ],
  "logTitle": "short log title",
  "logBody": "markdown summary for log.md",
  "answerBrief": "concise markdown summary for the human",
  "missingTopics": ["topic"],
  "followUpQuestions": ["question"]
}`,
  ].join("\n");
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const activities: ActivityItem[] = [];
  const uiText = getUiText(input.settings.language);
  const emit = (kind: ActivityItem["kind"], title: string, detail?: string) => {
    const activity = createActivity(kind, title, detail);
    activities.push(activity);
    input.onActivity(activity);
  };
  const executeLlmWithRecovery = async <T>(
    operation: () => Promise<T>,
    options?: {
      allowRetry?: () => boolean;
    },
  ): Promise<T> => {
    let waitingForRecovery = false;

    while (true) {
      try {
        const result = await operation();
        if (waitingForRecovery) {
          emit("status", uiText.llmRecovered, uiText.llmRecoveredDetail);
        }
        return result;
      } catch (error) {
        if (!isLlmTemporarilyUnavailable(error) || (options?.allowRetry && !options.allowRetry())) {
          throw error;
        }

        if (!waitingForRecovery) {
          emit(
            "warning",
            uiText.llmUnavailable,
            uiText.llmUnavailableDetail(describeLlmTemporaryUnavailability(input.settings, error)),
          );
          waitingForRecovery = true;
        }

        await sleep(LLM_RETRY_DELAY_MS);
      }
    }
  };
  const completeTextWithRecovery = (request: { messages: LlmMessage[]; temperature?: number }) =>
    executeLlmWithRecovery(() =>
      completeText({
        settings: input.settings,
        messages: request.messages,
        temperature: request.temperature,
      }),
    );

  await reindexWiki(input.settings);
  emit("status", uiText.scanComplete, uiText.loadedWiki(input.settings.wikiPath));

  const schema = await readWikiSchema(input.settings);
  const diagnostics = await getWikiDiagnostics(input.settings);
  const pageIndex = await getPageIndex(input.settings);
  const priorResearchBundles = getLatestAssistantResearch(input.chat.messages);

  const heuristicHints = await searchRelevantPages(
    input.settings,
    input.userMessage.content,
    [],
    Math.max(3, Math.min(5, input.settings.maxContextPages)),
  );

  const plannerContext = [
    `USER MESSAGE:\n${input.userMessage.content}`,
    `ATTACHMENTS:\n${formatAttachments(input.attachments).slice(0, 6_000)}`,
    `RECENT CHAT:\n${compactConversation(input.chat.messages)}`,
    `WIKI HINTS:\n${heuristicHints.map((item) => `- ${item.entry.title}: ${item.entry.summary}`).join("\n") || "No hints."}`,
    `WIKI SIZE: ${pageIndex.length} pages`,
    `MISSING LINKS: ${diagnostics.missingLinks.slice(0, 20).join(", ") || "none"}`,
  ].join("\n\n");

  let decision: PlannerDecision;
  const heuristicDecision = detectIntentHeuristically(
    input.settings.language,
    input.userMessage.content,
    input.attachments,
  );

  if (heuristicDecision) {
    decision = heuristicDecision;
    emit("status", uiText.planningStart, uiText.planningStartDetail);
  } else {
    emit("status", uiText.planningStart, uiText.planningStartDetail);
    try {
      decision = await completeJsonWithRetry<PlannerDecision>((request) => completeTextWithRecovery(request), [
        {
          role: "system",
          content: plannerPrompt(input.settings.language),
        },
        {
          role: "user",
          content: plannerContext,
        },
      ]);
    } catch {
      decision = heuristicsFallback(input.settings.language, input.userMessage.content, input.attachments);
    }
  }

  emit("status", uiText.intentTitle(decision.intent), decision.goal);

  const explicitResearchTopic = extractExplicitResearchTopic(input.userMessage.content);
  if (
    explicitResearchTopic &&
    decision.intent === "query" &&
    !decision.needsWebSearch &&
    !hasDirectWikiHit(pageIndex, explicitResearchTopic)
  ) {
    decision = {
      ...decision,
      needsWebSearch: true,
      webQueries: [explicitResearchTopic],
      goal:
        input.settings.language === "ru"
          ? `Найти точную информацию по теме: ${explicitResearchTopic}`
          : `Find accurate information about: ${explicitResearchTopic}`,
    };
    emit("status", uiText.intentTitle(decision.intent), decision.goal);
  }

  const relevantPages = await searchRelevantPages(
    input.settings,
    input.userMessage.content,
    decision.relevantTerms ?? [],
    input.settings.maxContextPages,
  );

  if (relevantPages.length > 0) {
    emit(
      "status",
      uiText.selectedContext,
      relevantPages.map((page) => page.entry.title).join(", "),
    );
  }

  const webBundles: StoredWebResearchBundle[] = [];
  const approvedQueries: string[] = [];

  if (decision.needsWebSearch && input.settings.allowWebSearch) {
    for (const rawQuery of decision.webQueries.slice(0, 3)) {
      const sanitized = sanitizeWebQuery(rawQuery);
      if (!sanitized) {
        continue;
      }

      emit("web", uiText.searchingWeb, sanitized);
      approvedQueries.push(sanitized);

      try {
        const searchBundle = await searchWeb(sanitized, 4);
        if (searchBundle.results.length === 0) {
          emit("warning", uiText.webSearchEmpty, sanitized);
          continue;
        }

        const enrichedResults = await Promise.all(searchBundle.results.slice(0, 2).map(enrichResult));
        webBundles.push({
          query: sanitized,
          results: [...enrichedResults, ...searchBundle.results.slice(2)],
        });
      } catch (error) {
        const detail = error instanceof Error ? `${sanitized}: ${error.message}` : sanitized;
        emit("warning", uiText.webSearchFailed, detail);
      }
    }
  }

  const activeResearchBundles = webBundles.length > 0 ? webBundles : priorResearchBundles;

  emit(
    "status",
    decision.needsWikiWrite ? uiText.draftingStartWrite : uiText.draftingStartRead,
    decision.needsWikiWrite ? uiText.draftingProgressDetailWrite : uiText.draftingProgressDetailRead,
  );

  const draftContext = [
    `INTENT: ${decision.intent}`,
    `WRITES ALLOWED: ${decision.needsWikiWrite ? "yes" : "no"}`,
    `SCHEMA:\n${schema}`,
    `USER REQUEST:\n${input.userMessage.content}`,
    `RECENT CHAT:\n${compactConversation(input.chat.messages)}`,
    `ATTACHMENTS:\n${formatAttachments(input.attachments)}`,
    `RELEVANT PAGES:\n${formatRelevantPages(relevantPages)}`,
    `WIKI DIAGNOSTICS:\nPage count: ${diagnostics.pageCount}\nMissing links: ${diagnostics.missingLinks.join(", ") || "none"}`,
    `WEB NOTES:\n${formatWebResearch(activeResearchBundles)}`,
  ].join("\n\n");

  const draft = await completeJsonWithRetry<AgentDraft>((request) => completeTextWithRecovery(request), [
    {
      role: "system",
      content: draftingPrompt(input.settings.language),
    },
    {
      role: "user",
      content: draftContext,
    },
  ]);

  let groundedOperations = draft.operations ?? [];
  if (decision.needsWikiWrite) {
    const sourceOperation = buildWebSourceOperation(activeResearchBundles);
    groundedOperations = groundOperationsWithResearch({
      language: input.settings.language,
      operations: groundedOperations,
      existingTitles: pageIndex.flatMap((entry) => [entry.title, path.posix.basename(entry.path, ".md")]),
      sourceOperation,
      webBundles: activeResearchBundles,
      dropNonCanonicalSourceFiles: activeResearchBundles.length > 0 && input.attachments.length === 0,
      relevantExistingPages: relevantPages
        .filter((page) => page.entry.path.startsWith("pages/"))
        .map((page) => ({
          path: page.entry.path,
          target: path.posix.basename(page.entry.path, ".md"),
          title: page.entry.title,
          content: page.content,
        })),
    });
  }

  const changedPaths = decision.needsWikiWrite
    ? await applyWikiWrites(input.settings, groundedOperations)
    : [];
  if (changedPaths.length > 0) {
    emit("file", uiText.updatedFiles, changedPaths.join(", "));
  }

  if (draft.missingTopics?.length) {
    emit("warning", uiText.missingEvidence, draft.missingTopics.join(", "));
  }

  const initialAssistantContent = buildFinalAnswer({
    language: input.settings.language,
    intent: decision.intent,
    brief: draft.answerBrief || uiText.noAnswer,
    changedPaths,
    missingTopics: draft.missingTopics ?? [],
    webQueries: approvedQueries,
    webBundles: activeResearchBundles,
  });

  const autoNote = buildAutoNote({
    language: input.settings.language,
    intent: decision.intent,
    assistantContent: initialAssistantContent,
  });

  let notePaths: string[] = [];
  if (autoNote) {
    notePaths = await applyWikiWrites(input.settings, [autoNote]);
    if (notePaths.length > 0) {
      emit("file", uiText.updatedFiles, notePaths.join(", "));
    }
  }

  const finalChangedPaths = [...changedPaths, ...notePaths];

  await appendLogEntry(
    input.settings,
    decision.intent === "chat" ? "query" : decision.intent,
    draft.logTitle || decision.goal,
    draft.logBody || draft.answerBrief || decision.goal,
    finalChangedPaths,
    approvedQueries.length > 0 ? approvedQueries : activeResearchBundles.map((bundle) => bundle.query),
  );

  const fallbackAssistantContent = buildFinalAnswer({
    language: input.settings.language,
    intent: decision.intent,
    brief: draft.answerBrief || uiText.noAnswer,
    changedPaths: finalChangedPaths,
    missingTopics: draft.missingTopics ?? [],
    webQueries: approvedQueries,
    webBundles: activeResearchBundles,
  });

  emit("status", uiText.writingAnswer, uiText.writingAnswerDetail);

  let thinkingSummary = "";
  let streamedAnyThinkingToken = false;
  let assistantContent = "";
  let streamedAnyToken = false;
  let answerStreamingEmitted = false;
  let thinkingStreamingEmitted = false;
  try {
    assistantContent = await executeLlmWithRecovery(
      () =>
        streamText(
          {
            settings: input.settings,
            messages: buildFinalAnswerMessages({
              language: input.settings.language,
              intent: decision.intent,
              userRequest: input.userMessage.content,
              brief: draft.answerBrief || uiText.noAnswer,
              changedPaths: finalChangedPaths,
              missingTopics: draft.missingTopics ?? [],
              webQueries: approvedQueries,
              webBundles: activeResearchBundles,
            }),
            temperature: 0.15,
            think: input.settings.provider === "ollama" ? true : undefined,
          },
          (token) => {
            streamedAnyToken = true;
            if (!answerStreamingEmitted) {
              emit("status", uiText.answerStreaming, uiText.answerStreamingDetail);
              answerStreamingEmitted = true;
            }
            assistantContent += token;
            input.onToken(token);
          },
          (thinkingToken) => {
            streamedAnyThinkingToken = true;
            if (!thinkingStreamingEmitted) {
              emit("status", uiText.thinkingSummary, uiText.thinkingSummaryDetail);
              thinkingStreamingEmitted = true;
            }
            thinkingSummary += thinkingToken;
            input.onThinkingToken(thinkingToken);
          },
        ),
      {
        allowRetry: () => !streamedAnyToken && !streamedAnyThinkingToken,
      },
    );
  } catch {
    if (!streamedAnyToken) {
      assistantContent = fallbackAssistantContent;
      input.onToken(assistantContent);
    }
  }

  if (!assistantContent.trim()) {
    assistantContent = fallbackAssistantContent;
    if (!streamedAnyToken && assistantContent) {
      input.onToken(assistantContent);
    }
  }

  return {
    activities,
    thinkingSummary: thinkingSummary.trim(),
    assistantContent,
    changedPaths: finalChangedPaths,
    missingTopics: draft.missingTopics ?? [],
    webQueries: approvedQueries,
    webResearch: activeResearchBundles,
  };
}
