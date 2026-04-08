import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import {
  isAbsolute,
  relative as relativePath,
  resolve as resolvePath,
} from "node:path";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";

function normalizeUnicodeSpaces(value: string) {
  return value.replace(UNICODE_SPACES, " ");
}

function tryMacOSScreenshotPath(filePath: string) {
  return filePath.replace(/ (AM|PM)\./g, `${NARROW_NO_BREAK_SPACE}$1.`);
}

function tryNFDVariant(filePath: string) {
  return filePath.normalize("NFD");
}

function tryCurlyQuoteVariant(filePath: string) {
  return filePath.replace(/'/g, "\u2019");
}

function fileExists(filePath: string) {
  try {
    accessSync(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeAtPrefix(filePath: string) {
  return filePath.startsWith("@") ? filePath.slice(1) : filePath;
}

export function expandPath(filePath: string) {
  const normalized = normalizeUnicodeSpaces(normalizeAtPrefix(filePath));

  if (normalized === "~") {
    return homedir();
  }

  if (normalized.startsWith("~/")) {
    return homedir() + normalized.slice(1);
  }

  return normalized;
}

export function resolveToCwd(filePath: string, cwd: string) {
  const expanded = expandPath(filePath);

  if (isAbsolute(expanded)) {
    return expanded;
  }

  return resolvePath(cwd, expanded);
}

export function resolveReadPath(filePath: string, cwd: string) {
  const resolved = resolveToCwd(filePath, cwd);

  if (fileExists(resolved)) {
    return resolved;
  }

  const amPmVariant = tryMacOSScreenshotPath(resolved);

  if (amPmVariant !== resolved && fileExists(amPmVariant)) {
    return amPmVariant;
  }

  const nfdVariant = tryNFDVariant(resolved);

  if (nfdVariant !== resolved && fileExists(nfdVariant)) {
    return nfdVariant;
  }

  const curlyVariant = tryCurlyQuoteVariant(resolved);

  if (curlyVariant !== resolved && fileExists(curlyVariant)) {
    return curlyVariant;
  }

  const nfdCurlyVariant = tryCurlyQuoteVariant(nfdVariant);

  if (nfdCurlyVariant !== resolved && fileExists(nfdCurlyVariant)) {
    return nfdCurlyVariant;
  }

  return resolved;
}

export function toDisplayPath(filePath: string, cwd: string) {
  const relative = relativePath(cwd, filePath);

  if (relative === "") {
    return ".";
  }

  return relative.startsWith("..") ? filePath : relative;
}
