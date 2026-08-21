import React, { useState, useEffect } from 'react';
import {
  adminLoginApi,
  adminVerify2FAApi,
  hasAdminSession,
  clearAdminToken,
  saveAdminToken,
  fetchAdminOverviewApi,
  fetchAdminOrdersApi,
  approveOrderApi,
  rejectOrderApi,
  fulfillOrderApi,
  fetchAdminStockApi,
  addStockLinksApi,
  deleteStockItemApi,
  fetchAdminUsersApi,
  fetchAdminSettingsApi,
  updateAdminSettingsApi,
  broadcastMessageApi,
} from './adminApi.ts';
import './admin.css';

export const AdminDashboard: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(hasAdminSession());
  const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'stock' | 'users' | 'settings' | 'broadcast'>('overview');

  // Auth State
  const [password, setPassword] = useState('');
  const [require2FA, setRequire2FA] = useState(false);
  const [adminId, setAdminId] = useState<number>(0);
  const [otp, setOtp] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Data States
  const [overview, setOverview] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [orderFilter, setOrderFilter] = useState<string>('all');
  const [orderSearch, setOrderSearch] = useState<string>('');
  const [stockData, setStockData] = useState<{ summary: any; items: any[] }>({ summary: {}, items: [] });
  const [bulkLinks, setBulkLinks] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Broadcast State
  const [broadcastTarget, setBroadcastTarget] = useState<'all' | 'active_buyers' | 'registered'>('all');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastResult, setBroadcastResult] = useState<any>(null);
  const [broadcasting, setBroadcasting] = useState(false);

  // Modal States
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [fulfillProof, setFulfillProof] = useState('');
  const [modalType, setModalType] = useState<'receipt' | 'reject' | 'fulfill' | null>(null);

  const loadAllAdminData = async () => {
    try {
      const [ov, ords, stk, usrs, stgs] = await Promise.all([
        fetchAdminOverviewApi().catch(() => null),
        fetchAdminOrdersApi(orderFilter, orderSearch).catch(() => ({ orders: [] })),
        fetchAdminStockApi().catch(() => ({ summary: {}, items: [] })),
        fetchAdminUsersApi().catch(() => ({ users: [] })),
        fetchAdminSettingsApi().catch(() => ({ settings: {} })),
      ]);

      if (ov) setOverview(ov);
      setOrders(ords.orders);
      setStockData(stk);
      setUsers(usrs.users);
      setSettings(stgs.settings);
    } catch (err) {
      console.error('Admin data load error:', err);
    }
  };

  useEffect(() => {
    if (isLoggedIn) {
      loadAllAdminData();
    }
  }, [isLoggedIn, orderFilter]);

  // Auth Handlers
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await adminLoginApi(password);
      setRequire2FA(true);
      setAdminId(res.adminId);
    } catch (err: any) {
      setAuthError(err.message || 'Login failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerify2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await adminVerify2FAApi(adminId, otp);
      saveAdminToken(res.token);
      setIsLoggedIn(true);
      setRequire2FA(false);
    } catch (err: any) {
      setAuthError(err.message || '2FA verification failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    clearAdminToken();
    setIsLoggedIn(false);
    setPassword('');
    setOtp('');
  };

  // Order Action Handlers
  const handleApprove = async (orderId: string) => {
    if (!confirm(`Approve order #${orderId}? This will immediately deliver links/notify the buyer.`)) return;
    try {
      await approveOrderApi(orderId);
      loadAllAdminData();
      if (modalType) setModalType(null);
    } catch (err: any) {
      alert(err.message || 'Failed to approve order');
    }
  };

  const handleReject = async () => {
    if (!selectedOrder || !rejectReason.trim()) {
      alert('Please enter a rejection reason.');
      return;
    }
    try {
      await rejectOrderApi(selectedOrder.id, rejectReason);
      setModalType(null);
      setRejectReason('');
      loadAllAdminData();
    } catch (err: any) {
      alert(err.message || 'Failed to reject order');
    }
  };

  const handleFulfill = async () => {
    if (!selectedOrder) return;
    try {
      await fulfillOrderApi(selectedOrder.id, fulfillProof);
      setModalType(null);
      setFulfillProof('');
      loadAllAdminData();
    } catch (err: any) {
      alert(err.message || 'Failed to fulfill order');
    }
  };

  // Stock Handlers
  const handleAddStock = async () => {
    if (!bulkLinks.trim()) return;
    try {
      const res = await addStockLinksApi(bulkLinks);
      alert(`Successfully added ${res.addedCount} Gemini activation links!`);
      setBulkLinks('');
      loadAllAdminData();
    } catch (err: any) {
      alert(err.message || 'Failed to add stock');
    }
  };

  const handleDeleteStock = async (id: string) => {
    if (!confirm('Delete this unused stock item?')) return;
    try {
      await deleteStockItemApi(id);
      loadAllAdminData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete item');
    }
  };

  // Settings Handlers
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateAdminSettingsApi(settings);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
      loadAllAdminData();
    } catch (err: any) {
      alert(err.message || 'Failed to save settings');
    }
  };

  // Broadcast Handler
  const handleSendBroadcast = async () => {
    if (!broadcastMessage.trim()) {
      alert('Please enter a broadcast message.');
      return;
    }
    if (!confirm(`Are you sure you want to broadcast this message to ${broadcastTarget.toUpperCase()} users?`)) return;

    setBroadcasting(true);
    setBroadcastResult(null);
    try {
      const res = await broadcastMessageApi(broadcastMessage, broadcastTarget);
      setBroadcastResult(res);
      setBroadcastMessage('');
    } catch (err: any) {
      alert(err.message || 'Broadcast failed');
    } finally {
      setBroadcasting(false);
    }
  };

  // -------------------------------------------------------------
  // Unauthenticated Login Screen
  // -------------------------------------------------------------
  if (!isLoggedIn) {
    return (
      <div className="admin-login-wrap">
        <div className="admin-login-card">
          <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🔐</div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#FFFFFF' }}>Bighabesha Admin Portal</h2>
          <p style={{ fontSize: '0.85rem', color: '#94A3B8', marginTop: '4px', marginBottom: '24px' }}>
            {require2FA ? 'Enter the 6-digit 2FA code sent to your Telegram' : 'Enter master password to access system'}
          </p>

          {authError && (
            <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #EF4444', padding: '10px', borderRadius: '8px', color: '#FCA5A5', fontSize: '0.85rem', marginBottom: '16px' }}>
              {authError}
            </div>
          )}

          {!require2FA ? (
            <form onSubmit={handleLoginSubmit}>
              <div className="form-group" style={{ textAlign: 'left' }}>
                <label className="form-label">Master Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="admin-input"
                  placeholder="Enter admin password"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={authLoading || !password}
                style={{ width: '100%', background: '#078930', color: '#fff', padding: '12px', borderRadius: '8px', border: 'none', fontWeight: 800, fontSize: '0.95rem', cursor: 'pointer', marginTop: '10px' }}
              >
                {authLoading ? 'Verifying...' : 'Next: Send 2FA Code →'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerify2FASubmit}>
              <div className="form-group" style={{ textAlign: 'left' }}>
                <label className="form-label">Telegram 2FA OTP Code</label>
                <input
                  type="text"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  className="admin-input"
                  style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '6px', fontWeight: 800 }}
                  placeholder="000000"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={authLoading || otp.length < 6}
                style={{ width: '100%', background: '#078930', color: '#fff', padding: '12px', borderRadius: '8px', border: 'none', fontWeight: 800, fontSize: '0.95rem', cursor: 'pointer', marginTop: '10px' }}
              >
                {authLoading ? 'Authenticating...' : 'Verify 2FA & Access Dashboard'}
              </button>
              <button
                type="button"
                onClick={() => setRequire2FA(false)}
                style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '0.85rem', marginTop: '14px', cursor: 'pointer' }}
              >
                « Back to Password
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // Filtered Users
  const filteredUsers = users.filter((u) =>
    !userSearch ||
    String(u.id).includes(userSearch) ||
    u.username?.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.phone_number?.includes(userSearch)
  );

  // -------------------------------------------------------------
  // Authenticated Admin Dashboard Workspace
  // -------------------------------------------------------------
  return (
    <div className="admin-layout">
      {/* Sidebar Navigation */}
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#078930', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#FCDD09' }}>B</div>
          <div>
            <div className="admin-brand-title">Bighabesha</div>
            <span className="admin-brand-tag">Superadmin Control</span>
          </div>
        </div>

        <nav className="admin-nav">
          <button className={`admin-nav-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
            <span>📊</span> Overview
          </button>
          <button className={`admin-nav-btn ${activeTab === 'orders' ? 'active' : ''}`} onClick={() => setActiveTab('orders')}>
            <span>📦</span> Orders &amp; Receipts
          </button>
          <button className={`admin-nav-btn ${activeTab === 'stock' ? 'active' : ''}`} onClick={() => setActiveTab('stock')}>
            <span>🔑</span> Gemini Stock ({stockData.summary.available || 0})
          </button>
          <button className={`admin-nav-btn ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
            <span>👥</span> Users &amp; CRM ({users.length})
          </button>
          <button className={`admin-nav-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
            <span>⚙️</span> Store Settings
          </button>
          <button className={`admin-nav-btn ${activeTab === 'broadcast' ? 'active' : ''}`} onClick={() => setActiveTab('broadcast')}>
            <span>📢</span> Broadcast Tool
          </button>
        </nav>

        <button className="admin-logout-btn" onClick={handleLogout}>
          Sign Out
        </button>
      </aside>

      {/* Main Content View */}
      <main className="admin-main">
        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div>
            <div className="admin-header">
              <div>
                <h1 className="admin-page-title">Executive Overview</h1>
                <p className="admin-page-desc">Live performance metrics, revenue volume, and pending queues.</p>
              </div>
              <button className="btn-sm-action btn-view" onClick={loadAllAdminData}>🔄 Refresh Data</button>
            </div>

            {/* KPI Cards */}
            <div className="kpi-grid">
              <div className="kpi-card">
                <div className="kpi-label">Settled Revenue</div>
                <div className="kpi-value highlight-gold">{(overview?.metrics?.totalRevenueETB || 0).toLocaleString()} ETB</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Completed Orders</div>
                <div className="kpi-value highlight-green">{overview?.metrics?.fulfilledOrders || 0}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Receipts To Review</div>
                <div className="kpi-value" style={{ color: overview?.metrics?.pendingApprovalOrders > 0 ? '#F59E0B' : '#94A3B8' }}>
                  {overview?.metrics?.pendingApprovalOrders || 0}
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Gemini Stock Left</div>
                <div className="kpi-value">{overview?.metrics?.geminiStockAvailable || 0} Links</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Registered Buyers</div>
                <div className="kpi-value">{overview?.metrics?.registeredUsers || 0} / {overview?.metrics?.totalUsers || 0}</div>
              </div>
            </div>

            {/* Revenue by Payment Rail */}
            <div className="admin-card-box">
              <h3 className="box-title">Revenue by Payment Rail</h3>
              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Payment Rail</th>
                      <th>Settled Count</th>
                      <th>Total Volume (ETB)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(overview?.railBreakdown || []).map((r: any) => (
                      <tr key={r.payment_rail}>
                        <td><strong>{r.payment_rail.toUpperCase()}</strong></td>
                        <td>{r.count} orders</td>
                        <td style={{ color: '#FCDD09', fontWeight: 800 }}>{(r.total_etb || 0).toLocaleString()} ETB</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Recent Orders */}
            <div className="admin-card-box">
              <h3 className="box-title">Recent Activity</h3>
              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>User</th>
                      <th>Product</th>
                      <th>Amount</th>
                      <th>Rail</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(overview?.recentOrders || []).map((ord: any) => (
                      <tr key={ord.id}>
                        <td><code>#{ord.id}</code></td>
                        <td>{ord.username ? `@${ord.username}` : ord.user_id}</td>
                        <td>{ord.product_id}</td>
                        <td style={{ color: '#FCDD09', fontWeight: 700 }}>{ord.amount_etb.toLocaleString()} ETB</td>
                        <td>{ord.payment_rail.toUpperCase()}</td>
                        <td>
                          <span className={`badge-status ${ord.status}`}>{ord.status.toUpperCase()}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: ORDERS & RECEIPTS */}
        {activeTab === 'orders' && (
          <div>
            <div className="admin-header">
              <div>
                <h1 className="admin-page-title">Orders &amp; Receipt Review</h1>
                <p className="admin-page-desc">Inspect transfer receipts, approve deliveries, or reject invalid transactions.</p>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <select
                  value={orderFilter}
                  onChange={(e) => setOrderFilter(e.target.value)}
                  style={{ background: '#141E2B', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', padding: '8px 12px', borderRadius: '8px' }}
                >
                  <option value="all">All Orders</option>
                  <option value="pending_approval">Pending Approval ⏳</option>
                  <option value="pending_fulfillment">Pending Fulfillment 🎁</option>
                  <option value="fulfilled">Fulfilled ✅</option>
                  <option value="awaiting_payment">Awaiting Payment 💳</option>
                  <option value="rejected">Rejected ❌</option>
                </select>
                <input
                  type="text"
                  placeholder="Search ID, username..."
                  value={orderSearch}
                  onChange={(e) => {
                    setOrderSearch(e.target.value);
                    loadAllAdminData();
                  }}
                  style={{ background: '#141E2B', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', padding: '8px 12px', borderRadius: '8px' }}
                />
              </div>
            </div>

            <div className="admin-card-box">
              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>Date</th>
                      <th>Buyer</th>
                      <th>Product</th>
                      <th>Amount</th>
                      <th>Rail</th>
                      <th>Status</th>
                      <th>Receipt</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ textAlign: 'center', padding: '36px', color: '#94A3B8' }}>
                          No orders matching current filter.
                        </td>
                      </tr>
                    ) : (
                      orders.map((ord) => (
                        <tr key={ord.id}>
                          <td><code>#{ord.id}</code></td>
                          <td style={{ fontSize: '0.8rem', color: '#94A3B8' }}>{new Date(ord.created_at).toLocaleString()}</td>
                          <td>
                            <strong>{ord.username ? `@${ord.username}` : ord.user_id}</strong>
                          </td>
                          <td>{ord.product_id}</td>
                          <td style={{ color: '#FCDD09', fontWeight: 800 }}>{ord.amount_etb.toLocaleString()} ETB</td>
                          <td>{ord.payment_rail.toUpperCase()}</td>
                          <td>
                            <span className={`badge-status ${ord.status}`}>{ord.status.toUpperCase()}</span>
                          </td>
                          <td>
                            {ord.receipt_file_id ? (
                              <button
                                className="btn-sm-action btn-view"
                                onClick={() => {
                                  setSelectedOrder(ord);
                                  setModalType('receipt');
                                }}
                              >
                                View Receipt
                              </button>
                            ) : (
                              <span style={{ color: '#64748B', fontSize: '0.75rem' }}>No receipt</span>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              {ord.status === 'pending_approval' && (
                                <>
                                  <button className="btn-sm-action btn-approve" onClick={() => handleApprove(ord.id)}>
                                    Approve
                                  </button>
                                  <button
                                    className="btn-sm-action btn-reject"
                                    onClick={() => {
                                      setSelectedOrder(ord);
                                      setModalType('reject');
                                    }}
                                  >
                                    Reject
                                  </button>
                                </>
                              )}
                              {ord.status === 'pending_fulfillment' && (
                                <button
                                  className="btn-sm-action btn-approve"
                                  onClick={() => {
                                    setSelectedOrder(ord);
                                    setModalType('fulfill');
                                  }}
                                >
                                  Complete Fulfillment
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: GEMINI STOCK */}
        {activeTab === 'stock' && (
          <div>
            <div className="admin-header">
              <div>
                <h1 className="admin-page-title">Gemini Pro Stock Inventory</h1>
                <p className="admin-page-desc">Add single-use activation links in bulk and monitor live consumption.</p>
              </div>
            </div>

            <div className="kpi-grid">
              <div className="kpi-card">
                <div className="kpi-label">Available Links</div>
                <div className="kpi-value highlight-green">{stockData.summary.available || 0}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Consumed Links</div>
                <div className="kpi-value">{stockData.summary.consumed || 0}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Total Ingested</div>
                <div className="kpi-value">{stockData.summary.total || 0}</div>
              </div>
            </div>

            {/* Bulk Ingest Box */}
            <div className="admin-card-box">
              <h3 className="box-title">📥 Bulk Ingest Activation Links</h3>
              <p style={{ fontSize: '0.85rem', color: '#94A3B8', marginBottom: '12px' }}>
                Paste single-use Google Gemini Pro links line-by-line (e.g. <code>https://gemini.google.com/redeem/XXXXX</code>):
              </p>
              <textarea
                rows={5}
                value={bulkLinks}
                onChange={(e) => setBulkLinks(e.target.value)}
                className="admin-input"
                placeholder="https://gemini.google.com/redeem/abc123xyz&#10;https://gemini.google.com/redeem/def456uvw"
              />
              <button
                onClick={handleAddStock}
                disabled={!bulkLinks.trim()}
                style={{ background: '#078930', color: '#fff', padding: '10px 20px', borderRadius: '8px', border: 'none', fontWeight: 800, cursor: 'pointer', marginTop: '12px' }}
              >
                + Add Links to Available Stock
              </button>
            </div>

            {/* Links Table */}
            <div className="admin-card-box">
              <h3 className="box-title">Stock Items</h3>
              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Activation Payload</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>Consumed At</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockData.items.map((it: any) => (
                      <tr key={it.id}>
                        <td><code>{it.id}</code></td>
                        <td><code style={{ fontSize: '0.8rem' }}>{it.payload}</code></td>
                        <td>
                          <span className={`badge-status ${it.status}`}>{it.status.toUpperCase()}</span>
                        </td>
                        <td style={{ fontSize: '0.8rem', color: '#94A3B8' }}>{new Date(it.created_at).toLocaleDateString()}</td>
                        <td style={{ fontSize: '0.8rem', color: '#94A3B8' }}>{it.consumed_at ? new Date(it.consumed_at).toLocaleString() : '—'}</td>
                        <td>
                          {it.status === 'available' && (
                            <button className="btn-sm-action btn-reject" onClick={() => handleDeleteStock(it.id)}>
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: USERS & CRM */}
        {activeTab === 'users' && (
          <div>
            <div className="admin-header">
              <div>
                <h1 className="admin-page-title">User Directory &amp; CRM</h1>
                <p className="admin-page-desc">Directory of all registered Telegram bot users, verified phone numbers, and orders.</p>
              </div>
              <input
                type="text"
                placeholder="Search user, @username, phone..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                style={{ background: '#141E2B', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', padding: '8px 14px', borderRadius: '8px', width: '280px' }}
              />
            </div>

            <div className="admin-card-box">
              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Telegram ID</th>
                      <th>Username</th>
                      <th>Phone Number</th>
                      <th>Registration Status</th>
                      <th>Language</th>
                      <th>Joined Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u: any) => (
                      <tr key={u.id}>
                        <td><code>{u.id}</code></td>
                        <td><strong>{u.username ? `@${u.username}` : 'No Username'}</strong></td>
                        <td>
                          {u.phone_number ? (
                            <span style={{ color: '#10B981', fontWeight: 700 }}>{u.phone_number}</span>
                          ) : (
                            <span style={{ color: '#64748B' }}>Unregistered</span>
                          )}
                        </td>
                        <td>
                          {u.is_registered === 1 ? (
                            <span className="badge-status fulfilled">Verified</span>
                          ) : (
                            <span className="badge-status awaiting_payment">Pending</span>
                          )}
                        </td>
                        <td>{u.language_code?.toUpperCase() || 'EN'}</td>
                        <td style={{ fontSize: '0.8rem', color: '#94A3B8' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: STORE SETTINGS */}
        {activeTab === 'settings' && (
          <div>
            <div className="admin-header">
              <div>
                <h1 className="admin-page-title">Store &amp; Exchange Rate Controls</h1>
                <p className="admin-page-desc">Instant updates to Ethiopian local bank accounts, exchange rates, and support handles.</p>
              </div>
            </div>

            {settingsSaved && (
              <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10B981', padding: '12px 16px', borderRadius: '8px', color: '#10B981', fontWeight: 700, marginBottom: '20px' }}>
                Settings updated successfully. All changes are live across bot and web app.
              </div>
            )}

            <form onSubmit={handleSaveSettings}>
              <div className="admin-card-box">
                <h3 className="box-title">💱 Exchange Rate Engine</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
                  <div className="form-group">
                    <label className="form-label">ETB per 1 Telegram Star (XTR)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={settings.etb_per_star || '2.5'}
                      onChange={(e) => setSettings({ ...settings, etb_per_star: e.target.value })}
                      className="admin-input"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">ETB per 1 USD (Baseline)</label>
                    <input
                      type="number"
                      step="1"
                      value={settings.etb_per_usd || '135'}
                      onChange={(e) => setSettings({ ...settings, etb_per_usd: e.target.value })}
                      className="admin-input"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Crypto Margin Percentage (%)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={settings.margin_pct || '5'}
                      onChange={(e) => setSettings({ ...settings, margin_pct: e.target.value })}
                      className="admin-input"
                    />
                  </div>
                </div>
              </div>

              <div className="admin-card-box">
                <h3 className="box-title">🏦 Bank &amp; Payment Accounts</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
                  <div className="form-group">
                    <label className="form-label">CBE Account Number</label>
                    <input
                      type="text"
                      value={settings.cbe_account || ''}
                      onChange={(e) => setSettings({ ...settings, cbe_account: e.target.value })}
                      className="admin-input"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">CBE Account Name</label>
                    <input
                      type="text"
                      value={settings.cbe_name || ''}
                      onChange={(e) => setSettings({ ...settings, cbe_name: e.target.value })}
                      className="admin-input"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Telebirr Mobile Number</label>
                    <input
                      type="text"
                      value={settings.telebirr_account || ''}
                      onChange={(e) => setSettings({ ...settings, telebirr_account: e.target.value })}
                      className="admin-input"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Telebirr Merchant Name</label>
                    <input
                      type="text"
                      value={settings.telebirr_name || ''}
                      onChange={(e) => setSettings({ ...settings, telebirr_name: e.target.value })}
                      className="admin-input"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Bank of Abyssinia Account</label>
                    <input
                      type="text"
                      value={settings.abyssinia_account || ''}
                      onChange={(e) => setSettings({ ...settings, abyssinia_account: e.target.value })}
                      className="admin-input"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Support Telegram Handle</label>
                    <input
                      type="text"
                      value={settings.support_username || ''}
                      onChange={(e) => setSettings({ ...settings, support_username: e.target.value })}
                      className="admin-input"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                style={{ background: '#078930', color: '#fff', padding: '14px 28px', borderRadius: '8px', border: 'none', fontWeight: 800, fontSize: '1rem', cursor: 'pointer' }}
              >
                💾 Save All Settings
              </button>
            </form>
          </div>
        )}

        {/* TAB 6: BROADCAST ANNOUNCEMENTS */}
        {activeTab === 'broadcast' && (
          <div>
            <div className="admin-header">
              <div>
                <h1 className="admin-page-title">Broadcast Announcements</h1>
                <p className="admin-page-desc">Deliver announcements, discounts, and restock alerts to your customer base.</p>
              </div>
            </div>

            {broadcastResult && (
              <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10B981', padding: '14px', borderRadius: '8px', color: '#10B981', fontWeight: 700, marginBottom: '20px' }}>
                ✅ Broadcast completed! Sent: {broadcastResult.sentCount} / Targeted: {broadcastResult.totalTargeted} (Failed: {broadcastResult.failCount})
              </div>
            )}

            <div className="admin-card-box">
              <div className="form-group">
                <label className="form-label">Select Target Audience</label>
                <select
                  value={broadcastTarget}
                  onChange={(e) => setBroadcastTarget(e.target.value as any)}
                  className="admin-input"
                >
                  <option value="all">All Users ({users.length} total users)</option>
                  <option value="active_buyers">Active Settled Buyers Only</option>
                  <option value="registered">Phone-Verified Users Only</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Message Content (HTML Allowed: &lt;b&gt;, &lt;i&gt;, &lt;code&gt;)</label>
                <textarea
                  rows={6}
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  className="admin-input"
                  placeholder="<b>Restock Alert:</b> New Gemini Pro links are now available at 1,500 ETB!"
                />
              </div>

              <button
                onClick={handleSendBroadcast}
                disabled={broadcasting || !broadcastMessage.trim()}
                style={{ background: '#078930', color: '#fff', padding: '12px 24px', borderRadius: '8px', border: 'none', fontWeight: 800, cursor: 'pointer' }}
              >
                {broadcasting ? 'Broadcasting...' : '📢 Send Broadcast Message'}
              </button>
            </div>
          </div>
        )}
      </main>

      {/* MODAL 1: RECEIPT PREVIEW MODAL */}
      {modalType === 'receipt' && selectedOrder && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#141E2B', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '16px', padding: '24px', maxWidth: '500px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>Receipt for Order #{selectedOrder.id}</h3>
              <button onClick={() => setModalType(null)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.2rem', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ background: '#0F1722', padding: '14px', borderRadius: '8px', marginBottom: '14px', fontSize: '0.88rem' }}>
              <div>• <strong>Buyer:</strong> {selectedOrder.username ? `@${selectedOrder.username}` : selectedOrder.user_id}</div>
              <div>• <strong>Amount:</strong> {selectedOrder.amount_etb.toLocaleString()} ETB ({selectedOrder.payment_rail.toUpperCase()})</div>
              <div>• <strong>Note / Ref:</strong> {selectedOrder.receipt_note || 'None'}</div>
            </div>

            {selectedOrder.receipt_file_id?.startsWith('data:image') || selectedOrder.receipt_file_id?.startsWith('base64') ? (
              <img src={selectedOrder.receipt_file_id} alt="Receipt" style={{ width: '100%', maxHeight: '300px', objectFit: 'contain', borderRadius: '8px', marginBottom: '16px', border: '1px solid rgba(255,255,255,0.1)' }} />
            ) : (
              <div style={{ padding: '20px', textAlign: 'center', color: '#94A3B8', background: '#0F1722', borderRadius: '8px', marginBottom: '16px' }}>
                Telegram Photo File ID: <code>{selectedOrder.receipt_file_id}</code>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              {selectedOrder.status === 'pending_approval' && (
                <button
                  className="btn-sm-action btn-approve"
                  style={{ flex: 1, padding: '10px' }}
                  onClick={() => handleApprove(selectedOrder.id)}
                >
                  Approve Receipt
                </button>
              )}
              <button
                className="btn-sm-action btn-view"
                style={{ flex: 1, padding: '10px' }}
                onClick={() => setModalType(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: REJECT MODAL */}
      {modalType === 'reject' && selectedOrder && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#141E2B', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '16px', padding: '24px', maxWidth: '440px', width: '100%' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '10px' }}>Reject Order #{selectedOrder.id}</h3>
            <p style={{ fontSize: '0.85rem', color: '#94A3B8', marginBottom: '14px' }}>
              Enter the reason for rejection (this will be sent directly to the buyer on Telegram):
            </p>
            <input
              type="text"
              className="admin-input"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Amount mismatch / Unreadable receipt"
              style={{ marginBottom: '16px' }}
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn-sm-action btn-reject" style={{ flex: 1, padding: '10px' }} onClick={handleReject}>
                Confirm Rejection
              </button>
              <button className="btn-sm-action btn-view" style={{ flex: 1, padding: '10px' }} onClick={() => setModalType(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: FULFILL MODAL */}
      {modalType === 'fulfill' && selectedOrder && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#141E2B', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '16px', padding: '24px', maxWidth: '440px', width: '100%' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '10px' }}>Complete Fulfillment #{selectedOrder.id}</h3>
            <p style={{ fontSize: '0.85rem', color: '#94A3B8', marginBottom: '14px' }}>
              Enter fulfillment proof note or Fragment transaction reference:
            </p>
            <input
              type="text"
              className="admin-input"
              value={fulfillProof}
              onChange={(e) => setFulfillProof(e.target.value)}
              placeholder="e.g. Fragment Gift TX 0x1234..."
              style={{ marginBottom: '16px' }}
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn-sm-action btn-approve" style={{ flex: 1, padding: '10px' }} onClick={handleFulfill}>
                Mark As Delivered
              </button>
              <button className="btn-sm-action btn-view" style={{ flex: 1, padding: '10px' }} onClick={() => setModalType(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
