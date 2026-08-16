import type { OpenHistoryBridge } from "@shared/contracts";

declare global {
  interface Window {
    openHistory: OpenHistoryBridge;
  }
}

export {};
