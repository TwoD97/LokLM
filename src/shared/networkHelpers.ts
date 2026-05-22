/** Returns true when `baseUrl` resolves to a loopback host — `localhost`,
 *  `127.0.0.0/8`, or `::1`. Anything else (LAN IP, public hostname, https
 *  proxy) is non-loopback and triggers the PasswordRetypeGate before the
 *  Ollama connector will use it. Lastenheft grundsatz: "lokal , offline
 *  nutzbar , keine externen KI-APIs" — loopback is the only host that
 *  satisfies that by default.
 *
 *  Errors (malformed URL) treat the input as non-loopback so a typo doesn't
 *  silently bypass the gate. */
export function isLoopbackBaseUrl(baseUrl: string): boolean {
  let host: string
  try {
    host = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return false
  }
  // Node keeps the square brackets around IPv6 hostnames ("[::1]") , peel
  // them off so the comparisons below stay shape-agnostic.
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host === 'localhost' || host === '::1') return true
  // IPv4-mapped IPv6 loopback: ::ffff:127.x.x.x
  if (host.startsWith('::ffff:127.')) return true
  // 127.0.0.0/8 — the entire IPv4 loopback range.
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  return false
}
