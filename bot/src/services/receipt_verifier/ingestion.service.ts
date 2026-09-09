import sharp, { Sharp } from 'sharp';
import zxing from '@zxing/library';
import { logger } from '../../logger/index.js';
import {
  MAX_RECEIPT_BUFFER_SIZE_BYTES,
  DEFAULT_MAX_IMAGE_PIXELS,
} from './constants.js';
import {
  IReceiptIngestionService,
  ReceiptMimeType,
  IngestionOptions,
  ExtractedReceiptReference,
  QrTestResult,
  DecodeMethod,
  ReceiptVerificationError,
  QrDecodeFailedError,
  UnsupportedBankError,
} from './types.js';

// ============================================================================
// ZXing Type Resolution & Instantiation
// ============================================================================

interface ZXingModule {
  QRCodeReader: new () => {
    decode: (bitmap: unknown, hints?: Map<unknown, unknown>) => { getText: () => string };
  };
  BinaryBitmap: new (binarizer: unknown) => unknown;
  HybridBinarizer: new (source: unknown) => unknown;
  RGBLuminanceSource: new (luminances: Uint8ClampedArray, width: number, height: number) => unknown;
  DecodeHintType: {
    PURE_BARCODE: unknown;
  };
}

const zxingResolved: ZXingModule = (zxing as unknown as { default?: ZXingModule }).default || (zxing as unknown as ZXingModule);
const {
  QRCodeReader,
  BinaryBitmap,
  HybridBinarizer,
  RGBLuminanceSource,
  DecodeHintType,
} = zxingResolved;

// ============================================================================
// Statically Instantiated Regular Expressions
// ============================================================================

const CBE_URL_PATTERN = /https?:\/\/apps\.cbe\.com\.et(?::100)?\/(?:[^\s"'?#]*[?&]id=|(?:[^\s"'?#]*\/)?(?:customer\/receipt|receipt)\/)([A-Za-z0-9_\-]+)/i;
const CBE_FT_PATTERN = /\b(FT[0-9A-Z_\-]{6,24})\b/i;

const TELEBIRR_URL_PATTERN = /https?:\/\/(?:transactioninfo\.ethiotelecom\.et|telebirr\.et)\/(?:(?:[^\s"'?#]*\/)?receipt\/|[^\s"'?#]*[?&]id=)([A-Za-z0-9_\-]+)/i;
const TELEBIRR_GENERIC_URL_PATTERN = /https?:\/\/(?:transactioninfo\.ethiotelecom\.et|telebirr\.et)\/[^\s"']+/i;
const TELEBIRR_LABELED_REF_PATTERN = /(?:transaction\s*(?:number|id|no)|txn\s*id|ref(?:erence)?\.?)(?:\s*[:=]\s*|\s+)([A-Za-z0-9_\-]{6,20})/i;
const TELEBIRR_FALLBACK_REF_PATTERN = /(?!\b0[79]\d{8}\b)\b([A-Za-z0-9_\-]{8,16})\b/i;
const TELEBIRR_KEYWORD_PATTERN = /telebirr/i;

const ABYSSINIA_KEYWORD_PATTERN = /abyssinia|boa/i;
const ABYSSINIA_REF_PATTERN = /\b([A-Z0-9_\-]{8,16})\b/i;

const STANDALONE_FT_PATTERN = /^FT[0-9A-Z_\-]{6,24}$/i;
const STANDALONE_ALPHA_PATTERN = /^[0-9A-Z_\-]{8,20}$/i;

const AMOUNT_PATTERNS = Object.freeze([
  /(?:ETB|Birr)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
  /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:ETB|Birr)/i,
  /(?:Amount|Paid|Transferred)(?:\s*[:=]\s*|\s+)([0-9,]+(?:\.[0-9]{1,2})?)/i,
]);

const MAX_PAYLOAD_PARSE_LENGTH = 10_000;

const EMBEDDED_URLS_PATTERN = /https?:\/\/[^\s<>"{}|\\^`\\]+/gi;

interface ImagePass {
  name: string;
  transform: (img: Sharp) => Sharp;
}

/**
 * Service responsible for ingesting files/text, image preprocessing,
 * QR matrix decoding via ZXing, and PDF vector stream extraction.
 */
export class ReceiptIngestionService implements IReceiptIngestionService {
  /**
   * Ingests a raw file buffer (image or PDF) and extracts bank reference data.
   */
  public async ingestBuffer(
    buffer: Buffer,
    mimeType: ReceiptMimeType,
    options?: IngestionOptions
  ): Promise<ExtractedReceiptReference> {
    if (!buffer || buffer.length === 0) {
      throw new ReceiptVerificationError(
        'CORRUPTED_FILE',
        400,
        'Empty File Uploaded',
        'Empty File Uploaded: The uploaded file buffer is empty.',
        'Please upload a valid receipt image or PDF file.'
      );
    }

    if (buffer.length > MAX_RECEIPT_BUFFER_SIZE_BYTES) {
      throw new ReceiptVerificationError(
        'CORRUPTED_FILE',
        400,
        'File Exceeds Size Limit',
        `File size (${(buffer.length / 1024 / 1024).toFixed(1)} MB) exceeds 10 MB limit.`,
        'Please upload an image or PDF smaller than 10 MB.'
      );
    }

    this.validateMagicBytes(buffer, mimeType);

    if (mimeType === 'application/pdf') {
      return this.ingestPdfBuffer(buffer, options);
    }

    return this.ingestImageBuffer(buffer, options);
  }

  /**
   * Ingests raw SMS or text message and parses bank transaction references via regex.
   */
  public async ingestText(rawText: string): Promise<ExtractedReceiptReference> {
    const text = rawText?.trim();
    if (!text) {
      throw new ReceiptVerificationError(
        'CORRUPTED_FILE',
        400,
        'Empty Text Provided',
        'No transaction reference or text content was provided.',
        'Please send the transaction reference code or full SMS message.'
      );
    }

    return this.parseTextPayload(text, 'sms_regex');
  }

  /**
   * Dedicated testing harness for QR decoding on uploaded images.
   */
  public async testQrMatrix(imageBuffer: Buffer): Promise<QrTestResult> {
    const startTime = Date.now();
    let passesAttempted = 0;

    try {
      if (!imageBuffer || imageBuffer.length === 0) {
        return {
          success: false,
          decodeDurationMs: Date.now() - startTime,
          passesAttempted: 0,
          error: 'Buffer is empty',
        };
      }

      const decoded = await this.decodeQrWithMultiPass(imageBuffer, {
        enableContrastEnhancement: true,
        multiPassThresholding: true,
      });

      passesAttempted = decoded.passesAttempted;
      const extractedReference = this.parseTextPayload(decoded.text, 'qr_matrix');

      return {
        success: true,
        rawText: decoded.text,
        extractedReference,
        decodeDurationMs: Date.now() - startTime,
        passesAttempted,
      };
    } catch (err: unknown) {
      return {
        success: false,
        decodeDurationMs: Date.now() - startTime,
        passesAttempted: passesAttempted || 1,
        error: err instanceof Error ? err.message : 'QR matrix decoding failed',
      };
    }
  }

  // ============================================================================
  // Image & QR Processing Pipeline
  // ============================================================================

  private async ingestImageBuffer(
    buffer: Buffer,
    options?: IngestionOptions
  ): Promise<ExtractedReceiptReference> {
    const decoded = await this.decodeQrWithMultiPass(buffer, options);
    return this.parseTextPayload(decoded.text, 'qr_matrix');
  }

  private async decodeQrWithMultiPass(
    buffer: Buffer,
    options?: IngestionOptions
  ): Promise<{ text: string; passesAttempted: number }> {
    const maxPixels = options?.maxPixels || DEFAULT_MAX_IMAGE_PIXELS;
    const multiPass = options?.multiPassThresholding !== false;
    const enableContrast = options?.enableContrastEnhancement !== false;

    const passes: ImagePass[] = [
      {
        name: 'standard_grayscale',
        transform: (img) => img.rotate().grayscale(),
      },
    ];

    if (enableContrast) {
      passes.push({
        name: 'contrast_normalized',
        transform: (img) => img.rotate().grayscale().normalize(),
      });
    }

    if (multiPass) {
      passes.push({
        name: 'sharpened_contrast',
        transform: (img) => img.rotate().grayscale().sharpen().linear(1.3, -20),
      });

      passes.push({
        name: 'threshold_binarized',
        transform: (img) => img.rotate().grayscale().threshold(128),
      });
    }

    let passesAttempted = 0;
    const reader = new QRCodeReader();

    for (const pass of passes) {
      passesAttempted++;
      try {
        const baseImg = sharp(buffer, { limitInputPixels: maxPixels });
        const { data, info } = await pass
          .transform(baseImg)
          .raw()
          .toBuffer({ resolveWithObject: true });

        const clamped = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
        const lumSource = new RGBLuminanceSource(clamped, info.width, info.height);
        const binarizer = new HybridBinarizer(lumSource);
        const bitmap = new BinaryBitmap(binarizer);

        let result: { getText?: () => string } | undefined;
        try {
          result = reader.decode(bitmap);
        } catch {
          const hints = new Map<unknown, unknown>();
          hints.set(DecodeHintType.PURE_BARCODE, true);
          result = reader.decode(bitmap, hints);
        }

        const text = result?.getText ? result.getText() : '';

        if (text && text.trim().length > 0) {
          logger.debug({ passName: pass.name, passesAttempted, textLength: text.length }, 'QR matrix decoded successfully');
          return { text: text.trim(), passesAttempted };
        }
      } catch (err: unknown) {
        // ZXing throws NotFoundException when no QR is recognized on this pass; continue to next pass
        logger.debug(
          { passName: pass.name, err: err instanceof Error ? err.message : String(err) },
          'Pass failed to decode QR matrix'
        );
      }
    }

    throw new QrDecodeFailedError(
      `Image matrix does not contain a recognizable 2D QR code after ${passesAttempted} contrast threshold passes.`
    );
  }

  // ============================================================================
  // PDF Parsing Pipeline
  // ============================================================================

  private async ingestPdfBuffer(
    buffer: Buffer,
    _options?: IngestionOptions
  ): Promise<ExtractedReceiptReference> {
    let text = '';
    const links: string[] = [];

    try {
      const pdfModule = await import('pdf-parse');
      const PDFParse = (pdfModule as Record<string, unknown>).PDFParse ||
        (pdfModule as Record<string, unknown>).default ||
        pdfModule;

      if (typeof PDFParse === 'function') {
        try {
          const parser = new (PDFParse as any)({ data: buffer });
          if (typeof parser.load === 'function') {
            await parser.load();
            const res = await parser.getText();
            text = typeof res === 'string' ? res : (res?.text || '');
            const pageLinks = await parser.getPageLinks?.();
            if (Array.isArray(pageLinks)) {
              for (const pl of pageLinks) {
                if (typeof pl === 'string') links.push(pl);
                else if (pl?.url) links.push(pl.url);
              }
            }
          } else {
            const res = await (PDFParse as Function)(buffer);
            text = res?.text || '';
          }
        } catch {
          const res = await (PDFParse as Function)(buffer);
          text = res?.text || '';
        }
      }
    } catch (err: unknown) {
      logger.warn({ err }, 'Failed to parse PDF via pdf-parse; using raw buffer inspection');
    }

    // Inspect raw PDF byte stream for embedded URLs and FT references
    const rawString = buffer.toString('latin1');
    const embeddedUrls = rawString.match(EMBEDDED_URLS_PATTERN) || [];
    for (const u of embeddedUrls) {
      if (!links.includes(u)) links.push(u);
    }

    const combined = [text, ...links].filter(Boolean).join('\n');

    if (combined.trim().length === 0) {
      throw new QrDecodeFailedError('Could not extract text or links from the uploaded PDF receipt.');
    }

    return this.parseTextPayload(combined, 'pdf_stream');
  }

  // ============================================================================
  // Structured Reference Extraction (SRP Decomposition)
  // ============================================================================

  public parseTextPayload(text: string, decodeMethod: DecodeMethod): ExtractedReceiptReference {
    const boundedText = text.length > MAX_PAYLOAD_PARSE_LENGTH ? text.slice(0, MAX_PAYLOAD_PARSE_LENGTH) : text;
    const rawSnippet = boundedText.slice(0, 500);

    const cbeRef = this.tryParseCbe(boundedText, rawSnippet, decodeMethod);
    if (cbeRef) return cbeRef;

    const telebirrRef = this.tryParseTelebirr(boundedText, rawSnippet, decodeMethod);
    if (telebirrRef) return telebirrRef;

    const abyssiniaRef = this.tryParseAbyssinia(boundedText, rawSnippet, decodeMethod);
    if (abyssiniaRef) return abyssiniaRef;

    const standaloneRef = this.tryParseStandaloneCode(boundedText, rawSnippet, decodeMethod);
    if (standaloneRef) return standaloneRef;

    throw new UnsupportedBankError(boundedText.slice(0, 40));
  }

  private tryParseCbe(
    text: string,
    rawSnippet: string,
    decodeMethod: DecodeMethod
  ): ExtractedReceiptReference | null {
    const cbeUrlMatch = text.match(CBE_URL_PATTERN);
    const cbeFtMatch = text.match(CBE_FT_PATTERN);

    if (!cbeUrlMatch && !cbeFtMatch) {
      return null;
    }

    const fullUrl = cbeUrlMatch ? cbeUrlMatch[0] : undefined;
    const rawRef = cbeUrlMatch ? cbeUrlMatch[1] : cbeFtMatch![1];
    const normalized = rawRef.trim().toUpperCase();
    const amount = this.extractAmount(text);

    return {
      bank: 'cbe',
      rawReference: rawRef,
      normalizedReference: normalized,
      sourceUrl: fullUrl,
      amountEtb: amount,
      extractedAt: new Date(),
      confidence: cbeUrlMatch ? 0.99 : 0.95,
      decodeMethod,
      rawPayloadSnippet: rawSnippet,
    };
  }

  private tryParseTelebirr(
    text: string,
    rawSnippet: string,
    decodeMethod: DecodeMethod
  ): ExtractedReceiptReference | null {
    const telebirrUrlMatch = text.match(TELEBIRR_URL_PATTERN);
    const telebirrGeneralUrl = text.match(TELEBIRR_GENERIC_URL_PATTERN);
    const labeledTelebirrRef = text.match(TELEBIRR_LABELED_REF_PATTERN);
    const fallbackTelebirrRef = text.match(TELEBIRR_FALLBACK_REF_PATTERN);
    const telebirrRefMatch = labeledTelebirrRef || fallbackTelebirrRef;
    const telebirrKeywordMatch = TELEBIRR_KEYWORD_PATTERN.test(text);

    if (!telebirrUrlMatch && !(telebirrKeywordMatch && telebirrRefMatch)) {
      return null;
    }

    const fullUrl = telebirrUrlMatch ? telebirrUrlMatch[0] : (telebirrGeneralUrl ? telebirrGeneralUrl[0] : undefined);
    const rawRef = telebirrUrlMatch ? telebirrUrlMatch[1] : telebirrRefMatch![1];
    const normalized = rawRef.trim().toUpperCase();
    const amount = this.extractAmount(text);

    return {
      bank: 'telebirr',
      rawReference: rawRef,
      normalizedReference: normalized,
      sourceUrl: fullUrl,
      amountEtb: amount,
      extractedAt: new Date(),
      confidence: telebirrUrlMatch ? 0.98 : 0.85,
      decodeMethod,
      rawPayloadSnippet: rawSnippet,
    };
  }

  private tryParseAbyssinia(
    text: string,
    rawSnippet: string,
    decodeMethod: DecodeMethod
  ): ExtractedReceiptReference | null {
    if (!ABYSSINIA_KEYWORD_PATTERN.test(text)) {
      return null;
    }

    const boaRef = text.match(ABYSSINIA_REF_PATTERN);
    const rawRef = boaRef ? boaRef[1] : text.trim().slice(0, 20);

    return {
      bank: 'abyssinia',
      rawReference: rawRef,
      normalizedReference: rawRef.trim().toUpperCase(),
      amountEtb: this.extractAmount(text),
      extractedAt: new Date(),
      confidence: 0.7,
      decodeMethod,
      rawPayloadSnippet: rawSnippet,
    };
  }

  private tryParseStandaloneCode(
    text: string,
    rawSnippet: string,
    decodeMethod: DecodeMethod
  ): ExtractedReceiptReference | null {
    const trimmed = text.trim();

    const standaloneFt = trimmed.match(STANDALONE_FT_PATTERN);
    if (standaloneFt) {
      return {
        bank: 'cbe',
        rawReference: standaloneFt[0],
        normalizedReference: standaloneFt[0].trim().toUpperCase(),
        extractedAt: new Date(),
        confidence: 0.9,
        decodeMethod: 'manual_code',
        rawPayloadSnippet: rawSnippet,
      };
    }

    const standaloneAlpha = trimmed.match(STANDALONE_ALPHA_PATTERN);
    if (standaloneAlpha) {
      return {
        bank: 'telebirr',
        rawReference: standaloneAlpha[0],
        normalizedReference: standaloneAlpha[0].trim().toUpperCase(),
        extractedAt: new Date(),
        confidence: 0.8,
        decodeMethod: 'manual_code',
        rawPayloadSnippet: rawSnippet,
      };
    }

    return null;
  }

  private extractAmount(text: string): number | undefined {
    for (const pattern of AMOUNT_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const numStr = match[1].replace(/,/g, '');
        const val = parseFloat(numStr);
        if (!isNaN(val) && val > 0) {
          return val;
        }
      }
    }
    return undefined;
  }

  // ============================================================================
  // Magic Bytes Validation
  // ============================================================================

  private validateMagicBytes(buffer: Buffer, mimeType: ReceiptMimeType): void {
    if (mimeType === 'application/pdf') {
      const header = buffer.subarray(0, 5).toString('ascii');
      if (!header.startsWith('%PDF-')) {
        throw new ReceiptVerificationError(
          'CORRUPTED_FILE',
          400,
          'Corrupted PDF Header',
          'Corrupted PDF: The uploaded file is not a valid PDF document (missing %PDF header).',
          'Please ensure the file is an uncorrupted PDF.'
        );
      }
      return;
    }

    if (mimeType === 'image/jpeg') {
      if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
        throw new ReceiptVerificationError(
          'CORRUPTED_FILE',
          400,
          'Corrupted JPEG Image',
          'Corrupted JPEG: The uploaded image does not match valid JPEG magic bytes.',
          'Please upload a valid JPEG or PNG screenshot.'
        );
      }
      return;
    }

    if (mimeType === 'image/png') {
      if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) {
        throw new ReceiptVerificationError(
          'CORRUPTED_FILE',
          400,
          'Corrupted PNG Image',
          'Corrupted PNG: The uploaded image does not match valid PNG magic bytes.',
          'Please upload a valid JPEG or PNG screenshot.'
        );
      }
      return;
    }

    if (mimeType === 'image/webp') {
      const riff = buffer.subarray(0, 4).toString('ascii');
      const webp = buffer.subarray(8, 12).toString('ascii');
      if (riff !== 'RIFF' || webp !== 'WEBP') {
        throw new ReceiptVerificationError(
          'CORRUPTED_FILE',
          400,
          'Corrupted WebP Image',
          'The uploaded image does not match valid WebP magic bytes.',
          'Please upload a valid JPEG or PNG screenshot.'
        );
      }
      return;
    }
  }
}
