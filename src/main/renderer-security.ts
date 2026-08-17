export function isTrustedRendererUrl(
  value: string,
  productionFileUrl: string,
  developmentUrl?: string
): boolean {
  try {
    const candidate = new URL(value);
    if (developmentUrl) return candidate.origin === new URL(developmentUrl).origin;
    return candidate.href === productionFileUrl;
  } catch {
    return false;
  }
}

export function safeExternalHttpsUrl(value: string): string | undefined {
  try {
    const candidate = new URL(value);
    if (candidate.protocol !== "https:" || candidate.username || candidate.password) return undefined;
    return candidate.href;
  } catch {
    return undefined;
  }
}
