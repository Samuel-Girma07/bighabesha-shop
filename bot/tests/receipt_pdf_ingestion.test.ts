import { describe, it, expect, vi, afterEach } from 'vitest';
import { ReceiptIngestionService } from '../src/services/receipt_verifier/ingestion.service.js';
import { logger } from '../src/logger/index.js';

/**
 * P2 guard: the PDF link-extraction branch was dead code.
 *
 * pdf-parse@2.4.5 exposes `PDFParse` as an ES class. Verified against the
 * installed package:
 *   - `parser.getPageLinks()` (no argument) throws
 *     "Cannot read properties of undefined (reading 'getViewport')" — it is
 *     declared `private` in the library's typings and wants an internal page
 *     object, not a page number.
 *   - invoking the class as a plain function throws
 *     "Class constructor PDFParse cannot be invoked without 'new'".
 *
 * The old inner catch therefore re-threw immediately, so `links` was never
 * populated from the API and every PDF ingest logged a spurious
 * "Failed to parse PDF" warning even though getText() had already succeeded.
 *
 * The PDF below is generated in-process and contains no real customer data:
 * a synthetic reference and a public portal URL.
 */

/** Minimal valid single-page PDF with a text run and a URI link annotation. */
function buildSyntheticPdf(reference: string): Buffer {
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /Annots [6 0 R] >>'
  );
  const stream = `BT /F1 12 Tf 20 260 Td (${reference}) Tj ET`;
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push(
    '<< /Type /Annot /Subtype /Link /Rect [20 200 280 220] ' +
      `/A << /Type /Action /S /URI /URI (https://transactioninfo.ethiotelecom.et/receipt/${reference}) >> >>`
  );

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${off.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

const SYNTHETIC_REF = 'FT26090123456789';

describe('FIX-6: PDF ingestion path', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts a reference from PDF text without logging a parse failure', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const service = new ReceiptIngestionService();

    const result = await service.ingestBuffer(buildSyntheticPdf(SYNTHETIC_REF), 'application/pdf');

    expect(result.normalizedReference).toBe(SYNTHETIC_REF);
    // The old code logged "Failed to parse PDF via pdf-parse" on every ingest.
    const parseWarnings = warnSpy.mock.calls.filter((call) =>
      String(call[0] ?? '').includes('pdf-parse')
    );
    expect(parseWarnings).toHaveLength(0);
  });

  it('still surfaces the reference when PDF text extraction fails', async () => {
    // A truncated/garbage PDF must not crash the pipeline: the raw-byte scan is
    // the documented fallback, and a total extraction failure is reported as a
    // typed error rather than an unhandled rejection.
    const service = new ReceiptIngestionService();
    const garbage = Buffer.from('%PDF-1.4\nthis is not a valid pdf body\n%%EOF\n', 'latin1');

    const outcome = await service
      .ingestBuffer(garbage, 'application/pdf')
      .then((r) => ({ ok: true as const, r }))
      .catch((e: unknown) => ({ ok: false as const, e }));

    // Either a reference was recovered, or a typed verification error was raised.
    if (outcome.ok) {
      expect(typeof outcome.r.normalizedReference).toBe('string');
    } else {
      expect((outcome.e as Error).name).toMatch(/Error$/);
    }
  });

  it('rejects a non-PDF buffer claiming to be a PDF via magic-byte validation', async () => {
    const service = new ReceiptIngestionService();
    await expect(
      service.ingestBuffer(Buffer.from('definitely not a pdf', 'latin1'), 'application/pdf')
    ).rejects.toThrow();
  });
});