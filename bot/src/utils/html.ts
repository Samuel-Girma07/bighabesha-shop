import { getSetting } from '../services/settings.service.js';

export function escapeHtml(str: string | number | null | undefined): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatFulfillmentDeliveryMessage(
  orderId: string,
  payload: string,
  instructionsTemplate?: string
): string {
  const template = instructionsTemplate || getSetting(
    'gemini_instructions',
    '1. Ensure your VPN is connected before opening the link.\n2. Click the link to complete activation on your Google account.\n3. Once activated, you may safely disconnect the VPN.'
  );
  return `<b>Payment Confirmed — Order #${escapeHtml(orderId)}</b>\n\n` +
    `Activation Link:\n<code>${escapeHtml(payload)}</code>\n\n` +
    `<b>Instructions:</b>\n${escapeHtml(template)}\n\n` +
    `<i>Thank you for choosing Bighabesha Shop.</i>`;
}

export interface SplitCaptionResult {
  caption: string;
  overflow: string | null;
}

/**
 * Ensures cut position does not bisect an escaped HTML entity (e.g. &amp;, &lt;, &gt;, &#123;).
 */
function adjustCutAwayFromEntity(text: string, cut: number): number {
  const offset = Math.max(0, cut - 10);
  const entityMatch = text.slice(offset, Math.min(text.length, cut + 10));
  const entityRegex = /&[a-zA-Z0-9#]+;/g;
  let em: RegExpExecArray | null;
  while ((em = entityRegex.exec(entityMatch)) !== null) {
    const entStart = offset + em.index;
    const entEnd = entStart + em[0].length;
    if (cut > entStart && cut < entEnd) {
      return entStart;
    }
  }
  return cut;
}

/**
 * Safely splits an HTML-formatted message for Telegram photo/document captions (max 1024 chars).
 * Ensures valid balanced HTML tags in both parts and total caption length <= maxLen.
 */
export function splitTelegramCaption(htmlText: string, maxLen: number = 1024): SplitCaptionResult {
  if (htmlText.length <= maxLen) {
    return { caption: htmlText, overflow: null };
  }

  const tagRegex = /<\/?([a-zA-Z0-9_-]+)(?:\s+[^>]*)?>/g;
  let rawCut = maxLen - 3;

  const tags: { start: number; end: number; isClosing: boolean; tagName: string; full: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(htmlText)) !== null) {
    tags.push({
      start: m.index,
      end: m.index + m[0].length,
      isClosing: m[0].startsWith('</'),
      tagName: m[1].toLowerCase(),
      full: m[0],
    });
  }

  for (const tag of tags) {
    if (rawCut > tag.start && rawCut < tag.end) {
      rawCut = tag.start;
      break;
    }
  }

  rawCut = adjustCutAwayFromEntity(htmlText, rawCut);

  const getOpenTags = (cut: number) => {
    const open: { tagName: string; openTagStr: string }[] = [];
    for (const tag of tags) {
      if (tag.end <= cut) {
        if (!tag.isClosing) {
          open.push({ tagName: tag.tagName, openTagStr: tag.full });
        } else {
          for (let i = open.length - 1; i >= 0; i--) {
            if (open[i].tagName === tag.tagName) {
              open.splice(i, 1);
              break;
            }
          }
        }
      }
    }
    return open;
  };

  let openTags = getOpenTags(rawCut);
  let closingTagsStr = openTags.map((t) => `</${t.tagName}>`).reverse().join('');
  let openingTagsStr = openTags.map((t) => t.openTagStr).join('');

  while (rawCut + 3 + closingTagsStr.length > maxLen && rawCut > 0) {
    rawCut--;
    for (const tag of tags) {
      if (rawCut > tag.start && rawCut < tag.end) {
        rawCut = tag.start;
        break;
      }
    }
    rawCut = adjustCutAwayFromEntity(htmlText, rawCut);
    openTags = getOpenTags(rawCut);
    closingTagsStr = openTags.map((t) => `</${t.tagName}>`).reverse().join('');
    openingTagsStr = openTags.map((t) => t.openTagStr).join('');
  }

  const caption = htmlText.slice(0, rawCut) + '...' + closingTagsStr;
  const overflow = openingTagsStr + '...' + htmlText.slice(rawCut);

  return { caption, overflow };
}
