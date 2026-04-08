import { readFile, stat } from "node:fs/promises";

import { tool } from "ai";
import { z } from "zod";

import { resolveReadPath, toDisplayPath } from "./path-utils.js";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "./truncate.js";
import { isProbablyBinary } from "./text-utils.js";

const readSchema = z.object({
  path: z.string().describe("Path to the file to read (relative or absolute)"),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Line number to start reading from (1-indexed)"),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Maximum number of lines to read"),
});

export interface ReadToolOutput {
  path: string;
  content: string;
  offset: number;
  nextOffset?: number;
  truncated: boolean;
  binary?: boolean;
}

export function createReadTool(cwd: string) {
  return tool({
    description: `Read the contents of a file. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files.`,
    inputSchema: readSchema,
    execute: async ({ path, offset, limit }): Promise<ReadToolOutput> => {
      const absolutePath = resolveReadPath(path, cwd);
      const fileStat = await stat(absolutePath);

      if (!fileStat.isFile()) {
        throw new Error("Path must point to a file.");
      }

      const buffer = await readFile(absolutePath);

      if (isProbablyBinary(buffer)) {
        return {
          path: toDisplayPath(absolutePath, cwd),
          content: "[Binary file omitted]",
          offset: 0,
          truncated: false,
          binary: true,
        };
      }

      const text = buffer.toString("utf-8");

      if (text === "") {
        return {
          path: toDisplayPath(absolutePath, cwd),
          content: "",
          offset: 0,
          truncated: false,
        };
      }

      const allLines = text.split("\n");

      const startLine = offset ?? 1;
      const startIndex = startLine - 1;

      if (startIndex >= allLines.length) {
        throw new Error(
          `Offset ${startLine} is beyond end of file (${allLines.length} lines total)`,
        );
      }

      let selectedContent = allLines.slice(startIndex).join("\n");
      let userLimitedLines: number | undefined;

      if (limit !== undefined) {
        const endIndex = Math.min(startIndex + limit, allLines.length);
        selectedContent = allLines.slice(startIndex, endIndex).join("\n");
        userLimitedLines = endIndex - startIndex;
      }

      const truncation = truncateHead(selectedContent);
      let content = truncation.content;
      let nextOffset: number | undefined;

      if (truncation.firstLineExceedsLimit) {
        const lineSize = formatSize(
          Buffer.byteLength(allLines[startIndex] ?? "", "utf-8"),
        );
        content = `[Line ${startLine} is ${lineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash for a narrower read.]`;
      } else if (truncation.truncated) {
        const endLine = startLine + truncation.outputLines - 1;
        nextOffset = endLine + 1;
        content += `\n\n[Showing lines ${startLine}-${endLine} of ${allLines.length}. Use offset=${nextOffset} to continue.]`;
      } else if (
        userLimitedLines !== undefined &&
        startIndex + userLimitedLines < allLines.length
      ) {
        nextOffset = startIndex + userLimitedLines + 1;
        const remainingLines = allLines.length - (startIndex + userLimitedLines);
        content += `\n\n[${remainingLines} more lines in file. Use offset=${nextOffset} to continue.]`;
      }

      return {
        path: toDisplayPath(absolutePath, cwd),
        content,
        offset: startLine,
        nextOffset,
        truncated: truncation.truncated || nextOffset !== undefined,
      };
    },
  });
}

export const readTool = createReadTool(process.cwd());
