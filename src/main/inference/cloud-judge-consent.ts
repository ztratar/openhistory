export function explicitCloudJudgeKey(arguments_: readonly string[], configuredKey?: string): string | undefined {
  if (!arguments_.includes("--cloud-judge")) return undefined;
  const key = configuredKey?.trim();
  if (!key) throw new Error("Cloud judging was requested, but OPENAI_API_KEY is not configured.");
  return key;
}
