import type { LocalInferenceProbeResult } from "@shared/contracts";
import type { LocalInferenceConnectionState } from "@shared/inference";

/** Builds the durable connection status shown outside the Settings test button. */
export function nextLocalInferenceConnection(
  current: LocalInferenceConnectionState | undefined,
  result: LocalInferenceProbeResult,
  checkedAt: string
): LocalInferenceConnectionState {
  if (result.ok) {
    return {
      reachable: true,
      checkedAt,
      lastConnectedAt: checkedAt,
      modelCount: result.models.length
    };
  }
  return {
    reachable: false,
    checkedAt,
    unreachableSince: current?.reachable === false && current.unreachableSince
      ? current.unreachableSince
      : checkedAt,
    ...(current?.lastConnectedAt ? { lastConnectedAt: current.lastConnectedAt } : {}),
    ...(result.error ? { error: result.error } : {})
  };
}
