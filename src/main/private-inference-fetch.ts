import { lookup as dnsLookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import { isPrivateInferenceHost, normalizeLocalInferenceBaseUrl } from "@shared/inference";

type ResolvedAddress = { address: string; family: 4 | 6 };
type LookupFunction = (hostname: string) => Promise<ResolvedAddress[]>;

const defaultLookup: LookupFunction = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })) as ResolvedAddress[];

/** Resolve a permitted hostname and reject it unless every result is private. */
export async function resolvePrivateInferenceHost(
  hostname: string,
  lookup: LookupFunction = defaultLookup
): Promise<ResolvedAddress[]> {
  const literal = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isPrivateInferenceHost(literal) && (/^\d/.test(literal) || literal.includes(":"))) {
    return [{ address: literal, family: literal.includes(":") ? 6 : 4 }];
  }
  const addresses = await lookup(literal);
  if (addresses.length === 0 || addresses.some(({ address }) => !isPrivateInferenceHost(address))) {
    throw new Error("The local inference hostname did not resolve exclusively to private addresses.");
  }
  return addresses;
}

/**
 * Fetches one private inference URL with DNS pinned to addresses validated immediately
 * before connecting. Redirects are rejected so activity evidence cannot be forwarded to
 * a different origin. Responses are buffered before the one-request agent is closed.
 */
export async function privateInferenceFetch(
  input: string | URL | Request,
  init?: RequestInit,
  lookup: LookupFunction = defaultLookup
): Promise<Response> {
  const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  const url = new URL(rawUrl);
  const allowedOrigin = normalizeLocalInferenceBaseUrl(url.origin);
  if (!allowedOrigin) throw new Error("Local inference requests require a private network address.");
  const addresses = await resolvePrivateInferenceHost(url.hostname, lookup);
  const agent = new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        const family = typeof options === "object" && options.family ? Number(options.family) : 0;
        const candidates = family ? addresses.filter((entry) => entry.family === family) : addresses;
        const selected = candidates.length > 0 ? candidates : addresses;
        if (typeof options === "object" && options.all) callback(null, selected);
        else callback(null, selected[0]!.address, selected[0]!.family);
      }
    }
  });
  try {
    const response = await undiciFetch(url, {
      ...init,
      redirect: "manual",
      dispatcher: agent
    } as Parameters<typeof undiciFetch>[1]);
    if (response.status >= 300 && response.status < 400) {
      throw new Error("Local inference redirects are not allowed.");
    }
    const body = await response.arrayBuffer();
    const headers = new Headers();
    response.headers.forEach((value, key) => headers.set(key, value));
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } finally {
    await agent.close();
  }
}
