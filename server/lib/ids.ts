import crypto from "node:crypto";

export function createId(prefix = ""): string {
  return `${prefix}${crypto.randomUUID()}`;
}
