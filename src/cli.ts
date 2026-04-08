import { existsSync, statSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  argv,
  cwd,
  env,
  exit,
  loadEnvFile,
  stdin,
  stdout,
} from "node:process";

import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import {
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";

import { codingAgentSystemPrompt, createCodingTools } from "./lib/coding-tools";
import type {
  BashToolOutput,
  EditToolOutput,
  FindToolOutput,
  GrepToolOutput,
  LsToolOutput,
  ReadToolOutput,
  SelfDiagnosticToolOutput,
  WriteToolOutput,
} from "./lib/tools/index.js";

const EXIT_COMMANDS = new Set(["/exit", "exit", "quit"]);
const HELP_COMMANDS = new Set(["/help", "help"]);
const CLEAR_COMMANDS = new Set(["/clear", "clear"]);

type Provider = "openai" | "anthropic";

type CliOptions = {
  workspaceCwd: string;
  provider: Provider;
  modelName?: string;
  prompt?: string;
};

function loadLocalEnvFiles() {
  for (const fileName of [".env.local", ".env"]) {
    if (existsSync(fileName)) {
      loadEnvFile(fileName);
    }
  }
}

function getDefaultModelName(provider: Provider) {
  if (provider === "anthropic") {
    return env.ANTHROPIC_MODEL ?? "claude-3-haiku-20240307";
  }

  return env.OPENAI_MODEL ?? "gpt-5.4";
}

function resolveModelName(provider: Provider, value?: string) {
  return value ?? getDefaultModelName(provider);
}

function createModel(provider: Provider, modelName: string): LanguageModel {
  if (provider === "anthropic") {
    return anthropic(modelName);
  }

  return openai(modelName);
}

function assertProviderEnv(provider: Provider) {
  if (provider === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) {
      console.error("Missing ANTHROPIC_API_KEY in .env.local or the environment.");
      exit(1);
    }

    return;
  }

  if (!env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY in .env.local or the environment.");
    exit(1);
  }
}

function createUserMessage(text: string): ModelMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
  };
}

function formatReadSummary(output: Partial<ReadToolOutput>) {
  if (typeof output.path !== "string") {
    return "read";
  }

  if (
    typeof output.offset === "number" &&
    typeof output.nextOffset === "number"
  ) {
    return `read ${output.path} from line ${output.offset}`;
  }

  return `read ${output.path}`;
}

function formatWriteSummary(output: Partial<WriteToolOutput>) {
  if (typeof output.path !== "string") {
    return "write";
  }

  return `write ${output.path}`;
}

function formatEditSummary(output: Partial<EditToolOutput>) {
  if (typeof output.path !== "string") {
    return "edit";
  }

  return `edit updated ${output.path}`;
}

function formatLsSummary(output: Partial<LsToolOutput>) {
  if (!Array.isArray(output.entries)) {
    return "ls";
  }

  return `ls returned ${output.entries.length} entries`;
}

function formatBashSummary(output: Partial<BashToolOutput>) {
  if (typeof output.command !== "string") {
    return "bash";
  }

  const exitCode =
    typeof output.exitCode === "number" ? output.exitCode : "unknown";
  const timedOut = output.timedOut === true ? " timed out" : "";

  return `bash exit=${exitCode}${timedOut}: ${output.command}`;
}

function formatGrepSummary(output: Partial<GrepToolOutput>) {
  if (typeof output.matches !== "number") {
    return "grep";
  }

  return `grep returned ${output.matches} matches`;
}

function formatFindSummary(output: Partial<FindToolOutput>) {
  if (!Array.isArray(output.results)) {
    return "find";
  }

  return `find returned ${output.results.length} results`;
}

function formatSelfDiagnosticSummary(
  output: Partial<SelfDiagnosticToolOutput>,
) {
  if (typeof output.report !== "string") {
    return "report";
  }

  return `report: ${output.report}`;
}

function formatToolSummary(toolName: string, output: unknown) {
  switch (toolName) {
    case "read":
      return formatReadSummary(output as Partial<ReadToolOutput>);
    case "write":
      return formatWriteSummary(output as Partial<WriteToolOutput>);
    case "edit":
      return formatEditSummary(output as Partial<EditToolOutput>);
    case "ls":
      return formatLsSummary(output as Partial<LsToolOutput>);
    case "bash":
      return formatBashSummary(output as Partial<BashToolOutput>);
    case "grep":
      return formatGrepSummary(output as Partial<GrepToolOutput>);
    case "find":
      return formatFindSummary(output as Partial<FindToolOutput>);
    case "report":
      return formatSelfDiagnosticSummary(
        output as Partial<SelfDiagnosticToolOutput>,
      );
    default:
      return toolName;
  }
}

function printAssistantError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`assistant> error: ${message}`);
}

function printHelp() {
  console.log("Commands:");
  console.log("  /help   Show help");
  console.log("  /clear  Clear conversation history");
  console.log("  /exit   Quit");
  console.log("");
  console.log("Options:");
  console.log("  --cwd <path>  Run the agent against a workspace directory");
  console.log("  --provider    Select model provider: openai | anthropic");
  console.log("  --model       Override the model name");
  console.log("");
  console.log(
    'Example: ask it "build hello world in python" and it should create a file, not just print code.',
  );
}

function printBanner(workspaceCwd: string, provider: Provider, modelName: string) {
  console.log("Basic Coding Agent");
  console.log(`workspace: ${workspaceCwd}`);
  console.log(`provider: ${provider}`);
  console.log(`model: ${modelName}`);
  console.log("commands: /help, /clear, /exit");
  console.log("");
}

function resolveWorkspaceCwd(value: string) {
  const workspaceCwd = resolvePath(cwd(), value);

  if (!existsSync(workspaceCwd)) {
    throw new Error(`Workspace does not exist: ${workspaceCwd}`);
  }

  const stat = statSync(workspaceCwd);

  if (!stat.isDirectory()) {
    throw new Error(`Workspace must be a directory: ${workspaceCwd}`);
  }

  return workspaceCwd;
}

function parseCliOptions(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  let workspaceCwd = cwd();
  let provider: Provider = "openai";
  let modelName: string | undefined;
  const promptParts: string[] = [];

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const current = normalizedArgs[index];

    if (current === "--") {
      promptParts.push(...normalizedArgs.slice(index + 1));
      break;
    }

    if (current === "--cwd") {
      const next = normalizedArgs[index + 1];

      if (!next) {
        throw new Error("--cwd requires a path");
      }

      workspaceCwd = resolveWorkspaceCwd(next);
      index += 1;
      continue;
    }

    if (current.startsWith("--cwd=")) {
      const value = current.slice("--cwd=".length);

      if (!value) {
        throw new Error("--cwd requires a path");
      }

      workspaceCwd = resolveWorkspaceCwd(value);
      continue;
    }

    if (current === "--provider") {
      const next = normalizedArgs[index + 1];

      if (next !== "openai" && next !== "anthropic") {
        throw new Error("--provider must be openai or anthropic");
      }

      provider = next;
      index += 1;
      continue;
    }

    if (current.startsWith("--provider=")) {
      const value = current.slice("--provider=".length);

      if (value !== "openai" && value !== "anthropic") {
        throw new Error("--provider must be openai or anthropic");
      }

      provider = value;
      continue;
    }

    if (current === "--model") {
      const next = normalizedArgs[index + 1];

      if (!next) {
        throw new Error("--model requires a value");
      }

      modelName = next;
      index += 1;
      continue;
    }

    if (current.startsWith("--model=")) {
      const value = current.slice("--model=".length);

      if (!value) {
        throw new Error("--model requires a value");
      }

      modelName = value;
      continue;
    }

    promptParts.push(current);
  }

  const prompt = promptParts.join(" ").trim();

  return {
    workspaceCwd,
    provider,
    modelName,
    prompt: prompt.length > 0 ? prompt : undefined,
  };
}

async function runTurn(
  history: ModelMessage[],
  input: string,
  tools: ToolSet,
  model: LanguageModel,
) {
  history.push(createUserMessage(input));

  let printedAssistantPrefix = false;
  let printedAnyOutput = false;
  let pendingNewlineAfterTool = false;

  const result = streamText({
    model,
    system: codingAgentSystemPrompt,
    messages: history,
    tools,
    stopWhen: stepCountIs(10),
    onChunk({ chunk }) {
      if (chunk.type === "tool-call") {
        if (printedAssistantPrefix) {
          stdout.write("\n");
          printedAssistantPrefix = false;
        }

        stdout.write(`[tool] ${chunk.toolName}\n`);
        printedAnyOutput = true;
        pendingNewlineAfterTool = false;
        return;
      }

      if (chunk.type === "tool-result") {
        stdout.write(`[tool] ${formatToolSummary(chunk.toolName, chunk.output)}\n`);
        printedAnyOutput = true;
        pendingNewlineAfterTool = true;
        return;
      }

      if (chunk.type === "text-delta") {
        if (!printedAssistantPrefix) {
          if (pendingNewlineAfterTool) {
            stdout.write("\n");
            pendingNewlineAfterTool = false;
          }

          stdout.write("assistant> ");
          printedAssistantPrefix = true;
        }

        stdout.write(chunk.text);
        printedAnyOutput = true;
      }
    },
  });

  await result.consumeStream();

  if (printedAssistantPrefix) {
    stdout.write("\n");
  }

  const finalText = await result.text;

  if (!printedAssistantPrefix && finalText.trim().length > 0) {
    stdout.write(`assistant> ${finalText}\n`);
    printedAnyOutput = true;
  }

  if (!printedAnyOutput) {
    stdout.write("assistant> Done.\n");
  }

  const response = await result.response;
  history.push(...response.messages);
}

async function runInteractiveMode(
  workspaceCwd: string,
  provider: Provider,
  modelName: string,
  tools: ToolSet,
  model: LanguageModel,
) {
  const history: ModelMessage[] = [];
  const rl = createInterface({
    input: stdin,
    output: stdout,
  });

  printBanner(workspaceCwd, provider, modelName);

  while (true) {
    const answer = await rl.question("you> ");
    const input = answer.trim();

    if (!input) {
      continue;
    }

    if (EXIT_COMMANDS.has(input)) {
      rl.close();
      return;
    }

    if (HELP_COMMANDS.has(input)) {
      printHelp();
      continue;
    }

    if (CLEAR_COMMANDS.has(input)) {
      history.length = 0;
      console.log("conversation cleared");
      console.log("");
      continue;
    }

    console.log("");

    try {
      await runTurn(history, input, tools, model);
    } catch (error) {
      printAssistantError(error);
    }

    console.log("");
  }
}

async function runSinglePrompt(
  prompt: string,
  tools: ToolSet,
  model: LanguageModel,
) {
  const history: ModelMessage[] = [];

  try {
    await runTurn(history, prompt, tools, model);
  } catch (error) {
    printAssistantError(error);
    exit(1);
  }
}

async function main() {
  loadLocalEnvFiles();

  const args = argv.slice(2);

  const options = parseCliOptions(args);
  const modelName = resolveModelName(options.provider, options.modelName);
  const model = createModel(options.provider, modelName);

  if (args.includes("--help") || args.includes("-h")) {
    printBanner(options.workspaceCwd, options.provider, modelName);
    printHelp();
    return;
  }

  assertProviderEnv(options.provider);
  const tools = createCodingTools(options.workspaceCwd);

  if (options.prompt) {
    await runSinglePrompt(options.prompt, tools, model);
    return;
  }

  await runInteractiveMode(
    options.workspaceCwd,
    options.provider,
    modelName,
    tools,
    model,
  );
}

void main();
