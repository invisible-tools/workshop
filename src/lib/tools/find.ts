import { stat } from "node:fs/promises";

import { tool } from "ai";
import { z } from "zod";

import { resolveToCwd, toDisplayPath } from "./path-utils.js";
import { matchesGlobPattern, walkSearchTree } from "./search-utils.js";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from "./truncate.js";

const DEFAULT_LIMIT = 1000;

const findSchema = z.object({
  pattern: z
    .string()
    .describe("Glob pattern to match files, e.g. '*.ts' or 'src/**/*.ts'"),
  path: z
    .string()
    .optional()
    .describe("Directory to search in (default: current directory)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(DEFAULT_LIMIT * 10)
    .optional()
    .describe("Maximum number of results to return"),
});

export interface FindToolOutput {
  path: string;
  results: string[];
  content: string;
  truncated: boolean;
}

export function createFindTool(cwd: string) {
  return tool({
    description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    inputSchema: findSchema,
    execute: async ({ pattern, path, limit }): Promise<FindToolOutput> => {
      const absolutePath = resolveToCwd(path ?? ".", cwd);
      const directoryStat = await stat(absolutePath);

      if (!directoryStat.isDirectory()) {
        throw new Error("Path must point to a directory.");
      }

      const effectiveLimit = limit ?? DEFAULT_LIMIT;
      const results: string[] = [];

      await walkSearchTree(absolutePath, absolutePath, async (entry) => {
        if (!matchesGlobPattern(entry.relativePath, pattern)) {
          return false;
        }

        results.push(entry.relativePath);

        if (results.length >= effectiveLimit) {
          return true;
        }

        return false;
      });

      if (results.length === 0) {
        return {
          path: toDisplayPath(absolutePath, cwd),
          results,
          content: "No files found matching pattern",
          truncated: false,
        };
      }

      const truncation = truncateHead(results.join("\n"), {
        maxLines: Number.MAX_SAFE_INTEGER,
      });
      const notices: string[] = [];

      if (results.length >= effectiveLimit) {
        notices.push(
          `${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
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
        results,
        content,
        truncated: notices.length > 0,
      };
    },
  });
}

export const findTool = createFindTool(process.cwd());
