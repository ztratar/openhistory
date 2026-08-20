import { Codex } from "@openai/codex-sdk";
import { z } from "zod";
import { codexEnvironment, type CodexRuntime } from "../../codex-runtime";
import type { InferenceProviderAdapter, StructuredGenerationRequest } from "../contracts";
import { InferenceOutputError } from "../errors";

interface CodexThread {
  run(
    input: string,
    options: { outputSchema: unknown }
  ): Promise<{ finalResponse: string }>;
}

interface CodexClient {
  startThread(options: {
    approvalPolicy: "never";
    model: string;
    modelReasoningEffort: "low";
    networkAccessEnabled: false;
    sandboxMode: "read-only";
    skipGitRepoCheck: true;
    webSearchMode: "disabled";
    workingDirectory: string;
  }): CodexThread;
}

export class CodexChatGPTProvider implements InferenceProviderAdapter {
  readonly provider = "openai" as const;
  private readonly client: CodexClient;

  constructor(
    readonly model: string,
    private readonly runtime: CodexRuntime,
    client?: CodexClient
  ) {
    this.client = client ?? new Codex({
      codexPathOverride: runtime.executablePath,
      env: codexEnvironment(runtime.codexHome),
      config: {
        agents: { enabled: false },
        analytics: { enabled: false },
        check_for_update_on_startup: false,
        cli_auth_credentials_store: "file",
        features: { shell_tool: false, unified_exec: false },
        feedback: { enabled: false },
        forced_login_method: "chatgpt",
        history: { persistence: "none" }
      }
    });
  }

  async generate<T>(request: StructuredGenerationRequest<T>): Promise<T> {
    const thread = this.client.startThread({
      model: this.model,
      sandboxMode: "read-only",
      workingDirectory: this.runtime.workingDirectory,
      skipGitRepoCheck: true,
      modelReasoningEffort: "low",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      approvalPolicy: "never"
    });
    const prompt = [
      request.instructions,
      "Do not use tools, execute commands, read files, or search the web.",
      `Return only the requested ${request.schemaName} JSON object and keep it within approximately ${request.maxOutputTokens} output tokens.`,
      "Evidence input follows:",
      request.input
    ].join("\n\n");

    try {
      const result = await thread.run(prompt, { outputSchema: z.toJSONSchema(request.schema) });
      return request.schema.parse(JSON.parse(result.finalResponse));
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        throw new InferenceOutputError("invalid_output");
      }
      throw error;
    }
  }
}
