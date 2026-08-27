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
  GlobeIcon,
  CloseIcon,
  GiftIcon,
  TierShieldGoldIcon,
  TierShieldSilverIcon,
  TierShieldBronzeIcon,
  ETBCurrencyIcon,
  TONDiamondIcon,
  USDCoinIcon,
  PaymentCbeIcon,
  TelegramBrandIcon,
  AlertCircleIcon,
  RefreshIcon,
  CameraIcon,
  ChevronRightIcon,
  VerifiedBadge3DIcon,
  GeminiPro3DIcon,
  ReferralMoney3DIcon,
  SupportAgent3DIcon,
  LocalPaymentGroupBadge,
} from './components/Icons.tsx';
import { formatMoney, type DisplayCurrency } from './utils.ts';
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
      id: 'telegram_premium',
      type: 'order',
      name: 'Telegram Premium',
      description: 'Official Fragment direct gift to @username without password or credentials.',
      is_active: 1,
      meta: '{}',
      variants: [
        { id: 'tg_prem_3m', product_id: 'telegram_premium', name: '3 Months', price_etb: 1100, is_active: 1, sort_order: 1 },
        { id: 'tg_prem_6m', product_id: 'telegram_premium', name: '6 Months', price_etb: 1900, is_active: 1, sort_order: 2 },
        { id: 'tg_prem_12m', product_id: 'telegram_premium', name: '12 Months', price_etb: 3400, is_active: 1, sort_order: 3 },
      ],
      availableStock: null,
    },
    {
      id: 'gemini_pro_18m',
      type: 'stock',
      name: 'Gemini Pro (18 Months)',
      description: 'Google AI Suite + 2TB Google Cloud Storage. Instant activation link.',
      is_active: 1,
      meta: '{}',
      variants: [
        { id: 'gemini_pro_18m_default', product_id: 'gemini_pro_18m', name: '18 Months Access', price_etb: 1500, is_active: 1, sort_order: 1 },
      ],
      availableStock: 5,
    },
  ],
  settings: {
    cbe_account: '1000123456789',
    cbe_name: 'Bighabesha Shop',
    telebirr_account: '0912345678',
    telebirr_name: 'Bighabesha Shop',
    abyssinia_account: '123456789',
    abyssinia_name: 'Bighabesha Shop',
    support_username: 'Vweah',
  },
  cryptoRates: {
    tonUsd: 1.45,
    usdtUsd: 1.0,
  },
};

function getLoyaltyInfo(user: BootstrapData['user'], orders: OrderItem[]) {
  const lifetimeSpent =
    user?.lifetimeEtb ??
    orders
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
    perk = 'Direct Telegram Delivery';
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
      <React.Suspense
        fallback={
          <div
            style={{
              minHeight: '100vh',
              background: '#0C121C',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94A3B8',
              fontSize: '14px',
            }}
          >
            Loading Admin Console...
          </div>
        }
      >
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

  const [activeTab, setActiveTab] = useState<'catalog' | 'orders' | 'profile'>('catalog');
  const [txFilter, setTxFilter] = useState<'all' | 'delivered' | 'pending'>('all');
  const [data, setData] = useState<BootstrapData>(DEFAULT_BOOTSTRAP);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);

  // Active Product Variant Drawer
  const [selectedProductDrawer, setSelectedProductDrawer] = useState<'telegram_premium' | 'gemini_pro_18m' | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('tg_prem_3m');
  const [recipientUsername, setRecipientUsername] = useState<string>('');

  // Other Modal Drawers
  const [referralDrawerOpen, setReferralDrawerOpen] = useState<boolean>(false);
  const [supportDrawerOpen, setSupportDrawerOpen] = useState<boolean>(false);

  // Payment Selection Sheet
  type PaymentRail = 'telebirr' | 'cbe' | 'abyssinia' | 'ton';
  interface PendingCheckoutItem {
    productId: string;
    variantId?: string;
    amountETB: number;
    productName: string;
    recipient: string;
  }

  const [gateOpen, setGateOpen] = useState(false);
  const [pendingCheckoutItem, setPendingCheckoutItem] = useState<PendingCheckoutItem | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentStep, setPaymentStep] = useState<1 | 2 | 3>(1); // 1: Select Method, 2: Transfer Details / Upload, 3: Success
  const [selectedPaymentRail, setSelectedPaymentRail] = useState<PaymentRail>('telebirr');
  const [paymentTypeGroup, setPaymentTypeGroup] = useState<'local' | 'crypto'>('local');
  const [checkoutOrder, setCheckoutOrder] = useState<OrderItem | null>(null);
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
      if (res.user?.username && !recipientUsername) {
        setRecipientUsername(res.user.username);
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
        (window.Telegram.WebApp as any).setHeaderColor?.('#0C121C');
        (window.Telegram.WebApp as any).setBackgroundColor?.('#0C121C');
      } catch {}
    }
    loadData();
    fetchSupportMessages()
      .then((res) => setSupportMsgs(res.messages || []))
      .catch(() => {});

    const handleOnline = () => {
      setIsOnline(true);
      haptic.success();
    };
    const handleOffline = () => {
      setIsOnline(false);
      haptic.warn();
    };
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
        else if (paymentModalOpen) setPaymentModalOpen(false);
        else if (selectedProductDrawer) setSelectedProductDrawer(null);
        else if (referralDrawerOpen) setReferralDrawerOpen(false);
        else if (supportDrawerOpen) setSupportDrawerOpen(false);
        else if (gateOpen) setGateOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDetailOrder, paymentModalOpen, selectedProductDrawer, referralDrawerOpen, supportDrawerOpen, gateOpen]);

  const hasUsername = Boolean(data?.user?.username && data.user.username.trim().length > 0);

  const fmt = (etb: number): string => {
    return formatMoney(etb, displayCurrency, {
      etbPerUsd: parseFloat(data?.settings.etb_per_usd || '135') || 135,
      tonUsd: data?.cryptoRates?.tonUsd || 3.5,
    });
  };

  // Open Product Drawer
  const openProductModal = (productId: 'telegram_premium' | 'gemini_pro_18m') => {
    haptic.tap();
    if (productId === 'telegram_premium' && !hasUsername && !recipientUsername) {
      setGateOpen(true);
      return;
    }
    setSelectedProductDrawer(productId);
    if (productId === 'telegram_premium') {
      setSelectedVariantId('tg_prem_3m');
    } else {
      setSelectedVariantId('gemini_pro_18m_default');
    }
  };

  // Proceed from Variant Selection to Payment Selection
  const handleProceedToPayment = () => {
    if (!selectedProductDrawer) return;
    haptic.tap();

    const prod = data.products.find((p) => p.id === selectedProductDrawer);
    if (!prod) return;

    const variant = prod.variants.find((v) => v.id === selectedVariantId) || prod.variants[0];
    const amount = variant?.price_etb || (selectedProductDrawer === 'gemini_pro_18m' ? 1500 : 1100);

    setPendingCheckoutItem({
      productId: selectedProductDrawer,
      variantId: variant?.id,
      amountETB: amount,
      productName: prod.name,
      recipient: recipientUsername || data?.user?.username || 'Telegram User',
    });

    setSelectedProductDrawer(null);
    setPaymentStep(1);
    setPaymentTypeGroup('local');
    setSelectedPaymentRail('telebirr');
    setPaymentModalOpen(true);
  };

  // Step 1 -> Step 2: Initialize Order & Show Bank Transfer / TON
  const handleConfirmPaymentMethod = async () => {
    if (!pendingCheckoutItem) return;
    haptic.tap();
    setSubmittingOrder(true);
    try {
      const railToUse = paymentTypeGroup === 'crypto' ? 'ton' : selectedPaymentRail;
      const res = await createOrderApi({
        productId: pendingCheckoutItem.productId,
        paymentRail: railToUse,
        variantId: pendingCheckoutItem.variantId,
        promoCode: promoCodeInput.trim() || undefined,
      });

      if (res.order) {
        setCheckoutOrder(res.order);
        setOrders((prev) => [res.order, ...prev.filter((o) => o.id !== res.order.id)]);
        setPaymentStep(2);
        haptic.success();
      }
    } catch (err: any) {
      haptic.error();
      alert(err.message || 'Failed to initialize order.');
    } finally {
      setSubmittingOrder(false);
    }
  };

  // Step 2 -> Step 3: Submit Receipt Slip
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
      setPaymentStep(3); // Success Screen
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

  const filteredOrders = orders.filter((o) => {
    if (txFilter === 'delivered') return o.status === 'fulfilled' || o.status === 'delivered';
    if (txFilter === 'pending')
      return o.status === 'pending_approval' || o.status === 'awaiting_payment' || o.status === 'pending_fulfillment';
    return true;
  });

  const premProd = data.products.find((p) => p.id === 'telegram_premium');
  const geminiProd = data.products.find((p) => p.id === 'gemini_pro_18m');
  const loyalty = getLoyaltyInfo(data?.user, orders);

  return (
    <div className="app-frame">
      {/* ── Top Minimalist Navigation Bar ─────────────────────────── */}
      <header className="top-nav">
        <div className="brand-section">
          <LogoIcon size={26} />
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
            <span>{lang === 'en' ? 'አማ' : 'EN'}</span>
          </button>

          {/* User Profile Badge */}
          <div className="user-badge-header" title={`Tier: ${loyalty.tier.toUpperCase()}`}>
            {loyalty.tier === 'gold' && <TierShieldGoldIcon size={15} />}
            {loyalty.tier === 'silver' && <TierShieldSilverIcon size={15} />}
            {loyalty.tier === 'bronze' && <TierShieldBronzeIcon size={15} />}
            <span>{data?.user?.username ? `@${data.user.username}` : data?.user?.firstName || 'Guest'}</span>
          </div>
        </div>
      </header>

      {/* ── Main Screen View ──────────────────────────────────────── */}
      <main className="page-content">
        {!isOnline && (
          <div className="offline-banner" role="status" aria-live="polite">
            <AlertCircleIcon size={16} color="var(--tg-gold)" />
            <span>{t.offlineBanner}</span>
          </div>
        )}

        {errorMessage && (
          <div
            style={{
              background: 'var(--tg-red-dim)',
              border: '1px solid var(--tg-red)',
              padding: '12px 14px',
              borderRadius: 'var(--radius-md)',
              marginBottom: '16px',
              color: '#FCA5A5',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>{errorMessage}</span>
            <button className="lang-switch-btn" style={{ fontSize: '11.5px', padding: '2px 8px', height: '26px' }} onClick={loadData}>
              <RefreshIcon size={12} /> {t.retry}
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
           TAB 1: SHOP (HuluPay-Inspired Minimalist Categorized Deck)
           ═══════════════════════════════════════════════════════════ */}
        {activeTab === 'catalog' && (
          <div>
            {isLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="skeleton" style={{ height: '80px', borderRadius: '18px' }} />
                <div className="skeleton" style={{ height: '84px', borderRadius: '18px' }} />
                <div className="skeleton" style={{ height: '84px', borderRadius: '18px' }} />
                <div className="skeleton" style={{ height: '84px', borderRadius: '18px' }} />
              </div>
            ) : (
              <>
                {/* HuluPay Style Minimalist Hero Header */}
                <div className="hulupay-hero-header">
                  <div className="hulupay-hero-illustration">
                    <ReferralMoney3DIcon size={64} />
                  </div>
                  <div>
                    <h1 className="hulupay-hero-title">
                      BigHabesha
                      <span className="hulupay-shopping-pill">SHOPPING TIME</span>
                    </h1>
                    <p className="hulupay-hero-subtitle">
                      Buy <span style={{ color: '#38BDF8', fontWeight: 800 }}>#Telegram</span> Premium and{' '}
                      <span style={{ color: '#A78BFA', fontWeight: 800 }}>#AI</span> Subscriptions
                    </p>
                  </div>
                </div>

                {/* ── Category 1: TELEGRAM SERVICES ── */}
                <div className="section-category-header">TELEGRAM SERVICES</div>
                <div className="hulupay-card-deck">
                  {premProd && (
                    <div className="hulupay-product-card" onClick={() => openProductModal('telegram_premium')}>
                      <div className="hulupay-card-icon-wrap">
                        <VerifiedBadge3DIcon size={48} />
                      </div>
                      <div className="hulupay-card-content">
                        <div className="hulupay-card-title-row">
                          <span className="hulupay-card-title">{premProd.name}</span>
                          <span className="hulupay-badge blue">GET VERIFIED</span>
                        </div>
                        <p className="hulupay-card-desc">
                          Get a Verified Blue Check badge & upgrade your Telegram experience instantly.
                        </p>
                      </div>
                      <ChevronRightIcon size={16} color="#64748B" />
                    </div>
                  )}
                </div>

                {/* ── Category 2: AI & CLOUD SERVICES ── */}
                <div className="section-category-header">AI & CLOUD SERVICES</div>
                <div className="hulupay-card-deck">
                  {geminiProd && (
                    <div className="hulupay-product-card" onClick={() => openProductModal('gemini_pro_18m')}>
                      <div className="hulupay-card-icon-wrap">
                        <GeminiPro3DIcon size={48} />
                      </div>
                      <div className="hulupay-card-content">
                        <div className="hulupay-card-title-row">
                          <span className="hulupay-card-title">Gemini Pro (18 Months)</span>
                          <span className="hulupay-badge purple">2TB STORAGE</span>
                        </div>
                        <p className="hulupay-card-desc">
                          Google Advanced AI Suite + 2TB Google Cloud Storage. One-click instant activation link.
                        </p>
                      </div>
                      <ChevronRightIcon size={16} color="#64748B" />
                    </div>
                  )}
                </div>

                {/* ── Category 3: INSTANT REWARDS ── */}
                <div className="section-category-header">INSTANT REWARDS</div>
                <div className="hulupay-card-deck">
                  <div
                    className="hulupay-product-card"
                    onClick={() => {
                      haptic.tap();
                      fetchReferralsApi()
                        .then((r) => setReferralInfo(r))
                        .catch(() => {});
                      setReferralDrawerOpen(true);
                    }}
                  >
                    <div className="hulupay-card-icon-wrap">
                      <ReferralMoney3DIcon size={48} />
                    </div>
                    <div className="hulupay-card-content">
                      <div className="hulupay-card-title-row">
                        <span className="hulupay-card-title">Refer and Earn Money</span>
                        <span className="hulupay-badge green">NEW</span>
                      </div>
                      <p className="hulupay-card-desc">
                        Earn 5% L1 + 1% L2 commission from every transaction made by your friend.
                      </p>
                    </div>
                    <ChevronRightIcon size={16} color="#64748B" />
                  </div>
                </div>

                {/* ── Category 4: GET HELP ── */}
                <div className="section-category-header">GET HELP</div>
                <div className="hulupay-card-deck">
                  <div
                    className="hulupay-product-card"
                    onClick={() => {
                      haptic.tap();
                      setSupportDrawerOpen(true);
                    }}
                  >
                    <div className="hulupay-card-icon-wrap">
                      <SupportAgent3DIcon size={48} />
                    </div>
                    <div className="hulupay-card-content">
                      <div className="hulupay-card-title-row">
                        <span className="hulupay-card-title">24/7 Live Support</span>
                        <span className="hulupay-badge blue">ONLINE</span>
                      </div>
                      <p className="hulupay-card-desc">
                        Need assistance with payment verification or orders? Chat with our support team.
                      </p>
                    </div>
                    <ChevronRightIcon size={16} color="#64748B" />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
           TAB 2: MY ORDERS (Simplified & Clean)
           ═══════════════════════════════════════════════════════════ */}
        {activeTab === 'orders' && (
          <div>
            <div className="tg-segmented-tabs" style={{ marginBottom: '16px' }}>
              <button className={`tg-tab-btn ${txFilter === 'all' ? 'active' : ''}`} onClick={() => setTxFilter('all')}>
                {t.allOrders} ({orders.length})
              </button>
              <button
                className={`tg-tab-btn ${txFilter === 'delivered' ? 'active' : ''}`}
                onClick={() => setTxFilter('delivered')}
              >
                🟢 Delivered ({orders.filter((o) => o.status === 'fulfilled' || o.status === 'delivered').length})
              </button>
              <button
                className={`tg-tab-btn ${txFilter === 'pending' ? 'active' : ''}`}
                onClick={() => setTxFilter('pending')}
              >
                🟡 Pending ({orders.filter((o) => o.status === 'pending_approval' || o.status === 'awaiting_payment').length})
              </button>
            </div>

            {filteredOrders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 16px', color: '#94A3B8' }}>
                <PackageIcon size={48} color="#64748B" />
                <h3 style={{ fontWeight: 800, color: '#FFFFFF', fontSize: '17px', marginTop: '14px', marginBottom: '6px' }}>
                  {t.noOrders}
                </h3>
                <p style={{ fontSize: '13.5px', color: '#94A3B8', marginBottom: '22px' }}>{t.noOrdersDesc}</p>
                <button
                  className="hulupay-btn-action"
                  style={{ maxWidth: '220px', margin: '0 auto' }}
                  onClick={() => setActiveTab('catalog')}
                >
                  <ShoppingBagIcon size={18} />
                  <span>{t.catalog}</span>
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {filteredOrders.map((ord) => {
                  const isDelivered = ord.status === 'fulfilled' || ord.status === 'delivered';
                  const isReview = ord.status === 'pending_approval';
                  const isRejected = ord.status === 'rejected';
                  const isPrem = ord.product_id?.includes('premium');

                  return (
                    <div
                      key={ord.id}
                      className="hulupay-product-card"
                      style={{ padding: '14px 16px' }}
                      onClick={() => openOrderDetail(ord)}
                    >
                      <div className="hulupay-card-icon-wrap" style={{ width: '40px', height: '40px' }}>
                        {isPrem ? <VerifiedBadge3DIcon size={38} /> : <GeminiPro3DIcon size={38} />}
                      </div>
                      <div className="hulupay-card-content">
                        <div className="hulupay-card-title-row">
                          <span className="hulupay-card-title" style={{ fontSize: '14.5px' }}>
                            {isPrem ? 'Telegram Premium' : 'Gemini Pro 18M'}
                          </span>
                          {isDelivered && <span className="hulupay-badge green">DELIVERED</span>}
                          {isReview && <span className="hulupay-badge blue">PENDING APPROVAL</span>}
                          {isRejected && <span className="hulupay-badge discount">REJECTED</span>}
                        </div>
                        <div style={{ fontSize: '12px', color: '#94A3B8', display: 'flex', justifyContent: 'space-between' }}>
                          <span>Order #{ord.id}</span>
                          <strong style={{ color: '#38BDF8' }}>{ord.amount_etb?.toLocaleString()} ETB</strong>
                        </div>
                      </div>
                      <ChevronRightIcon size={14} color="#64748B" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
           TAB 3: PROFILE & REWARDS
           ═══════════════════════════════════════════════════════════ */}
        {activeTab === 'profile' && (
          <div>
            {/* VIP Loyalty Card */}
            <div
              style={{
                background: 'linear-gradient(135deg, #151F2C 0%, #1E2B3D 100%)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '20px',
                padding: '20px',
                marginBottom: '16px',
                boxShadow: '0 4px 18px rgba(0, 0, 0, 0.3)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '50%',
                      background: '#2563EB',
                      color: '#FFFFFF',
                      fontSize: '16px',
                      fontWeight: 900,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {data?.user?.firstName?.[0] || 'U'}
                  </div>
                  <div>
                    <h2 style={{ fontSize: '16px', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
                      {data?.user?.firstName || 'Telegram User'}
                    </h2>
                    <span style={{ fontSize: '12px', color: '#94A3B8' }}>
                      {data?.user?.username ? `@${data.user.username}` : 'No username'}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 10px',
                    borderRadius: '8px',
                    background:
                      loyalty.tier === 'gold'
                        ? 'rgba(245, 158, 11, 0.2)'
                        : loyalty.tier === 'silver'
                        ? 'rgba(148, 163, 184, 0.2)'
                        : 'rgba(217, 119, 6, 0.2)',
                    color:
                      loyalty.tier === 'gold'
                        ? '#FBBF24'
                        : loyalty.tier === 'silver'
                        ? '#E2E8F0'
                        : '#FDBA74',
                    border: '1px solid rgba(255,255,255,0.1)',
                    fontSize: '11.5px',
                    fontWeight: 800,
                  }}
                >
                  {loyalty.tier === 'gold' && <TierShieldGoldIcon size={14} />}
                  {loyalty.tier === 'silver' && <TierShieldSilverIcon size={14} />}
                  {loyalty.tier === 'bronze' && <TierShieldBronzeIcon size={14} />}
                  <span>{loyalty.tier.toUpperCase()} VIP</span>
                </div>
              </div>

              <div style={{ fontSize: '12.5px', color: '#94A3B8', marginBottom: '8px' }}>
                Lifetime Spend: <strong style={{ color: '#FFFFFF' }}>{loyalty.lifetimeSpent.toLocaleString()} ETB</strong>
              </div>
              <div style={{ background: '#0C121C', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${loyalty.progressPct}%`, background: '#38BDF8', height: '100%' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748B', marginTop: '6px' }}>
                <span>VIP Progress: {loyalty.progressPct}%</span>
                <span>Next Tier: {loyalty.nextTier}</span>
              </div>
            </div>

            {/* Referral Hub Card */}
            <div className="hulupay-product-card" style={{ marginBottom: '14px' }}>
              <div className="hulupay-card-icon-wrap">
                <ReferralMoney3DIcon size={44} />
              </div>
              <div className="hulupay-card-content">
                <span className="hulupay-card-title" style={{ fontSize: '15px' }}>Referral Rewards</span>
                <p className="hulupay-card-desc" style={{ marginTop: '2px' }}>
                  Share your link with friends and receive 5% cash rewards on every order.
                </p>
                <button
                  className="hulupay-btn-action"
                  style={{ height: '38px', minHeight: '38px', fontSize: '12.5px', marginTop: '10px' }}
                  onClick={() => {
                    fetchReferralsApi()
                      .then((r) => setReferralInfo(r))
                      .catch(() => {});
                    setReferralDrawerOpen(true);
                  }}
                >
                  <GiftIcon size={14} />
                  <span>View Referral Code</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ═══════════════════════════════════════════════════════════
         PRODUCT VARIANT DRAWER (Image 2 HuluPay Minimalist Sheet)
         ═══════════════════════════════════════════════════════════ */}
      {selectedProductDrawer && (
        <div className="hulupay-sheet-backdrop" onClick={() => setSelectedProductDrawer(null)}>
          <div className="hulupay-sheet-container" onClick={(e) => e.stopPropagation()}>
            <div className="hulupay-sheet-header">
              <span className="hulupay-sheet-title">
                {selectedProductDrawer === 'telegram_premium' ? 'Premium.' : 'Gemini Pro.'}
              </span>
              <button className="hulupay-sheet-close-btn" onClick={() => setSelectedProductDrawer(null)} aria-label="Close">
                <CloseIcon size={16} />
              </button>
            </div>

            {/* Choose Recipient Section (ONLY for Telegram Premium) */}
            {selectedProductDrawer === 'telegram_premium' && (
              <>
                <div className="hulupay-section-label">Choose recipient</div>
                <div className="hulupay-recipient-box">
                  <div className="hulupay-recipient-avatar">
                    {recipientUsername?.[0]?.toUpperCase() || '@'}
                  </div>
                  <input
                    type="text"
                    className="hulupay-recipient-input"
                    placeholder="@username"
                    value={recipientUsername}
                    onChange={(e) => setRecipientUsername(e.target.value.replace(/^@/, ''))}
                  />
                </div>
              </>
            )}

            {/* Variant Cards List */}
            <div className="hulupay-variants-list">
              {selectedProductDrawer === 'telegram_premium' && (
                <>
                  <div
                    className={`hulupay-variant-card ${selectedVariantId === 'tg_prem_3m' ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedVariantId('tg_prem_3m');
                      haptic.tap();
                    }}
                  >
                    <div className="hulupay-variant-left">
                      <span className="hulupay-variant-name">For 3 Months</span>
                      <span className="hulupay-badge discount" style={{ width: 'fit-content' }}>
                        20% off
                      </span>
                    </div>
                    <div className="hulupay-variant-right">
                      <span className="hulupay-variant-price">{fmt(1100)}</span>
                      <div className="hulupay-radio-dot">
                        {selectedVariantId === 'tg_prem_3m' && <CheckIcon size={11} color="#FFFFFF" />}
                      </div>
                    </div>
                  </div>

                  <div
                    className={`hulupay-variant-card ${selectedVariantId === 'tg_prem_6m' ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedVariantId('tg_prem_6m');
                      haptic.tap();
                    }}
                  >
                    <div className="hulupay-variant-left">
                      <span className="hulupay-variant-name">For 6 Months</span>
                      <span className="hulupay-badge discount" style={{ width: 'fit-content' }}>
                        47% off
                      </span>
                    </div>
                    <div className="hulupay-variant-right">
                      <span className="hulupay-variant-price">{fmt(1900)}</span>
                      <div className="hulupay-radio-dot">
                        {selectedVariantId === 'tg_prem_6m' && <CheckIcon size={11} color="#FFFFFF" />}
                      </div>
                    </div>
                  </div>

                  <div
                    className={`hulupay-variant-card ${selectedVariantId === 'tg_prem_12m' ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedVariantId('tg_prem_12m');
                      haptic.tap();
                    }}
                  >
                    <div className="hulupay-variant-left">
                      <span className="hulupay-variant-name">For 12 Months</span>
                      <span className="hulupay-badge discount" style={{ width: 'fit-content' }}>
                        51% off
                      </span>
                    </div>
                    <div className="hulupay-variant-right">
                      <span className="hulupay-variant-price">{fmt(3400)}</span>
                      <div className="hulupay-radio-dot">
                        {selectedVariantId === 'tg_prem_12m' && <CheckIcon size={11} color="#FFFFFF" />}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {selectedProductDrawer === 'gemini_pro_18m' && (
                <div
                  className={`hulupay-variant-card ${selectedVariantId === 'gemini_pro_18m_default' ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedVariantId('gemini_pro_18m_default');
                    haptic.tap();
                  }}
                >
                  <div className="hulupay-variant-left">
                    <span className="hulupay-variant-name">For 18 Months</span>
                    <span className="hulupay-badge purple" style={{ width: 'fit-content' }}>
                      2TB CLOUD STORAGE
                    </span>
                  </div>
                  <div className="hulupay-variant-right">
                    <span className="hulupay-variant-price">{fmt(1500)}</span>
                    <div className="hulupay-radio-dot">
                      {selectedVariantId === 'gemini_pro_18m_default' && <CheckIcon size={11} color="#FFFFFF" />}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Promo Code Input */}
            <div style={{ marginBottom: '16px' }}>
              <input
                type="text"
                placeholder={t.promoPlaceholder}
                value={promoCodeInput}
                onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                style={{
                  width: '100%',
                  background: '#0E1622',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '14px',
                  padding: '12px 14px',
                  color: '#FFFFFF',
                  fontSize: '13.5px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Order Action Button */}
            <button className="hulupay-btn-action" onClick={handleProceedToPayment}>
              <span>
                {selectedProductDrawer === 'telegram_premium' ? 'Order Telegram Premium' : 'Order Gemini Pro (18M)'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
         PAYMENT SELECTION SHEET (Image 1 HuluPay Minimalist Sheet)
         ═══════════════════════════════════════════════════════════ */}
      {paymentModalOpen && pendingCheckoutItem && (
        <div className="hulupay-sheet-backdrop" onClick={() => setPaymentModalOpen(false)}>
          <div className="hulupay-sheet-container" onClick={(e) => e.stopPropagation()}>
            <div className="hulupay-sheet-header">
              <div>
                <span className="hulupay-sheet-title">{paymentStep === 1 ? 'Pay with' : 'Payment Details'}</span>
                {paymentStep === 1 && (
                  <div style={{ fontSize: '13px', color: '#94A3B8', marginTop: '2px' }}>How would you like to pay?</div>
                )}
              </div>
              <button className="hulupay-sheet-close-btn" onClick={() => setPaymentModalOpen(false)} aria-label="Close">
                <CloseIcon size={16} />
              </button>
            </div>

            {/* Step 1: Choose Payment Method */}
            {paymentStep === 1 && (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '22px' }}>
                  {/* Local Payment Card */}
                  <div
                    className={`hulupay-variant-card ${paymentTypeGroup === 'local' ? 'active' : ''}`}
                    onClick={() => {
                      setPaymentTypeGroup('local');
                      haptic.tap();
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div className="hulupay-radio-dot">
                        {paymentTypeGroup === 'local' && <CheckIcon size={11} color="#FFFFFF" />}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <PaymentCbeIcon size={22} />
                        <span className="hulupay-variant-name">Local payment</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="hulupay-badge blue">NEW</span>
                      <LocalPaymentGroupBadge />
                    </div>
                  </div>

                  {/* Sub-Selection for Local Rails */}
                  {paymentTypeGroup === 'local' && (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: '8px',
                        padding: '10px',
                        background: '#0E1622',
                        borderRadius: '14px',
                      }}
                    >
                      <button
                        className={`lang-switch-btn ${selectedPaymentRail === 'telebirr' ? 'active' : ''}`}
                        style={{
                          height: '38px',
                          justifyContent: 'center',
                          border: selectedPaymentRail === 'telebirr' ? '1.5px solid #38BDF8' : '1px solid rgba(255,255,255,0.08)',
                          background: selectedPaymentRail === 'telebirr' ? 'rgba(2, 132, 199, 0.2)' : 'transparent',
                          color: '#FFFFFF',
                        }}
                        onClick={() => {
                          setSelectedPaymentRail('telebirr');
                          haptic.tap();
                        }}
                      >
                        Telebirr
                      </button>
                      <button
                        className={`lang-switch-btn ${selectedPaymentRail === 'cbe' ? 'active' : ''}`}
                        style={{
                          height: '38px',
                          justifyContent: 'center',
                          border: selectedPaymentRail === 'cbe' ? '1.5px solid #38BDF8' : '1px solid rgba(255,255,255,0.08)',
                          background: selectedPaymentRail === 'cbe' ? 'rgba(2, 132, 199, 0.2)' : 'transparent',
                          color: '#FFFFFF',
                        }}
                        onClick={() => {
                          setSelectedPaymentRail('cbe');
                          haptic.tap();
                        }}
                      >
                        CBE Birr
                      </button>
                      <button
                        className={`lang-switch-btn ${selectedPaymentRail === 'abyssinia' ? 'active' : ''}`}
                        style={{
                          height: '38px',
                          justifyContent: 'center',
                          border: selectedPaymentRail === 'abyssinia' ? '1.5px solid #38BDF8' : '1px solid rgba(255,255,255,0.08)',
                          background: selectedPaymentRail === 'abyssinia' ? 'rgba(2, 132, 199, 0.2)' : 'transparent',
                          color: '#FFFFFF',
                        }}
                        onClick={() => {
                          setSelectedPaymentRail('abyssinia');
                          haptic.tap();
                        }}
                      >
                        Abyssinia
                      </button>
                    </div>
                  )}

                  {/* Crypto Payment Card (TON Connect) */}
                  <div
                    className={`hulupay-variant-card ${paymentTypeGroup === 'crypto' ? 'active' : ''}`}
                    onClick={() => {
                      setPaymentTypeGroup('crypto');
                      haptic.tap();
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div className="hulupay-radio-dot">
                        {paymentTypeGroup === 'crypto' && <CheckIcon size={11} color="#FFFFFF" />}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <TONDiamondIcon size={22} />
                        <span className="hulupay-variant-name">Crypto payment (TON / USDT)</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <USDCoinIcon size={18} />
                    </div>
                  </div>
                </div>

                <button className="hulupay-btn-action" disabled={submittingOrder} onClick={handleConfirmPaymentMethod}>
                  <span>{submittingOrder ? 'Processing...' : 'Pay Now'}</span>
                </button>
              </div>
            )}

            {/* Step 2: Transfer Details & Slip Upload */}
            {paymentStep === 2 && checkoutOrder && (
              <div>
                <div style={{ background: '#0E1622', padding: '16px', borderRadius: '16px', marginBottom: '16px' }}>
                  {paymentTypeGroup === 'local' ? (
                    <>
                      <div style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '6px' }}>
                        Bank / Account Name: <strong>{data?.settings?.[`${selectedPaymentRail}_name` as keyof typeof data.settings] || 'Bighabesha Shop'}</strong>
                      </div>
                      <div style={{ fontSize: '20px', fontWeight: 900, color: '#FFFFFF', letterSpacing: '1px', marginBottom: '10px' }}>
                        {data?.settings?.[`${selectedPaymentRail}_account` as keyof typeof data.settings] || '1000123456789'}
                      </div>
                      <button
                        className="hulupay-btn-action"
                        style={{ height: '40px', minHeight: '40px', fontSize: '13px', marginBottom: '12px' }}
                        onClick={() =>
                          copyToClipboard(
                            data?.settings?.[`${selectedPaymentRail}_account` as keyof typeof data.settings] || '1000123456789',
                            'acc'
                          )
                        }
                      >
                        {copiedKey === 'acc' ? <><CheckIcon size={14} /> Copied</> : <><CopyIcon size={14} /> Copy Account Number</>}
                      </button>
                      <div style={{ fontSize: '13px', color: '#38BDF8', fontWeight: 800 }}>
                        Exact Amount: {checkoutOrder.amount_etb?.toLocaleString()} ETB
                      </div>
                    </>
                  ) : (
                    <div>
                      {data.tonTreasury ? (
                        <TonPayButton
                          orderId={checkoutOrder.id}
                          amountEtb={checkoutOrder.amount_etb}
                          rates={{
                            etbPerUsd: parseFloat(data.settings.etb_per_usd || '135') || 135,
                            tonUsd: data.cryptoRates?.tonUsd || 3.5,
                          }}
                          treasuryAddress={data.tonTreasury}
                          onVerified={() => {
                            setPaymentStep(3);
                            haptic.success();
                          }}
                        />
                      ) : (
                        <div style={{ fontSize: '13px', color: '#94A3B8' }}>Please contact support for TON settlement.</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Slip Upload Box */}
                {paymentTypeGroup === 'local' && (
                  <>
                    <div className="receipt-dropzone-card" style={{ marginBottom: '16px' }}>
                      <label style={{ cursor: 'pointer', display: 'block' }}>
                        <CameraIcon size={34} color="#38BDF8" style={{ margin: '0 auto 8px auto' }} />
                        <div style={{ fontSize: '14.5px', fontWeight: 800, color: '#FFFFFF' }}>Attach Transfer Receipt</div>
                        <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '2px' }}>
                          Upload mobile banking screenshot or SMS confirmation
                        </div>
                        <input type="file" accept="image/*" onChange={handleReceiptFileChange} className="sr-only-input" />
                      </label>
                      {receiptBase64 && (
                        <div className="receipt-preview-box">
                          <img src={receiptBase64} alt="Receipt preview" className="receipt-preview-img" />
                          <button
                            type="button"
                            className="receipt-remove-btn"
                            onClick={() => setReceiptBase64('')}
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                      <input
                        type="text"
                        placeholder={t.paymentNotePlaceholder}
                        value={receiptNote}
                        onChange={(e) => setReceiptNote(e.target.value)}
                        style={{
                          width: '100%',
                          background: '#0E1622',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: '14px',
                          padding: '12px 14px',
                          color: '#FFFFFF',
                          fontSize: '13px',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>

                    <button
                      className="hulupay-btn-action"
                      disabled={uploadingReceipt || !receiptBase64}
                      onClick={handleSubmitReceipt}
                    >
                      <span>{uploadingReceipt ? 'Submitting...' : 'Submit & Track Order'}</span>
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Step 3: Success Screen */}
            {paymentStep === 3 && checkoutOrder && (
              <div style={{ textAlign: 'center', padding: '20px 10px' }}>
                <div
                  style={{
                    width: '60px',
                    height: '60px',
                    borderRadius: '50%',
                    background: 'rgba(16, 185, 129, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px auto',
                  }}
                >
                  <CheckIcon size={32} color="#10B981" />
                </div>
                <h3 style={{ fontSize: '19px', fontWeight: 900, color: '#FFFFFF', marginBottom: '6px' }}>
                  Payment Submitted!
                </h3>
                <p style={{ fontSize: '13px', color: '#94A3B8', lineHeight: 1.5, marginBottom: '20px' }}>
                  Order #{checkoutOrder.id} is being processed. You will receive activation directly in your Telegram bot.
                </p>
                <button
                  className="hulupay-btn-action"
                  onClick={() => {
                    setPaymentModalOpen(false);
                    setActiveTab('orders');
                    openOrderDetail(checkoutOrder);
                  }}
                >
                  <PackageIcon size={16} />
                  <span>View Order Status</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Referral Drawer ───────────────────────────────────────── */}
      {referralDrawerOpen && (
        <div className="hulupay-sheet-backdrop" onClick={() => setReferralDrawerOpen(false)}>
          <div className="hulupay-sheet-container" onClick={(e) => e.stopPropagation()}>
            <div className="hulupay-sheet-header">
              <span className="hulupay-sheet-title">Referral Program</span>
              <button className="hulupay-sheet-close-btn" onClick={() => setReferralDrawerOpen(false)}>
                <CloseIcon size={16} />
              </button>
            </div>
            {referralInfo ? (
              <div>
                <p style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '14px', lineHeight: 1.5 }}>
                  Earn 5% Level 1 and 1% Level 2 lifetime commissions from every purchase made by your invited users.
                </p>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                  <code style={{ background: '#0E1622', padding: '12px', borderRadius: '12px', flex: 1, color: '#FFFFFF', fontSize: '13px' }}>
                    {referralInfo.code}
                  </code>
                  <button
                    className="hulupay-btn-action"
                    style={{ width: 'auto', padding: '0 16px', height: '42px', minHeight: '42px', fontSize: '13px' }}
                    onClick={() =>
                      copyToClipboard(
                        `https://t.me/${data?.settings.support_username || 'bighabesha_shopbot'}?start=ref_${referralInfo.code}`,
                        'ref'
                      )
                    }
                  >
                    {copiedKey === 'ref' ? 'Copied' : 'Copy Link'}
                  </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', background: '#0E1622', padding: '14px', borderRadius: '14px' }}>
                  <div>
                    <span style={{ fontSize: '11px', color: '#64748B' }}>INVITED USERS</span>
                    <div style={{ fontSize: '16px', fontWeight: 900, color: '#FFFFFF' }}>{referralInfo.referredUsers}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '11px', color: '#64748B' }}>EARNED BALANCE</span>
                    <div style={{ fontSize: '16px', fontWeight: 900, color: '#10B981' }}>{referralInfo.balanceEtb?.toLocaleString()} ETB</div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px', color: '#94A3B8' }}>Loading Referral Info...</div>
            )}
          </div>
        </div>
      )}

      {/* ── Support Drawer ────────────────────────────────────────── */}
      {supportDrawerOpen && (
        <div className="hulupay-sheet-backdrop" onClick={() => setSupportDrawerOpen(false)}>
          <div className="hulupay-sheet-container" onClick={(e) => e.stopPropagation()}>
            <div className="hulupay-sheet-header">
              <span className="hulupay-sheet-title">Customer Support</span>
              <button className="hulupay-sheet-close-btn" onClick={() => setSupportDrawerOpen(false)}>
                <CloseIcon size={16} />
              </button>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <p style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '12px' }}>
                Need instant assistance? Contact our team directly on Telegram:
              </p>
              <button
                className="hulupay-btn-action"
                onClick={() => {
                  const url = `https://t.me/${data?.settings.support_username || 'Vweah'}`;
                  if (window.Telegram?.WebApp?.openTelegramLink) {
                    window.Telegram.WebApp.openTelegramLink(url);
                  } else {
                    window.open(url, '_blank');
                  }
                }}
              >
                <TelegramBrandIcon size={18} />
                <span>Chat with @{data?.settings.support_username || 'Vweah'}</span>
              </button>
            </div>

            {/* In-app Message Log */}
            {supportMsgs.length > 0 && (
              <div
                style={{
                  maxHeight: '140px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  marginBottom: '12px',
                  background: '#0E1622',
                  padding: '10px',
                  borderRadius: '12px',
                }}
              >
                {supportMsgs.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: m.sender_role === 'user' ? 'flex-end' : 'flex-start',
                      background: m.sender_role === 'user' ? '#2563EB' : '#1A2433',
                      color: '#FFFFFF',
                      padding: '6px 10px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      maxWidth: '85%',
                    }}
                  >
                    {m.body}
                  </div>
                ))}
              </div>
            )}

            {/* In-app Message Box */}
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#FFFFFF', marginBottom: '8px' }}>Or send a message:</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={supportInput}
                onChange={(e) => setSupportInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSendSupport();
                }}
                placeholder="Type your message here..."
                style={{
                  flex: 1,
                  background: '#0E1622',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '12px',
                  padding: '10px 14px',
                  color: '#FFFFFF',
                  fontSize: '13px',
                }}
              />
              <button
                className="hulupay-btn-action"
                style={{ width: 'auto', padding: '0 16px', height: '42px', minHeight: '42px', fontSize: '13px' }}
                onClick={handleSendSupport}
                disabled={!supportInput.trim()}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Order Detail Modal ────────────────────────────────────── */}
      {selectedDetailOrder && (
        <div className="hulupay-sheet-backdrop" onClick={() => setSelectedDetailOrder(null)}>
          <div className="hulupay-sheet-container" onClick={(e) => e.stopPropagation()}>
            <div className="hulupay-sheet-header">
              <span className="hulupay-sheet-title">Order #{selectedDetailOrder.id}</span>
              <button className="hulupay-sheet-close-btn" onClick={() => setSelectedDetailOrder(null)}>
                <CloseIcon size={16} />
              </button>
            </div>

            <div style={{ background: '#0E1622', padding: '14px 16px', borderRadius: '16px', marginBottom: '16px', fontSize: '13.5px', lineHeight: 1.6 }}>
              <div>Product: <strong>{selectedDetailOrder.product_id?.replace(/_/g, ' ').toUpperCase()}</strong></div>
              <div>Amount: <strong style={{ color: '#38BDF8' }}>{selectedDetailOrder.amount_etb?.toLocaleString()} ETB</strong> ({selectedDetailOrder.payment_rail?.toUpperCase()})</div>
              <div>Status: <strong>{selectedDetailOrder.status?.toUpperCase()}</strong></div>
            </div>

            <OrderTimeline order={selectedDetailOrder} events={detailEvents} />

            {selectedDetailOrder.fulfillment_payload && (
              <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1.5px solid #10B981', padding: '14px', borderRadius: '14px', margin: '16px 0' }}>
                <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#10B981', marginBottom: '6px' }}>Activation Link:</div>
                <code style={{ wordBreak: 'break-all', display: 'block', fontSize: '12.5px', color: '#FFFFFF', marginBottom: '10px', background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '8px' }}>
                  {selectedDetailOrder.fulfillment_payload}
                </code>
                <button
                  className="hulupay-btn-action"
                  style={{ height: '40px', minHeight: '40px', fontSize: '13px' }}
                  onClick={() => copyToClipboard(selectedDetailOrder.fulfillment_payload || '', 'link')}
                >
                  {copiedKey === 'link' ? 'Copied' : 'Copy Activation Link'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Username Gate Modal ───────────────────────────────────── */}
      {gateOpen && (
        <div className="hulupay-sheet-backdrop" onClick={() => setGateOpen(false)}>
          <div className="hulupay-sheet-container" onClick={(e) => e.stopPropagation()}>
            <div className="hulupay-sheet-header">
              <span className="hulupay-sheet-title">{t.usernameRequiredTitle}</span>
              <button className="hulupay-sheet-close-btn" onClick={() => setGateOpen(false)}>
                <CloseIcon size={16} />
              </button>
            </div>
            <p style={{ color: '#94A3B8', fontSize: '13.5px', marginBottom: '18px', lineHeight: 1.5 }}>
              {t.usernameRequiredDesc}
            </p>
            <button
              className="hulupay-btn-action"
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
                    setRecipientUsername(res.user.username);
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

      {/* ── Bottom Docked Navigation Bar (Image 3 HuluPay Style) ── */}
      <nav className="hulupay-bottom-nav">
        <div className="hulupay-nav-container">
          <button
            className={`hulupay-nav-tab ${activeTab === 'catalog' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('catalog');
              haptic.tap();
            }}
          >
            <div className="hulupay-nav-icon-circle">
              <ShoppingBagIcon size={20} />
            </div>
            <span>Shop</span>
          </button>

          <button
            className={`hulupay-nav-tab ${activeTab === 'orders' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('orders');
              haptic.tap();
            }}
          >
            <div className="hulupay-nav-icon-circle">
              <PackageIcon size={20} />
            </div>
            <span>Orders</span>
          </button>

          <button
            className={`hulupay-nav-tab ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('profile');
              haptic.tap();
            }}
          >
            <div className="hulupay-nav-icon-circle">
              <TierShieldGoldIcon size={20} />
            </div>
            <span>Profile</span>
          </button>
        </div>
      </nav>
    </div>
  );
};

export default App;

