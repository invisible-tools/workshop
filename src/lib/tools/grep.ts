import { basename } from "node:path";
import { readFile, stat } from "node:fs/promises";

import { tool } from "ai";
import { z } from "zod";

import { resolveToCwd, toDisplayPath } from "./path-utils.js";
import { matchesGlobPattern, walkSearchTree } from "./search-utils.js";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead, truncateLine } from "./truncate.js";
import { isProbablyBinary, normalizeToLF } from "./text-utils.js";

const DEFAULT_LIMIT = 100;

const grepSchema = z.object({
  pattern: z.string().describe("Search pattern (regex or literal string)"),
  path: z
    .string()
    .optional()
    .describe("Directory or file to search (default: current directory)"),
  glob: z
    .string()
    .optional()
    .describe("Filter files by glob pattern, e.g. '*.ts'"),
  ignoreCase: z
    .boolean()
    .optional()
    .describe("Case-insensitive search"),
  literal: z
    .boolean()
    .optional()
    .describe("Treat pattern as a literal string instead of regex"),
  context: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe("Number of lines to show before and after a match"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(DEFAULT_LIMIT * 10)
    .optional()
    .describe("Maximum number of matches to return"),
});

export interface GrepToolOutput {
  path: string;
  matches: number;
  content: string;
  linesTruncated: boolean;
  truncated: boolean;
}

function createMatcher({
  pattern,
  ignoreCase,
  literal,
}: {
  pattern: string;
  ignoreCase?: boolean;
  literal?: boolean;
}) {
  if (literal) {
    const searchValue = ignoreCase ? pattern.toLowerCase() : pattern;

    return (line: string) => {
      const haystack = ignoreCase ? line.toLowerCase() : line;
      return haystack.includes(searchValue);
    };
  }

  const flags = ignoreCase ? "i" : "";
  const regex = new RegExp(pattern, flags);

  return (line: string) => regex.test(line);
}

async function readTextLines(filePath: string) {
  const buffer = await readFile(filePath);

  if (isProbablyBinary(buffer)) {
    return null;
  }

  return normalizeToLF(buffer.toString("utf-8")).split("\n");
}

function formatMatchBlock(
  displayPath: string,
  lines: string[],
  matchLine: number,
  contextLines: number,
) {
  const output: string[] = [];
  let linesTruncated = false;
  const startLine = Math.max(1, matchLine - contextLines);
  const endLine = Math.min(lines.length, matchLine + contextLines);

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    const rawLine = lines[lineNumber - 1] ?? "";
    const truncatedLine = truncateLine(rawLine);

    if (truncatedLine.wasTruncated) {
      linesTruncated = true;
    }

    if (lineNumber === matchLine) {
      output.push(`${displayPath}:${lineNumber}: ${truncatedLine.text}`);
    } else {
      output.push(`${displayPath}-${lineNumber}- ${truncatedLine.text}`);
    }
  }

  return { output, linesTruncated };
}

export function createGrepTool(cwd: string) {
  return tool({
    description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Output is truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    inputSchema: grepSchema,
    execute: async ({
      pattern,
      path,
      glob,
      ignoreCase,
      literal,
      context,
      limit,
    }): Promise<GrepToolOutput> => {
      const absolutePath = resolveToCwd(path ?? ".", cwd);
      const pathStat = await stat(absolutePath);
      const matcher = createMatcher({ pattern, ignoreCase, literal });
      const contextLines = context ?? 0;
      const effectiveLimit = limit ?? DEFAULT_LIMIT;
      const outputLines: string[] = [];
      let matches = 0;
      let linesTruncated = false;

      const searchFile = async (filePath: string, displayPath: string) => {
        const lines = await readTextLines(filePath);

        if (!lines) {
          return false;
        }

        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? "";

          if (!matcher(line)) {
            continue;
          }

          matches += 1;

          const block = formatMatchBlock(
            displayPath,
            lines,
            index + 1,
            contextLines,
          );

          outputLines.push(...block.output);

          if (block.linesTruncated) {
            linesTruncated = true;
          }

          if (matches >= effectiveLimit) {
            return true;
          }
        }

        return false;
      };

      if (pathStat.isDirectory()) {
        await walkSearchTree(absolutePath, absolutePath, async (entry) => {
          if (entry.isDirectory) {
            return false;
          }

          if (glob && !matchesGlobPattern(entry.relativePath, glob)) {
            return false;
          }

          return searchFile(entry.absolutePath, entry.relativePath);
        });
      } else {
        const fileName = basename(absolutePath);

        if (!glob || matchesGlobPattern(fileName, glob)) {
          await searchFile(absolutePath, fileName);
        }
      }

      if (matches === 0) {
        return {
          path: toDisplayPath(absolutePath, cwd),
          matches,
          content: "No matches found",
          linesTruncated: false,
          truncated: false,
        };
      }

      const truncation = truncateHead(outputLines.join("\n"), {
        maxLines: Number.MAX_SAFE_INTEGER,
      });
      const notices: string[] = [];

      if (matches >= effectiveLimit) {
        notices.push(
          `${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
        );
      }

      if (truncation.truncated) {
        notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
      }

      if (linesTruncated) {
        notices.push("Some lines were truncated. Use read to inspect them fully");
      }

      let content = truncation.content;

      if (notices.length > 0) {
        content += `\n\n[${notices.join(". ")}]`;
      }

      return {
        path: toDisplayPath(absolutePath, cwd),
        matches,
        content,
        linesTruncated,
        truncated: notices.length > 0,
      };
    },
  });
}

export const grepTool = createGrepTool(process.cwd());
