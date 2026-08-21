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
  const [selectedRail, setSelectedRail] = useState<'stars' | 'wallet_pay' | 'telebirr' | 'cbe' | 'abyssinia'>('cbe');
  const [invoiceLink, setInvoiceLink] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [submittingOrder, setSubmittingOrder] = useState(false);

  // Receipt Upload
  const [receiptBase64, setReceiptBase64] = useState<string>('');
  const [receiptNote, setReceiptNote] = useState<string>('');
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [receiptSuccess, setReceiptSuccess] = useState(false);

  // Order Detail
  const [selectedDetailOrder, setSelectedDetailOrder] = useState<OrderItem | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await fetchBootstrap();
      setData(res);
      const ords = await fetchOrders().catch(() => ({ orders: [] }));
      setOrders(ords.orders);
      setErrorMessage(null);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const hasUsername = Boolean(data?.user?.username && data.user.username.trim().length > 0);

  const handleStartPurchase = async (productId: string, variantId?: string, customStars?: number, amountETB?: number) => {
    // Check username gate for Premium and Stars
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
    if (invoiceLink && window.Telegram?.WebApp?.openInvoice) {
      window.Telegram.WebApp.openInvoice(invoiceLink, (status) => {
        if (status === 'paid') {
          alert('⭐️ Stars Payment Successful! Your order has been placed.');
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
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--cta-color)', fontWeight: 600 }}>Loading Bighabesha Shop...</p>
      </div>
    );
  }

  const geminiProd = data?.products.find((p) => p.id === 'gemini_pro_18m');
  const premProd = data?.products.find((p) => p.id === 'telegram_premium');
  const starsProd = data?.products.find((p) => p.id === 'telegram_stars');
  const etbPerStar = parseFloat(data?.settings.etb_per_star || '2.5');

  return (
    <div className="app-container">
      {/* App Header */}
      <header className="app-header">
        <h1 className="brand-title">
          <span>🇪🇹</span> Bighabesha Shop
        </h1>
        <div className="user-badge">
          {data?.user?.username ? `@${data.user.username}` : data?.user?.firstName || 'Guest'}
        </div>
      </header>

      {/* Main Content View */}
      <main className="main-content">
        {errorMessage && (
          <div style={{ backgroundColor: 'rgba(218, 18, 26, 0.2)', border: '1px solid var(--danger-color)', padding: '12px', borderRadius: '10px', marginBottom: '16px', color: '#ff6b6b' }}>
            ⚠️ {errorMessage}
          </div>
        )}
        {activeTab === 'catalog' && (
          <div>
            {/* 1. Gemini Pro 18m Card */}
            {geminiProd && (
              <div className="product-card">
                <div className="card-header">
                  <h2 className="card-title">🤖 {geminiProd.name}</h2>
                  {geminiProd.availableStock && geminiProd.availableStock > 0 ? (
                    <span className="badge-stock">✅ {geminiProd.availableStock} in stock</span>
                  ) : (
                    <span className="badge-soldout">🚨 Sold Out</span>
                  )}
                </div>
                <p className="card-desc">{geminiProd.description}</p>
                <div style={{ marginBottom: '14px', fontSize: '1.1rem', fontWeight: 700, color: 'var(--cta-color)' }}>
                  1,500 ETB <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>/ 18 Months</span>
                </div>
                <button
                  className="btn-primary"
                  disabled={!geminiProd.availableStock || geminiProd.availableStock <= 0 || submittingOrder}
                  onClick={() => handleStartPurchase('gemini_pro_18m')}
                >
                  {geminiProd.availableStock && geminiProd.availableStock > 0 ? '⚡ Instant Buy — 1,500 ETB' : 'Sold Out'}
                </button>
              </div>
            )}

            {/* 2. Telegram Premium Card */}
            {premProd && (
              <div className="product-card">
                <div className="card-header">
                  <h2 className="card-title">⭐️ {premProd.name}</h2>
                  <span className="badge-stock">Fragment Delivery</span>
                </div>
                <p className="card-desc">{premProd.description}</p>
                <div className="variant-grid">
                  {premProd.variants.map((v) => (
                    <div
                      key={v.id}
                      className={`variant-pill ${selectedPremiumVariant === v.id ? 'selected' : ''}`}
                      onClick={() => setSelectedPremiumVariant(v.id)}
                    >
                      <div className="pill-title">{v.name}</div>
                      <div className="pill-price">{v.price_etb.toLocaleString()} ETB</div>
                    </div>
                  ))}
                </div>
                <button
                  className="btn-primary"
                  disabled={submittingOrder}
                  onClick={() => handleStartPurchase('telegram_premium', selectedPremiumVariant)}
                >
                  ⭐️ Buy Telegram Premium
                </button>
              </div>
            )}

            {/* 3. Telegram Stars Card */}
            {starsProd && (
              <div className="product-card">
                <div className="card-header">
                  <h2 className="card-title">🪙 {starsProd.name}</h2>
                  <span className="badge-stock">1 ⭐ = {etbPerStar} ETB</span>
                </div>
                <p className="card-desc">{starsProd.description}</p>

                {/* Preset packages */}
                <div className="variant-grid">
                  {starsProd.variants.map((v) => (
                    <div
                      key={v.id}
                      className={`variant-pill ${!isCustomStars && selectedStarsVariant === v.id ? 'selected' : ''}`}
                      onClick={() => {
                        setIsCustomStars(false);
                        setSelectedStarsVariant(v.id);
                      }}
                    >
                      <div className="pill-title">{v.name}</div>
                      <div className="pill-price">{v.price_etb.toLocaleString()} ETB</div>
                    </div>
                  ))}
                </div>

                {/* Custom stars option */}
                <div
                  className={`variant-pill ${isCustomStars ? 'selected' : ''}`}
                  style={{ marginBottom: '14px', textAlign: 'left' }}
                  onClick={() => setIsCustomStars(true)}
                >
                  <div className="pill-title">✨ Custom Stars Amount</div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '8px' }}>
                    <input
                      type="number"
                      min="10"
                      max="100000"
                      value={customStarsCount}
                      onChange={(e) => {
                        setIsCustomStars(true);
                        setCustomStarsCount(parseInt(e.target.value, 10) || 10);
                      }}
                      className="custom-input"
                      style={{ marginTop: 0 }}
                      placeholder="e.g. 750"
                    />
                    <div style={{ whiteSpace: 'nowrap', fontWeight: 700, color: 'var(--cta-color)' }}>
                      {Math.ceil(customStarsCount * etbPerStar).toLocaleString()} ETB
                    </div>
                  </div>
                </div>

                <button
                  className="btn-primary"
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
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '16px' }}>📦 My Orders</h2>
            {orders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)' }}>
                <p>No orders placed yet.</p>
                <button className="btn-secondary" onClick={() => setActiveTab('catalog')}>
                  Browse Catalog
                </button>
              </div>
            ) : (
              orders.map((ord) => (
                <div key={ord.id} className="order-history-item" onClick={() => setSelectedDetailOrder(ord)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 700 }}>#{ord.id}</span>
                    <span
                      style={{
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        color:
                          ord.status === 'fulfilled'
                            ? '#2ecc71'
                            : ord.status === 'rejected'
                            ? '#ff6b6b'
                            : 'var(--cta-color)',
                      }}
                    >
                      {ord.status.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    {ord.product_id} • {ord.amount_etb.toLocaleString()} ETB ({ord.payment_rail.toUpperCase()})
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Support View */}
        {activeTab === 'support' && (
          <div className="product-card" style={{ textAlign: 'center', padding: '32px 16px' }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '12px' }}>💬 Customer Support</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '24px', lineHeight: 1.5 }}>
              Need assistance with your purchase, custom star packages, or payment verification?
            </p>
            <button
              className="btn-primary"
              onClick={() => {
                const supportUrl = `https://t.me/${data?.settings.support_username || 'Vweah'}`;
                if (window.Telegram?.WebApp?.openTelegramLink) {
                  window.Telegram.WebApp.openTelegramLink(supportUrl);
                } else {
                  window.open(supportUrl, '_blank');
                }
              }}
            >
              💬 Contact @{data?.settings.support_username || 'Vweah'}
            </button>
          </div>
        )}
      </main>

      {/* Username Gate Modal */}
      {gateOpen && (
        <div className="modal-overlay" onClick={() => setGateOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">⚠️ Username Required</h3>
              <button className="btn-close" onClick={() => setGateOpen(false)}>
                ×
              </button>
            </div>
            <p style={{ color: 'var(--text-muted)', marginBottom: '16px', lineHeight: 1.5 }}>
              To fulfill your Telegram Premium subscription or Stars order via Fragment, your account must have a public{' '}
              <strong style={{ color: 'var(--text-main)' }}>@username</strong> set.
            </p>
            <div
              style={{
                backgroundColor: 'var(--bg-color)',
                padding: '12px 16px',
                borderRadius: '10px',
                marginBottom: '16px',
                fontSize: '0.9rem',
              }}
            >
              <div>1. Open Telegram <strong>Settings</strong></div>
              <div>2. Tap <strong>Edit Profile</strong> → <strong>Username</strong></div>
              <div>3. Set a public username and save</div>
            </div>
            <button
              className="btn-primary"
              onClick={async () => {
                await loadData();
                if (data?.user?.username) {
                  setGateOpen(false);
                  alert(`✅ Username @${data.user.username} verified!`);
                } else {
                  alert('❌ Username not detected yet. Please save your username in Telegram Settings and recheck.');
                }
              }}
            >
              🔄 I created it — recheck
            </button>
          </div>
        </div>
      )}

      {/* Checkout & Payment Rail Modal */}
      {checkoutModalOpen && checkoutOrder && (
        <div className="modal-overlay" onClick={() => setCheckoutModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">🛒 Checkout</h3>
              <button className="btn-close" onClick={() => setCheckoutModalOpen(false)}>
                ×
              </button>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Order ID: #{checkoutOrder.id}</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--cta-color)', marginTop: '4px' }}>
                {checkoutOrder.amount_etb.toLocaleString()} ETB
              </div>
            </div>

            {/* Rail Selection */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Select Payment Rail:
              </label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                {(['cbe', 'telebirr', 'abyssinia', 'stars', 'wallet_pay'] as const).map((rail) => (
                  <button
                    key={rail}
                    className={`variant-pill ${selectedRail === rail ? 'selected' : ''}`}
                    style={{ flex: '1 1 40%', padding: '8px' }}
                    onClick={() => setSelectedRail(rail)}
                  >
                    {rail === 'cbe' && '🏛 CBE Bank'}
                    {rail === 'telebirr' && '📱 Telebirr'}
                    {rail === 'abyssinia' && '🏦 Abyssinia'}
                    {rail === 'stars' && '⭐️ Telegram Stars'}
                    {rail === 'wallet_pay' && '💎 Wallet Pay'}
                  </button>
                ))}
              </div>
            </div>

            {/* Payment Rail Details */}
            {selectedRail === 'cbe' && (
              <div style={{ backgroundColor: 'var(--bg-color)', padding: '12px', borderRadius: '10px', marginBottom: '14px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Commercial Bank of Ethiopia</div>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', marginTop: '2px' }}>{data?.settings.cbe_account || '1000510711258'}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Name: {data?.settings.cbe_name || 'Bighabesha Shop'}</div>
              </div>
            )}

            {selectedRail === 'telebirr' && (
              <div style={{ backgroundColor: 'var(--bg-color)', padding: '12px', borderRadius: '10px', marginBottom: '14px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Telebirr Mobile Account</div>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', marginTop: '2px' }}>{data?.settings.telebirr_account || '0965579045'}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Name: {data?.settings.telebirr_name || 'Bighabesha Shop'}</div>
              </div>
            )}

            {selectedRail === 'abyssinia' && (
              <div style={{ backgroundColor: 'var(--bg-color)', padding: '12px', borderRadius: '10px', marginBottom: '14px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Bank of Abyssinia</div>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', marginTop: '2px' }}>{data?.settings.abyssinia_account || 'Abyssinia Bank Account'}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Name: {data?.settings.abyssinia_name || 'Bighabesha Shop'}</div>
              </div>
            )}

            {/* Stars & Wallet Pay Action Buttons */}
            {selectedRail === 'stars' && (
              <button className="btn-primary" onClick={handlePayWithStars} style={{ marginBottom: '10px' }}>
                ⭐️ Open Telegram Stars Invoice
              </button>
            )}

            {selectedRail === 'wallet_pay' && (
              <button className="btn-primary" onClick={handlePayWithWallet} style={{ marginBottom: '10px' }}>
                💎 Pay with TON / USDT
              </button>
            )}

            {/* Manual Rails Receipt Upload Form */}
            {(selectedRail === 'cbe' || selectedRail === 'telebirr' || selectedRail === 'abyssinia') && (
              <div>
                {receiptSuccess ? (
                  <div style={{ textAlign: 'center', padding: '16px', color: '#2ecc71' }}>
                    ✅ Receipt submitted successfully! Our administrators will verify and fulfill your order.
                  </div>
                ) : (
                  <div>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Upload Screenshot Receipt:</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleReceiptFileChange}
                      className="custom-input"
                      style={{ padding: '8px' }}
                    />
                    <input
                      type="text"
                      placeholder="Optional transfer note / transaction ref"
                      value={receiptNote}
                      onChange={(e) => setReceiptNote(e.target.value)}
                      className="custom-input"
                      style={{ marginTop: '8px' }}
                    />
                    <button
                      className="btn-primary"
                      disabled={uploadingReceipt || !receiptBase64}
                      onClick={handleSubmitReceipt}
                      style={{ marginTop: '12px' }}
                    >
                      {uploadingReceipt ? 'Submitting...' : '📸 Submit Payment Receipt'}
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
        <div className="modal-overlay" onClick={() => setSelectedDetailOrder(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">📄 Order #{selectedDetailOrder.id}</h3>
              <button className="btn-close" onClick={() => setSelectedDetailOrder(null)}>
                ×
              </button>
            </div>
            <div style={{ marginBottom: '14px', lineHeight: 1.6 }}>
              <div>• <strong>Product:</strong> {selectedDetailOrder.product_id}</div>
              <div>• <strong>Amount:</strong> {selectedDetailOrder.amount_etb.toLocaleString()} ETB</div>
              <div>• <strong>Payment Rail:</strong> {selectedDetailOrder.payment_rail.toUpperCase()}</div>
              <div>• <strong>Status:</strong> <span style={{ fontWeight: 700, color: 'var(--cta-color)' }}>{selectedDetailOrder.status.toUpperCase()}</span></div>
            </div>

            {selectedDetailOrder.fulfillment_payload && (
              <div style={{ backgroundColor: 'var(--bg-color)', padding: '14px', borderRadius: '10px', marginBottom: '14px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--cta-color)', fontWeight: 700 }}>🎉 Activation Link:</div>
                <code style={{ wordBreak: 'break-all', display: 'block', margin: '8px 0' }}>
                  {selectedDetailOrder.fulfillment_payload}
                </code>
                <button
                  className="btn-secondary"
                  style={{ marginTop: '6px' }}
                  onClick={() => {
                    navigator.clipboard.writeText(selectedDetailOrder.fulfillment_payload || '');
                    alert('Activation link copied to clipboard!');
                  }}
                >
                  📋 Copy Link
                </button>
              </div>
            )}

            <button className="btn-secondary" onClick={() => setSelectedDetailOrder(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* Bottom Tab Navigation */}
      <nav className="bottom-nav">
        <button
          className={`nav-item ${activeTab === 'catalog' ? 'active' : ''}`}
          onClick={() => setActiveTab('catalog')}
        >
          <span className="nav-icon">🛍</span>
          <span>Catalog</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'orders' ? 'active' : ''}`}
          onClick={() => setActiveTab('orders')}
        >
          <span className="nav-icon">📦</span>
          <span>My Orders</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'support' ? 'active' : ''}`}
          onClick={() => setActiveTab('support')}
        >
          <span className="nav-icon">💬</span>
          <span>Support</span>
        </button>
      </nav>
    </div>
  );
};

export default App;
