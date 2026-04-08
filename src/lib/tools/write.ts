import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { tool } from "ai";
import { z } from "zod";

import { assertFileMutationsAllowed } from "./mutation-permission.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import { resolveToCwd, toDisplayPath } from "./path-utils.js";

const writeSchema = z.object({
  path: z.string().describe("Path to the file to write (relative or absolute)"),
  content: z.string().describe("Content to write to the file"),
});

export interface WriteToolOutput {
  path: string;
  bytesWritten: number;
  message: string;
}

export function createWriteTool(cwd: string) {
  return tool({
    description:
      "Write content to a file. Creates the file if it does not exist, overwrites it if it does, and creates parent directories when needed.",
    inputSchema: writeSchema,
    execute: async ({ path, content }): Promise<WriteToolOutput> => {
      assertFileMutationsAllowed();
      const absolutePath = resolveToCwd(path, cwd);

      return withFileMutationQueue(absolutePath, async () => {
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, content, "utf-8");

        return {
          path: toDisplayPath(absolutePath, cwd),
          bytesWritten: Buffer.byteLength(content, "utf-8"),
          message: `Successfully wrote ${Buffer.byteLength(content, "utf-8")} bytes to ${path}`,
        };
      });
    },
  });
}

export const writeTool = createWriteTool(process.cwd());
