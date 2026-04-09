export type Language = "en" | "ru";

export type ProviderKind = "openai-compatible" | "ollama";

export type ChatRole = "user" | "assistant";

export type ActivityKind = "status" | "web" | "file" | "warning";

export interface AppSettings {
  provider: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  wikiPath: string;
  language: Language;
  allowWebSearch: boolean;
  temperature: number;
  maxContextPages: number;
}

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  storedPath?: string;
  wikiRelativePath?: string;
  textPreview?: string;
}

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  detail?: string;
  createdAt: string;
}

export interface WebResearchResult {
  title: string;
  url: string;
  snippet: string;
  pageText?: string;
}

export interface WebResearchBundle {
  query: string;
  results: WebResearchResult[];
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  attachments?: ChatAttachment[];
  activities?: ActivityItem[];
  webResearch?: WebResearchBundle[];
}

export interface ChatSession {
  id: string;
  wikiId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  language: Language;
  messages: ChatMessage[];
}

export interface ChatSummary {
  id: string;
  wikiId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview: string;
  messageCount: number;
}

export interface WikiSummary {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  pageCount: number;
  managed: boolean;
  canDelete: boolean;
}

export interface WikiPageIndexEntry {
  path: string;
  title: string;
  summary: string;
  excerpt: string;
  headings: string[];
  links: string[];
  updatedAt: string;
}

export interface StreamMessageStartEvent {
  type: "message-start";
  messageId: string;
  createdAt: string;
}

export interface StreamActivityEvent {
  type: "activity";
  activity: ActivityItem;
}

export interface StreamAssistantTokenEvent {
  type: "assistant-token";
  text: string;
}

export interface StreamAssistantFinalEvent {
  type: "assistant-final";
  message: ChatMessage;
  chatSummary: ChatSummary;
}

export interface StreamErrorEvent {
  type: "error";
  error: string;
}

export type StreamEvent =
  | StreamMessageStartEvent
  | StreamActivityEvent
  | StreamAssistantTokenEvent
  | StreamAssistantFinalEvent
  | StreamErrorEvent;
