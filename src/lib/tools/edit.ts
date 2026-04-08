import { readFile, stat, writeFile } from "node:fs/promises";

import { tool } from "ai";
import { z } from "zod";

import { assertFileMutationsAllowed } from "./mutation-permission.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import { resolveToCwd, toDisplayPath } from "./path-utils.js";
import {
  detectLineEnding,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "./text-utils.js";

type EditReplacement = {
  oldText: string;
  newText: string;
};

const editReplacementSchema = z.object({
  oldText: z
    .string()
    .min(1)
    .describe("Exact text to replace. It must be unique in the file."),
  newText: z.string().describe("Replacement text."),
});

const editSchema = z.object({
  path: z.string().describe("Path to the file to edit (relative or absolute)"),
  edits: z
    .array(editReplacementSchema)
    .optional()
    .describe("One or more exact, non-overlapping replacements."),
  oldText: z.string().optional().describe("Legacy single-edit old text."),
  newText: z.string().optional().describe("Legacy single-edit replacement."),
});

type EditInput = z.infer<typeof editSchema>;

export interface EditToolOutput {
  path: string;
  replacements: number;
  firstChangedLine?: number;
  message: string;
}

type ResolvedReplacement = EditReplacement & {
  start: number;
  end: number;
};

function countOccurrences(source: string, searchValue: string) {
  let count = 0;
  let offset = 0;

  while (true) {
    const index = source.indexOf(searchValue, offset);

    if (index === -1) {
      return count;
    }

    count += 1;
    offset = index + searchValue.length;
  }
}

function normalizeEditInput(input: EditInput) {
  const edits = input.edits ? [...input.edits] : [];

  if (input.oldText !== undefined || input.newText !== undefined) {
    if (input.oldText === undefined || input.newText === undefined) {
      throw new Error(
        "oldText and newText must both be provided when using the legacy edit shape.",
      );
    }

    edits.push({
      oldText: input.oldText,
      newText: input.newText,
    });
  }

  if (edits.length === 0) {
    throw new Error("edits must contain at least one replacement.");
  }

  return edits;
}

function resolveReplacements(
  source: string,
  edits: EditReplacement[],
  filePath: string,
) {
  const replacements: ResolvedReplacement[] = [];

  for (const edit of edits) {
    const oldText = normalizeToLF(edit.oldText);
    const newText = normalizeToLF(edit.newText);

    if (oldText.length === 0) {
      throw new Error("edits[].oldText must not be empty.");
    }

    const occurrences = countOccurrences(source, oldText);

    if (occurrences === 0) {
      throw new Error(`Could not find a matching block in ${filePath}.`);
    }

    if (occurrences > 1) {
      throw new Error(
        `edits[].oldText matched more than once in ${filePath}. Make it more specific.`,
      );
    }

    const start = source.indexOf(oldText);

    replacements.push({
      oldText,
      newText,
      start,
      end: start + oldText.length,
    });
  }

  replacements.sort((left, right) => left.start - right.start);

  for (let index = 1; index < replacements.length; index += 1) {
    const previous = replacements[index - 1];
    const current = replacements[index];

    if (current.start < previous.end) {
      throw new Error(
        "Edit ranges overlap. Merge nearby changes into one edit instead.",
      );
    }
  }

  return replacements;
}

function applyReplacements(source: string, replacements: ResolvedReplacement[]) {
  let cursor = 0;
  let content = "";

  for (const replacement of replacements) {
    content += source.slice(cursor, replacement.start);
    content += replacement.newText;
    cursor = replacement.end;
  }

  content += source.slice(cursor);

  const firstChangedLine =
    replacements.length > 0
      ? source.slice(0, replacements[0].start).split("\n").length
      : undefined;

  return {
    content,
    replacements: replacements.length,
    firstChangedLine,
  };
}

export function createEditTool(cwd: string) {
  return tool({
    description:
      "Edit a single file using exact text replacement. Each edits[].oldText must be unique and non-overlapping in the original file.",
    inputSchema: editSchema,
    execute: async (input): Promise<EditToolOutput> => {
      assertFileMutationsAllowed();
      const edits = normalizeEditInput(input);
      const absolutePath = resolveToCwd(input.path, cwd);

      return withFileMutationQueue(absolutePath, async () => {
        const fileStat = await stat(absolutePath);

        if (!fileStat.isFile()) {
          throw new Error("Path must point to a file.");
        }

        const rawContent = await readFile(absolutePath, "utf-8");
        const { bom, text } = stripBom(rawContent);
        const lineEnding = detectLineEnding(text);
        const source = normalizeToLF(text);
        const replacements = resolveReplacements(source, edits, input.path);
        const result = applyReplacements(source, replacements);
        const finalContent =
          bom + restoreLineEndings(result.content, lineEnding);

        await writeFile(absolutePath, finalContent, "utf-8");

        return {
          path: toDisplayPath(absolutePath, cwd),
          replacements: result.replacements,
          firstChangedLine: result.firstChangedLine,
          message: `Successfully replaced ${result.replacements} block(s) in ${input.path}.`,
        };
      });
    },
  });
}

export const editTool = createEditTool(process.cwd());
