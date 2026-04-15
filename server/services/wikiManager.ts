import fs from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import type { Express } from "express";
import type { AppSettings, ChatAttachment, WikiPageIndexEntry } from "../../shared/contracts.js";
import { ensureDir, listFilesRecursive, pathExists, readJsonFile, readTextFile, writeJsonFile, writeTextFile } from "../lib/fs.js";
import { createId } from "../lib/ids.js";
import {
  WIKI_INDEX_FILE,
  WIKI_INTERNAL_DIRNAME,
  WIKI_LOG_FILE,
  WIKI_SCHEMA_FILE,
  resolveInside,
} from "../lib/paths.js";

const PAGE_INDEX_FILE = "page-index.json";
const MAX_ATTACHMENT_PREVIEW = 2_000;
const MAX_PAGE_CONTEXT = 8_000;
const OBSIDIAN_IGNORE_FILE = ".obsidianignore";
const MANAGED_CONTENT_PREFIXES = ["pages/", "sources/", "notes/"] as const;

const DEFAULT_SCHEMA = `# WikiClaw Schema

## Role

You maintain an Obsidian-compatible wiki. The human interacts in chat; the system stores files for you and manages index/log automatically.

## File conventions

- Prefer updating existing pages over creating new ones.
- Use valid Markdown that opens cleanly in Obsidian.
- Use wiki links like [[Topic]] when the target page already exists.
- Do not create empty or speculative stub pages.
- If a topic deserves a page but lacks evidence, report it as a missing topic instead of creating the page.
- When you create a new substantive page, include:
  - A clear H1 title
  - A concise summary section or opening paragraph
  - Relationships to other pages when grounded
  - A Sources section when source material is available
- Keep claims specific. If a source conflicts with earlier material, note the conflict explicitly.

## Directory conventions

- \`pages/\` for topic, entity, reference, and synthesis pages
- \`sources/\` for source summaries derived from attached files or imported material
- \`notes/\` for query outputs or temporary syntheses worth preserving
- \`raw/\` is system-managed storage for attached originals

## Maintenance rules

- \`index.md\` and \`log.md\` are system-managed.
- Favor cross-linking grounded concepts already present in the wiki.
- If web research is used, only request public factual information that does not reveal private wiki content.
- Reply to the human in the language requested by the UI. Internal instructions remain English.
`;

export interface AttachmentDocument extends ChatAttachment {
  extractedText: string;
  truncatedText: string;
}

export interface RelevantPage {
  entry: WikiPageIndexEntry;
  content: string;
}

export interface FileOperation {
  path: string;
  content: string;
  reason: string;
}

export interface WikiDiagnostics {
  pageCount: number;
  missingLinks: string[];
}

function wikiDirs(settings: AppSettings) {
  return {
    root: settings.wikiPath,
    pages: path.join(settings.wikiPath, "pages"),
    sources: path.join(settings.wikiPath, "sources"),
    notes: path.join(settings.wikiPath, "notes"),
    raw: path.join(settings.wikiPath, "raw"),
    internal: path.join(settings.wikiPath, WIKI_INTERNAL_DIRNAME),
    pageIndex: path.join(settings.wikiPath, WIKI_INTERNAL_DIRNAME, PAGE_INDEX_FILE),
    schema: path.join(settings.wikiPath, WIKI_SCHEMA_FILE),
    index: path.join(settings.wikiPath, WIKI_INDEX_FILE),
    log: path.join(settings.wikiPath, WIKI_LOG_FILE),
    obsidianIgnore: path.join(settings.wikiPath, OBSIDIAN_IGNORE_FILE),
  };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function safeFileName(input: string): string {
  return input
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) {
    return content;
  }

  const endIndex = content.indexOf("\n---", 3);
  return endIndex === -1 ? content : content.slice(endIndex + 4);
}

function stripMarkdown(content: string): string {
  return stripFrontmatter(content)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/[*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstParagraph(content: string): string {
  const body = stripFrontmatter(content);
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !paragraph.startsWith("#"));

  return paragraphs[0] ?? "";
}

function extractWikiLinks(content: string): string[] {
  const links = new Set<string>();
  const regex = /\[\[([^\]|#]+)(?:[^\]]*)\]\]/g;

  for (const match of content.matchAll(regex)) {
    const target = match[1]?.trim();
    if (target) {
      links.add(target);
    }
  }

  return [...links];
}

function extractHeadings(content: string): string[] {
  return [...content.matchAll(/^##+\s+(.+)$/gm)].map((match) => match[1].trim());
}

function isManagedContentPath(relativePath: string): boolean {
  return MANAGED_CONTENT_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

function inferTitle(filePath: string, content: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) {
    return heading;
  }

  return path.basename(filePath, path.extname(filePath));
}

function tokenize(input: string): string[] {
  return [...(input.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
}

function scorePage(entry: WikiPageIndexEntry, tokens: string[]): number {
  if (tokens.length === 0) {
    return 0;
  }

  const title = entry.title.toLowerCase();
  const summary = `${entry.summary} ${entry.excerpt} ${entry.headings.join(" ")} ${entry.links.join(" ")}`.toLowerCase();

  return tokens.reduce((score, token) => {
    let nextScore = score;
    if (title.includes(token)) {
      nextScore += 6;
    }
    if (summary.includes(token)) {
      nextScore += 2;
    }
    return nextScore;
  }, 0);
}

function contentPriority(entry: WikiPageIndexEntry): number {
  if (entry.path.startsWith("pages/")) {
    return 3;
  }

  if (entry.path.startsWith("notes/")) {
    return 2;
  }

  if (entry.path.startsWith("sources/")) {
    return 1;
  }

  return 0;
}

function isKnowledgePageEntry(entry: WikiPageIndexEntry): boolean {
  return entry.path.startsWith("pages/");
}

async function writeGeneratedIndex(settings: AppSettings, entries: WikiPageIndexEntry[]): Promise<void> {
  const dirs = wikiDirs(settings);
  const lines = ["# Index", "", `Total pages: ${entries.length}`, ""];

  const grouped = {
    pages: entries.filter((entry) => entry.path.startsWith("pages/")),
    sources: entries.filter((entry) => entry.path.startsWith("sources/")),
    notes: entries.filter((entry) => entry.path.startsWith("notes/")),
  };

  for (const [section, items] of Object.entries(grouped)) {
    if (items.length === 0) {
      continue;
    }

    lines.push(`## ${section[0].toUpperCase()}${section.slice(1)}`, "");
    for (const item of items.sort((a, b) => a.title.localeCompare(b.title))) {
      lines.push(`- [${item.title}](${item.path})${item.summary ? ` — ${item.summary}` : ""}`);
    }
    lines.push("");
  }

  await writeTextFile(dirs.index, `${lines.join("\n").trim()}\n`);
}

function computeMissingLinks(entries: WikiPageIndexEntry[]): string[] {
  const known = new Set<string>();

  for (const entry of entries) {
    known.add(entry.title.toLowerCase());
    known.add(path.basename(entry.path, ".md").toLowerCase());
  }

  const missing = new Set<string>();
  for (const entry of entries) {
    for (const link of entry.links) {
      if (!known.has(link.toLowerCase())) {
        missing.add(link);
      }
    }
  }

  return [...missing].sort((a, b) => a.localeCompare(b));
}

export async function ensureWikiScaffold(settings: AppSettings): Promise<void> {
  const dirs = wikiDirs(settings);
  await ensureDir(dirs.root);
  await ensureDir(dirs.pages);
  await ensureDir(dirs.sources);
  await ensureDir(dirs.notes);
  await ensureDir(dirs.raw);
  await ensureDir(dirs.internal);

  if (!(await pathExists(dirs.schema))) {
    await writeTextFile(dirs.schema, DEFAULT_SCHEMA);
  }

  if (!(await pathExists(dirs.log))) {
    await writeTextFile(dirs.log, "# Log\n\n");
  }

  if (!(await pathExists(dirs.index))) {
    await writeTextFile(dirs.index, "# Index\n\n");
  }

  if (!(await pathExists(dirs.obsidianIgnore))) {
    await writeTextFile(dirs.obsidianIgnore, "raw/\n.wikiclaw/\n");
  }
}

export async function readWikiSchema(settings: AppSettings): Promise<string> {
  await ensureWikiScaffold(settings);
  return readTextFile(wikiDirs(settings).schema, DEFAULT_SCHEMA);
}

export async function reindexWiki(settings: AppSettings): Promise<WikiPageIndexEntry[]> {
  await ensureWikiScaffold(settings);
  const dirs = wikiDirs(settings);
  const files = await listFilesRecursive(settings.wikiPath);

  const entries: WikiPageIndexEntry[] = [];
  for (const filePath of files) {
    const relativePath = path.relative(settings.wikiPath, filePath).replace(/\\/g, "/");

    if (!relativePath.endsWith(".md")) {
      continue;
    }

    if (relativePath.startsWith(`${WIKI_INTERNAL_DIRNAME}/`)) {
      continue;
    }

    if ([WIKI_SCHEMA_FILE, WIKI_INDEX_FILE, WIKI_LOG_FILE].includes(relativePath)) {
      continue;
    }

    if (!isManagedContentPath(relativePath)) {
      continue;
    }

    const raw = await fs.readFile(filePath, "utf8");
    const summary = firstParagraph(raw).slice(0, 240);
    const excerpt = stripMarkdown(raw).slice(0, 680);
    const stat = await fs.stat(filePath);

    entries.push({
      path: relativePath,
      title: inferTitle(filePath, raw),
      summary,
      excerpt,
      headings: extractHeadings(raw),
      links: extractWikiLinks(raw),
      updatedAt: stat.mtime.toISOString(),
    });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  await writeJsonFile(dirs.pageIndex, entries);
  await writeGeneratedIndex(settings, entries);
  return entries;
}

export async function getPageIndex(settings: AppSettings): Promise<WikiPageIndexEntry[]> {
  await ensureWikiScaffold(settings);
  const dirs = wikiDirs(settings);

  if (!(await pathExists(dirs.pageIndex))) {
    return reindexWiki(settings);
  }

  return readJsonFile<WikiPageIndexEntry[]>(dirs.pageIndex, []);
}

export async function getWikiDiagnostics(settings: AppSettings): Promise<WikiDiagnostics> {
  const entries = await getPageIndex(settings);
  return {
    pageCount: entries.length,
    missingLinks: computeMissingLinks(entries),
  };
}

export async function getWikiSnapshot(settings: AppSettings, limit = 40): Promise<string> {
  const entries = await getPageIndex(settings);
  return entries
    .slice(0, limit)
    .map((entry) => `- ${entry.title} (${entry.path})${entry.summary ? `: ${entry.summary}` : ""}`)
    .join("\n");
}

export async function searchRelevantPages(
  settings: AppSettings,
  query: string,
  extraTerms: string[],
  limit: number,
): Promise<RelevantPage[]> {
  const entries = (await getPageIndex(settings)).filter(isKnowledgePageEntry);
  const tokens = tokenize([query, ...extraTerms].join(" "));

  const scored = entries
    .map((entry) => ({ entry, score: scorePage(entry, tokens) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        contentPriority(b.entry) - contentPriority(a.entry) ||
        b.entry.updatedAt.localeCompare(a.entry.updatedAt),
    )
    .slice(0, limit)
    .filter((item) => item.score > 0 || tokens.length === 0);

  const selected = scored.length > 0 ? scored : entries.slice(-limit).map((entry) => ({ entry, score: 0 }));

  if (selected.length === 0) {
    return [];
  }

  return Promise.all(
    selected.map(async ({ entry }) => {
      const fullPath = resolveInside(settings.wikiPath, entry.path);
      const content = await readTextFile(fullPath, "");
      return {
        entry,
        content: content.slice(0, MAX_PAGE_CONTEXT),
      };
    }),
  );
}

async function extractTextFromFile(file: Express.Multer.File): Promise<string> {
  if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
    const parser = new PDFParse({ data: file.buffer });
    try {
      const parsed = await parser.getText();
      return parsed.text;
    } finally {
      await parser.destroy();
    }
  }

  const text = file.buffer.toString("utf8");
  const extension = path.extname(file.originalname).toLowerCase();

  if (extension === ".md" || extension === ".markdown") {
    return stripFrontmatter(text);
  }

  return text;
}

export async function storeAttachments(
  settings: AppSettings,
  files: Express.Multer.File[],
): Promise<AttachmentDocument[]> {
  await ensureWikiScaffold(settings);
  const dirs = wikiDirs(settings);
  const stamp = new Date().toISOString().slice(0, 10);
  const targetDir = path.join(dirs.raw, stamp);
  await ensureDir(targetDir);

  const attachments: AttachmentDocument[] = [];

  for (const file of files) {
    const extension = path.extname(file.originalname) || ".bin";
    const safeBase = slugify(path.basename(file.originalname, extension)) || "attachment";
    const fileName = `${safeBase}-${createId().slice(0, 8)}${extension}`;
    const targetPath = path.join(targetDir, fileName);
    await fs.writeFile(targetPath, file.buffer);

    const extractedText = (await extractTextFromFile(file)).replace(/\u0000/g, " ").trim();
    const preview = extractedText.slice(0, MAX_ATTACHMENT_PREVIEW);

    attachments.push({
      id: createId("att_"),
      name: file.originalname,
      mimeType: file.mimetype || "application/octet-stream",
      size: file.size,
      storedPath: targetPath,
      wikiRelativePath: path.relative(settings.wikiPath, targetPath).replace(/\\/g, "/"),
      textPreview: preview,
      extractedText,
      truncatedText: extractedText.slice(0, 18_000),
    });
  }

  return attachments;
}

function extractDocumentTitle(content: string): string | null {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
}

async function normalizeTargetPath(
  settings: AppSettings,
  relativePath: string,
  content: string,
): Promise<string | null> {
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const withExtension = cleaned.endsWith(".md") ? cleaned : `${cleaned}.md`;
  const normalizedPath = isManagedContentPath(withExtension) ? withExtension : `pages/${path.posix.basename(withExtension)}`;

  if ([WIKI_INDEX_FILE, WIKI_LOG_FILE, WIKI_SCHEMA_FILE].includes(withExtension)) {
    return null;
  }

  if (withExtension.startsWith(`${WIKI_INTERNAL_DIRNAME}/`) || withExtension.startsWith("raw/")) {
    return null;
  }

  const title = extractDocumentTitle(content);
  if (!title) {
    return normalizedPath;
  }

  const safeTitle = safeFileName(title);
  if (!safeTitle) {
    return normalizedPath;
  }

  const requestedBase = path.posix.basename(normalizedPath, ".md").trim();
  if (requestedBase) {
    const normalizedRequested = requestedBase.toLowerCase();
    const normalizedTitle = title.toLowerCase();
    if (
      normalizedTitle === normalizedRequested ||
      normalizedTitle.includes(normalizedRequested) ||
      normalizedRequested.length <= 6
    ) {
      return normalizedPath;
    }
  }

  const directory = path.posix.dirname(normalizedPath);
  const titlePath = `${directory === "." ? "" : `${directory}/`}${safeTitle}.md`;
  const requestedFullPath = resolveInside(settings.wikiPath, normalizedPath);
  const titleFullPath = resolveInside(settings.wikiPath, titlePath);
  const requestedExists = await pathExists(requestedFullPath);
  const titleExists = await pathExists(titleFullPath);

  if (requestedExists) {
    return normalizedPath;
  }

  if (titleExists) {
    return titlePath;
  }

  return titlePath;
}

function hasSubstantiveContent(content: string): boolean {
  const plain = stripMarkdown(content);
  return plain.length >= 80 && !/^todo\b/i.test(plain);
}

export async function applyWikiWrites(settings: AppSettings, operations: FileOperation[]): Promise<string[]> {
  await ensureWikiScaffold(settings);

  const applied: string[] = [];

  for (const operation of operations) {
    const relativePath = await normalizeTargetPath(settings, operation.path, operation.content);
    if (!relativePath) {
      continue;
    }
    const fullPath = resolveInside(settings.wikiPath, relativePath);
    const exists = await pathExists(fullPath);

    if (!exists && !hasSubstantiveContent(operation.content)) {
      continue;
    }

    if (exists && stripMarkdown(operation.content).length < 20) {
      continue;
    }

    await writeTextFile(fullPath, `${operation.content.trim()}\n`);
    applied.push(relativePath);
  }

  await reindexWiki(settings);
  return applied;
}

export async function appendLogEntry(
  settings: AppSettings,
  kind: "ingest" | "query" | "lint" | "update",
  title: string,
  body: string,
  changedPaths: string[],
  webQueries: string[],
): Promise<void> {
  await ensureWikiScaffold(settings);
  const dirs = wikiDirs(settings);
  const current = await readTextFile(dirs.log, "# Log\n\n");
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    current.trimEnd(),
    "",
    `## [${date}] ${kind} | ${title}`.trim(),
    "",
    body.trim(),
    "",
  ];

  if (changedPaths.length > 0) {
    lines.push("Changed files:", ...changedPaths.map((filePath) => `- ${filePath}`), "");
  }

  if (webQueries.length > 0) {
    lines.push("Web queries:", ...webQueries.map((query) => `- ${query}`), "");
  }

  await writeTextFile(dirs.log, `${lines.join("\n").trimEnd()}\n`);
}
