import React, { useState, useEffect } from 'react';
import {
  fetchBootstrap,
  fetchOrders,
  createOrderApi,
  submitReceiptApi,
  BootstrapData,
  OrderItem,
} from './api.ts';
import { translations, Language } from './i18n.ts';
import {
  LogoIcon,
  SparkleIcon,
  StarIcon,
  CoinIcon,
  CheckIcon,
  CopyIcon,
  ShieldCheckIcon,
  BankIcon,
  PhoneIcon,
  CryptoIcon,
  ShoppingBagIcon,
  PackageIcon,
  MessageCircleIcon,
  GlobeIcon,
  UploadCloudIcon,
  CloseIcon,
} from './components/Icons.tsx';
import './index.css';

const DEFAULT_BOOTSTRAP: BootstrapData = {
  user: null,
  products: [
    {
      id: 'gemini_pro_18m',
      type: 'stock',
      name: 'Gemini Pro (18 Months)',
      description: 'Google AI Suite + 2TB Google Cloud Storage. Instant automated delivery.',
      is_active: 1,
      meta: '{}',
      variants: [
        { id: 'gemini_pro_18m_default', product_id: 'gemini_pro_18m', name: '18 Months Access', price_etb: 1500, is_active: 1, sort_order: 1 }
      ],
      availableStock: 5
    },
    {
      id: 'telegram_premium',
      type: 'order',
      name: 'Telegram Premium',
      description: 'Official Fragment direct gift to @username without password.',
      is_active: 1,
      meta: '{}',
      variants: [
        { id: 'tg_prem_3m', product_id: 'telegram_premium', name: '3 Months Plan', price_etb: 1100, is_active: 1, sort_order: 1 },
        { id: 'tg_prem_6m', product_id: 'telegram_premium', name: '6 Months Plan', price_etb: 1850, is_active: 1, sort_order: 2 },
        { id: 'tg_prem_12m', product_id: 'telegram_premium', name: '12 Months Plan', price_etb: 3200, is_active: 1, sort_order: 3 }
      ],
      availableStock: null
    },
    {
      id: 'telegram_stars',
      type: 'order',
      name: 'Telegram Stars (Coins)',
      description: 'In-app currency for digital gifts, channel boosts, and bots.',
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
    }
  ],
  settings: {
    etb_per_star: '2.5',
    cbe_account: '1000510711258',
    cbe_name: 'Bighabesha Shop',
    telebirr_account: '0965579045',
    telebirr_name: 'Bighabesha Shop',
    abyssinia_account: 'Bank of Abyssinia',
    abyssinia_name: 'Bighabesha Shop',
    support_username: 'Vweah'
  },
  cryptoRates: {
    tonUsd: 1.45,
    usdtUsd: 1.0
  }
};

export const App: React.FC = () => {
  const [lang, setLang] = useState<Language>('en');
  const t = translations[lang];

  const [activeTab, setActiveTab] = useState<'catalog' | 'orders' | 'support'>('catalog');
  const [data, setData] = useState<BootstrapData>(DEFAULT_BOOTSTRAP);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Selections
  const [selectedPremiumVariant, setSelectedPremiumVariant] = useState<string>('tg_prem_3m');
  const [selectedStarsVariant, setSelectedStarsVariant] = useState<string>('tg_stars_100');
  const [customStarsCount, setCustomStarsCount] = useState<number>(500);
  const [isCustomStars, setIsCustomStars] = useState<boolean>(false);

  // Modals
  const [gateOpen, setGateOpen] = useState(false);
  const [checkoutOrder, setCheckoutOrder] = useState<OrderItem | null>(null);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [selectedRail, setSelectedRail] = useState<'cbe' | 'telebirr' | 'abyssinia' | 'stars' | 'wallet_pay'>('cbe');
  const [invoiceLink, setInvoiceLink] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [submittingOrder, setSubmittingOrder] = useState(false);

  // Receipt Upload & Copy Feedback
  const [receiptBase64, setReceiptBase64] = useState<string>('');
  const [receiptNote, setReceiptNote] = useState<string>('');
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [receiptSuccess, setReceiptSuccess] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Order Detail Modal
  const [selectedDetailOrder, setSelectedDetailOrder] = useState<OrderItem | null>(null);

  const triggerHaptic = () => {
    try {
      (window as any).Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium');
    } catch {}
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    triggerHaptic();
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const toggleLanguage = () => {
    const nextLang = lang === 'en' ? 'am' : 'en';
    setLang(nextLang);
    triggerHaptic();
  };

  const loadData = async () => {
    try {
      const res = await fetchBootstrap();
      setData(res);
      if (res.user?.languageCode?.startsWith('am')) {
        setLang('am');
      }
      const ords = await fetchOrders().catch(() => ({ orders: [] }));
      setOrders(ords.orders);
      setErrorMessage(null);
    } catch (err: any) {
      // Keep DEFAULT_BOOTSTRAP data active
      console.warn('Bootstrap fetch warning:', err);
    }
  };

  useEffect(() => {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
    }
    loadData();
  }, []);

  const hasUsername = Boolean(data?.user?.username && data.user.username.trim().length > 0);

  const handleStartPurchase = async (productId: string, variantId?: string, customStars?: number, amountETB?: number) => {
    triggerHaptic();

    if ((productId === 'telegram_premium' || productId === 'telegram_stars') && !hasUsername) {
      setGateOpen(true);
      return;
    }

    try {
      setSubmittingOrder(true);
      let calculatedAmount = amountETB || 0;

      if (productId === 'gemini_pro_18m') {
        const prod = data?.products.find((p) => p.id === productId);
        calculatedAmount = prod?.variants[0]?.price_etb || 1500;
        variantId = prod?.variants[0]?.id || 'gemini_pro_18m_default';
      } else if (productId === 'telegram_premium') {
        const v = data?.products.find((p) => p.id === productId)?.variants.find((v) => v.id === variantId);
        calculatedAmount = v?.price_etb || 1100;
      } else if (productId === 'telegram_stars') {
        if (customStars) {
          const etbPerStar = parseFloat(data?.settings.etb_per_star || '2.5');
          calculatedAmount = Math.ceil(customStars * etbPerStar);
        } else {
          const v = data?.products.find((p) => p.id === productId)?.variants.find((v) => v.id === variantId);
          calculatedAmount = v?.price_etb || 250;
        }
      }

      const res = await createOrderApi({
        productId,
        variantId,
        customStars,
        amountETB: calculatedAmount,
        paymentRail: selectedRail,
      });

      setCheckoutOrder(res.order);
      setInvoiceLink(res.invoiceLink || null);
      setPayUrl(res.payUrl || null);
      setReceiptSuccess(false);
      setReceiptBase64('');
      setReceiptNote('');
      setCheckoutModalOpen(true);
    } catch (err: any) {
      if (err.message === 'USERNAME_REQUIRED') {
        setGateOpen(true);
      } else {
        alert(err.message || 'Error creating order');
      }
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handlePayWithStars = () => {
    triggerHaptic();
    if (invoiceLink && window.Telegram?.WebApp?.openInvoice) {
      window.Telegram.WebApp.openInvoice(invoiceLink, (status) => {
        if (status === 'paid') {
          setCheckoutModalOpen(false);
          loadData();
          setActiveTab('orders');
        }
      });
    } else if (invoiceLink) {
      window.open(invoiceLink, '_blank');
    }
  };

  const handlePayWithWallet = () => {
    triggerHaptic();
    if (payUrl) {
      if (window.Telegram?.WebApp?.openTelegramLink) {
        window.Telegram.WebApp.openTelegramLink(payUrl);
      } else {
        window.open(payUrl, '_blank');
      }
    }
  };

  const handleReceiptFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setReceiptBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitReceipt = async () => {
    if (!checkoutOrder) return;
    try {
      setUploadingReceipt(true);
      triggerHaptic();
      await submitReceiptApi({
        orderId: checkoutOrder.id,
        receiptImageBase64: receiptBase64,
        note: receiptNote,
      });
      setReceiptSuccess(true);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to submit receipt');
    } finally {
      setUploadingReceipt(false);
    }
  };

  const geminiProd = data?.products.find((p) => p.id === 'gemini_pro_18m');
  const premProd = data?.products.find((p) => p.id === 'telegram_premium');
  const starsProd = data?.products.find((p) => p.id === 'telegram_stars');
  const etbPerStar = parseFloat(data?.settings.etb_per_star || '2.5');

  return (
    <div className="app-frame">
      {/* Top Navigation */}
      <header className="top-nav">
        <div className="brand-section">
          <LogoIcon size={28} />
          <span className="brand-title-text">{t.brandName}</span>
        </div>

        <div className="nav-actions">
          {/* Language Toggle */}
          <button className="lang-switch-btn" onClick={toggleLanguage}>
            <GlobeIcon size={14} />
            <span>{lang === 'en' ? 'አማርኛ' : 'English'}</span>
          </button>
          <div className="user-badge-header">
            {data?.user?.username ? `@${data.user.username}` : data?.user?.firstName || 'Guest'}
          </div>
        </div>
      </header>

      {/* Main Page Body */}
      <main className="page-content">
        {errorMessage && (
          <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--eth-red)', padding: '12px 14px', borderRadius: 'var(--radius-md)', marginBottom: '16px', color: '#FCA5A5', fontSize: '0.85rem' }}>
            {errorMessage}
          </div>
        )}

        {activeTab === 'catalog' && (
          <div>
            {/* Trust Assurance Banner */}
            <div className="trust-banner">
              <div className="trust-badge-icon">
                <ShieldCheckIcon size={24} color="#10B981" />
              </div>
              <div>
                <div className="trust-title">{t.officialStore}</div>
                <div className="trust-subtitle">{t.instantDelivery}</div>
              </div>
            </div>

            <div className="section-headline">{t.featuredProducts}</div>

            {/* 1. Gemini Pro 18m Card */}
            {geminiProd && (
              <div className="store-product-card">
                <div className="product-card-head">
                  <div className="product-identity">
                    <div className="product-avatar">
                      <SparkleIcon size={22} color="#FCDD09" />
                    </div>
                    <div>
                      <h3 className="product-card-title">{geminiProd.name}</h3>
                      <div className="product-card-subtitle">Google One AI Premium (18 Months)</div>
                    </div>
                  </div>
                  {geminiProd.availableStock && geminiProd.availableStock > 0 ? (
                    <span className="badge-pill-green">{geminiProd.availableStock} {t.inStock}</span>
                  ) : (
                    <span className="badge-pill-red">{t.soldOut}</span>
                  )}
                </div>

                <ul className="feature-checklist">
                  {t.geminiFeatures.map((feat, idx) => (
                    <li key={idx}>
                      <span className="feature-check-icon"><CheckIcon size={14} color="#10B981" /></span>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>

                <div className="price-display-banner">
                  <span className="price-main">1,500 ETB</span>
                  <span className="price-details">/ 18 Months (~83 ETB/mo)</span>
                </div>

                <button
                  className="btn-action-main"
                  disabled={!geminiProd.availableStock || geminiProd.availableStock <= 0 || submittingOrder}
                  onClick={() => handleStartPurchase('gemini_pro_18m')}
                >
                  {geminiProd.availableStock && geminiProd.availableStock > 0 ? `${t.buyNow} — 1,500 ETB` : t.soldOut}
                </button>
              </div>
            )}

            {/* 2. Telegram Premium Card */}
            {premProd && (
              <div className="store-product-card">
                <div className="product-card-head">
                  <div className="product-identity">
                    <div className="product-avatar">
                      <StarIcon size={22} color="#FCDD09" fill="#FCDD09" />
                    </div>
                    <div>
                      <h3 className="product-card-title">{premProd.name}</h3>
                      <div className="product-card-subtitle">Official Fragment Gift to @username</div>
                    </div>
                  </div>
                  <span className="badge-pill-green">Verified</span>
                </div>

                <ul className="feature-checklist">
                  {t.premiumFeatures.map((feat, idx) => (
                    <li key={idx}>
                      <span className="feature-check-icon"><CheckIcon size={14} color="#10B981" /></span>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>

                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px' }}>
                  {t.selectDuration}:
                </div>

                <div className="options-selector-grid">
                  {premProd.variants.map((v) => (
                    <div
                      key={v.id}
                      className={`option-box-pill ${selectedPremiumVariant === v.id ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedPremiumVariant(v.id);
                        triggerHaptic();
                      }}
                    >
                      <div className="option-pill-name">{v.name.replace(' Subscription', '').replace(' Plan', '')}</div>
                      <div className="option-pill-price">{v.price_etb.toLocaleString()} ETB</div>
                      {v.id === 'tg_prem_12m' && <div className="option-pill-save">Save 400 ETB</div>}
                    </div>
                  ))}
                </div>

                <button
                  className="btn-action-main"
                  disabled={submittingOrder}
                  onClick={() => handleStartPurchase('telegram_premium', selectedPremiumVariant)}
                >
                  {t.buyNow} — Telegram Premium
                </button>
              </div>
            )}

            {/* 3. Telegram Stars Card */}
            {starsProd && (
              <div className="store-product-card">
                <div className="product-card-head">
                  <div className="product-identity">
                    <div className="product-avatar">
                      <CoinIcon size={22} color="#38BDF8" />
                    </div>
                    <div>
                      <h3 className="product-card-title">{starsProd.name}</h3>
                      <div className="product-card-subtitle">1 Star = {etbPerStar} ETB</div>
                    </div>
                  </div>
                  <span className="badge-pill-green">Instant</span>
                </div>

                <ul className="feature-checklist">
                  {t.starsFeatures.map((feat, idx) => (
                    <li key={idx}>
                      <span className="feature-check-icon"><CheckIcon size={14} color="#10B981" /></span>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>

                {/* Preset Star Packages */}
                <div className="options-selector-grid">
                  {starsProd.variants.slice(0, 6).map((v) => (
                    <div
                      key={v.id}
                      className={`option-box-pill ${!isCustomStars && selectedStarsVariant === v.id ? 'selected' : ''}`}
                      onClick={() => {
                        setIsCustomStars(false);
                        setSelectedStarsVariant(v.id);
                        triggerHaptic();
                      }}
                    >
                      <div className="option-pill-name">{v.name}</div>
                      <div className="option-pill-price">{v.price_etb.toLocaleString()} ETB</div>
                    </div>
                  ))}
                </div>

                {/* Interactive Stars Calculator Slider */}
                <div className="stars-calculator-box">
                  <div className="calc-header">
                    <span className="calc-title">{t.starsCalculator}</span>
                    <span className="calc-price-total">{Math.ceil(customStarsCount * etbPerStar).toLocaleString()} ETB</span>
                  </div>

                  <input
                    type="range"
                    min="50"
                    max="5000"
                    step="50"
                    value={customStarsCount}
                    onChange={(e) => {
                      setIsCustomStars(true);
                      setCustomStarsCount(parseInt(e.target.value, 10));
                    }}
                    className="stars-slider"
                  />

                  {/* Preset quick chips */}
                  <div className="preset-stars-chips">
                    {[50, 100, 250, 500, 1000, 2500].map((count) => (
                      <span
                        key={count}
                        className={`star-chip ${isCustomStars && customStarsCount === count ? 'active' : ''}`}
                        onClick={() => {
                          setIsCustomStars(true);
                          setCustomStarsCount(count);
                          triggerHaptic();
                        }}
                      >
                        {count.toLocaleString()} Stars
                      </span>
                    ))}
                  </div>
                </div>

                <button
                  className="btn-action-main"
                  disabled={submittingOrder}
                  onClick={() => {
                    if (isCustomStars) {
                      handleStartPurchase('telegram_stars', undefined, customStarsCount);
                    } else {
                      handleStartPurchase('telegram_stars', selectedStarsVariant);
                    }
                  }}
                >
                  {t.buyNow} — Telegram Stars
                </button>
              </div>
            )}
          </div>
        )}

        {/* Orders Screen */}
        {activeTab === 'orders' && (
          <div>
            <div className="section-headline">{t.myOrders}</div>
            {orders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-muted)' }}>
                <PackageIcon size={44} color="#64748B" />
                <div style={{ fontWeight: 800, color: 'var(--text-pure)', fontSize: '1.1rem', marginTop: '12px', marginBottom: '6px' }}>{t.noOrders}</div>
                <p style={{ fontSize: '0.85rem' }}>{t.noOrdersDesc}</p>
                <button
                  className="btn-action-main"
                  style={{ maxWidth: '220px', margin: '20px auto 0 auto' }}
                  onClick={() => setActiveTab('catalog')}
                >
                  {t.catalog}
                </button>
              </div>
            ) : (
              orders.map((ord) => (
                <div
                  key={ord.id}
                  className="store-product-card"
                  style={{ padding: '16px', cursor: 'pointer' }}
                  onClick={() => setSelectedDetailOrder(ord)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>#{ord.id}</span>
                    <span className="badge-pill-green">
                      {ord.status === 'fulfilled' && t.statusDelivered}
                      {ord.status === 'pending_approval' && t.statusPendingApproval}
                      {ord.status === 'pending_fulfillment' && t.statusPendingFulfillment}
                      {ord.status === 'awaiting_payment' && t.statusAwaitingPayment}
                      {ord.status === 'rejected' && t.statusRejected}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {ord.product_id} • <strong style={{ color: 'var(--eth-yellow)' }}>{ord.amount_etb.toLocaleString()} ETB</strong> ({ord.payment_rail.toUpperCase()})
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Support Screen */}
        {activeTab === 'support' && (
          <div className="support-box-clean">
            <MessageCircleIcon size={48} color="#078930" />
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, marginTop: '12px', marginBottom: '8px' }}>{t.needHelp}</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '24px', lineHeight: 1.5 }}>
              {t.supportDesc}
            </p>
            <button
              className="btn-action-main"
              onClick={() => {
                const supportUrl = `https://t.me/${data?.settings.support_username || 'Vweah'}`;
                if (window.Telegram?.WebApp?.openTelegramLink) {
                  window.Telegram.WebApp.openTelegramLink(supportUrl);
                } else {
                  window.open(supportUrl, '_blank');
                }
              }}
            >
              {t.contactSupport}
            </button>
          </div>
        )}
      </main>

      {/* Username Gate Modal */}
      {gateOpen && (
        <div className="modal-backdrop-blur" onClick={() => setGateOpen(false)}>
          <div className="modal-bottom-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-grab-bar"></div>
            <div className="modal-header-row">
              <h3 className="modal-head-title">{t.usernameRequiredTitle}</h3>
              <button className="modal-close-icon" onClick={() => setGateOpen(false)}><CloseIcon size={18} /></button>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '16px', lineHeight: 1.5 }}>
              {t.usernameRequiredDesc}
            </p>
            <div style={{ background: 'var(--bg-input)', padding: '14px', borderRadius: 'var(--radius-md)', marginBottom: '18px', fontSize: '0.85rem' }}>
              <div>1. Open Telegram <strong>Settings</strong></div>
              <div style={{ margin: '6px 0' }}>2. Tap <strong>Edit Profile</strong> → <strong>Username</strong></div>
              <div>3. Save your username and tap below:</div>
            </div>
            <button
              className="btn-action-main"
              onClick={async () => {
                await loadData();
                if (data?.user?.username) {
                  setGateOpen(false);
                } else {
                  alert('Username not detected yet. Please ensure you saved it in Telegram settings.');
                }
              }}
            >
              {t.recheckUsername}
            </button>
          </div>
        </div>
      )}

      {/* Guided Checkout Bottom Sheet */}
      {checkoutModalOpen && checkoutOrder && (
        <div className="modal-backdrop-blur" onClick={() => setCheckoutModalOpen(false)}>
          <div className="modal-bottom-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-grab-bar"></div>
            <div className="modal-header-row">
              <h3 className="modal-head-title">{t.step1Title}</h3>
              <button className="modal-close-icon" onClick={() => setCheckoutModalOpen(false)}><CloseIcon size={18} /></button>
            </div>

            {/* Order Highlight Bar */}
            <div className="step-wizard-bar">
              <span className="step-circle"><CheckIcon size={12} color="#fff" /></span>
              <span className="step-label-text">#{checkoutOrder.id} • {checkoutOrder.amount_etb.toLocaleString()} ETB</span>
            </div>

            <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-muted)', marginBottom: '10px' }}>
              {t.step2Title}:
            </div>

            {/* Recognized Bank Brand Cards */}
            <div className="bank-cards-grid">
              {(['cbe', 'telebirr', 'abyssinia', 'stars', 'wallet_pay'] as const).map((rail) => (
                <div
                  key={rail}
                  className={`bank-option-card ${selectedRail === rail ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedRail(rail);
                    triggerHaptic();
                  }}
                >
                  <div className="bank-logo-text">
                    {rail === 'cbe' && <><BankIcon size={18} color="#A78BFA" /> CBE</>}
                    {rail === 'telebirr' && <><PhoneIcon size={18} color="#00A651" /> Telebirr</>}
                    {rail === 'abyssinia' && <><BankIcon size={18} color="#F59E0B" /> Abyssinia</>}
                    {rail === 'stars' && <><StarIcon size={18} color="#38BDF8" fill="#38BDF8" /> Stars</>}
                    {rail === 'wallet_pay' && <><CryptoIcon size={18} color="#06B6D4" /> Crypto</>}
                  </div>
                  <div className="bank-desc-tag">
                    {rail === 'cbe' && 'Commercial Bank'}
                    {rail === 'telebirr' && 'Mobile Wallet'}
                    {rail === 'abyssinia' && 'Bank Transfer'}
                    {rail === 'stars' && 'Telegram XTR'}
                    {rail === 'wallet_pay' && 'TON / USDT'}
                  </div>
                </div>
              ))}
            </div>

            {/* Bank Transfer Details with 1-Tap Copy */}
            {selectedRail === 'cbe' && (
              <div className="account-highlight-card">
                <div className="acc-row">
                  <span className="acc-label">{t.cbeBank}</span>
                </div>
                <div className="acc-row">
                  <span className="acc-label">{t.accountNumber}</span>
                  <div className="acc-number-copy">
                    <span className="acc-value">{data?.settings.cbe_account || '1000510711258'}</span>
                    <button className="btn-copy-chip" onClick={() => copyToClipboard(data?.settings.cbe_account || '1000510711258', 'cbe')}>
                      {copiedKey === 'cbe' ? t.copied : <><CopyIcon size={12} /> {t.copyAccount}</>}
                    </button>
                  </div>
                </div>
                <div className="acc-row">
                  <span className="acc-label">{t.accountName}</span>
                  <span className="acc-value">{data?.settings.cbe_name || 'Bighabesha Shop'}</span>
                </div>
              </div>
            )}

            {selectedRail === 'telebirr' && (
              <div className="account-highlight-card">
                <div className="acc-row">
                  <span className="acc-label">{t.telebirrMobile}</span>
                </div>
                <div className="acc-row">
                  <span className="acc-label">{t.accountNumber}</span>
                  <div className="acc-number-copy">
                    <span className="acc-value">{data?.settings.telebirr_account || '0965579045'}</span>
                    <button className="btn-copy-chip" onClick={() => copyToClipboard(data?.settings.telebirr_account || '0965579045', 'telebirr')}>
                      {copiedKey === 'telebirr' ? t.copied : <><CopyIcon size={12} /> {t.copyAccount}</>}
                    </button>
                  </div>
                </div>
                <div className="acc-row">
                  <span className="acc-label">{t.accountName}</span>
                  <span className="acc-value">{data?.settings.telebirr_name || 'Bighabesha Shop'}</span>
                </div>
              </div>
            )}

            {selectedRail === 'abyssinia' && (
              <div className="account-highlight-card">
                <div className="acc-row">
                  <span className="acc-label">{t.abyssiniaBank}</span>
                </div>
                <div className="acc-row">
                  <span className="acc-label">{t.accountNumber}</span>
                  <div className="acc-number-copy">
                    <span className="acc-value">{data?.settings.abyssinia_account || 'Abyssinia Bank Account'}</span>
                    <button className="btn-copy-chip" onClick={() => copyToClipboard(data?.settings.abyssinia_account || 'Abyssinia Bank Account', 'abyssinia')}>
                      {copiedKey === 'abyssinia' ? t.copied : <><CopyIcon size={12} /> {t.copyAccount}</>}
                    </button>
                  </div>
                </div>
                <div className="acc-row">
                  <span className="acc-label">{t.accountName}</span>
                  <span className="acc-value">{data?.settings.abyssinia_name || 'Bighabesha Shop'}</span>
                </div>
              </div>
            )}

            {/* Stars & Crypto Actions */}
            {selectedRail === 'stars' && (
              <button className="btn-action-main" onClick={handlePayWithStars} style={{ marginBottom: '10px' }}>
                Open Telegram Stars Invoice
              </button>
            )}

            {selectedRail === 'wallet_pay' && (
              <button className="btn-action-main" onClick={handlePayWithWallet} style={{ marginBottom: '10px' }}>
                Pay with TON / USDT
              </button>
            )}

            {/* Bank Transfer Receipt Submission */}
            {(selectedRail === 'cbe' || selectedRail === 'telebirr' || selectedRail === 'abyssinia') && (
              <div>
                {receiptSuccess ? (
                  <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid var(--eth-green-light)', padding: '16px', borderRadius: 'var(--radius-md)', textAlign: 'center', color: 'var(--eth-green-light)', fontSize: '0.92rem', fontWeight: 700 }}>
                    Receipt submitted successfully. Our administrators are verifying your transfer.
                  </div>
                ) : (
                  <div>
                    <div className="receipt-upload-container">
                      <label style={{ cursor: 'pointer', display: 'block' }}>
                        <UploadCloudIcon size={32} color="#078930" />
                        <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-pure)', marginTop: '6px' }}>{t.uploadReceipt}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>Tap to select photo from gallery</div>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleReceiptFileChange}
                          style={{ display: 'none' }}
                        />
                      </label>
                      {receiptBase64 && (
                        <img src={receiptBase64} alt="Receipt preview" className="preview-thumbnail" />
                      )}
                    </div>

                    <input
                      type="text"
                      placeholder="Optional transfer note or transaction reference"
                      value={receiptNote}
                      onChange={(e) => setReceiptNote(e.target.value)}
                      style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', padding: '12px', borderRadius: 'var(--radius-sm)', color: 'var(--text-pure)', fontSize: '0.88rem', outline: 'none', marginBottom: '16px' }}
                    />

                    <button
                      className="btn-action-main"
                      disabled={uploadingReceipt || !receiptBase64}
                      onClick={handleSubmitReceipt}
                    >
                      {uploadingReceipt ? t.submitting : t.submitPayment}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Order Detail Modal */}
      {selectedDetailOrder && (
        <div className="modal-backdrop-blur" onClick={() => setSelectedDetailOrder(null)}>
          <div className="modal-bottom-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-grab-bar"></div>
            <div className="modal-header-row">
              <h3 className="modal-head-title">Order #{selectedDetailOrder.id}</h3>
              <button className="modal-close-icon" onClick={() => setSelectedDetailOrder(null)}><CloseIcon size={18} /></button>
            </div>

            <div style={{ background: 'var(--bg-input)', padding: '16px', borderRadius: 'var(--radius-md)', marginBottom: '16px', lineHeight: 1.6, fontSize: '0.88rem' }}>
              <div>• <strong>Product:</strong> {selectedDetailOrder.product_id}</div>
              <div>• <strong>Total:</strong> {selectedDetailOrder.amount_etb.toLocaleString()} ETB</div>
              <div>• <strong>Method:</strong> {selectedDetailOrder.payment_rail.toUpperCase()}</div>
              <div>• <strong>{t.orderStatus}:</strong> <span style={{ color: 'var(--eth-yellow)', fontWeight: 800 }}>{selectedDetailOrder.status.toUpperCase()}</span></div>
            </div>

            {selectedDetailOrder.fulfillment_payload && (
              <div style={{ background: 'rgba(7, 137, 48, 0.15)', border: '1px solid var(--eth-green)', padding: '16px', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--eth-green-light)', marginBottom: '6px' }}>{t.activationLink}:</div>
                <code style={{ wordBreak: 'break-all', display: 'block', fontSize: '0.85rem', color: 'var(--text-pure)', marginBottom: '12px' }}>
                  {selectedDetailOrder.fulfillment_payload}
                </code>
                <button
                  className="btn-action-main"
                  style={{ minHeight: '44px', padding: '10px' }}
                  onClick={() => copyToClipboard(selectedDetailOrder.fulfillment_payload || '', 'link')}
                >
                  {copiedKey === 'link' ? t.copied : t.copyLink}
                </button>
              </div>
            )}

            <button className="btn-action-main" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }} onClick={() => setSelectedDetailOrder(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* Bottom Tabs */}
      <nav className="bottom-tabbar">
        <button
          className={`tab-button ${activeTab === 'catalog' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('catalog');
            triggerHaptic();
          }}
        >
          <ShoppingBagIcon size={20} />
          <span>{t.catalog}</span>
        </button>
        <button
          className={`tab-button ${activeTab === 'orders' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('orders');
            triggerHaptic();
          }}
        >
          <PackageIcon size={20} />
          <span>{t.myOrders}</span>
        </button>
        <button
          className={`tab-button ${activeTab === 'support' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('support');
            triggerHaptic();
          }}
        >
          <MessageCircleIcon size={20} />
          <span>{t.support}</span>
        </button>
      </nav>
    </div>
  );
};

export default App;
