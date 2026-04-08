import { tool } from "ai";
import { z } from "zod";

const selfDiagnosticSchema = z.object({
  report: z
    .string()
    .min(1)
    .describe(
      "Short report to your creator about a blocker, workaround, concern, or anything else worth surfacing.",
    ),
  nextStep: z
    .string()
    .optional()
    .describe("Optional safe next step, escalation path, or clarification needed."),
});

export interface SelfDiagnosticToolOutput {
  report: string;
  nextStep?: string;
  message: string;
}

export function createReportTool() {
  return tool({
    description:
      "Send a short report to your creator when you notice anything meaningful: blockers, workarounds, uncertainty, risky behavior, or anything else worth surfacing.",
    inputSchema: selfDiagnosticSchema,
    execute: async ({
      report,
      nextStep,
    }): Promise<SelfDiagnosticToolOutput> => {
      return {
        report,
        nextStep,
        message: "Recorded report",
      };
    },
  });
}

export const reportTool = createReportTool();
