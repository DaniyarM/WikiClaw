import * as cheerio from "cheerio";
import type { WebResearchBundle as WebSearchBundle, WebResearchResult as WebResult } from "../../shared/contracts.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36 WikiClaw/0.1";

export function sanitizeWebQuery(input: string): string | null {
  const cleaned = input
    .replace(/\[\[[^\]]+\]\]/g, " ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[<>{}`"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  if (cleaned.length < 3) {
    return null;
  }

  return cleaned;
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Web request failed with ${response.status}`);
  }

  return response.text();
}

function normalizeResultUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();

  if (trimmed.startsWith("//duckduckgo.com/l/?")) {
    const parsed = new URL(`https:${trimmed}`);
    const direct = parsed.searchParams.get("uddg");
    return direct ? decodeURIComponent(direct) : `https:${trimmed}`;
  }

  if (trimmed.startsWith("/l/?")) {
    const parsed = new URL(`https://duckduckgo.com${trimmed}`);
    const direct = parsed.searchParams.get("uddg");
    return direct ? decodeURIComponent(direct) : `https://duckduckgo.com${trimmed}`;
  }

  return trimmed;
}

export async function searchWeb(query: string, limit = 5): Promise<WebSearchBundle> {
  const html = await fetchHtml(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  const $ = cheerio.load(html);
  const results: WebResult[] = [];

  $(".result").each((_, element) => {
    if (results.length >= limit) {
      return false;
    }

    const link = $(element).find(".result__a").first();
    const title = link.text().trim();
    const url = normalizeResultUrl(link.attr("href")?.trim() ?? "");
    const snippet = $(element).find(".result__snippet").text().trim();

    if (title && url) {
      results.push({
        title,
        url,
        snippet,
      });
    }

    return undefined;
  });

  return {
    query,
    results,
  };
}

export async function enrichResult(result: WebResult): Promise<WebResult> {
  try {
    const html = await fetchHtml(result.url);
    const $ = cheerio.load(html);
    const pageText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 2_400);

    return {
      ...result,
      pageText,
    };
  } catch {
    return result;
  }
}
