import React, { useState, useEffect } from 'react';
import {
  fetchBootstrap,
  fetchOrders,
  createOrderApi,
  submitReceiptApi,
  recheckUsernameApi,
  BootstrapData,
  OrderItem,
  sendSupportMessage,
  fetchSupportMessages,
  fetchReferralsApi,
  getOrderEventsApi,
  type ReferralSummary,
} from './api.ts';
import { translations, Language } from './i18n.ts';
import {
  LogoIcon,
  CheckIcon,
  CopyIcon,
  ShoppingBagIcon,
  PackageIcon,
  MessageCircleIcon,
  GlobeIcon,
  CloseIcon,
  TelegramStar3DIcon,
  GiftIcon,
  TierShieldGoldIcon,
  TierShieldSilverIcon,
  TierShieldBronzeIcon,
  ETBCurrencyIcon,
  TONDiamondIcon,
  USDCoinIcon,
  PaymentCbeIcon,
  PaymentTelebirrIcon,
  PaymentAbyssiniaIcon,
  GeminiBrandIcon,
  TelegramBrandIcon,
  StarsBrandIcon,
  SparkleIcon,
  AlertCircleIcon,
  RefreshIcon,
  CrownIcon,
  ZapIcon,
  CameraIcon,
  HelpCircleIcon,
  ChevronRightIcon,
} from './components/Icons.tsx';
import { computeStarsTotal, formatMoney, type DisplayCurrency } from './utils.ts';
import { haptic } from './haptics.ts';
import { loadPrefsSync, savePrefs } from './prefs.service.ts';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { OrderTimeline } from './components/OrderTimeline.tsx';
import { TonPayButton } from './components/TonPayButton.tsx';
import './index.css';

const AdminDashboard = React.lazy(() => import('./admin/AdminDashboard.tsx'));

const DEFAULT_BOOTSTRAP: BootstrapData = {
  user: null,
  products: [
    {
      id: 'telegram_stars',
      type: 'order',
      name: 'Telegram Stars',
      description: 'Official currency for digital gifts, channels, bots, and mini-apps.',
      is_active: 1,
      meta: '{}',
      variants: [
        { id: 'tg_stars_50', product_id: 'telegram_stars', name: '50 Stars', price_etb: 125, is_active: 1, sort_order: 1 },
        { id: 'tg_stars_100', product_id: 'telegram_stars', name: '100 Stars', price_etb: 250, is_active: 1, sort_order: 2 },
        { id: 'tg_stars_250', product_id: 'telegram_stars', name: '250 Stars', price_etb: 625, is_active: 1, sort_order: 3 },
        { id: 'tg_stars_500', product_id: 'telegram_stars', name: '500 Stars', price_etb: 1250, is_active: 1, sort_order: 4 },
        { id: 'tg_stars_1000', product_id: 'telegram_stars', name: '1,000 Stars', price_etb: 2500, is_active: 1, sort_order: 5 },
        { id: 'tg_stars_2500', product_id: 'telegram_stars', name: '2,500 Stars', price_etb: 6250, is_active: 1, sort_order: 6 }
      ],
      availableStock: null
    },
    {
      id: 'telegram_premium',
      type: 'order',
      name: 'Telegram Premium',
      description: 'Official Fragment direct gift to @username without password or credentials.',
      is_active: 1,
      meta: '{}',
      variants: [
        { id: 'tg_prem_3m', product_id: 'telegram_premium', name: '3 Months', price_etb: 1100, is_active: 1, sort_order: 1 },
        { id: 'tg_prem_6m', product_id: 'telegram_premium', name: '6 Months', price_etb: 1900, is_active: 1, sort_order: 2 },
        { id: 'tg_prem_12m', product_id: 'telegram_premium', name: '12 Months', price_etb: 3400, is_active: 1, sort_order: 3 }
      ],
      availableStock: null
    },
    {
      id: 'gemini_pro_18m',
      type: 'stock',
      name: 'Gemini Pro (18 Months)',
      description: 'Google AI Suite + 2TB Google Cloud Storage. Instant activation link.',
      is_active: 1,
      meta: '{}',
      variants: [
        { id: 'gemini_pro_18m_default', product_id: 'gemini_pro_18m', name: '18 Months Access', price_etb: 1500, is_active: 1, sort_order: 1 }
      ],
      availableStock: 5
    }
  ],
  settings: {
    etb_per_star: '2.5',
    cbe_account: '1000123456789',
    cbe_name: 'Bighabesha Shop',
    telebirr_account: '0912345678',
    telebirr_name: 'Bighabesha Shop',
    abyssinia_account: '123456789',
    abyssinia_name: 'Bighabesha Shop',
    support_username: 'Vweah'
  },
  cryptoRates: {
    tonUsd: 1.45,
    usdtUsd: 1.0
  }
};

function getLoyaltyInfo(user: BootstrapData['user'], orders: OrderItem[]) {
  const lifetimeSpent = user?.lifetimeEtb ?? orders
    .filter((o) => o.status === 'fulfilled' || o.status === 'delivered')
    .reduce((sum, o) => sum + (o.amount_etb || 0), 0);

  let tier = user?.tier || 'bronze';
  if (!user?.tier) {
    if (lifetimeSpent >= 5000) tier = 'gold';
    else if (lifetimeSpent >= 1500) tier = 'silver';
    else tier = 'bronze';
  }

  let nextTarget = 1500;
  let nextTier = 'Silver VIP';
  let progressPct = 0;
  let perk = 'Automated Queue';

  if (tier === 'gold') {
    nextTarget = 10000;
    nextTier = 'Elite VIP';
    progressPct = Math.min(100, Math.round((lifetimeSpent / 10000) * 100));
    perk = '5% Cashback + VIP Priority';
  } else if (tier === 'silver') {
    nextTarget = 5000;
    nextTier = 'Gold VIP';
    progressPct = Math.min(100, Math.round(((lifetimeSpent - 1500) / 3500) * 100));
    perk = '2% Cashback + Fast Processing';
  } else {
    nextTarget = 1500;
    nextTier = 'Silver VIP';
    progressPct = Math.min(100, Math.round((lifetimeSpent / 1500) * 100));
    perk = 'Direct Telegram Bot Delivery';
  }

  return { tier, lifetimeSpent, nextTarget, nextTier, progressPct, perk };
}

export const App: React.FC = () => {
  const checkIsAdmin = () =>
    window.location.pathname.startsWith('/admin') ||
    window.location.hash.startsWith('#admin') ||
    window.location.search.includes('admin=1');

  const [isAdminRoute, setIsAdminRoute] = useState<boolean>(checkIsAdmin());

  useEffect(() => {
    const handleRoute = () => {
      setIsAdminRoute(checkIsAdmin());
    };
    window.addEventListener('hashchange', handleRoute);
    window.addEventListener('popstate', handleRoute);
    return () => {
      window.removeEventListener('hashchange', handleRoute);
      window.removeEventListener('popstate', handleRoute);
    };
  }, []);

  if (isAdminRoute) {
    return (
      <React.Suspense fallback={<div style={{ minHeight: '100vh', background: '#0A0D12', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: '14px' }}>Loading Admin Console...</div>}>
        <AdminDashboard />
      </React.Suspense>
    );
  }

  return (
    <TonConnectUIProvider manifestUrl={`${window.location.origin}/tonconnect-manifest.json`}>
      <StoreFront />
    </TonConnectUIProvider>
  );
};

const StoreFront: React.FC = () => {
  const [lang, setLang] = useState<Language>('en');
  const t = translations[lang];

  useEffect(() => {
    document.documentElement.lang = lang === 'am' ? 'am' : 'en';
  }, [lang]);

  const [activeTab, setActiveTab] = useState<'catalog' | 'orders' | 'support'>('catalog');
  const [txFilter, setTxFilter] = useState<'all' | 'delivered' | 'pending'>('all');
  const [data, setData] = useState<BootstrapData>(DEFAULT_BOOTSTRAP);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);

  // Product Customizations
  const [selectedPremiumVariant, setSelectedPremiumVariant] = useState<string>('tg_prem_3m');
  const [selectedStarsVariant, setSelectedStarsVariant] = useState<string>('tg_stars_100');
  const [customStarsCount, setCustomStarsCount] = useState<number>(100);
  const [isCustomStars, setIsCustomStars] = useState<boolean>(false);

  // Guided Checkout Wizard State
  type PaymentRail = 'telebirr' | 'cbe' | 'abyssinia' | 'ton' | 'stars';
  interface PendingCheckoutItem {
    productId: string;
    variantId?: string;
    customStars?: number;
    amountETB: number;
    productName: string;
  }

  const [gateOpen, setGateOpen] = useState(false);
  const [pendingCheckoutItem, setPendingCheckoutItem] = useState<PendingCheckoutItem | null>(null);
  const [checkoutOrder, setCheckoutOrder] = useState<OrderItem | null>(null);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1); // 1: Method, 2: Transfer, 3: Receipt, 4: Success
  const [selectedRail, setSelectedRail] = useState<PaymentRail>('telebirr');
  const [submittingOrder, setSubmittingOrder] = useState(false);

  // Receipt & Feedback
  const [receiptBase64, setReceiptBase64] = useState<string>('');
  const [receiptNote, setReceiptNote] = useState<string>('');
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Order Detail Modal
  const [selectedDetailOrder, setSelectedDetailOrder] = useState<OrderItem | null>(null);
  const [detailEvents, setDetailEvents] = useState<any[]>([]);

  // Preferences, Promo & Support
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>(() => loadPrefsSync().currency ?? 'ETB');
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [supportMsgs, setSupportMsgs] = useState<{ id: number; sender_role: string; body: string }[]>([]);
  const [supportInput, setSupportInput] = useState('');
  const [referralInfo, setReferralInfo] = useState<ReferralSummary | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    haptic.success();
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const toggleLanguage = () => {
    const nextLang = lang === 'en' ? 'am' : 'en';
    setLang(nextLang);
    haptic.tap();
    void savePrefs({ language: nextLang });
  };

  const cycleCurrency = () => {
    haptic.tap();
    setDisplayCurrency((prev) => {
      const next: DisplayCurrency = prev === 'ETB' ? 'USD' : prev === 'USD' ? 'TON' : 'ETB';
      void savePrefs({ currency: next });
      return next;
    });
  };

  const loadData = async (): Promise<BootstrapData | null> => {
    setIsLoading(true);
    try {
      const res = await fetchBootstrap();
      setData(res);
      if (res.user?.languageCode?.startsWith('am')) {
        setLang('am');
      }
      const ords = await fetchOrders().catch(() => ({ orders: [] }));
      setOrders(ords.orders);
      setErrorMessage(null);
      return res;
    } catch (err: any) {
      console.warn('Bootstrap fetch warning:', err);
      setErrorMessage(t.bootstrapError);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
      try {
        (window.Telegram.WebApp as any).setHeaderColor?.('#0A0D12');
        (window.Telegram.WebApp as any).setBackgroundColor?.('#0A0D12');
      } catch {}
    }
    loadData();
    fetchSupportMessages().then((res) => setSupportMsgs(res.messages || [])).catch(() => {});

    const handleOnline = () => { setIsOnline(true); haptic.success(); };
    const handleOffline = () => { setIsOnline(false); haptic.warn(); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedDetailOrder) setSelectedDetailOrder(null);
        else if (checkoutModalOpen) setCheckoutModalOpen(false);
        else if (gateOpen) setGateOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDetailOrder, checkoutModalOpen, gateOpen]);

  const hasUsername = Boolean(data?.user?.username && data.user.username.trim().length > 0);
  const etbPerStar = parseFloat(data?.settings.etb_per_star || '2.5') || 2.5;

  const fmt = (etb: number): string => {
    return formatMoney(etb, displayCurrency, {
      etbPerUsd: parseFloat(data?.settings.etb_per_usd || '135') || 135,
      tonUsd: data?.cryptoRates?.tonUsd || 3.5,
    });
  };

  // Launch Checkout Wizard
  const handleStartPurchase = (productId: string, variantId?: string, customStars?: number) => {
    haptic.tap();
    const prod = data.products.find((p) => p.id === productId);
    if (!prod) return;

    if (productId === 'telegram_premium' && !hasUsername) {
      setGateOpen(true);
      return;
    }

    let calculatedAmount = 0;
    let displayName = prod.name;

    if (productId === 'gemini_pro_18m') {
      calculatedAmount = prod.variants[0]?.price_etb || 1500;
      displayName = 'Gemini Pro (18 Months)';
    } else if (productId === 'telegram_premium') {
      const selectedVar = prod.variants.find((v) => v.id === (variantId || selectedPremiumVariant));
      calculatedAmount = selectedVar ? selectedVar.price_etb : 1100;
      displayName = `Telegram Premium (${selectedVar?.name || '3 Months'})`;
    } else if (productId === 'telegram_stars') {
      if (customStars) {
        calculatedAmount = computeStarsTotal(customStars, etbPerStar);
        displayName = `${customStars.toLocaleString()} Telegram Stars`;
      } else {
        const selectedVar = prod.variants.find((v) => v.id === (variantId || selectedStarsVariant));
        calculatedAmount = selectedVar ? selectedVar.price_etb : 250;
        displayName = selectedVar?.name || '100 Stars';
      }
    }

    setPendingCheckoutItem({
      productId,
      variantId,
      customStars,
      amountETB: calculatedAmount,
      productName: displayName,
    });
    setCheckoutOrder(null);
    setReceiptBase64('');
    setReceiptNote('');
    setWizardStep(1);
    setSelectedRail('telebirr');
    setCheckoutModalOpen(true);
  };

  // Step 1 -> Step 2: Proceed to Transfer
  const handleProceedToTransfer = async () => {
    if (!pendingCheckoutItem) return;
    haptic.tap();
    setSubmittingOrder(true);
    try {
      const res = await createOrderApi({
        productId: pendingCheckoutItem.productId,
        paymentRail: selectedRail,
        variantId: pendingCheckoutItem.variantId,
        customStars: pendingCheckoutItem.customStars,
        promoCode: promoCodeInput.trim() || undefined,
      });

      if (res.order) {
        setCheckoutOrder(res.order);
        setOrders((prev) => [res.order, ...prev.filter((o) => o.id !== res.order.id)]);
        setWizardStep(2);
        haptic.success();
      }
    } catch (err: any) {
      haptic.error();
      alert(err.message || 'Failed to initialize order.');
    } finally {
      setSubmittingOrder(false);
    }
  };

  // Step 3: Submit Receipt & Finish
  const handleSubmitReceipt = async () => {
    if (!checkoutOrder || !receiptBase64) return;
    haptic.tap();
    setUploadingReceipt(true);
    try {
      const res = await submitReceiptApi({
        orderId: checkoutOrder.id,
        receiptImageBase64: receiptBase64,
        note: receiptNote.trim() || undefined,
      });
      if (res.order) {
        setCheckoutOrder(res.order);
        setOrders((prev) => prev.map((o) => (o.id === res.order.id ? res.order : o)));
      }
      setWizardStep(4); // Success Celebration
      haptic.success();
    } catch (err: any) {
      haptic.error();
      alert(err.message || 'Failed to upload receipt slip.');
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleReceiptFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setReceiptBase64(reader.result as string);
      haptic.success();
    };
    reader.readAsDataURL(file);
  };

  const openOrderDetail = async (ord: OrderItem) => {
    haptic.tap();
    setSelectedDetailOrder(ord);
    try {
      const ev = await getOrderEventsApi(ord.id);
      setDetailEvents(ev.events || []);
    } catch {
      setDetailEvents([]);
    }
  };

  const handleSendSupport = async () => {
    if (!supportInput.trim()) return;
    const text = supportInput.trim();
    setSupportInput('');
    haptic.tap();
    try {
      await sendSupportMessage(text);
      const res = await fetchSupportMessages();
      setSupportMsgs(res.messages || []);
      haptic.success();
    } catch (err: any) {
      haptic.error();
      alert(err.message || 'Support message dispatch failed.');
    }
  };

  // Filtered orders
  const filteredOrders = orders.filter((o) => {
    if (txFilter === 'delivered') return o.status === 'fulfilled' || o.status === 'delivered';
    if (txFilter === 'pending') return o.status === 'pending_approval' || o.status === 'awaiting_payment' || o.status === 'pending_fulfillment';
    return true;
  });

  const starsProd = data.products.find((p) => p.id === 'telegram_stars');
  const premProd = data.products.find((p) => p.id === 'telegram_premium');
  const geminiProd = data.products.find((p) => p.id === 'gemini_pro_18m');

  const loyalty = getLoyaltyInfo(data?.user, orders);

  // Selected Star Price
  const currentStarAmount = isCustomStars ? customStarsCount : parseInt(selectedStarsVariant.replace(/\D/g, '') || '100', 10);
  const currentStarPriceEtb = computeStarsTotal(currentStarAmount, etbPerStar);

  // Selected Premium Price
  const selectedPremVariantObj = premProd?.variants.find((v) => v.id === selectedPremiumVariant);
  const currentPremPriceEtb = selectedPremVariantObj?.price_etb || 1100;

  return (
    <div className="app-frame">
      {/* ── Top Navigation Bar ────────────────────────────────────── */}
      <header className="top-nav">
        <div className="brand-section">
          <LogoIcon size={30} />
          <span className="brand-title-text">{t.brandName}</span>
        </div>

        <div className="nav-actions">
          {/* Currency Switcher */}
          <button className="lang-switch-btn" onClick={cycleCurrency} aria-label={`Display currency: ${displayCurrency}`}>
            {displayCurrency === 'ETB' && <><ETBCurrencyIcon size={14} /> ETB</>}
            {displayCurrency === 'USD' && <><USDCoinIcon size={14} /> USD</>}
            {displayCurrency === 'TON' && <><TONDiamondIcon size={14} /> TON</>}
          </button>

          {/* Language Switcher */}
          <button className="lang-switch-btn" onClick={toggleLanguage} aria-label="Toggle language">
            <GlobeIcon size={13} color="var(--tg-text-secondary)" />
            <span>{lang === 'en' ? 'አማርኛ' : 'EN'}</span>
          </button>

          {/* User Tag with Tier Badge */}
          <div className="user-badge-header" title={`Tier: ${loyalty.tier.toUpperCase()}`}>
            {loyalty.tier === 'gold' && <TierShieldGoldIcon size={16} />}
            {loyalty.tier === 'silver' && <TierShieldSilverIcon size={16} />}
            {loyalty.tier === 'bronze' && <TierShieldBronzeIcon size={16} />}
            <span>{data?.user?.username ? `@${data.user.username}` : data?.user?.firstName || 'Guest'}</span>
          </div>
        </div>
      </header>

      {/* ── Main Screen View ──────────────────────────────────────── */}
      <main className="page-content">
        {/* Offline Warning */}
        {!isOnline && (
          <div className="offline-banner" role="status" aria-live="polite">
            <AlertCircleIcon size={16} color="var(--tg-orange)" />
            <span>{t.offlineBanner}</span>
          </div>
        )}

        {/* Global Error Banner */}
        {errorMessage && (
          <div style={{ background: 'var(--tg-red-dim)', border: '1px solid var(--tg-red)', padding: '12px 14px', borderRadius: 'var(--radius-md)', marginBottom: '16px', color: '#FCA5A5', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{errorMessage}</span>
            <button className="lang-switch-btn" style={{ fontSize: '11.5px', padding: '2px 8px', height: '26px' }} onClick={loadData}>
              <RefreshIcon size={12} /> {t.retry}
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
           TAB 1: SHOP (Dead-Simple Clean Card Deck)
           ═══════════════════════════════════════════════════════════ */}
        {activeTab === 'catalog' && (
          <div>
            {isLoading ? (
              <div>
                <div className="skeleton" style={{ height: '90px', marginBottom: '16px' }} />
                <div className="skeleton" style={{ height: '340px', marginBottom: '16px' }} />
                <div className="skeleton" style={{ height: '300px', marginBottom: '16px' }} />
                <div className="skeleton" style={{ height: '260px', marginBottom: '16px' }} />
              </div>
            ) : (
              <>
                {/* Hero Header Banner */}
                <div className="hero-banner-card">
                  <div className="hero-banner-content">
                    <div className="hero-banner-badge">
                      <ZapIcon size={13} color="var(--tg-green)" />
                      <span>{t.fastDelivery}</span>
                    </div>
                    <h1 className="hero-banner-title">{t.featuredProducts}</h1>
                    <p className="hero-banner-subtitle">{t.instantDelivery}</p>
                  </div>
                </div>

                {/* 3-Hero Product Cards Deck */}
                <div className="product-card-deck">
                  {/* ───────────────────────────────────────────────
                     CARD 1: ⭐ Telegram Stars (Custom amounts + pills)
                     ─────────────────────────────────────────────── */}
                  {starsProd && (
                    <div className="store-product-card featured-card">
                      <div className="product-card-header">
                        <div className="product-brand-group">
                          <div className="product-hero-icon stars">
                            <TelegramStar3DIcon size={36} />
                          </div>
                          <div className="product-title-group">
                            <h2 className="product-main-title">{starsProd.name}</h2>
                            <span className="product-main-desc">Official currency for gifts & bots</span>
                          </div>
                        </div>
                        <span className="badge-stock-green">⚡ {t.fastDelivery}</span>
                      </div>

                      {/* Crystal Clear Live Price Banner */}
                      <div className="product-price-section">
                        <div>
                          <div className="price-huge-number">{currentStarPriceEtb.toLocaleString()} ETB</div>
                          {displayCurrency !== 'ETB' && (
                            <div className="price-secondary-text">{fmt(currentStarPriceEtb)}</div>
                          )}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--tg-gold)' }}>
                            ⭐ {currentStarAmount.toLocaleString()} Stars
                          </span>
                        </div>
                      </div>

                      {/* Quick Select Star Pills */}
                      <div className="pills-grid-container" role="radiogroup" aria-label="Telegram Stars packages">
                        {starsProd.variants.slice(0, 6).map((v) => {
                          const isSelected = !isCustomStars && selectedStarsVariant === v.id;
                          return (
                            <button
                              type="button"
                              role="radio"
                              aria-checked={isSelected}
                              key={v.id}
                              className={`quick-select-pill ${isSelected ? 'active' : ''}`}
                              onClick={() => {
                                setIsCustomStars(false);
                                setSelectedStarsVariant(v.id);
                                haptic.tap();
                              }}
                            >
                              <span className="pill-primary-label">{v.name}</span>
                              <span className="pill-sub-price">{v.price_etb.toLocaleString()} ETB</span>
                            </button>
                          );
                        })}
                      </div>

                      {/* Custom Stars Smooth Slider */}
                      <div className="custom-slider-box">
                        <div className="slider-header-row">
                          <span className="slider-title">{t.customStars}</span>
                          <span className="slider-stars-count">{customStarsCount.toLocaleString()} ⭐</span>
                        </div>
                        <input
                          type="range"
                          min="50"
                          max="5000"
                          step="50"
                          className="custom-stars-slider"
                          value={customStarsCount}
                          aria-label="Telegram Stars custom amount"
                          onChange={(e) => {
                            setIsCustomStars(true);
                            setCustomStarsCount(parseInt(e.target.value, 10));
                            haptic.select();
                          }}
                        />
                      </div>

                      {/* Feature Bullet Points */}
                      <ul className="product-features-list">
                        {t.starsFeatures.map((feat, idx) => (
                          <li key={idx} className="product-feature-item">
                            <span className="feature-check-bubble"><CheckIcon size={12} color="var(--tg-green)" /></span>
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>

                      {/* 54px Primary Action Button */}
                      <button
                        className="btn-tg-primary"
                        onClick={() => {
                          if (isCustomStars) {
                            handleStartPurchase('telegram_stars', undefined, customStarsCount);
                          } else {
                            handleStartPurchase('telegram_stars', selectedStarsVariant);
                          }
                        }}
                      >
                        <SparkleIcon size={18} color="#FFFFFF" />
                        <span>{t.buyNow} — Telegram Stars</span>
                      </button>
                    </div>
                  )}

                  {/* ───────────────────────────────────────────────
                     CARD 2: 👑 Telegram Premium (3/6/12 Months)
                     ─────────────────────────────────────────────── */}
                  {premProd && (
                    <div className="store-product-card">
                      <div className="product-card-header">
                        <div className="product-brand-group">
                          <div className="product-hero-icon premium">
                            <TelegramBrandIcon size={30} />
                          </div>
                          <div className="product-title-group">
                            <h2 className="product-main-title">{premProd.name}</h2>
                            <span className="product-main-desc">Direct Fragment gift to @username</span>
                          </div>
                        </div>
                        <span className="badge-official-blue">🎁 Official Fragment</span>
                      </div>

                      {/* Crystal Clear Live Price Banner */}
                      <div className="product-price-section">
                        <div>
                          <div className="price-huge-number">{currentPremPriceEtb.toLocaleString()} ETB</div>
                          {displayCurrency !== 'ETB' && (
                            <div className="price-secondary-text">{fmt(currentPremPriceEtb)}</div>
                          )}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--tg-electric-blue)' }}>
                            {selectedPremVariantObj?.name || '3 Months'}
                          </span>
                        </div>
                      </div>

                      {/* Duration Pills */}
                      <div className="pills-grid-container" role="radiogroup" aria-label="Telegram Premium plan duration">
                        {premProd.variants.map((v) => {
                          const isSelected = selectedPremiumVariant === v.id;
                          return (
                            <button
                              type="button"
                              role="radio"
                              aria-checked={isSelected}
                              key={v.id}
                              className={`quick-select-pill ${isSelected ? 'active' : ''}`}
                              onClick={() => {
                                setSelectedPremiumVariant(v.id);
                                haptic.tap();
                              }}
                            >
                              <span className="pill-primary-label">{v.name.replace(' Subscription', '').replace(' Plan', '')}</span>
                              <span className="pill-sub-price">{v.price_etb.toLocaleString()} ETB</span>
                              {v.id === 'tg_prem_12m' && <span className="pill-badge-save">{t.saveDiscount}</span>}
                            </button>
                          );
                        })}
                      </div>

                      {/* Feature Bullet Points */}
                      <ul className="product-features-list">
                        {t.premiumFeatures.map((feat, idx) => (
                          <li key={idx} className="product-feature-item">
                            <span className="feature-check-bubble"><CheckIcon size={12} color="var(--tg-green)" /></span>
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>

                      {/* 54px Primary Action Button */}
                      <button
                        className="btn-tg-primary"
                        onClick={() => handleStartPurchase('telegram_premium', selectedPremiumVariant)}
                      >
                        <CrownIcon size={18} color="#FFFFFF" />
                        <span>{t.buyNow} — Telegram Premium</span>
                      </button>
                    </div>
                  )}

                  {/* ───────────────────────────────────────────────
                     CARD 3: 🤖 Gemini Pro 18 Months (Google AI + 2TB)
                     ─────────────────────────────────────────────── */}
                  {geminiProd && (
                    <div className="store-product-card">
                      <div className="product-card-header">
                        <div className="product-brand-group">
                          <div className="product-hero-icon gemini">
                            <GeminiBrandIcon size={30} />
                          </div>
                          <div className="product-title-group">
                            <h2 className="product-main-title">{geminiProd.name}</h2>
                            <span className="product-main-desc">Google AI Suite + 2TB Storage</span>
                          </div>
                        </div>
                        {geminiProd.availableStock && geminiProd.availableStock > 0 ? (
                          <span className="badge-stock-green">🟢 {geminiProd.availableStock} {t.inStock}</span>
                        ) : (
                          <span className="status-pill-rejected">{t.soldOut}</span>
                        )}
                      </div>

                      {/* Crystal Clear Live Price Banner */}
                      <div className="product-price-section">
                        <div>
                          <div className="price-huge-number">1,500 ETB</div>
                          {displayCurrency !== 'ETB' && (
                            <div className="price-secondary-text">{fmt(1500)}</div>
                          )}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--tg-text-secondary)' }}>
                            18 Months (~83 ETB/mo)
                          </span>
                        </div>
                      </div>

                      {/* Feature Bullet Points */}
                      <ul className="product-features-list">
                        {t.geminiFeatures.map((feat, idx) => (
                          <li key={idx} className="product-feature-item">
                            <span className="feature-check-bubble"><CheckIcon size={12} color="var(--tg-green)" /></span>
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>

                      {/* 54px Primary Action Button */}
                      <button
                        className="btn-tg-primary"
                        disabled={!geminiProd.availableStock || geminiProd.availableStock <= 0}
                        onClick={() => handleStartPurchase('gemini_pro_18m')}
                      >
                        <SparkleIcon size={18} color="#FFFFFF" />
                        <span>{geminiProd.availableStock && geminiProd.availableStock > 0 ? `${t.buyNow} — 1,500 ETB` : t.soldOut}</span>
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
           TAB 2: MY ORDERS (Simplified & Color Coded)
           ═══════════════════════════════════════════════════════════ */}
        {activeTab === 'orders' && (
          <div>
            {/* Filter Pills */}
            <div className="tg-segmented-tabs">
              <button
                className={`tg-tab-btn ${txFilter === 'all' ? 'active' : ''}`}
                onClick={() => { setTxFilter('all'); haptic.tap(); }}
              >
                {t.allOrders} ({orders.length})
              </button>
              <button
                className={`tg-tab-btn ${txFilter === 'delivered' ? 'active' : ''}`}
                onClick={() => { setTxFilter('delivered'); haptic.tap(); }}
              >
                🟢 {t.deliveredOrders} ({orders.filter(o => o.status === 'fulfilled' || o.status === 'delivered').length})
              </button>
              <button
                className={`tg-tab-btn ${txFilter === 'pending' ? 'active' : ''}`}
                onClick={() => { setTxFilter('pending'); haptic.tap(); }}
              >
                🟡 {t.pendingOrders} ({orders.filter(o => o.status === 'pending_approval' || o.status === 'awaiting_payment').length})
              </button>
            </div>

            {filteredOrders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--tg-text-secondary)' }}>
                <PackageIcon size={48} color="var(--tg-text-muted)" />
                <h3 style={{ fontWeight: 800, color: '#FFFFFF', fontSize: '17px', marginTop: '14px', marginBottom: '6px' }}>
                  {t.noOrders}
                </h3>
                <p style={{ fontSize: '13.5px', color: 'var(--tg-text-secondary)', marginBottom: '22px', maxWidth: '300px', margin: '0 auto 22px auto' }}>
                  {t.noOrdersDesc}
                </p>
                <button
                  className="btn-tg-primary"
                  style={{ maxWidth: '240px', margin: '0 auto' }}
                  onClick={() => setActiveTab('catalog')}
                >
                  <ShoppingBagIcon size={18} />
                  <span>{t.catalog}</span>
                </button>
              </div>
            ) : (
              <div className="order-cards-stack">
                {filteredOrders.map((ord) => {
                  const isDelivered = ord.status === 'fulfilled' || ord.status === 'delivered';
                  const isReview = ord.status === 'pending_approval';
                  const isRejected = ord.status === 'rejected';
                  const isStars = ord.product_id?.includes('stars');
                  const isPrem = ord.product_id?.includes('premium');

                  return (
                    <div
                      key={ord.id}
                      className="order-item-card"
                      onClick={() => openOrderDetail(ord)}
                    >
                      <div className="order-card-top">
                        <div className="order-card-left">
                          <div className={`order-avatar-wrap ${isStars ? 'stars' : isPrem ? 'premium' : 'gemini'}`}>
                            {isStars && <StarsBrandIcon size={22} />}
                            {isPrem && <TelegramBrandIcon size={22} />}
                            {!isStars && !isPrem && <GeminiBrandIcon size={22} />}
                          </div>
                          <div>
                            <div className="order-title-text">
                              {isStars ? 'Telegram Stars' : isPrem ? 'Telegram Premium' : 'Gemini Pro (18M)'}
                            </div>
                            <div className="order-meta-text">
                              Order #{ord.id} · {new Date(ord.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>

                        {/* Color-Coded Status Pill */}
                        <div>
                          {isDelivered && <span className="status-pill-delivered">🟢 {t.statusDelivered}</span>}
                          {isReview && <span className="status-pill-review">🟡 {t.statusPendingApproval}</span>}
                          {isRejected && <span className="status-pill-rejected">🔴 {t.statusRejected}</span>}
                          {!isDelivered && !isReview && !isRejected && <span className="status-pill-awaiting">🔵 {t.statusAwaitingPayment}</span>}
                        </div>
                      </div>

                      <div className="order-card-bottom">
                        <span className="order-amount-text">
                          {ord.amount_etb?.toLocaleString()} ETB ({ord.payment_rail?.toUpperCase()})
                        </span>
                        <span style={{ fontSize: '12px', color: 'var(--tg-electric-blue)', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 700 }}>
                          <span>{t.viewDetails}</span>
                          <ChevronRightIcon size={13} />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
           TAB 3: SUPPORT & HELP (1-Tap Support, Chat, FAQs, Referrals)
           ═══════════════════════════════════════════════════════════ */}
        {activeTab === 'support' && (
          <div>
            {/* Hero Direct 1-Tap Support Card */}
            <div className="support-hero-card">
              <div className="support-icon-wrap">
                <MessageCircleIcon size={32} color="#FFFFFF" />
              </div>
              <h2 style={{ fontSize: '19px', fontWeight: 800, color: '#FFFFFF', marginBottom: '6px' }}>
                {t.needHelp}
              </h2>
              <p style={{ color: 'var(--tg-text-secondary)', fontSize: '13px', lineHeight: 1.5, margin: '0 0 18px 0' }}>
                {t.supportDesc}
              </p>
              <button
                className="btn-tg-primary"
                onClick={() => {
                  const supportUrl = `https://t.me/${data?.settings.support_username || 'Vweah'}`;
                  if (window.Telegram?.WebApp?.openTelegramLink) {
                    window.Telegram.WebApp.openTelegramLink(supportUrl);
                  } else {
                    window.open(supportUrl, '_blank');
                  }
                }}
              >
                <TelegramBrandIcon size={20} />
                <span>{t.contactSupport}</span>
              </button>
            </div>

            {/* Helpful FAQs */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '14px', fontWeight: 800, color: '#FFFFFF', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <HelpCircleIcon size={18} color="var(--tg-electric-blue)" />
                <span>{t.faqTitle}</span>
              </div>

              <div className="faq-card-group">
                <div className="faq-item-card">
                  <div className="faq-question">⏱️ {t.faq1Q}</div>
                  <div className="faq-answer">{t.faq1A}</div>
                </div>

                <div className="faq-item-card">
                  <div className="faq-question">👑 {t.faq2Q}</div>
                  <div className="faq-answer">{t.faq2A}</div>
                </div>

                <div className="faq-item-card">
                  <div className="faq-question">🤖 {t.faq3Q}</div>
                  <div className="faq-answer">{t.faq3A}</div>
                </div>

                <div className="faq-item-card">
                  <div className="faq-question">💬 {t.faq4Q}</div>
                  <div className="faq-answer">{t.faq4A}</div>
                </div>
              </div>
            </div>

            {/* In-App Live Support Chat Box */}
            <div className="store-product-card" style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '14.5px', fontWeight: 800, color: '#FFFFFF', marginBottom: '12px' }}>
                {t.supportChatTitle}
              </div>

              <div role="log" aria-live="polite" style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px', paddingRight: '4px' }}>
                {supportMsgs.length === 0 ? (
                  <div style={{ color: 'var(--tg-text-muted)', fontSize: '12.5px', textAlign: 'center', padding: '16px' }}>
                    {t.supportChatEmpty}
                  </div>
                ) : (
                  supportMsgs.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: m.sender_role === 'user' ? 'flex-end' : 'flex-start',
                        background: m.sender_role === 'user' ? 'var(--tg-blue)' : 'var(--tg-bg-card-secondary)',
                        color: '#FFFFFF',
                        padding: '8px 12px',
                        borderRadius: '12px',
                        fontSize: '13px',
                        maxWidth: '85%',
                        lineHeight: 1.4,
                      }}
                    >
                      {m.body}
                    </div>
                  ))
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={supportInput}
                  onChange={(e) => setSupportInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleSendSupport(); }}
                  placeholder={t.supportPlaceholder}
                  style={{ flex: 1, background: 'var(--tg-bg-input)', border: '1px solid var(--tg-line)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: '#FFFFFF', fontSize: '13.5px' }}
                />
                <button
                  className="btn-tg-primary"
                  style={{ width: 'auto', padding: '0 18px', height: '44px', minHeight: '44px', fontSize: '13.5px' }}
                  onClick={handleSendSupport}
                  disabled={!supportInput.trim()}
                >
                  {t.send}
                </button>
              </div>
            </div>

            {/* Referral Hub Card */}
            <div className="store-product-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <GiftIcon size={20} color="var(--tg-gold)" />
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>{t.referTitle}</h3>
              </div>

              {referralInfo ? (
                <>
                  <p style={{ fontSize: '13px', color: 'var(--tg-text-secondary)', marginBottom: '12px' }}>
                    {t.referRate.replace('{pct}', String(referralInfo.commissionRatePct))}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <code style={{ background: 'var(--tg-bg-input)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', flex: 1, color: '#FFFFFF', fontFamily: 'monospace', fontSize: '13px' }}>
                      {referralInfo.code}
                    </code>
                    <button
                      className="btn-tg-primary"
                      style={{ width: 'auto', padding: '0 16px', height: '40px', minHeight: '40px', fontSize: '13px' }}
                      onClick={() => copyToClipboard(`https://t.me/Bighabesha_shopBot?start=ref_${referralInfo.code}`, 'refcode')}
                    >
                      {copiedKey === 'refcode' ? t.copied : <><CopyIcon size={13} /> Copy</>}
                    </button>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--tg-green)', fontWeight: 700 }}>
                    {t.referStats
                      .replace('{users}', String(referralInfo.referredUsers))
                      .replace('{balance}', referralInfo.balanceEtb.toLocaleString('en-US'))}
                  </div>
                </>
              ) : (
                <button
                  className="btn-tg-secondary"
                  onClick={() => {
                    fetchReferralsApi().then((r) => { setReferralInfo(r); haptic.tap(); }).catch(() => {});
                  }}
                >
                  {t.referLoad}
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ═══════════════════════════════════════════════════════════
         STEP-BY-STEP GUIDED CHECKOUT WIZARD (Slide-up Sheet)
         ═══════════════════════════════════════════════════════════ */}
      {checkoutModalOpen && pendingCheckoutItem && (
        <div className="modal-backdrop" onClick={() => setCheckoutModalOpen(false)}>
          <div className="checkout-sheet" role="dialog" aria-modal="true" aria-labelledby="checkout-wizard-title" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />

            <div className="sheet-header">
              <span id="checkout-wizard-title" className="sheet-title">
                {wizardStep === 1 && t.step1Method}
                {wizardStep === 2 && t.step2Transfer}
                {wizardStep === 3 && t.step3Receipt}
                {wizardStep === 4 && t.paymentSubmittedTitle}
              </span>
              <button className="sheet-close-btn" onClick={() => setCheckoutModalOpen(false)} aria-label="Close dialog">
                <CloseIcon size={18} />
              </button>
            </div>

            {/* 3-Step Guided Progress Header */}
            {wizardStep <= 3 && (
              <div className="wizard-progress-bar">
                <div className="wizard-connector-line" />
                <div className={`wizard-step-item ${wizardStep === 1 ? 'active' : wizardStep > 1 ? 'completed' : ''}`}>
                  <div className="wizard-step-bubble">{wizardStep > 1 ? '✓' : '1'}</div>
                  <span className="wizard-step-label">{t.step1}</span>
                </div>
                <div className={`wizard-step-item ${wizardStep === 2 ? 'active' : wizardStep > 2 ? 'completed' : ''}`}>
                  <div className="wizard-step-bubble">{wizardStep > 2 ? '✓' : '2'}</div>
                  <span className="wizard-step-label">{t.step2}</span>
                </div>
                <div className={`wizard-step-item ${wizardStep === 3 ? 'active' : ''}`}>
                  <div className="wizard-step-bubble">3</div>
                  <span className="wizard-step-label">{t.step3}</span>
                </div>
              </div>
            )}

            {/* Selected Product Summary Box */}
            {wizardStep <= 3 && (
              <div className="wizard-order-summary">
                <div>
                  <div className="wizard-product-name">{pendingCheckoutItem.productName}</div>
                  <div style={{ fontSize: '12px', color: 'var(--tg-text-secondary)' }}>
                    Recipient: @{data?.user?.username || data?.user?.firstName || 'Telegram User'}
                  </div>
                </div>
                <div>
                  <div className="wizard-product-price">
                    {checkoutOrder ? `${checkoutOrder.amount_etb?.toLocaleString()} ETB` : `${pendingCheckoutItem.amountETB.toLocaleString()} ETB`}
                  </div>
                  {displayCurrency !== 'ETB' && (
                    <div style={{ fontSize: '11px', color: 'var(--tg-text-secondary)', textAlign: 'right' }}>
                      {fmt(checkoutOrder ? checkoutOrder.amount_etb : pendingCheckoutItem.amountETB)}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ───────────────────────────────────────────────────────
               STEP 1: Choose How to Pay
               ─────────────────────────────────────────────────────── */}
            {wizardStep === 1 && (
              <div>
                <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--tg-text-secondary)', marginBottom: '10px' }}>
                  {t.selectPaymentOption}
                </div>

                <div className="payment-methods-stack" role="radiogroup" aria-label="Payment method choices">
                  {/* Telebirr */}
                  <div
                    className={`payment-method-card ${selectedRail === 'telebirr' ? 'selected' : ''}`}
                    onClick={() => { setSelectedRail('telebirr'); haptic.tap(); }}
                  >
                    <div className="method-card-left">
                      <div className="method-icon-wrap telebirr"><PaymentTelebirrIcon size={24} /></div>
                      <div>
                        <div className="method-card-title">{t.telebirrMobile}</div>
                        <div className="method-card-subtitle">{t.telebirrDesc}</div>
                      </div>
                    </div>
                    <div className="method-radio-circle">
                      {selectedRail === 'telebirr' && <CheckIcon size={12} color="#FFFFFF" />}
                    </div>
                  </div>

                  {/* CBE Bank */}
                  <div
                    className={`payment-method-card ${selectedRail === 'cbe' ? 'selected' : ''}`}
                    onClick={() => { setSelectedRail('cbe'); haptic.tap(); }}
                  >
                    <div className="method-card-left">
                      <div className="method-icon-wrap cbe"><PaymentCbeIcon size={24} /></div>
                      <div>
                        <div className="method-card-title">{t.cbeBank}</div>
                        <div className="method-card-subtitle">{t.cbeDesc}</div>
                      </div>
                    </div>
                    <div className="method-radio-circle">
                      {selectedRail === 'cbe' && <CheckIcon size={12} color="#FFFFFF" />}
                    </div>
                  </div>

                  {/* Bank of Abyssinia */}
                  <div
                    className={`payment-method-card ${selectedRail === 'abyssinia' ? 'selected' : ''}`}
                    onClick={() => { setSelectedRail('abyssinia'); haptic.tap(); }}
                  >
                    <div className="method-card-left">
                      <div className="method-icon-wrap abyssinia"><PaymentAbyssiniaIcon size={24} /></div>
                      <div>
                        <div className="method-card-title">{t.abyssiniaBank}</div>
                        <div className="method-card-subtitle">{t.abyssiniaDesc}</div>
                      </div>
                    </div>
                    <div className="method-radio-circle">
                      {selectedRail === 'abyssinia' && <CheckIcon size={12} color="#FFFFFF" />}
                    </div>
                  </div>

                  {/* TON / Crypto */}
                  <div
                    className={`payment-method-card ${selectedRail === 'ton' ? 'selected' : ''}`}
                    onClick={() => { setSelectedRail('ton'); haptic.tap(); }}
                  >
                    <div className="method-card-left">
                      <div className="method-icon-wrap ton"><TONDiamondIcon size={24} /></div>
                      <div>
                        <div className="method-card-title">{t.walletPayCrypto}</div>
                        <div className="method-card-subtitle">{t.tonDesc}</div>
                      </div>
                    </div>
                    <div className="method-radio-circle">
                      {selectedRail === 'ton' && <CheckIcon size={12} color="#FFFFFF" />}
                    </div>
                  </div>

                  {/* Telegram Stars */}
                  <div
                    className={`payment-method-card ${selectedRail === 'stars' ? 'selected' : ''}`}
                    onClick={() => { setSelectedRail('stars'); haptic.tap(); }}
                  >
                    <div className="method-card-left">
                      <div className="method-icon-wrap stars"><StarsBrandIcon size={24} /></div>
                      <div>
                        <div className="method-card-title">{t.starsNative}</div>
                        <div className="method-card-subtitle">{t.starsNativeDesc}</div>
                      </div>
                    </div>
                    <div className="method-radio-circle">
                      {selectedRail === 'stars' && <CheckIcon size={12} color="#FFFFFF" />}
                    </div>
                  </div>
                </div>

                {/* Promo Code Input */}
                <div style={{ marginBottom: '16px' }}>
                  <input
                    type="text"
                    placeholder={t.promoPlaceholder}
                    value={promoCodeInput}
                    onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                    style={{ width: '100%', background: 'var(--tg-bg-input)', border: '1px solid var(--tg-line)', borderRadius: 'var(--radius-md)', padding: '12px 14px', color: '#FFFFFF', fontSize: '13.5px', boxSizing: 'border-box' }}
                  />
                </div>

                <button
                  className="btn-tg-primary"
                  disabled={submittingOrder}
                  onClick={handleProceedToTransfer}
                >
                  <span>{submittingOrder ? t.submitting : t.nextTransfer}</span>
                </button>
              </div>
            )}

            {/* ───────────────────────────────────────────────────────
               STEP 2: Send Payment (1-Tap Copy Bank Details)
               ─────────────────────────────────────────────────────── */}
            {wizardStep === 2 && checkoutOrder && (
              <div>
                <div className="bank-transfer-container">
                  {/* Telebirr Details */}
                  {selectedRail === 'telebirr' && (
                    <div className="bank-transfer-card">
                      <div className="bank-transfer-header">
                        <div className="bank-badge-title">
                          <PaymentTelebirrIcon size={24} />
                          <span>Telebirr Mobile Money</span>
                        </div>
                      </div>
                      <div className="bank-account-big">
                        {data?.settings.telebirr_account || '0912345678'}
                      </div>
                      <button
                        className={`bank-copy-account-btn ${copiedKey === 'acc' ? 'copied' : ''}`}
                        onClick={() => copyToClipboard(data?.settings.telebirr_account || '0912345678', 'acc')}
                      >
                        {copiedKey === 'acc' ? <><CheckIcon size={16} /> {t.copied}</> : <><CopyIcon size={16} /> {t.copyAccount}</>}
                      </button>
                      <div className="bank-holder-info">
                        <span>{t.accountName}: <strong>{data?.settings.telebirr_name || 'Bighabesha Shop'}</strong></span>
                        <span>{t.exactAmountToSend}: <strong style={{ color: 'var(--tg-electric-blue)' }}>{checkoutOrder.amount_etb?.toLocaleString()} ETB</strong></span>
                      </div>
                    </div>
                  )}

                  {/* CBE Details */}
                  {selectedRail === 'cbe' && (
                    <div className="bank-transfer-card">
                      <div className="bank-transfer-header">
                        <div className="bank-badge-title">
                          <PaymentCbeIcon size={24} />
                          <span>Commercial Bank of Ethiopia (CBE)</span>
                        </div>
                      </div>
                      <div className="bank-account-big">
                        {data?.settings.cbe_account || '1000123456789'}
                      </div>
                      <button
                        className={`bank-copy-account-btn ${copiedKey === 'acc' ? 'copied' : ''}`}
                        onClick={() => copyToClipboard(data?.settings.cbe_account || '1000123456789', 'acc')}
                      >
                        {copiedKey === 'acc' ? <><CheckIcon size={16} /> {t.copied}</> : <><CopyIcon size={16} /> {t.copyAccount}</>}
                      </button>
                      <div className="bank-holder-info">
                        <span>{t.accountName}: <strong>{data?.settings.cbe_name || 'Bighabesha Shop'}</strong></span>
                        <span>{t.exactAmountToSend}: <strong style={{ color: 'var(--tg-electric-blue)' }}>{checkoutOrder.amount_etb?.toLocaleString()} ETB</strong></span>
                      </div>
                    </div>
                  )}

                  {/* Abyssinia Details */}
                  {selectedRail === 'abyssinia' && (
                    <div className="bank-transfer-card">
                      <div className="bank-transfer-header">
                        <div className="bank-badge-title">
                          <PaymentAbyssiniaIcon size={24} />
                          <span>Bank of Abyssinia</span>
                        </div>
                      </div>
                      <div className="bank-account-big">
                        {data?.settings.abyssinia_account || '123456789'}
                      </div>
                      <button
                        className={`bank-copy-account-btn ${copiedKey === 'acc' ? 'copied' : ''}`}
                        onClick={() => copyToClipboard(data?.settings.abyssinia_account || '123456789', 'acc')}
                      >
                        {copiedKey === 'acc' ? <><CheckIcon size={16} /> {t.copied}</> : <><CopyIcon size={16} /> {t.copyAccount}</>}
                      </button>
                      <div className="bank-holder-info">
                        <span>{t.accountName}: <strong>{data?.settings.abyssinia_name || 'Bighabesha Shop'}</strong></span>
                        <span>{t.exactAmountToSend}: <strong style={{ color: 'var(--tg-electric-blue)' }}>{checkoutOrder.amount_etb?.toLocaleString()} ETB</strong></span>
                      </div>
                    </div>
                  )}

                  {/* TON Connect Wallet Pay */}
                  {(selectedRail === 'ton' || selectedRail === 'stars') && (
                    <div className="bank-transfer-card">
                      <div className="bank-transfer-header">
                        <div className="bank-badge-title">
                          <TONDiamondIcon size={24} />
                          <span>TON Connect & Crypto Treasury</span>
                        </div>
                      </div>
                      {data.tonTreasury ? (
                        <div style={{ marginBottom: '14px' }}>
                          <TonPayButton
                            orderId={checkoutOrder.id}
                            amountEtb={checkoutOrder.amount_etb}
                            rates={{
                              etbPerUsd: parseFloat(data.settings.etb_per_usd || '135') || 135,
                              tonUsd: data.cryptoRates?.tonUsd || 3.5,
                            }}
                            treasuryAddress={data.tonTreasury}
                            onVerified={() => {
                              setWizardStep(4);
                              haptic.success();
                            }}
                          />
                          <div style={{ fontSize: '12px', color: 'var(--tg-text-secondary)', textAlign: 'center', marginTop: '6px' }}>
                            Treasury: {data.tonTreasury.slice(0, 8)}...{data.tonTreasury.slice(-8)}
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '13px', color: 'var(--tg-text-secondary)', padding: '12px 0' }}>
                          Please contact support for direct crypto settlement.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Transfer Note Alert with 1-Tap Username Copy */}
                  <div className="transfer-note-alert">
                    <AlertCircleIcon size={20} color="var(--tg-orange)" style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      <strong>{t.importantNote}:</strong> {t.putUsernameInNote}
                      {data?.user?.username && (
                        <div>
                          <button
                            type="button"
                            className="copy-username-pill"
                            onClick={() => copyToClipboard(`@${data.user?.username}`, 'username')}
                          >
                            {copiedKey === 'username' ? t.copied : <><CopyIcon size={12} /> {t.copyUsername} (@{data.user.username})</>}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    className="btn-tg-secondary"
                    style={{ flex: '0 0 100px' }}
                    onClick={() => setWizardStep(1)}
                  >
                    {t.back}
                  </button>
                  <button
                    className="btn-tg-primary"
                    style={{ flex: 1 }}
                    onClick={() => { setWizardStep(3); haptic.tap(); }}
                  >
                    <span>{t.nextReceipt}</span>
                  </button>
                </div>
              </div>
            )}

            {/* ───────────────────────────────────────────────────────
               STEP 3: Attach Receipt & Finish
               ─────────────────────────────────────────────────────── */}
            {wizardStep === 3 && checkoutOrder && (
              <div>
                <div className="receipt-dropzone-card">
                  <label style={{ cursor: 'pointer', display: 'block' }}>
                    <CameraIcon size={38} color="var(--tg-electric-blue)" style={{ margin: '0 auto 8px auto' }} />
                    <div style={{ fontSize: '15px', fontWeight: 800, color: '#FFFFFF' }}>{t.tapToUpload}</div>
                    <div style={{ fontSize: '12.5px', color: 'var(--tg-text-secondary)', marginTop: '4px' }}>
                      {t.tapToUploadSub}
                    </div>
                    <input type="file" accept="image/*" onChange={handleReceiptFileChange} className="sr-only-input" />
                  </label>

                  {receiptBase64 && (
                    <div className="receipt-preview-box">
                      <img src={receiptBase64} alt="Receipt preview" className="receipt-preview-img" />
                      <div>
                        <button
                          type="button"
                          className="receipt-remove-btn"
                          onClick={(e) => { e.stopPropagation(); setReceiptBase64(''); }}
                        >
                          {t.removeImage}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <input
                    type="text"
                    placeholder={t.paymentNotePlaceholder}
                    value={receiptNote}
                    onChange={(e) => setReceiptNote(e.target.value)}
                    style={{ width: '100%', background: 'var(--tg-bg-input)', border: '1px solid var(--tg-line)', borderRadius: 'var(--radius-md)', padding: '12px 14px', color: '#FFFFFF', fontSize: '13.5px', boxSizing: 'border-box' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    className="btn-tg-secondary"
                    style={{ flex: '0 0 100px' }}
                    onClick={() => setWizardStep(2)}
                  >
                    {t.back}
                  </button>
                  <button
                    className="btn-tg-primary"
                    style={{ flex: 1 }}
                    disabled={uploadingReceipt || !receiptBase64}
                    onClick={handleSubmitReceipt}
                  >
                    <span>{uploadingReceipt ? t.submitting : t.submitAndTrack}</span>
                  </button>
                </div>
              </div>
            )}

            {/* ───────────────────────────────────────────────────────
               STEP 4: Success Screen
               ─────────────────────────────────────────────────────── */}
            {wizardStep === 4 && checkoutOrder && (
              <div className="wizard-success-card">
                <div className="success-check-circle">
                  <CheckIcon size={38} color="var(--tg-green)" />
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: 900, color: '#FFFFFF', marginBottom: '8px' }}>
                  {t.paymentSubmittedTitle}
                </h3>
                <p style={{ fontSize: '13.5px', color: 'var(--tg-text-secondary)', lineHeight: 1.5, marginBottom: '22px' }}>
                  {t.paymentSubmittedDesc.replace('{id}', checkoutOrder.id)}
                </p>

                <button
                  className="btn-tg-primary"
                  onClick={() => {
                    setCheckoutModalOpen(false);
                    setActiveTab('orders');
                    openOrderDetail(checkoutOrder);
                  }}
                >
                  <PackageIcon size={18} />
                  <span>{t.viewOrderStatus}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Order Detail Modal ────────────────────────────────────── */}
      {selectedDetailOrder && (
        <div className="modal-backdrop" onClick={() => setSelectedDetailOrder(null)}>
          <div className="checkout-sheet" role="dialog" aria-modal="true" aria-labelledby="order-detail-sheet-title" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span id="order-detail-sheet-title" className="sheet-title">Order #{selectedDetailOrder.id}</span>
              <button className="sheet-close-btn" onClick={() => setSelectedDetailOrder(null)} aria-label="Close dialog">
                <CloseIcon size={18} />
              </button>
            </div>

            <div style={{ background: 'var(--tg-bg-card-secondary)', padding: '14px 16px', borderRadius: 'var(--radius-md)', marginBottom: '16px', fontSize: '13.5px', lineHeight: 1.6 }}>
              <div>Product: <strong>{selectedDetailOrder.product_id?.replace(/_/g, ' ').toUpperCase()}</strong></div>
              <div>Amount: <strong style={{ color: 'var(--tg-electric-blue)' }}>{selectedDetailOrder.amount_etb?.toLocaleString()} ETB</strong> ({selectedDetailOrder.payment_rail?.toUpperCase()})</div>
              <div>Status: <strong>{selectedDetailOrder.status?.toUpperCase()}</strong></div>
            </div>

            {/* Visual Timeline */}
            <OrderTimeline order={selectedDetailOrder} events={detailEvents} />

            {/* Activation Link Box if delivered */}
            {selectedDetailOrder.fulfillment_payload && (
              <div style={{ background: 'var(--tg-green-dim)', border: '1.5px solid var(--tg-green)', padding: '16px', borderRadius: 'var(--radius-md)', margin: '16px 0' }}>
                <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--tg-green)', marginBottom: '6px' }}>
                  {t.activationLink}:
                </div>
                <code style={{ wordBreak: 'break-all', display: 'block', fontSize: '13px', color: '#FFFFFF', marginBottom: '12px', background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '8px' }}>
                  {selectedDetailOrder.fulfillment_payload}
                </code>
                <button
                  className="btn-tg-primary"
                  style={{ height: '44px', minHeight: '44px', fontSize: '13.5px' }}
                  onClick={() => copyToClipboard(selectedDetailOrder.fulfillment_payload || '', 'link')}
                >
                  {copiedKey === 'link' ? t.copied : <><CopyIcon size={14} /> {t.copyLink}</>}
                </button>
              </div>
            )}

            <button
              className="btn-tg-secondary"
              style={{ marginTop: '12px' }}
              onClick={() => setSelectedDetailOrder(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── Username Gate Modal ───────────────────────────────────── */}
      {gateOpen && (
        <div className="modal-backdrop" onClick={() => setGateOpen(false)}>
          <div className="checkout-sheet" role="dialog" aria-modal="true" aria-labelledby="username-gate-title" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span id="username-gate-title" className="sheet-title">{t.usernameRequiredTitle}</span>
              <button className="sheet-close-btn" onClick={() => setGateOpen(false)} aria-label="Close dialog">
                <CloseIcon size={18} />
              </button>
            </div>
            <p style={{ color: 'var(--tg-text-secondary)', fontSize: '13.5px', marginBottom: '18px', lineHeight: 1.5 }}>
              {t.usernameRequiredDesc}
            </p>
            <button
              className="btn-tg-primary"
              onClick={async () => {
                haptic.tap();
                try {
                  const res = await recheckUsernameApi();
                  if (res.user && res.user.username) {
                    setData((prev) => ({
                      ...prev,
                      user: {
                        ...res.user,
                        username: res.user.username || undefined,
                      },
                    }));
                    setGateOpen(false);
                    haptic.success();
                  } else {
                    haptic.warn();
                    alert('Username not detected yet. Please save a public username in your Telegram Settings and tap recheck.');
                  }
                } catch {
                  setGateOpen(false);
                }
              }}
            >
              {t.recheckUsername}
            </button>
          </div>
        </div>
      )}

      {/* ── Bottom Navigation Tab Bar ─────────────────────────────── */}
      <nav className="bottom-nav">
        <div className="nav-bar-container">
          <button
            className={`nav-tab-item ${activeTab === 'catalog' ? 'active' : ''}`}
            onClick={() => { setActiveTab('catalog'); haptic.tap(); }}
            aria-label={t.catalog}
          >
            <ShoppingBagIcon size={22} />
            <span>{t.catalog}</span>
          </button>
          <button
            className={`nav-tab-item ${activeTab === 'orders' ? 'active' : ''}`}
            onClick={() => { setActiveTab('orders'); haptic.tap(); }}
            aria-label={t.myOrders}
          >
            <PackageIcon size={22} />
            <span>{t.myOrders}</span>
          </button>
          <button
            className={`nav-tab-item ${activeTab === 'support' ? 'active' : ''}`}
            onClick={() => { setActiveTab('support'); haptic.tap(); }}
            aria-label={t.support}
          >
            <MessageCircleIcon size={22} />
            <span>{t.support}</span>
          </button>
        </div>
      </nav>
    </div>
  );
};

export default App;
