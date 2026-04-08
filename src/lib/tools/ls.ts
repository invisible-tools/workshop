import { readdir, stat } from "node:fs/promises";

import { tool } from "ai";
import { z } from "zod";

import { resolveToCwd, toDisplayPath } from "./path-utils.js";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from "./truncate.js";

const DEFAULT_LIMIT = 500;

const lsSchema = z.object({
  path: z
    .string()
    .optional()
    .describe("Directory to list (default: current directory)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(DEFAULT_LIMIT * 10)
    .optional()
    .describe("Maximum number of entries to return"),
});

export interface LsToolOutput {
  path: string;
  entries: string[];
  content: string;
  truncated: boolean;
}

export function createLsTool(cwd: string) {
  return tool({
    description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Output is truncated to ${DEFAULT_LIMIT} entries or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    inputSchema: lsSchema,
    execute: async ({ path, limit }): Promise<LsToolOutput> => {
      const absolutePath = resolveToCwd(path ?? ".", cwd);
      const directoryStat = await stat(absolutePath);

      if (!directoryStat.isDirectory()) {
        throw new Error("Path must point to a directory.");
      }

      const dirents = await readdir(absolutePath, { withFileTypes: true });
      dirents.sort((left, right) =>
        left.name.toLowerCase().localeCompare(right.name.toLowerCase()),
      );

      const effectiveLimit = limit ?? DEFAULT_LIMIT;
      const entries = dirents
        .slice(0, effectiveLimit)
        .map((dirent) => (dirent.isDirectory() ? `${dirent.name}/` : dirent.name));

      if (entries.length === 0) {
        return {
          path: toDisplayPath(absolutePath, cwd),
          entries,
          content: "(empty directory)",
          truncated: false,
        };
      }

      const truncation = truncateHead(entries.join("\n"), {
        maxLines: Number.MAX_SAFE_INTEGER,
      });
      const notices: string[] = [];

      if (dirents.length > effectiveLimit) {
        notices.push(
          `${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`,
        );
      }

      if (truncation.truncated) {
        notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
      }

      let content = truncation.content;

      if (notices.length > 0) {
        content += `\n\n[${notices.join(". ")}]`;
      }

      return {
        path: toDisplayPath(absolutePath, cwd),
        entries,
        content,
        truncated: notices.length > 0,
      };
    },
  });
}

export const lsTool = createLsTool(process.cwd());
