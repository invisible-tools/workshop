import type { ToolSet } from "ai";

export { createBashTool, bashTool, type BashToolOutput } from "./bash.js";
export { createEditTool, editTool, type EditToolOutput } from "./edit.js";
export { createFindTool, findTool, type FindToolOutput } from "./find.js";
export { createGrepTool, grepTool, type GrepToolOutput } from "./grep.js";
export { createLsTool, lsTool, type LsToolOutput } from "./ls.js";
export {
  assertFileMutationsAllowed,
  FILE_MUTATIONS_ENABLED,
} from "./mutation-permission.js";
export { createReadTool, readTool, type ReadToolOutput } from "./read.js";
export {
  createReportTool,
  reportTool,
  type SelfDiagnosticToolOutput,
} from "./self-diagnostic.js";
export {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  GREP_MAX_LINE_LENGTH,
  formatSize,
  truncateHead,
  truncateLine,
  truncateTail,
  type TruncationOptions,
  type TruncationResult,
} from "./truncate.js";
export { createWriteTool, writeTool, type WriteToolOutput } from "./write.js";
export { withFileMutationQueue } from "./file-mutation-queue.js";

import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createFindTool } from "./find.js";
import { createGrepTool } from "./grep.js";
import { createLsTool } from "./ls.js";
import { createReadTool } from "./read.js";
import { createReportTool } from "./self-diagnostic.js";
import { createWriteTool } from "./write.js";

export function createCodingTools(cwd: string) {
  return {
    read: createReadTool(cwd),
    bash: createBashTool(cwd),
    edit: createEditTool(cwd),
    write: createWriteTool(cwd),
    report: createReportTool(),
  } satisfies ToolSet;
}

export function createReadOnlyTools(cwd: string) {
  return {
    read: createReadTool(cwd),
    grep: createGrepTool(cwd),
    find: createFindTool(cwd),
    ls: createLsTool(cwd),
    report: createReportTool(),
  } satisfies ToolSet;
}

export function createAllTools(cwd: string) {
  return {
    read: createReadTool(cwd),
    bash: createBashTool(cwd),
    edit: createEditTool(cwd),
    write: createWriteTool(cwd),
    grep: createGrepTool(cwd),
    find: createFindTool(cwd),
    ls: createLsTool(cwd),
    report: createReportTool(),
  } satisfies ToolSet;
}

export const codingTools = createCodingTools(process.cwd());
export const readOnlyTools = createReadOnlyTools(process.cwd());
export const allTools = createAllTools(process.cwd());
