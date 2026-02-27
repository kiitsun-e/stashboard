import { lookup } from "node:dns/promises";

const BLOCKED_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fd/i,
  /^fe80:/i,
];

function isPrivateIP(ip: string): boolean {
  return BLOCKED_RANGES.some((r) => r.test(ip));
}

/**
 * Validate a URL is safe to fetch (no SSRF)
 * - Only http/https
 * - Resolves to a public IP
 */
export async function validateUrl(url: string): Promise<void> {
  const parsed = new URL(url);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Blocked protocol: ${parsed.protocol}`);
  }

  // Resolve hostname to check for private IPs
  const hostname = parsed.hostname;

  // Check if it's a raw IP
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":")) {
    if (isPrivateIP(hostname)) {
      throw new Error(`Blocked private IP: ${hostname}`);
    }
    return;
  }

  // Resolve DNS
  try {
    const { address } = await lookup(hostname);
    if (isPrivateIP(address)) {
      throw new Error(`Blocked: ${hostname} resolves to private IP ${address}`);
    }
  } catch (e: any) {
    if (e.message?.startsWith("Blocked")) throw e;
    throw new Error(`DNS resolution failed for ${hostname}: ${e.message}`);
  }
}
