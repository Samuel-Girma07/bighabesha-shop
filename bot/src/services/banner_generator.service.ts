import { Resvg } from '@resvg/resvg-js';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger/index.js';

const ASSETS_DIR = path.resolve(process.cwd(), 'assets/banners');

function ensureAssetsDir() {
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }
}

export function generateSvgBanner(type: 'welcome' | 'gemini' | 'premium' | 'stars' | 'checkout'): string {
  switch (type) {
    case 'welcome':
      return `
      <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0B111A"/>
            <stop offset="50%" stop-color="#121D2C"/>
            <stop offset="100%" stop-color="#080D14"/>
          </linearGradient>
          <linearGradient id="ethGlow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#078930"/>
            <stop offset="50%" stop-color="#FCDD09"/>
            <stop offset="100%" stop-color="#DA121A"/>
          </linearGradient>
          <radialGradient id="circleAura" cx="80%" cy="30%" r="60%">
            <stop offset="0%" stop-color="rgba(7, 137, 48, 0.25)"/>
            <stop offset="100%" stop-color="transparent"/>
          </radialGradient>
        </defs>

        <rect width="1200" height="630" fill="url(#bg)"/>
        <rect width="1200" height="630" fill="url(#circleAura)"/>
        <rect x="0" y="0" width="1200" height="6" fill="url(#ethGlow)"/>

        <!-- Ambient geometric grid -->
        <g stroke="rgba(255, 255, 255, 0.04)" stroke-width="1">
          <line x1="100" y1="0" x2="100" y2="630"/>
          <line x1="300" y1="0" x2="300" y2="630"/>
          <line x1="500" y1="0" x2="500" y2="630"/>
          <line x1="700" y1="0" x2="700" y2="630"/>
          <line x1="900" y1="0" x2="900" y2="630"/>
          <line x1="1100" y1="0" x2="1100" y2="630"/>
          <line x1="0" y1="150" x2="1200" y2="150"/>
          <line x1="0" y1="300" x2="1200" y2="300"/>
          <line x1="0" y1="450" x2="1200" y2="450"/>
        </g>

        <!-- Brand Emblem -->
        <g transform="translate(100, 100)">
          <rect width="80" height="80" rx="20" fill="#078930"/>
          <path d="M24 20H46C53 20 58 25 58 31.5C58 35.8 55.7 39.5 52.2 41.5C56.8 43.7 59.8 48.3 59.8 53.6C59.8 61.5 53.4 68 45.5 68H24V20Z" fill="#FCDD09"/>
          <path d="M32.5 27.5V40H44.5C48 40 50.8 37.2 50.8 33.7C50.8 30.2 48 27.5 44.5 27.5H32.5ZM32.5 48V60.5H45.2C48.9 60.5 51.8 57.6 51.8 53.9C51.8 50.2 48.9 48 45.2 48H32.5Z" fill="#078930"/>
        </g>

        <text x="204" y="142" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="800" fill="#FFFFFF" letter-spacing="1">BIGHABESHA SHOP</text>
        <text x="204" y="172" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="600" fill="#94A3B8" letter-spacing="0.5">OFFICIAL DIGITAL SUBSCRIPTION PLATFORM</text>

        <!-- Hero Headline -->
        <text x="100" y="270" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="48" font-weight="800" fill="#FFFFFF">Premium Subscriptions &amp; Digital Rails</text>
        <text x="100" y="320" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="500" fill="#94A3B8">Instant automated delivery, Fragment verified gifts, and direct Ethiopian local payments.</text>

        <!-- Product Cards Showcase -->
        <!-- Card 1: Gemini -->
        <g transform="translate(100, 380)">
          <rect width="300" height="150" rx="16" fill="#16202E" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
          <text x="24" y="44" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="800" fill="#FCDD09">Gemini Pro 18M</text>
          <text x="24" y="72" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="500" fill="#94A3B8">Google AI + 2TB Storage</text>
          <text x="24" y="118" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="800" fill="#FFFFFF">1,500 ETB</text>
        </g>

        <!-- Card 2: Premium -->
        <g transform="translate(440, 380)">
          <rect width="300" height="150" rx="16" fill="#16202E" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
          <text x="24" y="44" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="800" fill="#38BDF8">Telegram Premium</text>
          <text x="24" y="72" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="500" fill="#94A3B8">3, 6, or 12 Months Gift</text>
          <text x="24" y="118" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="800" fill="#FFFFFF">from 1,100 ETB</text>
        </g>

        <!-- Card 3: Stars -->
        <g transform="translate(780, 380)">
          <rect width="300" height="150" rx="16" fill="#16202E" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
          <text x="24" y="44" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="800" fill="#10B981">Telegram Stars</text>
          <text x="24" y="72" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="500" fill="#94A3B8">Packages &amp; Custom</text>
          <text x="24" y="118" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="800" fill="#FFFFFF">1 Star = 2.5 ETB</text>
        </g>
      </svg>`;

    case 'gemini':
      return `
      <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bgG" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0B111A"/>
            <stop offset="100%" stop-color="#141E2B"/>
          </linearGradient>
          <radialGradient id="sparkleAura" cx="75%" cy="35%" r="55%">
            <stop offset="0%" stop-color="rgba(252, 221, 9, 0.22)"/>
            <stop offset="100%" stop-color="transparent"/>
          </radialGradient>
        </defs>

        <rect width="1200" height="630" fill="url(#bgG)"/>
        <rect width="1200" height="630" fill="url(#sparkleAura)"/>
        <rect x="0" y="0" width="1200" height="6" fill="#FCDD09"/>

        <!-- Tag -->
        <rect x="100" y="90" width="180" height="36" rx="18" fill="rgba(252, 221, 9, 0.12)" stroke="#FCDD09" stroke-width="1"/>
        <text x="130" y="114" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="14" font-weight="700" fill="#FCDD09">GOOGLE AI SUITE</text>

        <!-- Title -->
        <text x="100" y="210" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="54" font-weight="800" fill="#FFFFFF">Gemini Pro (18 Months)</text>
        <text x="100" y="260" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="24" font-weight="500" fill="#94A3B8">Advanced AI Model Access + 2TB Google Cloud Storage</text>

        <!-- Features list -->
        <g transform="translate(100, 320)">
          <text x="0" y="30" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="20" font-weight="600" fill="#FFFFFF">&#x2022; Full 18-month duration subscription</text>
          <text x="0" y="70" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="20" font-weight="600" fill="#FFFFFF">&#x2022; 2,048 GB Google Drive, Gmail &amp; Photos storage</text>
          <text x="0" y="110" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="20" font-weight="600" fill="#FFFFFF">&#x2022; Gemini 1.5 Pro with Deep Research &amp; Python runtime</text>
          <text x="0" y="150" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="20" font-weight="600" fill="#FFFFFF">&#x2022; Automated one-time activation link with instructions</text>
        </g>

        <!-- Price box -->
        <g transform="translate(800, 290)">
          <rect width="300" height="180" rx="20" fill="#16202E" stroke="rgba(252, 221, 9, 0.4)" stroke-width="2"/>
          <text x="30" y="55" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="16" font-weight="700" fill="#94A3B8">TOTAL PRICE</text>
          <text x="30" y="110" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="44" font-weight="800" fill="#FCDD09">1,500 ETB</text>
          <text x="30" y="145" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="16" font-weight="600" fill="#10B981">&#x223C;83.3 ETB / Month</text>
        </g>
      </svg>`;

    case 'premium':
      return `
      <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bgP" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0B111A"/>
            <stop offset="100%" stop-color="#171A30"/>
          </linearGradient>
          <radialGradient id="premGlow" cx="80%" cy="30%" r="60%">
            <stop offset="0%" stop-color="rgba(56, 189, 248, 0.25)"/>
            <stop offset="100%" stop-color="transparent"/>
          </radialGradient>
        </defs>

        <rect width="1200" height="630" fill="url(#bgP)"/>
        <rect width="1200" height="630" fill="url(#premGlow)"/>
        <rect x="0" y="0" width="1200" height="6" fill="#38BDF8"/>

        <!-- Tag -->
        <rect x="100" y="90" width="190" height="36" rx="18" fill="rgba(56, 189, 248, 0.12)" stroke="#38BDF8" stroke-width="1"/>
        <text x="130" y="114" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="14" font-weight="700" fill="#38BDF8">FRAGMENT VERIFIED</text>

        <text x="100" y="210" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="54" font-weight="800" fill="#FFFFFF">Telegram Premium</text>
        <text x="100" y="260" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="24" font-weight="500" fill="#94A3B8">Official direct gifting to your @username — No password needed</text>

        <!-- Plans -->
        <g transform="translate(100, 330)">
          <!-- 3m -->
          <rect x="0" y="0" width="300" height="150" rx="16" fill="#16202E" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
          <text x="24" y="44" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="18" font-weight="800" fill="#FFFFFF">3 Months</text>
          <text x="24" y="74" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="14" font-weight="500" fill="#94A3B8">Standard Plan</text>
          <text x="24" y="118" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="26" font-weight="800" fill="#38BDF8">1,100 ETB</text>

          <!-- 6m -->
          <rect x="340" y="0" width="300" height="150" rx="16" fill="#16202E" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
          <text x="364" y="44" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="18" font-weight="800" fill="#FFFFFF">6 Months</text>
          <text x="364" y="74" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="14" font-weight="500" fill="#94A3B8">Popular Choice</text>
          <text x="364" y="118" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="26" font-weight="800" fill="#38BDF8">1,850 ETB</text>

          <!-- 12m -->
          <rect x="680" y="0" width="320" height="150" rx="16" fill="#16202E" stroke="rgba(56, 189, 248, 0.4)" stroke-width="2"/>
          <text x="704" y="44" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="18" font-weight="800" fill="#FFFFFF">12 Months (1 Year)</text>
          <text x="704" y="74" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="14" font-weight="600" fill="#10B981">Best Value — Save 400 ETB</text>
          <text x="704" y="118" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="26" font-weight="800" fill="#FCDD09">3,200 ETB</text>
        </g>
      </svg>`;

    case 'stars':
      return `
      <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bgS" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0B111A"/>
            <stop offset="100%" stop-color="#1C2114"/>
          </linearGradient>
          <radialGradient id="starsGlow" cx="80%" cy="30%" r="60%">
            <stop offset="0%" stop-color="rgba(16, 185, 129, 0.25)"/>
            <stop offset="100%" stop-color="transparent"/>
          </radialGradient>
        </defs>

        <rect width="1200" height="630" fill="url(#bgS)"/>
        <rect width="1200" height="630" fill="url(#starsGlow)"/>
        <rect x="0" y="0" width="1200" height="6" fill="#10B981"/>

        <!-- Tag -->
        <rect x="100" y="90" width="220" height="36" rx="18" fill="rgba(16, 185, 129, 0.12)" stroke="#10B981" stroke-width="1"/>
        <text x="125" y="114" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="14" font-weight="700" fill="#10B981">OFFICIAL TELEGRAM STARS</text>

        <text x="100" y="210" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="54" font-weight="800" fill="#FFFFFF">Telegram Stars (Coins)</text>
        <text x="100" y="260" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="24" font-weight="500" fill="#94A3B8">In-app currency for digital gifts, channel boosts, bots, and mini-apps</text>

        <!-- Rate pill -->
        <g transform="translate(100, 310)">
          <rect width="460" height="60" rx="14" fill="#16202E" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
          <text x="24" y="38" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="20" font-weight="700" fill="#FFFFFF">Exchange Rate: <tspan fill="#FCDD09">1 Star = 2.5 ETB</tspan></text>
        </g>

        <!-- Packages sample grid -->
        <g transform="translate(100, 400)">
          <rect x="0" y="0" width="220" height="100" rx="14" fill="#16202E" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
          <text x="20" y="40" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="18" font-weight="800" fill="#FFFFFF">100 Stars</text>
          <text x="20" y="75" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="18" font-weight="800" fill="#10B981">250 ETB</text>

          <rect x="250" y="0" width="220" height="100" rx="14" fill="#16202E" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
          <text x="270" y="40" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="18" font-weight="800" fill="#FFFFFF">500 Stars</text>
          <text x="270" y="75" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="18" font-weight="800" fill="#10B981">1,250 ETB</text>

          <rect x="500" y="0" width="220" height="100" rx="14" fill="#16202E" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
          <text x="520" y="40" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="18" font-weight="800" fill="#FFFFFF">1,000 Stars</text>
          <text x="520" y="75" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="18" font-weight="800" fill="#10B981">2,500 ETB</text>

          <rect x="750" y="0" width="250" height="100" rx="14" fill="#16202E" stroke="rgba(252, 221, 9, 0.4)" stroke-width="2"/>
          <text x="770" y="40" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="18" font-weight="800" fill="#FFFFFF">Custom Amount</text>
          <text x="770" y="75" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="16" font-weight="600" fill="#FCDD09">Interactive Slider</text>
        </g>
      </svg>`;

    case 'checkout':
      return `
      <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bgC" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0B111A"/>
            <stop offset="100%" stop-color="#141E28"/>
          </linearGradient>
        </defs>

        <rect width="1200" height="630" fill="url(#bgC)"/>
        <rect x="0" y="0" width="1200" height="6" fill="#078930"/>

        <!-- Tag -->
        <rect x="100" y="90" width="200" height="36" rx="18" fill="rgba(7, 137, 48, 0.12)" stroke="#078930" stroke-width="1"/>
        <text x="125" y="114" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="14" font-weight="700" fill="#10B981">SECURE SETTLEMENT</text>

        <text x="100" y="210" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="54" font-weight="800" fill="#FFFFFF">Payment Rails &amp; Verification</text>
        <text x="100" y="260" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="24" font-weight="500" fill="#94A3B8">Instant verification via bank receipt upload or Telegram Stars &amp; Crypto</text>

        <g transform="translate(100, 330)">
          <!-- CBE -->
          <rect x="0" y="0" width="230" height="150" rx="16" fill="#16202E" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
          <text x="24" y="44" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="20" font-weight="800" fill="#A78BFA">CBE Bank</text>
          <text x="24" y="74" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="14" font-weight="500" fill="#94A3B8">Commercial Bank</text>
          <text x="24" y="118" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="16" font-weight="700" fill="#FFFFFF">1000510711258</text>

          <!-- Telebirr -->
          <rect x="250" y="0" width="230" height="150" rx="16" fill="#16202E" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
          <text x="274" y="44" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="20" font-weight="800" fill="#00A651">Telebirr</text>
          <text x="274" y="74" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="14" font-weight="500" fill="#94A3B8">Mobile Money</text>
          <text x="274" y="118" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="16" font-weight="700" fill="#FFFFFF">0965579045</text>

          <!-- Abyssinia -->
          <rect x="500" y="0" width="230" height="150" rx="16" fill="#16202E" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
          <text x="524" y="44" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="20" font-weight="800" fill="#F59E0B">Abyssinia</text>
          <text x="524" y="74" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="14" font-weight="500" fill="#94A3B8">Bank of Abyssinia</text>
          <text x="524" y="118" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="16" font-weight="700" fill="#FFFFFF">Verified Account</text>

          <!-- Stars / Crypto -->
          <rect x="750" y="0" width="250" height="150" rx="16" fill="#16202E" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
          <text x="774" y="44" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="20" font-weight="800" fill="#38BDF8">Stars &amp; TON</text>
          <text x="774" y="74" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="14" font-weight="500" fill="#94A3B8">Native In-Chat Pay</text>
          <text x="774" y="118" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="16" font-weight="700" fill="#10B981">Auto-Settlement</text>
        </g>
      </svg>`;
  }
}

export function getBannerPngPath(type: 'welcome' | 'gemini' | 'premium' | 'stars' | 'checkout'): string {
  ensureAssetsDir();
  const filePath = path.join(ASSETS_DIR, `${type}.png`);

  if (!fs.existsSync(filePath)) {
    try {
      const svg = generateSvgBanner(type);
      const resvg = new Resvg(svg, {
        fitTo: {
          mode: 'width',
          value: 1200,
        },
      });
      const pngData = resvg.render();
      const pngBuffer = pngData.asPng();
      fs.writeFileSync(filePath, pngBuffer);
      logger.info({ type, filePath }, 'Generated high-DPI PNG banner');
    } catch (err) {
      logger.error({ err, type }, 'Failed to render PNG banner');
    }
  }

  return filePath;
}
