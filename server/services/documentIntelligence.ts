import path from "node:path";

export type DocumentKind = "code" | "article" | "notes" | "mixed";

export interface SemanticDocumentShape {
  kind: DocumentKind;
  titleHint: string;
  signals: string[];
  totalChars: number;
}

export interface SemanticChunk {
  index: number;
  label: string;
  content: string;
  charLength: number;
}

export interface AttachmentStructure {
  shape: SemanticDocumentShape;
  chunks: SemanticChunk[];
}

const MAX_CHUNKS_PER_DOCUMENT = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(content: string): string {
  return content.replace(/\r\n?/g, "\n").replace(/\u0000/g, " ").trim();
}

function basenameTitle(name: string): string {
  return path.basename(name, path.extname(name)).replace(/[_-]+/g, " ").trim() || "Untitled document";
}

function extractTitleHint(name: string, content: string): string {
  const markdownTitle = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (markdownTitle) {
    return markdownTitle.slice(0, 140);
  }

  const candidate = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && line.length <= 140 && !/^[`#{[*\-]|^\/\//.test(line));
  if (candidate) {
    return candidate;
  }

  return basenameTitle(name).slice(0, 140);
}

function countMatches(content: string, patterns: RegExp[]): number {
  return patterns.reduce((total, pattern) => total + [...content.matchAll(pattern)].length, 0);
}

function inferKind(name: string, content: string): SemanticDocumentShape {
  const lowerName = name.toLowerCase();
  const normalized = normalizeText(content);
  const signals: string[] = [];

  const codeScore =
    countMatches(normalized, [
      /^(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_]\w*/gm,
      /^class\s+[A-Za-z_]\w*/gm,
      /^(?:export\s+)?(?:const|let|var)\s+[A-Za-z_]\w*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_]\w*)\s*=>/gm,
      /^def\s+[A-Za-z_]\w*/gm,
      /^\s*(?:public|private|protected)\s+(?:static\s+)?[A-Za-z_<>\[\]]+\s+[A-Za-z_]\w*\s*\(/gm,
      /^import\s.+from\s.+$/gm,
      /^#include\s+[<"].+[>"]$/gm,
      /[{;}]$/gm,
      /```[a-zA-Z0-9_-]*/g,
    ]) + (/\.(ts|tsx|js|jsx|py|java|c|cpp|h|hpp|rs|go|php|rb|cs)$/i.test(lowerName) ? 6 : 0);

  const articleScore =
    countMatches(normalized, [
      /^(?:abstract|introduction|background|methods?|methodology|results?|discussion|conclusion|references)\b.*$/gim,
      /^(?:аннотация|введение|методы?|результаты?|обсуждение|заключение|литература)\b.*$/gim,
      /^\d+(?:\.\d+)*\s+[A-ZА-Я].*$/gm,
      /\bet al\./gi,
      /\bdoi\b/gi,
      /\[[0-9,\s-]+\]/g,
    ]) + (/\.(pdf|tex)$/i.test(lowerName) ? 4 : 0);

  const noteScore =
    countMatches(normalized, [
      /^\s*[-*]\s+/gm,
      /^\s*\d+\.\s+/gm,
      /^\s*(?:todo|note|idea|summary|вывод|заметка)\b.*$/gim,
    ]) + (/\.(md|txt)$/i.test(lowerName) ? 1 : 0);

  const nonEmptyLines = normalized.split("\n").filter((line) => line.trim());
  const avgLineLength =
    nonEmptyLines.length > 0
      ? nonEmptyLines.reduce((total, line) => total + line.trim().length, 0) / nonEmptyLines.length
      : 0;

  let kind: DocumentKind = "notes";

  if (codeScore >= 10 && articleScore >= 6) {
    kind = "mixed";
    signals.push("contains both code structure and article-style sections");
  } else if (codeScore >= Math.max(articleScore + 4, 8)) {
    kind = "code";
    signals.push("function/class/import syntax dominates the document");
  } else if (articleScore >= Math.max(codeScore + 3, 6)) {
    kind = "article";
    signals.push("section headings, citations, and paper structure dominate the document");
  } else if (noteScore >= 4 || avgLineLength < 110) {
    kind = "notes";
    signals.push("outline-like or note-like structure dominates the document");
  } else {
    kind = "mixed";
    signals.push("document structure is heterogeneous");
  }

  if (codeScore > 0) {
    signals.push(`code signals=${codeScore}`);
  }
  if (articleScore > 0) {
    signals.push(`article signals=${articleScore}`);
  }
  if (noteScore > 0) {
    signals.push(`note signals=${noteScore}`);
  }

  return {
    kind,
    titleHint: extractTitleHint(name, normalized),
    signals: signals.slice(0, 6),
    totalChars: normalized.length,
  };
}

function isMarkdownHeading(line: string): boolean {
  return /^#{1,6}\s+/.test(line.trim());
}

function isArticleHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 140) {
    return false;
  }

  if (/^(?:abstract|introduction|background|methods?|methodology|results?|discussion|conclusion|references)\b/i.test(trimmed)) {
    return true;
  }

  if (/^(?:аннотация|введение|методы?|результаты?|обсуждение|заключение|литература)\b/i.test(trimmed)) {
    return true;
  }

  if (/^\d+(?:\.\d+)*\s+[A-ZА-Я].+$/.test(trimmed)) {
    return true;
  }

  return /^[A-ZА-Я][A-ZА-Я0-9\s,:()/-]{4,}$/.test(trimmed);
}

function isCodeBoundary(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_]\w*/.test(trimmed) ||
    /^class\s+[A-Za-z_]\w*/.test(trimmed) ||
    /^(?:export\s+)?(?:const|let|var)\s+[A-Za-z_]\w*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_]\w*)\s*=>/.test(trimmed) ||
    /^def\s+[A-Za-z_]\w*/.test(trimmed) ||
    /^\s*(?:public|private|protected)\s+(?:static\s+)?[A-Za-z_<>\[\]]+\s+[A-Za-z_]\w*\s*\(/.test(line) ||
    /^interface\s+[A-Za-z_]\w*/.test(trimmed) ||
    /^type\s+[A-Za-z_]\w*\s*=/.test(trimmed) ||
    /^enum\s+[A-Za-z_]\w*/.test(trimmed) ||
    /^import\s.+from\s.+$/.test(trimmed) ||
    /^#include\s+[<"].+[>"]$/.test(trimmed)
  );
}

function shouldStartSection(kind: DocumentKind, line: string, currentLength: number): boolean {
  if (isMarkdownHeading(line)) {
    return true;
  }

  if ((kind === "article" || kind === "mixed") && isArticleHeading(line)) {
    return true;
  }

  if ((kind === "code" || kind === "mixed") && isCodeBoundary(line) && currentLength > 0) {
    return true;
  }

  return false;
}

function splitOversizedSection(content: string, hardLimit: number): string[] {
  if (content.length <= hardLimit) {
    return [content];
  }

  const paragraphs = content.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length > 1) {
    const chunks: string[] = [];
    let current = "";

    for (const paragraph of paragraphs) {
      const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
      if (candidate.length > hardLimit && current) {
        chunks.push(current);
        current = paragraph;
      } else {
        current = candidate;
      }
    }

    if (current) {
      chunks.push(current);
    }

    return chunks.flatMap((chunk) => splitOversizedSection(chunk, hardLimit));
  }

  const lines = content.split("\n");
  const chunks: string[] = [];
  let currentLines: string[] = [];

  for (const line of lines) {
    const candidate = [...currentLines, line].join("\n");
    if (candidate.length > hardLimit && currentLines.length > 0) {
      chunks.push(currentLines.join("\n").trim());
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    chunks.push(currentLines.join("\n").trim());
  }

  return chunks.filter(Boolean);
}

function buildSections(kind: DocumentKind, content: string): Array<{ label: string; content: string }> {
  const lines = content.split("\n");
  const sections: Array<{ label: string; content: string }> = [];
  let currentLines: string[] = [];
  let currentLabel = "Overview";

  const flush = () => {
    const sectionContent = currentLines.join("\n").trim();
    if (!sectionContent) {
      currentLines = [];
      return;
    }
    sections.push({
      label: currentLabel,
      content: sectionContent,
    });
    currentLines = [];
  };

  for (const line of lines) {
    if (shouldStartSection(kind, line, currentLines.join("\n").length)) {
      flush();
      currentLabel = line.trim().replace(/^#{1,6}\s+/, "").slice(0, 120) || currentLabel;
    }

    currentLines.push(line);
  }

  flush();
  return sections.length > 0 ? sections : [{ label: "Overview", content }];
}

function mergeSections(
  sections: Array<{ label: string; content: string }>,
  targetChars: number,
  hardLimit: number,
): SemanticChunk[] {
  const prepared = sections.flatMap((section) =>
    splitOversizedSection(section.content, hardLimit).map((content, index) => ({
      label: index === 0 ? section.label : `${section.label} (part ${index + 1})`,
      content,
    })),
  );

  const chunks: SemanticChunk[] = [];
  let currentLabel = prepared[0]?.label ?? "Overview";
  let currentContent = "";

  const push = () => {
    const trimmed = currentContent.trim();
    if (!trimmed) {
      return;
    }
    chunks.push({
      index: chunks.length,
      label: currentLabel || `Chunk ${chunks.length + 1}`,
      content: trimmed,
      charLength: trimmed.length,
    });
    currentContent = "";
  };

  for (const section of prepared) {
    const candidate = currentContent ? `${currentContent}\n\n${section.content}` : section.content;
    if (candidate.length > targetChars && currentContent) {
      push();
      currentLabel = section.label;
      currentContent = section.content;
      continue;
    }

    if (!currentContent) {
      currentLabel = section.label;
      currentContent = section.content;
    } else {
      currentContent = candidate;
    }
  }

  push();
  return chunks;
}

export function buildAttachmentStructure(name: string, rawContent: string): AttachmentStructure {
  const content = normalizeText(rawContent);
  const shape = inferKind(name, content);
  if (!content) {
    return {
      shape,
      chunks: [],
    };
  }

  const sections = buildSections(shape.kind, content);
  const targetChars = clamp(Math.ceil(content.length / MAX_CHUNKS_PER_DOCUMENT), 1_200, shape.kind === "code" ? 4_200 : 4_800);
  const hardLimit = clamp(Math.floor(targetChars * 1.35), 1_800, shape.kind === "code" ? 5_200 : 5_800);
  const chunks = mergeSections(sections, targetChars, hardLimit);

  return {
    shape,
    chunks,
  };
}
