import { spawn } from "node:child_process";

import { tool } from "ai";
import { z } from "zod";

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateTail,
} from "./truncate.js";

const MAX_TIMEOUT_SECONDS = 600;
const CAPTURE_MAX_BYTES = DEFAULT_MAX_BYTES * 2;

const bashSchema = z.object({
  command: z.string().min(1).describe("Bash command to execute"),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(MAX_TIMEOUT_SECONDS)
    .optional()
    .describe("Timeout in seconds"),
});

export interface BashToolOutput {
  command: string;
  output: string;
  exitCode: number | null;
  truncated: boolean;
  timedOut?: boolean;
}

type CommandResult = {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
};

function keepRecentOutput(current: string, chunk: Buffer) {
  const next = current + chunk.toString("utf-8");
  return truncateTail(next, {
    maxLines: Number.MAX_SAFE_INTEGER,
    maxBytes: CAPTURE_MAX_BYTES,
  }).content;
}

async function runCommand(
  command: string,
  cwd: string,
  timeoutMs?: number,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], {
      cwd,
      env: process.env,
    });

    let output = "";
    let timedOut = false;

    const timeoutId =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");

            setTimeout(() => {
              child.kill("SIGKILL");
            }, 2_000).unref();
          }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      output = keepRecentOutput(output, chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      output = keepRecentOutput(output, chunk);
    });

    child.on("error", (error) => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }

      reject(error);
    });

    child.on("close", (exitCode) => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }

      resolve({
        exitCode,
        output,
        timedOut,
      });
    });
  });
}

function formatShellOutput(output: string) {
  const truncation = truncateTail(output);
  let text = truncation.content || "(no output)";

  if (!truncation.truncated) {
    return { output: text, truncated: false };
  }

  const startLine = truncation.totalLines - truncation.outputLines + 1;
  const endLine = truncation.totalLines;

  if (truncation.lastLinePartial) {
    const lastLine = output.split("\n").pop() ?? "";
    const lastLineSize = formatSize(Buffer.byteLength(lastLine, "utf-8"));
    text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}).]`;
  } else if (truncation.truncatedBy === "lines") {
    text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}.]`;
  } else {
    text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit).]`;
  }

  return {
    output: text,
    truncated: true,
  };
}

export function createBashTool(cwd: string) {
  return tool({
    description: `Execute a bash command in the current working directory. Output is truncated to the last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    inputSchema: bashSchema,
    execute: async ({ command, timeout }): Promise<BashToolOutput> => {
      const result = await runCommand(
        command,
        cwd,
        timeout === undefined ? undefined : timeout * 1000,
      );
      const formatted = formatShellOutput(result.output);

      if (result.timedOut) {
        throw new Error(
          `${formatted.output}\n\nCommand timed out after ${timeout} seconds`,
        );
      }

      if (result.exitCode !== 0 && result.exitCode !== null) {
        throw new Error(
          `${formatted.output}\n\nCommand exited with code ${result.exitCode}`,
        );
      }

      return {
        command,
        output: formatted.output,
        exitCode: result.exitCode,
        truncated: formatted.truncated,
      };
    },
  });
}

export const bashTool = createBashTool(process.cwd());
