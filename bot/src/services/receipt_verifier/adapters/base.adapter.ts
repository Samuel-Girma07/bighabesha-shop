import dns from 'dns';
import net from 'net';
import { logger } from '../../../logger/index.js';
import { CircuitBreaker } from '../circuit_breaker.js';
import { DEFAULT_BANK_NETWORK_TIMEOUT_MS } from '../constants.js';
import {
  IBankReceiptVerifier,
  SupportedBank,
  ExtractedReceiptReference,
  BankTransactionPayload,
  BankVerificationOptions,
  BankPortalUnavailableError,
  ReceiptVerificationError,
} from '../types.js';

export interface ExecuteProtectionOptions<T> {
  targetUrl: string;
  timeoutMs: number;
  operation: (signal: AbortSignal) => Promise<T>;
  onError?: (err: unknown, targetUrl: string, timeoutMs: number) => void;
}

/**
 * Validates whether an IP address belongs to private, loopback, link-local,
 * carrier-grade NAT, or cloud metadata ranges.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  let cleanIp = ip.trim();
  if (cleanIp.startsWith('::ffff:')) {
    cleanIp = cleanIp.slice(7);
  }

  if (!net.isIP(cleanIp)) {
    return false;
  }

  // IPv4 checks
  if (net.isIPv4(cleanIp)) {
    const parts = cleanIp.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    const [b0, b1, b2, b3] = parts;

    // 0.0.0.0/8 (Current network)
    if (b0 === 0) return true;
    // 10.0.0.0/8 (Private Class A)
    if (b0 === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;
    // 169.254.0.0/16 (Link-Local / AWS & Cloud Metadata 169.254.169.254)
    if (b0 === 169 && b1 === 254) return true;
    // 172.16.0.0/12 (Private Class B)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.168.0.0/16 (Private Class C)
    if (b0 === 192 && b1 === 168) return true;
    // 100.64.0.0/10 (Carrier-Grade NAT)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (b0 === 192 && b1 === 0 && b2 === 2) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (b0 === 198 && b1 === 51 && b2 === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (b0 === 203 && b1 === 0 && b2 === 113) return true;
    // 224.0.0.0/4 (Multicast)
    if (b0 >= 224 && b0 <= 239) return true;
    // 240.0.0.0/4 (Reserved / Future use)
    if (b0 >= 240) return true;
    // 255.255.255.255 (Broadcast)
    if (b0 === 255 && b1 === 255 && b2 === 255 && b3 === 255) return true;

    return false;
  }

  // IPv6 checks
  if (net.isIPv6(cleanIp)) {
    const lower = cleanIp.toLowerCase();
    // ::1 (Loopback)
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
    // :: (Unspecified)
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
    // fe80::/10 (Link-Local)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    // fc00::/7 (Unique Local Address - private)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

    return false;
  }

  return false;
}

/**
 * Abstract base class for bank receipt verifiers.
 * Encapsulates common SSRF domain whitelisting, circuit breaker state tracking,
 * and fetch timeout management.
 */
export abstract class BaseBankAdapter implements IBankReceiptVerifier {
  public abstract readonly bankRail: SupportedBank;
  protected readonly circuitBreaker: CircuitBreaker;
  protected readonly defaultTimeoutMs: number;

  constructor(circuitBreaker?: CircuitBreaker, defaultTimeoutMs: number = DEFAULT_BANK_NETWORK_TIMEOUT_MS) {
    this.circuitBreaker = circuitBreaker || new CircuitBreaker();
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  public abstract canHandle(reference: ExtractedReceiptReference): boolean;

  public abstract verify(
    reference: ExtractedReceiptReference,
    options?: BankVerificationOptions
  ): Promise<BankTransactionPayload>;

  /**
   * Asserts that targetUrl is HTTPS, contains no credentials, matches allowed ports,
   * is not a raw IP or private host, and strictly matches allowed hostnames.
   * Throws ReceiptVerificationError on failure.
   */
  public assertSsrfSafety(
    urlStr: string,
    permittedHosts: readonly string[],
    allowedPorts: readonly number[] = [443, 100]
  ): URL {
    try {
      const parsed = new URL(urlStr);
      if (parsed.protocol !== 'https:') {
        throw new Error(`Only HTTPS protocol is permitted for ${this.bankRail.toUpperCase()} confirmation`);
      }

      // Block embedded user credentials (e.g. https://admin:secret@host)
      if (parsed.username || parsed.password) {
        throw new Error(`SSRF violation: User credentials in verification URL are prohibited`);
      }

      // Restrict port (default HTTPS 443 or specific bank ports e.g. CBE 100)
      const port = parsed.port ? parseInt(parsed.port, 10) : 443;
      if (!allowedPorts.includes(port)) {
        throw new Error(`SSRF violation: Port '${port}' is not permitted for ${this.bankRail.toUpperCase()} confirmation`);
      }

      const rawHost = parsed.hostname.toLowerCase();
      const cleanHost = rawHost.replace(/^\[|\]$/g, '');

      // Block direct IP address literals or loopback hostnames
      if (net.isIP(cleanHost) || cleanHost === 'localhost' || cleanHost.endsWith('.localhost')) {
        throw new Error(
          `SSRF violation: Direct IP or loopback address '${rawHost}' is not permitted`
        );
      }

      const isPermitted = permittedHosts.some(
        (allowed) => cleanHost === allowed || cleanHost.endsWith(`.${allowed}`)
      );

      if (!isPermitted) {
        throw new Error(
          `SSRF violation: Hostname '${rawHost}' is not a permitted ${this.bankRail.toUpperCase()} host`
        );
      }

      return parsed;
    } catch (err: unknown) {
      if (err instanceof ReceiptVerificationError) {
        throw err;
      }
      throw new ReceiptVerificationError(
        'INTERNAL_ENGINE_ERROR',
        500,
        'SSRF Validation Error',
        err instanceof Error ? err.message : 'Invalid target verification URL',
        'Outbound verification requests are strictly bound to permitted banking hostnames.'
      );
    }
  }

  /**
   * Performs deep SSRF validation including DNS rebinding inspection.
   * Resolves hostname and verifies that all returned IPs are outside private/reserved ranges.
   */
  public async validateSsrfHost(
    urlStr: string,
    permittedHosts: readonly string[],
    allowedPorts: readonly number[] = [443, 100],
    dnsLookup?: (host: string) => Promise<Array<{ address: string }>>
  ): Promise<URL> {
    const parsed = this.assertSsrfSafety(urlStr, permittedHosts, allowedPorts);
    const hostname = parsed.hostname.toLowerCase();

    // 1. If explicit dnsLookup is supplied (e.g. in tests or specialized resolvers)
    if (dnsLookup) {
      const records = await dnsLookup(hostname);
      for (const record of records) {
        if (isPrivateOrReservedIp(record.address)) {
          throw new ReceiptVerificationError(
            'INTERNAL_ENGINE_ERROR',
            500,
            'SSRF Validation Error',
            `SSRF violation: Hostname '${hostname}' resolved to private/reserved IP '${record.address}'`,
            'Outbound verification requests are strictly bound to permitted public banking hostnames.'
          );
        }
      }
      return parsed;
    }

    // 2. In live environments, resolve with a hard 1.5s timeout to guard against hung DNS queries
    if (!process.env.VITEST) {
      try {
        let timeoutHandle: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('DNS lookup timeout')), 1500);
        });

        const records = await Promise.race([
          dns.promises.lookup(hostname, { all: true }),
          timeoutPromise,
        ]).finally(() => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        });

        for (const record of records) {
          if (isPrivateOrReservedIp(record.address)) {
            throw new Error(
              `SSRF violation: Hostname '${hostname}' resolved to private/reserved IP '${record.address}'`
            );
          }
        }
      } catch (err: unknown) {
        if (err instanceof ReceiptVerificationError) {
          throw err;
        }
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('SSRF violation')) {
          throw new ReceiptVerificationError(
            'INTERNAL_ENGINE_ERROR',
            500,
            'SSRF Validation Error',
            msg,
            'Outbound verification requests are strictly bound to permitted public banking hostnames.'
          );
        }
        logger.debug({ hostname, err: msg }, 'DNS pre-validation lookup exception (fallback to network fetch)');
      }
    }

    return parsed;
  }

  /**
   * Checks circuit breaker state and throws BankPortalUnavailableError if OPEN.
   */
  protected ensureCircuitBreakerPermits(bypass: boolean = false): void {
    if (!this.circuitBreaker.canAttempt(bypass)) {
      throw new BankPortalUnavailableError(
        this.bankRail,
        `${this.bankRail.toUpperCase()} confirmation portal circuit breaker is OPEN due to repeated timeouts.`
      );
    }
  }

  /**
   * Executes an asynchronous network operation wrapped in an AbortController timeout
   * and circuit breaker telemetry.
   */
  protected async executeWithProtection<T>(params: ExecuteProtectionOptions<T>): Promise<T> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), params.timeoutMs);

    try {
      const result = await params.operation(controller.signal);
      this.circuitBreaker.recordSuccess();
      return result;
    } catch (err: unknown) {
      this.circuitBreaker.recordFailure(err);

      if (params.onError) {
        params.onError(err, params.targetUrl, params.timeoutMs);
      }

      if (this.isAbortError(err)) {
        logger.warn(
          { targetUrl: params.targetUrl, timeoutMs: params.timeoutMs },
          `${this.bankRail.toUpperCase()} portal request timed out`
        );
        throw new BankPortalUnavailableError(
          this.bankRail,
          `Connection timed out after ${params.timeoutMs}ms`
        );
      }

      logger.warn(
        { targetUrl: params.targetUrl, err: err instanceof Error ? err.message : String(err) },
        `${this.bankRail.toUpperCase()} portal request failed`
      );
      throw new BankPortalUnavailableError(
        this.bankRail,
        err instanceof Error ? err.message : `Failed to connect to ${this.bankRail.toUpperCase()} portal`
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  protected isAbortError(err: unknown): boolean {
    return (
      (err instanceof Error && err.name === 'AbortError') ||
      (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError')
    );
  }
}
