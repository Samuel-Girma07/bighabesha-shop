import React, { useState, useEffect } from 'react';
import {
  fetchBootstrap,
  fetchOrders,
  createOrderApi,
  submitReceiptApi,
  BootstrapData,
  OrderItem,
} from './api.ts';
import './index.css';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'catalog' | 'orders' | 'support'>('catalog');
  const [data, setData] = useState<BootstrapData | null>(null);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
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
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await fetchBootstrap();
      setData(res);
      const ords = await fetchOrders().catch(() => ({ orders: [] }));
      setOrders(ords.orders);
      setErrorMessage(null);
    } catch (err: any) {
      setErrorMessage(err.message || 'Connecting to store...');
    } finally {
      setLoading(false);
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

  if (loading) {
    return (
      <div className="app-wrapper" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '12px' }}>🇪🇹</div>
          <div style={{ color: 'var(--eth-yellow)', fontWeight: 700, fontSize: '1.1rem' }}>Bighabesha Shop</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>Loading digital catalog...</div>
        </div>
      </div>
    );
  }

  const geminiProd = data?.products.find((p) => p.id === 'gemini_pro_18m');
  const premProd = data?.products.find((p) => p.id === 'telegram_premium');
  const starsProd = data?.products.find((p) => p.id === 'telegram_stars');
  const etbPerStar = parseFloat(data?.settings.etb_per_star || '2.5');

  return (
    <div className="app-wrapper">
      {/* Header */}
      <header className="header-glass">
        <div className="brand-badge">
          <span className="brand-flag">🇪🇹</span>
          <span className="brand-name">Bighabesha Shop</span>
        </div>
        <div className="user-pill">
          <span className="user-dot"></span>
          <span>{data?.user?.username ? `@${data.user.username}` : data?.user?.firstName || 'Guest'}</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="content-body">
        {errorMessage && (
          <div style={{ background: 'rgba(218, 18, 26, 0.15)', border: '1px solid var(--eth-red)', padding: '12px', borderRadius: 'var(--radius-md)', marginBottom: '16px', color: '#F87171', fontSize: '0.85rem' }}>
            ⚠️ {errorMessage}
          </div>
        )}

        {activeTab === 'catalog' && (
          <div>
            {/* Hero Highlights */}
            <div className="hero-banner">
              <div className="hero-text">
                <h2>Official Ethiopian Store</h2>
                <p>Instant activation & Fragment gifting</p>
              </div>
              <span className="hero-badge">Verified</span>
            </div>

            <div className="section-title">✨ Featured Products</div>

            {/* 1. Gemini Pro 18m Card */}
            {geminiProd && (
              <div className="card-product">
                <div className="card-top">
                  <div className="card-header-group">
                    <div className="product-icon-wrap">🤖</div>
                    <div>
                      <h3 className="product-name">{geminiProd.name}</h3>
                      <div className="product-subtitle">Google AI + 2TB Cloud Storage</div>
                    </div>
                  </div>
                  {geminiProd.availableStock && geminiProd.availableStock > 0 ? (
                    <span className="badge-status-green">✅ {geminiProd.availableStock} in stock</span>
                  ) : (
                    <span className="badge-status-red">Sold Out</span>
                  )}
                </div>

                <p className="card-description">{geminiProd.description}</p>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '16px' }}>
                  <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--eth-yellow)' }}>1,500 ETB</span>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>/ 18 Months (~83 ETB/mo)</span>
                </div>

                <button
                  className="btn-cta"
                  disabled={!geminiProd.availableStock || geminiProd.availableStock <= 0 || submittingOrder}
                  onClick={() => handleStartPurchase('gemini_pro_18m')}
                >
                  {geminiProd.availableStock && geminiProd.availableStock > 0 ? '⚡ Instant Buy — 1,500 ETB' : 'Sold Out'}
                </button>
              </div>
            )}

            {/* 2. Telegram Premium Card */}
            {premProd && (
              <div className="card-product">
                <div className="card-top">
                  <div className="card-header-group">
                    <div className="product-icon-wrap">⭐️</div>
                    <div>
                      <h3 className="product-name">{premProd.name}</h3>
                      <div className="product-subtitle">Fragment Direct Gift to @username</div>
                    </div>
                  </div>
                  <span className="badge-status-green">Official Rails</span>
                </div>

                <p className="card-description">{premProd.description}</p>

                <div className="pills-grid">
                  {premProd.variants.map((v) => (
                    <div
                      key={v.id}
                      className={`pill-card ${selectedPremiumVariant === v.id ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedPremiumVariant(v.id);
                        triggerHaptic();
                      }}
                    >
                      <div className="pill-label">{v.name.replace(' Subscription', '')}</div>
                      <div className="pill-amount">{v.price_etb.toLocaleString()} ETB</div>
                    </div>
                  ))}
                </div>

                <button
                  className="btn-cta"
                  disabled={submittingOrder}
                  onClick={() => handleStartPurchase('telegram_premium', selectedPremiumVariant)}
                >
                  ⭐️ Buy Telegram Premium
                </button>
              </div>
            )}

            {/* 3. Telegram Stars Card */}
            {starsProd && (
              <div className="card-product">
                <div className="card-top">
                  <div className="card-header-group">
                    <div className="product-icon-wrap">🪙</div>
                    <div>
                      <h3 className="product-name">{starsProd.name}</h3>
                      <div className="product-subtitle">For Gifts, Bots & Mini-Apps</div>
                    </div>
                  </div>
                  <span className="badge-status-green">1 ⭐ = {etbPerStar} ETB</span>
                </div>

                <p className="card-description">{starsProd.description}</p>

                {/* Preset Pills */}
                <div className="pills-grid">
                  {starsProd.variants.map((v) => (
                    <div
                      key={v.id}
                      className={`pill-card ${!isCustomStars && selectedStarsVariant === v.id ? 'active' : ''}`}
                      onClick={() => {
                        setIsCustomStars(false);
                        setSelectedStarsVariant(v.id);
                        triggerHaptic();
                      }}
                    >
                      <div className="pill-label">{v.name}</div>
                      <div className="pill-amount">{v.price_etb.toLocaleString()} ETB</div>
                    </div>
                  ))}
                </div>

                {/* Custom Stars Box */}
                <div className="custom-box">
                  <div className="custom-box-top">
                    <span className="custom-box-title">✨ Custom Star Amount</span>
                    <span className="custom-box-calc">{Math.ceil(customStarsCount * etbPerStar).toLocaleString()} ETB</span>
                  </div>

                  <input
                    type="range"
                    min="10"
                    max="5000"
                    step="10"
                    value={customStarsCount}
                    onChange={(e) => {
                      setIsCustomStars(true);
                      setCustomStarsCount(parseInt(e.target.value, 10));
                    }}
                    className="range-slider"
                  />

                  <input
                    type="number"
                    min="10"
                    max="100000"
                    value={customStarsCount}
                    onChange={(e) => {
                      setIsCustomStars(true);
                      setCustomStarsCount(parseInt(e.target.value, 10) || 10);
                    }}
                    className="input-number"
                    placeholder="Enter custom stars (e.g. 750)"
                  />
                </div>

                <button
                  className="btn-cta"
                  disabled={submittingOrder}
                  onClick={() => {
                    if (isCustomStars) {
                      handleStartPurchase('telegram_stars', undefined, customStarsCount);
                    } else {
                      handleStartPurchase('telegram_stars', selectedStarsVariant);
                    }
                  }}
                >
                  🪙 Buy Telegram Stars
                </button>
              </div>
            )}
          </div>
        )}

        {/* Orders View */}
        {activeTab === 'orders' && (
          <div>
            <div className="section-title">📦 Order History</div>
            {orders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🛍</div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>No orders yet</div>
                <p style={{ fontSize: '0.85rem' }}>Your purchased subscriptions and stars will appear here.</p>
                <button className="btn-secondary-action" style={{ maxWidth: '200px', margin: '18px auto 0 auto' }} onClick={() => setActiveTab('catalog')}>
                  Browse Catalog
                </button>
              </div>
            ) : (
              orders.map((ord) => (
                <div key={ord.id} className="order-card" onClick={() => setSelectedDetailOrder(ord)}>
                  <div className="order-card-top">
                    <span className="order-id">#{ord.id}</span>
                    <span className={ord.status === 'fulfilled' ? 'order-badge-fulfilled' : 'order-badge-pending'}>
                      {ord.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="order-details">
                    {ord.product_id} • {ord.amount_etb.toLocaleString()} ETB ({ord.payment_rail.toUpperCase()})
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Support View */}
        {activeTab === 'support' && (
          <div className="card-product" style={{ textAlign: 'center', padding: '36px 20px' }}>
            <div style={{ fontSize: '2.8rem', marginBottom: '12px' }}>💬</div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '8px' }}>Customer Support</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '24px', lineHeight: 1.5 }}>
              Need help with payment verification, activation links, or custom orders? Our team is available on Telegram.
            </p>
            <button
              className="btn-cta"
              onClick={() => {
                const supportUrl = `https://t.me/${data?.settings.support_username || 'Vweah'}`;
                if (window.Telegram?.WebApp?.openTelegramLink) {
                  window.Telegram.WebApp.openTelegramLink(supportUrl);
                } else {
                  window.open(supportUrl, '_blank');
                }
              }}
            >
              💬 Chat with @{data?.settings.support_username || 'Vweah'}
            </button>
          </div>
        )}
      </main>

      {/* Username Gate Modal */}
      {gateOpen && (
        <div className="modal-mask" onClick={() => setGateOpen(false)}>
          <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grabber"></div>
            <div className="sheet-header">
              <h3 className="sheet-title">⚠️ Username Required</h3>
              <button className="sheet-close-btn" onClick={() => setGateOpen(false)}>×</button>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '16px', lineHeight: 1.5 }}>
              Telegram Premium and Stars are gifted directly to your public <strong style={{ color: 'var(--text-primary)' }}>@username</strong> via Fragment.
            </p>
            <div style={{ background: 'var(--bg-input)', padding: '14px', borderRadius: 'var(--radius-md)', marginBottom: '18px', fontSize: '0.85rem' }}>
              <div>1. Open Telegram <strong>Settings</strong></div>
              <div style={{ margin: '4px 0' }}>2. Tap <strong>Edit Profile</strong> → <strong>Username</strong></div>
              <div>3. Save your username and tap below:</div>
            </div>
            <button
              className="btn-cta"
              onClick={async () => {
                await loadData();
                if (data?.user?.username) {
                  setGateOpen(false);
                } else {
                  alert('Username not detected yet. Please ensure you saved it in Telegram settings.');
                }
              }}
            >
              🔄 I created it — recheck
            </button>
          </div>
        </div>
      )}

      {/* Checkout Bottom Sheet */}
      {checkoutModalOpen && checkoutOrder && (
        <div className="modal-mask" onClick={() => setCheckoutModalOpen(false)}>
          <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grabber"></div>
            <div className="sheet-header">
              <h3 className="sheet-title">🛒 Checkout</h3>
              <button className="sheet-close-btn" onClick={() => setCheckoutModalOpen(false)}>×</button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Order ID</div>
                <div style={{ fontWeight: 800, fontSize: '1rem' }}>#{checkoutOrder.id}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Total Amount</div>
                <div style={{ fontWeight: 800, fontSize: '1.25rem', color: 'var(--eth-yellow)' }}>
                  {checkoutOrder.amount_etb.toLocaleString()} ETB
                </div>
              </div>
            </div>

            <div className="section-title">Choose Payment Rail</div>

            <div className="rail-choice-grid">
              {(['cbe', 'telebirr', 'abyssinia', 'stars', 'wallet_pay'] as const).map((rail) => (
                <button
                  key={rail}
                  className={`rail-btn ${selectedRail === rail ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedRail(rail);
                    triggerHaptic();
                  }}
                >
                  <span className="rail-btn-name">
                    {rail === 'cbe' && '🏛 CBE Bank'}
                    {rail === 'telebirr' && '📱 Telebirr'}
                    {rail === 'abyssinia' && '🏦 Abyssinia'}
                    {rail === 'stars' && '⭐️ Telegram Stars'}
                    {rail === 'wallet_pay' && '💎 Wallet Pay'}
                  </span>
                  <span className="rail-btn-desc">
                    {rail === 'cbe' && 'Instant transfer'}
                    {rail === 'telebirr' && 'Mobile money'}
                    {rail === 'abyssinia' && 'Bank transfer'}
                    {rail === 'stars' && 'Native XTR'}
                    {rail === 'wallet_pay' && 'TON / USDT'}
                  </span>
                </button>
              ))}
            </div>

            {/* Bank details card */}
            {selectedRail === 'cbe' && (
              <div className="bank-info-box">
                <div className="bank-info-row">
                  <span className="bank-info-label">Bank</span>
                  <span className="bank-info-val">Commercial Bank of Ethiopia</span>
                </div>
                <div className="bank-info-row">
                  <span className="bank-info-label">Account No</span>
                  <span className="bank-info-val">
                    {data?.settings.cbe_account || '1000510711258'}
                    <button className="copy-icon-btn" onClick={() => copyToClipboard(data?.settings.cbe_account || '1000510711258', 'cbe')}>
                      {copiedKey === 'cbe' ? 'Copied! ✓' : 'Copy'}
                    </button>
                  </span>
                </div>
                <div className="bank-info-row">
                  <span className="bank-info-label">Account Name</span>
                  <span className="bank-info-val">{data?.settings.cbe_name || 'Bighabesha Shop'}</span>
                </div>
              </div>
            )}

            {selectedRail === 'telebirr' && (
              <div className="bank-info-box">
                <div className="bank-info-row">
                  <span className="bank-info-label">Platform</span>
                  <span className="bank-info-val">Telebirr Mobile</span>
                </div>
                <div className="bank-info-row">
                  <span className="bank-info-label">Mobile Number</span>
                  <span className="bank-info-val">
                    {data?.settings.telebirr_account || '0965579045'}
                    <button className="copy-icon-btn" onClick={() => copyToClipboard(data?.settings.telebirr_account || '0965579045', 'telebirr')}>
                      {copiedKey === 'telebirr' ? 'Copied! ✓' : 'Copy'}
                    </button>
                  </span>
                </div>
                <div className="bank-info-row">
                  <span className="bank-info-label">Merchant Name</span>
                  <span className="bank-info-val">{data?.settings.telebirr_name || 'Bighabesha Shop'}</span>
                </div>
              </div>
            )}

            {selectedRail === 'abyssinia' && (
              <div className="bank-info-box">
                <div className="bank-info-row">
                  <span className="bank-info-label">Bank</span>
                  <span className="bank-info-val">Bank of Abyssinia</span>
                </div>
                <div className="bank-info-row">
                  <span className="bank-info-label">Account No</span>
                  <span className="bank-info-val">
                    {data?.settings.abyssinia_account || 'Abyssinia Bank Account'}
                    <button className="copy-icon-btn" onClick={() => copyToClipboard(data?.settings.abyssinia_account || 'Abyssinia Bank Account', 'abyssinia')}>
                      {copiedKey === 'abyssinia' ? 'Copied! ✓' : 'Copy'}
                    </button>
                  </span>
                </div>
                <div className="bank-info-row">
                  <span className="bank-info-label">Account Name</span>
                  <span className="bank-info-val">{data?.settings.abyssinia_name || 'Bighabesha Shop'}</span>
                </div>
              </div>
            )}

            {/* Stars & Crypto Actions */}
            {selectedRail === 'stars' && (
              <button className="btn-cta" onClick={handlePayWithStars} style={{ marginBottom: '10px' }}>
                ⭐️ Open Telegram Stars Invoice
              </button>
            )}

            {selectedRail === 'wallet_pay' && (
              <button className="btn-cta" onClick={handlePayWithWallet} style={{ marginBottom: '10px' }}>
                💎 Pay with TON / USDT
              </button>
            )}

            {/* Bank Transfer Receipt Upload */}
            {(selectedRail === 'cbe' || selectedRail === 'telebirr' || selectedRail === 'abyssinia') && (
              <div>
                {receiptSuccess ? (
                  <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid var(--accent-emerald)', padding: '14px', borderRadius: 'var(--radius-md)', textAlign: 'center', color: 'var(--accent-emerald)', fontSize: '0.9rem', fontWeight: 600 }}>
                    ✅ Receipt submitted! Our team will verify and deliver your order shortly.
                  </div>
                ) : (
                  <div>
                    <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                      Upload Screenshot Receipt:
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleReceiptFileChange}
                      style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', padding: '10px', borderRadius: 'var(--radius-sm)', width: '100%', color: 'var(--text-primary)', marginBottom: '8px' }}
                    />
                    <input
                      type="text"
                      placeholder="Optional transaction reference or note"
                      value={receiptNote}
                      onChange={(e) => setReceiptNote(e.target.value)}
                      className="input-number"
                      style={{ marginTop: 0, marginBottom: '14px' }}
                    />
                    <button
                      className="btn-cta"
                      disabled={uploadingReceipt || !receiptBase64}
                      onClick={handleSubmitReceipt}
                    >
                      {uploadingReceipt ? 'Submitting Receipt...' : '📸 Submit Payment Receipt'}
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
        <div className="modal-mask" onClick={() => setSelectedDetailOrder(null)}>
          <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grabber"></div>
            <div className="sheet-header">
              <h3 className="sheet-title">📄 Order #{selectedDetailOrder.id}</h3>
              <button className="sheet-close-btn" onClick={() => setSelectedDetailOrder(null)}>×</button>
            </div>

            <div style={{ background: 'var(--bg-input)', padding: '14px', borderRadius: 'var(--radius-md)', marginBottom: '16px', lineHeight: 1.6, fontSize: '0.88rem' }}>
              <div>• <strong>Product:</strong> {selectedDetailOrder.product_id}</div>
              <div>• <strong>Amount:</strong> {selectedDetailOrder.amount_etb.toLocaleString()} ETB</div>
              <div>• <strong>Payment Rail:</strong> {selectedDetailOrder.payment_rail.toUpperCase()}</div>
              <div>• <strong>Status:</strong> <span style={{ color: 'var(--eth-yellow)', fontWeight: 700 }}>{selectedDetailOrder.status.toUpperCase()}</span></div>
            </div>

            {selectedDetailOrder.fulfillment_payload && (
              <div style={{ background: 'rgba(7, 137, 48, 0.15)', border: '1px solid var(--eth-green)', padding: '14px', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent-emerald)', marginBottom: '6px' }}>🎉 Activation Link:</div>
                <code style={{ wordBreak: 'break-all', display: 'block', fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '10px' }}>
                  {selectedDetailOrder.fulfillment_payload}
                </code>
                <button
                  className="btn-cta"
                  style={{ padding: '10px' }}
                  onClick={() => copyToClipboard(selectedDetailOrder.fulfillment_payload || '', 'link')}
                >
                  {copiedKey === 'link' ? 'Copied! ✓' : '📋 Copy Activation Link'}
                </button>
              </div>
            )}

            <button className="btn-secondary-action" onClick={() => setSelectedDetailOrder(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* Bottom Tabs */}
      <nav className="bottom-tabs">
        <button
          className={`tab-btn ${activeTab === 'catalog' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('catalog');
            triggerHaptic();
          }}
        >
          <span className="tab-icon">🛍</span>
          <span>Catalog</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'orders' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('orders');
            triggerHaptic();
          }}
        >
          <span className="tab-icon">📦</span>
          <span>My Orders</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'support' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('support');
            triggerHaptic();
          }}
        >
          <span className="tab-icon">💬</span>
          <span>Support</span>
        </button>
      </nav>
    </div>
  );
};

export default App;
