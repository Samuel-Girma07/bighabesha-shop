import { describe, it, expect, vi } from 'vitest';
import { GramixAdapter } from '../src/services/reseller/gramix.js';
import { IStarAdapter } from '../src/services/reseller/istar.js';
import { CascadeResellerAdapter } from '../src/services/reseller/cascade.js';
import {
  InsufficientFloatError,
  InvalidTargetUserError,
  ProviderUnavailableError,
} from '../src/services/reseller/types.js';
import { HttpError } from '../src/lib/http.js';
import { getConfig } from '../src/config/env.js';

describe('Reseller Provider Hardening (Gramix, iStar, Cascade)', () => {
  const mockConfig = {
    ...getConfig(),
    GRAMIX_API_KEY: 'test_gramix_key',
    ISTAR_API_KEY: 'test_istar_key',
  };

  describe('GramixAdapter error classification', () => {
    it('maps HTTP 401 to ProviderUnavailableError with clear API key diagnostic', async () => {
      const adapter = new GramixAdapter(mockConfig);
      vi.spyOn(adapter as any, 'postJson').mockRejectedValueOnce(
        new HttpError('Upstream 401', 401, '{"statusCode":401,"message":"Unauthorized"}')
      );

      await expect(
        adapter.fulfill({
          orderId: 'ord_test_001',
          targetUsername: 'legit_user',
          months: 3,
        })
      ).rejects.toThrow(ProviderUnavailableError);

      try {
        vi.spyOn(adapter as any, 'postJson').mockRejectedValueOnce(
          new HttpError('Upstream 401', 401, '{"statusCode":401,"message":"Unauthorized"}')
        );
        await adapter.fulfill({
          orderId: 'ord_test_001',
          targetUsername: 'legit_user',
          months: 3,
        });
      } catch (err: any) {
        expect(err.message).toContain('Gramix API key unauthorized or invalid (HTTP 401)');
      }
    });

    it('maps HTTP 403 / insufficient balance to InsufficientFloatError', async () => {
      const adapter = new GramixAdapter(mockConfig);
      vi.spyOn(adapter as any, 'postJson').mockRejectedValueOnce(
        new HttpError('Upstream 403', 403, '{"statusCode":403,"message":"Insufficient balance"}')
      );

      await expect(
        adapter.fulfill({
          orderId: 'ord_test_002',
          targetUsername: 'legit_user',
          months: 3,
        })
      ).rejects.toThrow(InsufficientFloatError);
    });

    it('maps HTTP 400 with invalid username to InvalidTargetUserError', async () => {
      const adapter = new GramixAdapter(mockConfig);
      vi.spyOn(adapter as any, 'postJson').mockRejectedValueOnce(
        new HttpError('Upstream 400', 400, '{"statusCode":400,"message":"Invalid username"}')
      );

      await expect(
        adapter.fulfill({
          orderId: 'ord_test_003',
          targetUsername: 'bad_user',
          months: 3,
        })
      ).rejects.toThrow(InvalidTargetUserError);
    });

    it('getBalance throws ProviderUnavailableError on HTTP 401', async () => {
      const adapter = new GramixAdapter(mockConfig);
      vi.spyOn(adapter as any, 'getJson').mockRejectedValueOnce(
        new HttpError('Upstream 401', 401, 'Unauthorized')
      );

      await expect(adapter.getBalance()).rejects.toThrow(ProviderUnavailableError);
    });
  });

  describe('iStarAdapter error classification', () => {
    it('NEVER maps HTTP 404 to InvalidTargetUserError (must be ProviderUnavailableError)', async () => {
      const adapter = new IStarAdapter(mockConfig);
      vi.spyOn(adapter as any, 'postJson').mockRejectedValueOnce(
        new HttpError('Upstream 404', 404, '')
      );

      await expect(
        adapter.fulfill({
          orderId: 'ord_test_004',
          targetUsername: 'vweah',
          months: 3,
        })
      ).rejects.toThrow(ProviderUnavailableError);

      try {
        vi.spyOn(adapter as any, 'postJson').mockRejectedValueOnce(
          new HttpError('Upstream 404', 404, '')
        );
        await adapter.fulfill({
          orderId: 'ord_test_004',
          targetUsername: 'vweah',
          months: 3,
        });
      } catch (err: any) {
        expect(err).not.toBeInstanceOf(InvalidTargetUserError);
        expect(err).toBeInstanceOf(ProviderUnavailableError);
        expect(err.message).toContain('404');
      }
    });

    it('maps HTTP 400 with user error keyword to InvalidTargetUserError', async () => {
      const adapter = new IStarAdapter(mockConfig);
      vi.spyOn(adapter as any, 'postJson').mockRejectedValueOnce(
        new HttpError('Upstream 400', 400, '{"error":"Target user not found"}')
      );

      await expect(
        adapter.fulfill({
          orderId: 'ord_test_005',
          targetUsername: 'non_existent_user',
          months: 3,
        })
      ).rejects.toThrow(InvalidTargetUserError);
    });
  });

  describe('Cascade error combination preserves InsufficientFloatError', () => {
    it('preserves InsufficientFloatError when primary has 0 balance and secondary has 404 route error', async () => {
      const primary = new GramixAdapter(mockConfig);
      const secondary = new IStarAdapter(mockConfig);

      // Primary fails with InsufficientFloatError (0 balance)
      vi.spyOn(primary, 'fulfill').mockRejectedValueOnce(new InsufficientFloatError('gramix'));

      // Secondary fails with ProviderUnavailableError (404 route missing)
      vi.spyOn(secondary, 'fulfill').mockRejectedValueOnce(
        new ProviderUnavailableError('istar', 'iStar route not found (HTTP 404)')
      );

      const cascade = new CascadeResellerAdapter(mockConfig, primary, secondary);

      await expect(
        cascade.fulfill({
          orderId: 'ord_test_006',
          targetUsername: 'vweah',
          months: 3,
        })
      ).rejects.toThrow(InsufficientFloatError);
    });
  });
});
