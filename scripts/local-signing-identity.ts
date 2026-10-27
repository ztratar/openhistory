export interface LocalSigningIdentity {
  sha1: string;
  name: string;
}

export function parseLocalSigningIdentities(output: string): LocalSigningIdentity[] {
  return [...output.matchAll(/^\s*\d+\)\s+([A-F0-9]{40})\s+"([^"]+)"/gm)]
    .map((match) => ({ sha1: match[1]!, name: match[2]! }))
    .filter(({ name }) => name.startsWith("Apple Development:"));
}

/** Selects a stable identity; ambiguous keychains require an explicit SHA-1 pin. */
export function selectLocalSigningIdentity(
  output: string,
  options: { configuredIdentity?: string; expectedSha1?: string } = {}
): LocalSigningIdentity | undefined {
  const identities = parseLocalSigningIdentities(output);
  const expectedSha1 = options.expectedSha1?.trim().toUpperCase();
  if (expectedSha1) {
    const match = identities.find(({ sha1 }) => sha1 === expectedSha1);
    if (!match) throw new Error(`Configured OpenHistory signing certificate ${expectedSha1} is not available.`);
    return match;
  }
  const configured = options.configuredIdentity?.trim();
  if (configured) {
    const match = identities.find(({ name, sha1 }) => name === configured || sha1 === configured.toUpperCase());
    if (!match) throw new Error(`Configured OpenHistory signing identity ${configured} is not available.`);
    return match;
  }
  if (identities.length > 1) {
    throw new Error("Multiple Apple Development identities are available. Pin expectedIdentitySha1 in ~/.config/openhistory/local-signing.json.");
  }
  return identities[0];
}
