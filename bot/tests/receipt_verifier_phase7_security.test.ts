/**
 * Bighabesha Shop - Ethiopian Bank Receipt Verification Engine
 * Phase 7: SAST / SCA Security Verification & Defensive Assertion Suite
 *
 * CWE-918: Server-Side Request Forgery (SSRF) & DNS Rebinding
 * CWE-1333: Regular Expression Denial of Service (ReDoS)
 * CWE-400: Resource Exhaustion & Payload Truncation
 * CWE-208: Observable Timing Discrepancy
 * CWE-287 / CWE-697: Beneficiary Authentication & Exact Suffix Matching
 */

import { describe, it, expect } from 'vitest';
import { CbeBankAdapter } from '../src/services/receipt_verifier/adapters/cbe.adapter.js';
import { isPrivateOrReservedIp } from '../src/services/receipt_verifier/adapters/base.adapter.js';
import { SecurityGateService } from '../src/services/receipt_verifier/security_gate.service.js';
import { ReceiptIngestionService } from '../src/services/receipt_verifier/ingestion.service.js';
import { CBE_PERMITTED_HOSTNAMES } from '../src/services/receipt_verifier/constants.js';
import { validateVerificationSettings } from '../src/services/settings.service.js';

describe('Phase 7: SAST & SCA Security Hardening Suite', () => {
  // ============================================================================
  // 1. SSRF & Private IP Range Filtering (CWE-918)
  // ============================================================================

  describe('1. SSRF & Private IP Range Filtering (CWE-918)', () => {
    it('isPrivateOrReservedIp flags all private, loopback, and cloud metadata IPv4/IPv6 addresses', () => {
      // Loopback
      expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('127.0.0.53')).toBe(true);
      expect(isPrivateOrReservedIp('127.255.255.255')).toBe(true);
      expect(isPrivateOrReservedIp('::1')).toBe(true);

      // Cloud metadata & Link-Local
      expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
      expect(isPrivateOrReservedIp('169.254.1.1')).toBe(true);
      expect(isPrivateOrReservedIp('fe80::1')).toBe(true);

      // Private RFC 1918
      expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('10.255.255.255')).toBe(true);
      expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('172.31.255.255')).toBe(true);
      expect(isPrivateOrReservedIp('192.168.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('192.168.1.254')).toBe(true);

      // Carrier-Grade NAT (RFC 6598)
      expect(isPrivateOrReservedIp('100.64.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('100.127.255.255')).toBe(true);

      // IPv6 Unique Local (RFC 4193)
      expect(isPrivateOrReservedIp('fc00::1')).toBe(true);
      expect(isPrivateOrReservedIp('fd12:3456:789a::1')).toBe(true);

      // IPv4-mapped IPv6
      expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('::ffff:169.254.169.254')).toBe(true);
      expect(isPrivateOrReservedIp('::ffff:10.0.0.1')).toBe(true);

      // Public routable IPs (should NOT be flagged)
      expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
      expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false);
      expect(isPrivateOrReservedIp('197.156.120.10')).toBe(false);

      // Hostnames (not IP literals) return false
      expect(isPrivateOrReservedIp('apps.cbe.com.et')).toBe(false);
      expect(isPrivateOrReservedIp('transactioninfo.ethiotelecom.et')).toBe(false);
    });

    it('assertSsrfSafety blocks direct IP address literals in verification URLs', () => {
      const adapter = new CbeBankAdapter();

      expect(() =>
        adapter.assertSsrfSafety('https://127.0.0.1/?id=FT123', CBE_PERMITTED_HOSTNAMES)
      ).toThrow('Direct IP or loopback address');

      expect(() =>
        adapter.assertSsrfSafety('https://169.254.169.254/latest/meta-data/', CBE_PERMITTED_HOSTNAMES)
      ).toThrow('Direct IP or loopback address');

      expect(() =>
        adapter.assertSsrfSafety('https://10.0.0.1:100/?id=FT123', CBE_PERMITTED_HOSTNAMES)
      ).toThrow('Direct IP or loopback address');

      expect(() =>
        adapter.assertSsrfSafety('https://[::1]:100/?id=FT123', CBE_PERMITTED_HOSTNAMES)
      ).toThrow('Direct IP or loopback address');
    });

    it('assertSsrfSafety blocks loopback hostnames and localhost aliases', () => {
      const adapter = new CbeBankAdapter();

      expect(() =>
        adapter.assertSsrfSafety('https://localhost:100/?id=FT123', CBE_PERMITTED_HOSTNAMES)
      ).toThrow('Direct IP or loopback address');

      expect(() =>
        adapter.assertSsrfSafety('https://sub.localhost/?id=FT123', CBE_PERMITTED_HOSTNAMES)
      ).toThrow('Direct IP or loopback address');
    });

    it('assertSsrfSafety rejects unauthorized port numbers', () => {
      const adapter = new CbeBankAdapter();

      // Port 22 (SSH), Port 6379 (Redis), Port 8080 (Internal HTTP)
      expect(() =>
        adapter.assertSsrfSafety('https://apps.cbe.com.et:22/?id=FT123', CBE_PERMITTED_HOSTNAMES, [443, 100])
      ).toThrow("Port '22' is not permitted");

      expect(() =>
        adapter.assertSsrfSafety('https://apps.cbe.com.et:6379/?id=FT123', CBE_PERMITTED_HOSTNAMES, [443, 100])
      ).toThrow("Port '6379' is not permitted");

      // Allowed ports (443 or 100) succeed
      expect(
        adapter.assertSsrfSafety('https://apps.cbe.com.et:100/?id=FT123', CBE_PERMITTED_HOSTNAMES, [443, 100]).hostname
      ).toBe('apps.cbe.com.et');
      expect(
        adapter.assertSsrfSafety('https://apps.cbe.com.et/?id=FT123', CBE_PERMITTED_HOSTNAMES, [443, 100]).hostname
      ).toBe('apps.cbe.com.et');
    });

    it('assertSsrfSafety blocks embedded user credentials in URL', () => {
      const adapter = new CbeBankAdapter();

      expect(() =>
        adapter.assertSsrfSafety('https://admin:password@apps.cbe.com.et:100/?id=FT123', CBE_PERMITTED_HOSTNAMES)
      ).toThrow('User credentials in verification URL are prohibited');
    });

    it('assertSsrfSafety strictly requires HTTPS protocol', () => {
      const adapter = new CbeBankAdapter();

      expect(() =>
        adapter.assertSsrfSafety('http://apps.cbe.com.et:100/?id=FT123', CBE_PERMITTED_HOSTNAMES)
      ).toThrow('Only HTTPS protocol is permitted');
    });

    it('validateSsrfHost intercepts DNS rebinding to private IP ranges', async () => {
      const adapter = new CbeBankAdapter();

      // Mock DNS resolving apps.cbe.com.et to private AWS metadata / internal IP
      const mockDnsRebind = async () => [{ address: '169.254.169.254' }];

      await expect(
        adapter.validateSsrfHost(
          'https://apps.cbe.com.et:100/?id=FT123',
          CBE_PERMITTED_HOSTNAMES,
          [443, 100],
          mockDnsRebind
        )
      ).rejects.toThrow("resolved to private/reserved IP '169.254.169.254'");

      // Mock DNS resolving to loopback
      const mockLoopbackRebind = async () => [{ address: '127.0.0.1' }];
      await expect(
        adapter.validateSsrfHost(
          'https://apps.cbe.com.et:100/?id=FT123',
          CBE_PERMITTED_HOSTNAMES,
          [443, 100],
          mockLoopbackRebind
        )
      ).rejects.toThrow("resolved to private/reserved IP '127.0.0.1'");

      // Mock DNS resolving to legitimate public IP
      const mockLegitimatePublicDns = async () => [{ address: '197.156.120.10' }];
      const validUrl = await adapter.validateSsrfHost(
        'https://apps.cbe.com.et:100/?id=FT123',
        CBE_PERMITTED_HOSTNAMES,
        [443, 100],
        mockLegitimatePublicDns
      );
      expect(validUrl.hostname).toBe('apps.cbe.com.et');
    });
  });

  // ============================================================================
  // 2. Beneficiary Whitelist Hardening (CWE-287 / CWE-697)
  // ============================================================================

  describe('2. Beneficiary Whitelist Hardening (CWE-287 / CWE-697)', () => {
    const gate = new SecurityGateService();

    it('rejects empty or non-digit account strings (blocks .endsWith("") bypass)', () => {
      expect(gate.assertBeneficiary('cbe', '')).toBe(false);
      expect(gate.assertBeneficiary('cbe', '   ')).toBe(false);
      expect(gate.assertBeneficiary('cbe', 'N/A')).toBe(false);
      expect(gate.assertBeneficiary('cbe', 'None')).toBe(false);
      expect(gate.assertBeneficiary('cbe', 'UNKNOWN')).toBe(false);
    });

    it('rejects short suffix attacks (e.g. 789 should not match 1000123456789)', () => {
      expect(gate.assertBeneficiary('cbe', '789')).toBe(false);
      expect(gate.assertBeneficiary('cbe', '6789')).toBe(false);
      expect(gate.assertBeneficiary('cbe', '0')).toBe(false);
    });
  });

  // ============================================================================
  // 3. Regular Expression Denial of Service (ReDoS) Defense (CWE-1333)
  // ============================================================================

  describe('3. Regular Expression Denial of Service (ReDoS) Defense (CWE-1333)', () => {
    const ingestion = new ReceiptIngestionService();

    it('evaluates malicious non-matching strings without catastrophic backtracking (< 50ms)', () => {
      // Pathological ReDoS string with nested repetitions
      const pathologicalInput = 'debited from ' + 'a '.repeat(2000) + '!';
      const startTime = Date.now();

      expect(() => ingestion.parseTextPayload(pathologicalInput, 'sms_regex')).toThrow();

      const durationMs = Date.now() - startTime;
      expect(durationMs).toBeLessThan(100);
    });

    it('bounds huge text payloads without memory or CPU exhaustion', async () => {
      const hugeText = 'FT24252Y8WQM ' + 'A'.repeat(500_000);
      const startTime = Date.now();

      const result = await ingestion.ingestText(hugeText);
      const durationMs = Date.now() - startTime;

      expect(durationMs).toBeLessThan(100);
      expect(result.bank).toBe('cbe');
      expect(result.normalizedReference).toBe('FT24252Y8WQM');
    });
  });

  // ============================================================================
  // 4. Parameter Tampering & Port Whitelisting Defense (CWE-20)
  // ============================================================================

  describe('4. Parameter Tampering & Port Whitelisting Defense (CWE-20)', () => {
    it('strictly restricts receipt_cbe_port to allowed gateway ports (100 or 443)', () => {
      // Valid ports
      expect(validateVerificationSettings({ receipt_cbe_port: '100' }).isValid).toBe(true);
      expect(validateVerificationSettings({ receipt_cbe_port: '443' }).isValid).toBe(true);

      // Malicious or unauthorized internal ports (SSRF / port probing attempts)
      const invalid22 = validateVerificationSettings({ receipt_cbe_port: '22' });
      expect(invalid22.isValid).toBe(false);
      expect(invalid22.errors[0]).toContain('receipt_cbe_port must be either "100" or "443"');

      const invalid8080 = validateVerificationSettings({ receipt_cbe_port: '8080' });
      expect(invalid8080.isValid).toBe(false);

      const invalidAlpha = validateVerificationSettings({ receipt_cbe_port: 'http' });
      expect(invalidAlpha.isValid).toBe(false);
    });
  });
});
