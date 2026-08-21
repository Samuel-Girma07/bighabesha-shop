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
  onSessionExpired,
} from './adminApi.ts';
import {
  BarChartIcon,
  PackageIcon,
  KeyIcon,
  UsersIcon,
  MegaphoneIcon,
  SettingsIcon,
  SearchIcon,
  BellIcon,
  LogOutIcon,
  GeminiBrandIcon,
  TelegramBrandIcon,
  StarsBrandIcon,
  EyeIcon,
  EyeOffIcon,
  CopyIcon,
  TrashIcon,
} from '../components/Icons.tsx';
import './admin.css';

export const AdminDashboard: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(hasAdminSession());
  const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'stock' | 'users' | 'settings' | 'broadcast'>('overview');

  // In-App Toast Notification Engine
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'success' | 'error' | 'info' }[]>([]);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // Custom Sleek Confirmation Modal
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    actionLabel: string;
    isDanger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  // Auth State
  const [password, setPassword] = useState('');
  const [require2FA, setRequire2FA] = useState(false);
  const [adminId, setAdminId] = useState<number>(0);
  const [otp, setOtp] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Overview & Analytics Data (100% Real from Database)
  const [overview, setOverview] = useState<any>(null);
  const [timeRange, setTimeRange] = useState<string>('6M');
  const [hoveredPoint, setHoveredPoint] = useState<any | null>(null);

  // Live Auto-Sync & Real-time Polling
  const [liveSync, setLiveSync] = useState<boolean>(true);
  const [isSyncLoading, setIsSyncLoading] = useState<boolean>(false);
  const [lastSync, setLastSync] = useState<Date>(new Date());

  // Filter & Search States
  const [categoryRail, setCategoryRail] = useState<string>('all');
  const [orderFilter, setOrderFilter] = useState<string>('all');
  const [orderSearch, setOrderSearch] = useState<string>('');
  const [orders, setOrders] = useState<any[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);

  // Quick Action Modals on Overview
  const [quickStockOpen, setQuickStockOpen] = useState<boolean>(false);
  const [quickRateOpen, setQuickRateOpen] = useState<boolean>(false);
  const [newRateStars, setNewRateStars] = useState<string>('');
  const [newRateUsd, setNewRateUsd] = useState<string>('');

  // Stock, Users & Settings States
  const [stockData, setStockData] = useState<{ summary: any; items: any[] }>({ summary: {}, items: [] });
  const [bulkLinks, setBulkLinks] = useState('');
  const [stockSearch, setStockSearch] = useState('');
  const [revealedStockIds, setRevealedStockIds] = useState<Set<number>>(new Set());
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

  // Listen to 401 Session Expiry globally
  useEffect(() => {
    onSessionExpired(() => {
      setIsLoggedIn(false);
      setAuthError('Your admin session has expired. Please sign in again.');
      showToast('Your session has expired. Please log in again.', 'error');
    });
  }, []);

  const loadAllAdminData = async (range = timeRange, rail = categoryRail) => {
    try {
      setIsSyncLoading(true);
      const [ov, ords, stk, usrs, stgs] = await Promise.all([
        fetchAdminOverviewApi(range, rail).catch(() => null),
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
      setLastSync(new Date());
    } catch (err: any) {
      if (err.message && !err.message.includes('expired')) {
        console.error('Admin data load error:', err);
      }
    } finally {
      setIsSyncLoading(false);
    }
  };

  useEffect(() => {
    if (isLoggedIn) {
      loadAllAdminData(timeRange, categoryRail);
    }
  }, [isLoggedIn, orderFilter, timeRange, categoryRail]);

  // Live Sync interval
  useEffect(() => {
    if (!isLoggedIn || !liveSync) return;
    const interval = setInterval(() => {
      loadAllAdminData(timeRange, categoryRail);
    }, 10000);
    return () => clearInterval(interval);
  }, [isLoggedIn, liveSync, timeRange, categoryRail, orderFilter]);

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
          setIsSearchOpen(false);
        }
        return;
      }
      if (e.key === '1') setActiveTab('overview');
      if (e.key === '2') setActiveTab('orders');
      if (e.key === '3') setActiveTab('stock');
      if (e.key === '4') setActiveTab('users');
      if (e.key === '5') setActiveTab('broadcast');
      if (e.key === '6') setActiveTab('settings');
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        loadAllAdminData(timeRange, categoryRail);
      }
      if (e.key === '/') {
        e.preventDefault();
        const searchInput = document.getElementById('admin-global-search') as HTMLInputElement;
        if (searchInput) searchInput.focus();
      }
      if (e.key === 'Escape') {
        setModalType(null);
        setQuickStockOpen(false);
        setQuickRateOpen(false);
        setIsSearchOpen(false);
        setConfirmModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [timeRange, categoryRail]);

  // Auth Handlers
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await adminLoginApi(password);
      setRequire2FA(true);
      setAdminId(res.adminId);
      showToast('2FA verification code dispatched to Telegram', 'info');
    } catch (err: any) {
      setAuthError(err.message || 'Login failed');
      showToast(err.message || 'Login failed', 'error');
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
      showToast('Authenticated successfully as Administrator', 'success');
    } catch (err: any) {
      setAuthError(err.message || '2FA verification failed');
      showToast(err.message || '2FA verification failed', 'error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    clearAdminToken();
    setIsLoggedIn(false);
    setPassword('');
    setOtp('');
    showToast('Signed out of admin portal.', 'info');
  };

  // Order Actions
  const handleApprove = (orderId: string) => {
    setConfirmModal({
      title: 'Approve Payment Transfer',
      message: `Approve Order #${orderId}? This will automatically deliver activation credentials to the buyer immediately.`,
      actionLabel: 'Approve Transfer',
      isDanger: false,
      onConfirm: async () => {
        try {
          await approveOrderApi(orderId);
          showToast(`Order #${orderId} approved and fulfilled!`, 'success');
          loadAllAdminData();
          if (modalType) setModalType(null);
        } catch (err: any) {
          showToast(err.message || 'Failed to approve order', 'error');
        } finally {
          setConfirmModal(null);
        }
      },
    });
  };

  const handleReject = async () => {
    if (!selectedOrder || !rejectReason.trim()) {
      showToast('Please enter a rejection reason for the buyer.', 'error');
      return;
    }
    try {
      await rejectOrderApi(selectedOrder.id, rejectReason);
      showToast(`Order #${selectedOrder.id} rejected.`, 'info');
      setModalType(null);
      setRejectReason('');
      loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to reject order', 'error');
    }
  };

  const handleFulfill = async () => {
    if (!selectedOrder) return;
    try {
      await fulfillOrderApi(selectedOrder.id, fulfillProof);
      showToast(`Order #${selectedOrder.id} marked as delivered!`, 'success');
      setModalType(null);
      setFulfillProof('');
      loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to fulfill order', 'error');
    }
  };

  // Stock Actions
  const toggleRevealStock = (id: number) => {
    setRevealedStockIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const copyStockLink = (payload: string) => {
    navigator.clipboard.writeText(payload);
    showToast('Secret activation link copied to clipboard!', 'success');
  };

  const handleAddStock = async () => {
    if (!bulkLinks.trim()) {
      showToast('Please paste at least one activation link.', 'error');
      return;
    }
    try {
      const res = await addStockLinksApi(bulkLinks);
      if (res.duplicateCount && res.duplicateCount > 0 && res.addedCount > 0) {
        showToast(`Added ${res.addedCount} new link(s) (${res.duplicateCount} duplicate links skipped)`, 'info');
      } else {
        showToast(`Successfully added ${res.addedCount} activation link(s) to stock!`, 'success');
      }
      setBulkLinks('');
      loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to add stock', 'error');
    }
  };

  const handleDeleteStock = (id: string) => {
    setConfirmModal({
      title: 'Delete Stock Item',
      message: 'Are you sure you want to remove this activation link from stock?',
      actionLabel: 'Delete Item',
      isDanger: true,
      onConfirm: async () => {
        try {
          await deleteStockItemApi(id);
          showToast('Stock item removed.', 'info');
          loadAllAdminData();
        } catch (err: any) {
          showToast(err.message || 'Failed to delete item', 'error');
        } finally {
          setConfirmModal(null);
        }
      },
    });
  };

  // Settings Actions
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateAdminSettingsApi(settings);
      setSettingsSaved(true);
      showToast('Store settings saved successfully!', 'success');
      setTimeout(() => setSettingsSaved(false), 3000);
      loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to save settings', 'error');
    }
  };

  // Broadcast Action
  const handleSendBroadcast = () => {
    if (!broadcastMessage.trim()) {
      showToast('Please enter a message to broadcast.', 'error');
      return;
    }
    setConfirmModal({
      title: 'Confirm Broadcast',
      message: `Send this broadcast notification to all ${broadcastTarget.toUpperCase()} users?`,
      actionLabel: 'Send Broadcast',
      isDanger: false,
      onConfirm: async () => {
        setBroadcasting(true);
        setBroadcastResult(null);
        try {
          const res = await broadcastMessageApi(broadcastMessage, broadcastTarget);
          setBroadcastResult(res);
          showToast(`Broadcast delivered to ${res.sentCount} users!`, 'success');
          setBroadcastMessage('');
        } catch (err: any) {
          showToast(err.message || 'Broadcast failed', 'error');
        } finally {
          setBroadcasting(false);
          setConfirmModal(null);
        }
      },
    });
  };

  // -------------------------------------------------------------
  // Unauthenticated Login Screen
  // -------------------------------------------------------------
  if (!isLoggedIn) {
    return (
      <div className="admin-viewport" style={{ alignItems: 'center' }}>
        <div style={{ background: '#0E131B', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '24px', padding: '40px 32px', width: '100%', maxWidth: '420px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.7)' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '16px', background: 'linear-gradient(135deg, #059669 0%, #008A45 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto', fontSize: '1.4rem', fontWeight: 800, color: '#fff', boxShadow: '0 4px 20px rgba(5, 150, 105, 0.4)' }}>
            B
          </div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#FFFFFF', margin: '0 0 6px 0' }}>Bighabesha Admin</h2>
          <p style={{ fontSize: '0.85rem', color: '#94A3B8', margin: '0 0 24px 0' }}>
            {require2FA ? 'Enter the 6-digit 2FA code sent to your Telegram' : 'Sign in with your master password'}
          </p>

          {authError && (
            <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #EF4444', padding: '10px', borderRadius: '10px', color: '#FCA5A5', fontSize: '0.85rem', marginBottom: '16px' }}>
              {authError}
            </div>
          )}

          {!require2FA ? (
            <form onSubmit={handleLoginSubmit}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: '100%', background: '#131A24', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 14px', borderRadius: '12px', color: '#fff', fontSize: '0.92rem', outline: 'none', boxSizing: 'border-box', marginBottom: '16px' }}
                placeholder="Enter master password"
                required
              />
              <button
                type="submit"
                disabled={authLoading || !password}
                style={{ width: '100%', background: 'linear-gradient(135deg, #059669 0%, #008A45 100%)', color: '#fff', padding: '12px', borderRadius: '12px', border: 'none', fontWeight: 800, fontSize: '0.95rem', cursor: 'pointer', boxShadow: '0 4px 15px rgba(5, 150, 105, 0.4)' }}
              >
                {authLoading ? 'Verifying...' : 'Next: Send Telegram 2FA Code →'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerify2FASubmit}>
              <input
                type="text"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                style={{ width: '100%', background: '#131A24', border: '1px solid #059669', padding: '12px 14px', borderRadius: '12px', color: '#fff', fontSize: '1.5rem', fontWeight: 800, textAlign: 'center', letterSpacing: '8px', outline: 'none', boxSizing: 'border-box', marginBottom: '16px' }}
                placeholder="000000"
                required
              />
              <button
                type="submit"
                disabled={authLoading || otp.length < 6}
                style={{ width: '100%', background: 'linear-gradient(135deg, #059669 0%, #008A45 100%)', color: '#fff', padding: '12px', borderRadius: '12px', border: 'none', fontWeight: 800, fontSize: '0.95rem', cursor: 'pointer', boxShadow: '0 4px 15px rgba(5, 150, 105, 0.4)' }}
              >
                {authLoading ? 'Authenticating...' : 'Verify 2FA & Enter Portal'}
              </button>
              <button
                type="button"
                onClick={() => setRequire2FA(false)}
                style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '0.82rem', marginTop: '14px', cursor: 'pointer' }}
              >
                « Back to Password
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Real SVG Area Chart Renderer
  // -------------------------------------------------------------
  const chartPoints: { label: string; revenue: number; orders: number }[] = overview?.chartPoints || [];
  const maxRevenue = Math.max(...chartPoints.map((p) => p.revenue), 1000);

  const svgWidth = 760;
  const svgHeight = 150;
  const paddingX = 30;
  const paddingY = 20;

  const getCoordinates = () => {
    if (chartPoints.length === 0) return [];
    return chartPoints.map((pt, idx) => {
      const x = paddingX + (idx / Math.max(chartPoints.length - 1, 1)) * (svgWidth - paddingX * 2);
      const y = svgHeight - paddingY - (pt.revenue / maxRevenue) * (svgHeight - paddingY * 2);
      return { x, y, pt };
    });
  };

  const coords = getCoordinates();

  const createSmoothPath = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cp1x = p0.x + (p1.x - p0.x) / 2;
      const cp1y = p0.y;
      const cp2x = p0.x + (p1.x - p0.x) / 2;
      const cp2y = p1.y;
      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
    }
    return path;
  };

  const linePath = createSmoothPath(coords);
  const areaPath = coords.length > 0
    ? `${linePath} L ${coords[coords.length - 1].x} ${svgHeight} L ${coords[0].x} ${svgHeight} Z`
    : '';

  // Filtered Orders & Users
  const filteredOrders = orders.filter((o) => {
    if (categoryRail !== 'all' && o.payment_rail !== categoryRail) return false;
    return true;
  });

  const filteredUsers = users.filter((u) =>
    !userSearch ||
    String(u.id).includes(userSearch) ||
    u.username?.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.phone_number?.includes(userSearch)
  );

  // -------------------------------------------------------------
  // Authenticated Main Workspace
  // -------------------------------------------------------------
  return (
    <div className="admin-viewport">
      <div className="admin-app-window">
        {/* Left Sidebar */}
        <aside className="admin-sidebar">
          <div className="admin-brand">
            <div className="admin-logo-box">B</div>
            <div>
              <div className="admin-brand-text">Bighabesha</div>
              <div style={{ fontSize: '0.7rem', color: '#10B981', fontWeight: 700 }}>EXECUTIVE PORTAL</div>
            </div>
          </div>

          <nav className="admin-nav">
            <button className={`admin-nav-item ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
              <BarChartIcon size={18} />
              <span>Dashboard</span>
            </button>
            <button className={`admin-nav-item ${activeTab === 'orders' ? 'active' : ''}`} onClick={() => setActiveTab('orders')}>
              <PackageIcon size={18} />
              <span>Orders &amp; Receipts ({overview?.metrics?.pendingApprovalOrders || 0})</span>
            </button>
            <button className={`admin-nav-item ${activeTab === 'stock' ? 'active' : ''}`} onClick={() => setActiveTab('stock')}>
              <KeyIcon size={18} />
              <span>Gemini Stock ({stockData.summary.available || 0})</span>
            </button>
            <button className={`admin-nav-item ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
              <UsersIcon size={18} />
              <span>User CRM ({users.length})</span>
            </button>
            <button className={`admin-nav-item ${activeTab === 'broadcast' ? 'active' : ''}`} onClick={() => setActiveTab('broadcast')}>
              <MegaphoneIcon size={18} />
              <span>Broadcast Tool</span>
            </button>
            <button className={`admin-nav-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
              <SettingsIcon size={18} />
              <span>Store Settings</span>
            </button>
            <div className="sidebar-divider" />
            <button className="admin-logout-btn" onClick={handleLogout}>
              <LogOutIcon size={18} />
              <span>Sign Out</span>
            </button>
          </nav>
        </aside>

        {/* Main Workspace */}
        <main className="admin-workspace">
          {/* Top Bar */}
          <div className="admin-topbar">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h1 className="greeting-title">Welcome, Administrator</h1>
                <div
                  className="live-sync-pill"
                  onClick={() => setLiveSync(!liveSync)}
                  title={liveSync ? 'Live Auto-Sync Active (Click to pause)' : 'Sync Paused (Click to resume)'}
                >
                  <span className={liveSync ? 'pulse-dot' : ''} style={{ background: liveSync ? '#10B981' : '#64748B' }} />
                  <span>{liveSync ? 'Live Sync' : 'Paused'}</span>
                </div>
                <button
                  className="dash-pill-btn"
                  onClick={() => loadAllAdminData(timeRange, categoryRail)}
                  title="Manual Sync (Shortcut: R)"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <span className={isSyncLoading ? 'sync-rotate-anim' : ''}>↻</span>
                  <span>Sync</span>
                  <span className="kbd-shortcut">R</span>
                </button>
              </div>
              <div className="greeting-subtitle">
                Live digital store performance overview • Last synced {lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
            </div>

            <div className="topbar-right">
              {/* Universal Search Box with Auto-Dropdown */}
              <div className="search-wrapper-rel">
                <div className="search-pill-box">
                  <SearchIcon size={16} color="#94A3B8" />
                  <input
                    id="admin-global-search"
                    type="text"
                    placeholder="Search orders, @users... (/)"
                    value={orderSearch}
                    onFocus={() => setIsSearchOpen(true)}
                    onChange={(e) => {
                      setOrderSearch(e.target.value);
                      setIsSearchOpen(true);
                    }}
                    className="search-pill-input"
                  />
                  {orderSearch && (
                    <button
                      onClick={() => { setOrderSearch(''); setIsSearchOpen(false); }}
                      style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Live Search Quick Results Dropdown */}
                {isSearchOpen && orderSearch.trim().length > 1 && (
                  <div className="global-search-dropdown">
                    <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '8px', padding: '0 4px' }}>
                      Quick Matches
                    </div>
                    {orders
                      .filter((o) =>
                        o.id.toLowerCase().includes(orderSearch.toLowerCase()) ||
                        (o.username && o.username.toLowerCase().includes(orderSearch.toLowerCase())) ||
                        o.product_id.toLowerCase().includes(orderSearch.toLowerCase())
                      )
                      .slice(0, 5)
                      .map((o) => (
                        <div
                          key={o.id}
                          className="search-result-item"
                          onClick={() => {
                            setSelectedOrder(o);
                            setModalType('receipt');
                            setIsSearchOpen(false);
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#FFFFFF' }}>
                              {o.username ? `@${o.username}` : `Order #${o.id.slice(0, 8)}`}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>{o.product_id} • {o.payment_rail?.toUpperCase()}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#10B981' }}>{o.amount_etb} ETB</div>
                            <div style={{ fontSize: '0.7rem', color: o.status === 'fulfilled' ? '#10B981' : '#F59E0B' }}>{o.status}</div>
                          </div>
                        </div>
                      ))}
                    {orders.filter((o) => o.id.toLowerCase().includes(orderSearch.toLowerCase()) || (o.username && o.username.toLowerCase().includes(orderSearch.toLowerCase()))).length === 0 && (
                      <div style={{ padding: '12px', textAlign: 'center', color: '#64748B', fontSize: '0.8rem' }}>
                        No orders matching "{orderSearch}"
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="icon-btn-pill" onClick={() => { setActiveTab('orders'); setOrderFilter('pending_approval'); }} title="Pending Receipts">
                <BellIcon size={18} />
                {overview?.metrics?.pendingApprovalOrders > 0 && <span className="icon-badge-dot" />}
              </div>

              <div className="admin-profile-pill">
                <div className="profile-avatar">A</div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#FFFFFF' }}>Admin Primary</div>
              </div>
            </div>
          </div>

          {/* Category Rail Filter Pills with Dynamic Counts */}
          <div className="filter-pills-row">
            {[
              { id: 'all', label: 'All Rails' },
              { id: 'cbe', label: 'CBE Birr' },
              { id: 'telebirr', label: 'Telebirr' },
              { id: 'abyssinia', label: 'Bank of Abyssinia' },
              { id: 'stars', label: 'Telegram Stars' },
              { id: 'wallet_pay', label: 'Crypto (TON / USDT)' },
            ].map((rail) => {
              const railData = (overview?.railBreakdown || []).find((r: any) => r.payment_rail === rail.id);
              return (
                <button
                  key={rail.id}
                  className={`filter-pill ${categoryRail === rail.id ? 'active' : ''}`}
                  onClick={() => setCategoryRail(rail.id)}
                >
                  <span>{rail.label}</span>
                  {railData && railData.count > 0 && (
                    <span className="rail-count-badge">{railData.count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div>
              {/* Row 1: Top 4 KPI Metrics */}
              <div className="admin-metrics-row">
                {/* Metric 1: Settled Revenue */}
                <div className="kpi-stat-card">
                  <div className="kpi-top-meta">
                    <span className="kpi-label">Total Settled Revenue</span>
                    <button className="dash-pill-btn" onClick={() => setTimeRange(timeRange === '6M' ? '1Y' : '6M')}>
                      {timeRange} ▾
                    </button>
                  </div>
                  <div className="kpi-hero-value">
                    {(overview?.metrics?.totalRevenueETB || 0).toLocaleString()}
                    <span className="kpi-hero-unit">ETB</span>
                  </div>
                  <div className="kpi-footer-sub">
                    <span>{categoryRail === 'all' ? 'All Payment Rails' : categoryRail.toUpperCase() + ' Volume'}</span>
                    <span style={{ color: '#10B981' }}>100% Settled</span>
                  </div>
                </div>

                {/* Metric 2: Pending Approval */}
                <div className="kpi-stat-card">
                  <div className="kpi-top-meta">
                    <span className="kpi-label">Pending Verification</span>
                    <div className="kpi-icon-badge">
                      <PackageIcon size={18} color={overview?.metrics?.pendingApprovalOrders > 0 ? '#F59E0B' : '#10B981'} />
                    </div>
                  </div>
                  <div className="kpi-hero-value">
                    {overview?.metrics?.pendingApprovalOrders || 0}
                    <span className="kpi-hero-unit">Orders</span>
                  </div>
                  <div className="kpi-footer-sub">
                    <span>Awaiting receipt review</span>
                    <button className="kpi-quick-btn" onClick={() => { setActiveTab('orders'); setOrderFilter('pending_approval'); }}>
                      Review Queue ↗
                    </button>
                  </div>
                </div>

                {/* Metric 3: Gemini Stock */}
                <div className="kpi-stat-card">
                  <div className="kpi-top-meta">
                    <span className="kpi-label">Gemini Stock Ready</span>
                    <div className="kpi-icon-badge">
                      <KeyIcon size={18} color="#38BDF8" />
                    </div>
                  </div>
                  <div className="kpi-hero-value">
                    {stockData.summary.available || 0}
                    <span className="kpi-hero-unit">Links</span>
                  </div>
                  <div className="kpi-footer-sub">
                    <span>Instant auto-delivery</span>
                    <button className="kpi-quick-btn" onClick={() => setQuickStockOpen(true)}>
                      + Add Stock
                    </button>
                  </div>
                </div>

                {/* Metric 4: Registered CRM Users */}
                <div className="kpi-stat-card">
                  <div className="kpi-top-meta">
                    <span className="kpi-label">Verified Customers</span>
                    <div className="kpi-icon-badge">
                      <UsersIcon size={18} color="#10B981" />
                    </div>
                  </div>
                  <div className="kpi-hero-value">
                    {overview?.metrics?.registeredUsers || 0}
                    <span className="kpi-hero-unit">/ {overview?.metrics?.totalUsers || 0}</span>
                  </div>
                  <div className="kpi-footer-sub">
                    <span>+251 Verified Phone</span>
                    <button className="kpi-quick-btn" onClick={() => setActiveTab('users')}>
                      CRM Directory ↗
                    </button>
                  </div>
                </div>
              </div>

              {/* Row 2: Dual Workspaces (Product Breakdown & Recent Activity) */}
              <div className="admin-dual-grid">
                {/* Left Card: Wide Product Breakdown */}
                <div className="dash-card">
                  <div className="dash-card-header">
                    <div>
                      <div className="dash-card-title">Product Sales &amp; Inventory</div>
                      <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginTop: '2px' }}>Real-time revenue, units, and inventory volume distribution</div>
                    </div>
                    <button className="dash-pill-btn" onClick={() => setActiveTab('orders')}>
                      Full Orders ↗
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {/* 1. Gemini Pro 18M */}
                    {(() => {
                      const p = (overview?.productStats || []).find((x: any) => x.id === 'gemini_pro_18m') || { revenue: 0, units: 0, pctOfTotal: '0%' };
                      const pctNum = parseFloat(p.pctOfTotal) || 0;
                      return (
                        <div className="product-row-item">
                          <div className="product-row-top">
                            <div className="product-row-identity">
                              <div className="product-avatar-box">
                                <GeminiBrandIcon size={24} />
                              </div>
                              <div>
                                <div className="product-title-bold">Gemini Pro (18 Months)</div>
                                <div className="product-sku-tag">SKU: GEMINI-18M • Google AI Suite &amp; 2TB</div>
                              </div>
                            </div>
                            <div className="product-financials">
                              <div className="product-rev-amount">{p.revenue.toLocaleString()} ETB</div>
                              <div className="product-units-sold">{p.units} units sold</div>
                            </div>
                          </div>
                          <div className="volume-bar-track">
                            <div className="volume-bar-fill" style={{ width: `${Math.max(pctNum, p.revenue > 0 ? 15 : 0)}%`, background: 'linear-gradient(90deg, #38BDF8, #818CF8)' }} />
                          </div>
                          <div className="volume-meta-row">
                            <span>{p.pctOfTotal} of total revenue</span>
                            <span style={{ color: stockData.summary.available > 0 ? '#10B981' : '#EF4444' }}>
                              {stockData.summary.available || 0} links available in stock
                            </span>
                          </div>
                        </div>
                      );
                    })()}

                    {/* 2. Telegram Premium */}
                    {(() => {
                      const p = (overview?.productStats || []).find((x: any) => x.id === 'telegram_premium') || { revenue: 0, units: 0, pctOfTotal: '0%' };
                      const pctNum = parseFloat(p.pctOfTotal) || 0;
                      return (
                        <div className="product-row-item">
                          <div className="product-row-top">
                            <div className="product-row-identity">
                              <div className="product-avatar-box">
                                <TelegramBrandIcon size={24} />
                              </div>
                              <div>
                                <div className="product-title-bold">Telegram Premium</div>
                                <div className="product-sku-tag">SKU: TG-PREM • 3, 6, 12 Months Subscriptions</div>
                              </div>
                            </div>
                            <div className="product-financials">
                              <div className="product-rev-amount">{p.revenue.toLocaleString()} ETB</div>
                              <div className="product-units-sold">{p.units} gifts fulfilled</div>
                            </div>
                          </div>
                          <div className="volume-bar-track">
                            <div className="volume-bar-fill" style={{ width: `${Math.max(pctNum, p.revenue > 0 ? 15 : 0)}%`, background: 'linear-gradient(90deg, #8B5CF6, #6366F1)' }} />
                          </div>
                          <div className="volume-meta-row">
                            <span>{p.pctOfTotal} of total revenue</span>
                            <span>Direct Fragment @username delivery</span>
                          </div>
                        </div>
                      );
                    })()}

                    {/* 3. Telegram Stars */}
                    {(() => {
                      const p = (overview?.productStats || []).find((x: any) => x.id === 'telegram_stars') || { revenue: 0, units: 0, pctOfTotal: '0%' };
                      const pctNum = parseFloat(p.pctOfTotal) || 0;
                      return (
                        <div className="product-row-item">
                          <div className="product-row-top">
                            <div className="product-row-identity">
                              <div className="product-avatar-box">
                                <StarsBrandIcon size={24} />
                              </div>
                              <div>
                                <div className="product-title-bold">Telegram Stars (Coins)</div>
                                <div className="product-sku-tag">SKU: TG-STARS • In-App Currency &amp; Gifts</div>
                              </div>
                            </div>
                            <div className="product-financials">
                              <div className="product-rev-amount">{p.revenue.toLocaleString()} ETB</div>
                              <div className="product-units-sold">{p.units} coins minted</div>
                            </div>
                          </div>
                          <div className="volume-bar-track">
                            <div className="volume-bar-fill" style={{ width: `${Math.max(pctNum, p.revenue > 0 ? 15 : 0)}%`, background: 'linear-gradient(90deg, #F59E0B, #FBBF24)' }} />
                          </div>
                          <div className="volume-meta-row">
                            <span>{p.pctOfTotal} of total revenue</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span>Rate: {settings.etb_per_star || '2.5'} ETB / Star</span>
                              <button
                                className="kpi-quick-btn"
                                onClick={() => {
                                  setNewRateStars(settings.etb_per_star || '2.5');
                                  setNewRateUsd(settings.usd_to_etb_rate || '135');
                                  setQuickRateOpen(true);
                                }}
                              >
                                Edit ⚙
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Right Card: Recent Activity Stream */}
                <div className="dash-card">
                  <div className="dash-card-header">
                    <div>
                      <div className="dash-card-title">Recent Activity Stream</div>
                      <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginTop: '2px' }}>Live incoming orders and transfer confirmations (Click to review)</div>
                    </div>
                    <button className="dash-pill-btn" onClick={() => setActiveTab('orders')}>
                      See all orders ↗
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
                    {(overview?.recentOrders || []).length === 0 ? (
                      <div style={{ textAlign: 'center', color: '#64748B', fontSize: '0.88rem', padding: '40px 20px' }}>
                        <div style={{ fontSize: '1.8rem', marginBottom: '10px', opacity: 0.5 }}>📦</div>
                        <div style={{ fontWeight: 700, color: '#94A3B8', marginBottom: '4px' }}>No orders recorded yet</div>
                        <div style={{ fontSize: '0.78rem', color: '#64748B' }}>Live customer orders will appear here automatically in real-time.</div>
                      </div>
                    ) : (
                      (overview?.recentOrders || []).map((ord: any) => (
                        <div
                          key={ord.id}
                          className="activity-row"
                          onClick={() => {
                            setSelectedOrder(ord);
                            setModalType('receipt');
                          }}
                          style={{ cursor: 'pointer' }}
                          title="Click to inspect and approve receipt"
                        >
                          <div className="activity-info">
                            <div className="activity-badge-icon">
                              {ord.product_id?.includes('gemini') ? (
                                <GeminiBrandIcon size={20} />
                              ) : ord.product_id?.includes('prem') ? (
                                <TelegramBrandIcon size={20} />
                              ) : (
                                <StarsBrandIcon size={20} />
                              )}
                            </div>
                            <div>
                              <div className="activity-name">{ord.username ? `@${ord.username}` : `User #${ord.user_id}`}</div>
                              <div className="activity-sub">{ord.product_id} • {ord.payment_rail?.toUpperCase()}</div>
                            </div>
                          </div>
                          <div className="activity-val">
                            <div className="activity-price">{ord.amount_etb.toLocaleString()} ETB</div>
                            <div className="activity-status-tag" style={{ color: ord.status === 'fulfilled' ? '#10B981' : '#F59E0B' }}>
                              {ord.status === 'fulfilled' ? '+ Settled' : '• ' + ord.status.replace('_', ' ')}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Row 3: Full-Width Real Performance Area Chart */}
              <div className="chart-container-card">
                <div className="chart-header">
                  <div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#FFFFFF' }}>Store Revenue Performance</div>
                    <div style={{ fontSize: '0.8rem', color: '#94A3B8', marginTop: '2px' }}>Real aggregate sales calculated from confirmed orders</div>
                  </div>

                  <div className="timeframe-toggles">
                    {['1D', '1W', '1M', '6M', '1Y'].map((tf) => (
                      <button
                        key={tf}
                        className={`tf-btn ${timeRange === tf ? 'active' : ''}`}
                        onClick={() => setTimeRange(tf)}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>
                </div>

                {/* SVG Line & Area Chart */}
                <div className="svg-chart-wrap" style={{ position: 'relative' }}>
                  <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ width: '100%', height: '100%', overflow: 'visible' }}>
                    <defs>
                      <linearGradient id="emeraldAreaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#059669" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#008A45" stopOpacity="0.0" />
                      </linearGradient>
                      <filter id="emeraldGlow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#10B981" floodOpacity="0.5" />
                      </filter>
                    </defs>

                    {/* Horizontal Grid Track Lines */}
                    <line x1="20" y1="30" x2="740" y2="30" stroke="rgba(255,255,255,0.04)" strokeDasharray="4 4" />
                    <line x1="20" y1="75" x2="740" y2="75" stroke="rgba(255,255,255,0.04)" strokeDasharray="4 4" />
                    <line x1="20" y1="120" x2="740" y2="120" stroke="rgba(255,255,255,0.06)" />

                    {/* Area fill */}
                    {areaPath && <path d={areaPath} fill="url(#emeraldAreaGradient)" />}

                    {/* Glowing Stroke Curve */}
                    {linePath && (
                      <path
                        d={linePath}
                        fill="none"
                        stroke="#10B981"
                        strokeWidth="3"
                        strokeLinecap="round"
                        filter="url(#emeraldGlow)"
                      />
                    )}

                    {/* Data Points */}
                    {coords.map((c, i) => (
                      <g key={i} onMouseEnter={() => setHoveredPoint(c)} onMouseLeave={() => setHoveredPoint(null)}>
                        <circle
                          cx={c.x}
                          cy={c.y}
                          r={hoveredPoint?.pt?.label === c.pt.label ? 6 : 4}
                          fill="#FFFFFF"
                          stroke="#008A45"
                          strokeWidth="3"
                          style={{ cursor: 'pointer', transition: 'all 0.2s' }}
                        />
                      </g>
                    ))}
                  </svg>

                  {/* Tooltip on Active Point */}
                  {hoveredPoint && (
                    <div
                      className="chart-tooltip-bubble"
                      style={{
                        left: `${(hoveredPoint.x / svgWidth) * 100}%`,
                        top: `${(hoveredPoint.y / svgHeight) * 100}%`,
                      }}
                    >
                      <div className="tooltip-date">{hoveredPoint.pt.label}</div>
                      <div className="tooltip-amount">{hoveredPoint.pt.revenue.toLocaleString()} ETB</div>
                      <div style={{ fontSize: '0.7rem', color: '#10B981' }}>{hoveredPoint.pt.orders} orders</div>
                    </div>
                  )}
                </div>

                {/* X-Axis Labels */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', padding: '0 20px', fontSize: '0.78rem', color: '#64748B', fontWeight: 600 }}>
                  {chartPoints.map((p, idx) => (
                    <span key={idx}>{p.label}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ORDERS & RECEIPTS */}
          {activeTab === 'orders' && (
            <div>
              <div className="dash-card-header" style={{ marginBottom: '20px' }}>
                <div>
                  <h2 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>Orders &amp; Receipt Review</h2>
                  <div style={{ fontSize: '0.85rem', color: '#94A3B8', marginTop: '4px' }}>Inspect buyer transfers and approve instant link deliveries</div>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <select
                    value={orderFilter}
                    onChange={(e) => setOrderFilter(e.target.value)}
                    style={{ background: '#131A24', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', padding: '8px 14px', borderRadius: '12px' }}
                  >
                    <option value="all">All Orders</option>
                    <option value="pending_approval">Pending Approval</option>
                    <option value="pending_fulfillment">Pending Delivery</option>
                    <option value="fulfilled">Fulfilled</option>
                    <option value="awaiting_payment">Awaiting Payment</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
              </div>

              <div className="dash-card">
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#94A3B8', textAlign: 'left' }}>
                        <th style={{ padding: '12px' }}>Order ID</th>
                        <th style={{ padding: '12px' }}>Date</th>
                        <th style={{ padding: '12px' }}>Buyer</th>
                        <th style={{ padding: '12px' }}>Product</th>
                        <th style={{ padding: '12px' }}>Amount</th>
                        <th style={{ padding: '12px' }}>Rail</th>
                        <th style={{ padding: '12px' }}>Status</th>
                        <th style={{ padding: '12px' }}>Receipt</th>
                        <th style={{ padding: '12px' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrders.length === 0 ? (
                        <tr>
                          <td colSpan={9} style={{ textAlign: 'center', padding: '40px', color: '#64748B' }}>
                            No orders found matching filter.
                          </td>
                        </tr>
                      ) : (
                        filteredOrders.map((ord) => (
                          <tr key={ord.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            <td style={{ padding: '12px' }}><code>#{ord.id}</code></td>
                            <td style={{ padding: '12px', fontSize: '0.78rem', color: '#94A3B8' }}>{new Date(ord.created_at).toLocaleString()}</td>
                            <td style={{ padding: '12px' }}><strong>{ord.username ? `@${ord.username}` : ord.user_id}</strong></td>
                            <td style={{ padding: '12px' }}>{ord.product_id}</td>
                            <td style={{ padding: '12px', fontWeight: 800, color: '#FCDD09' }}>{ord.amount_etb.toLocaleString()} ETB</td>
                            <td style={{ padding: '12px' }}>{ord.payment_rail?.toUpperCase()}</td>
                            <td style={{ padding: '12px' }}>
                              <span style={{ padding: '4px 10px', borderRadius: '9999px', fontSize: '0.72rem', fontWeight: 700, background: ord.status === 'fulfilled' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)', color: ord.status === 'fulfilled' ? '#10B981' : '#F59E0B' }}>
                                {ord.status.toUpperCase()}
                              </span>
                            </td>
                            <td style={{ padding: '12px' }}>
                              {ord.receipt_file_id ? (
                                <button
                                  onClick={() => { setSelectedOrder(ord); setModalType('receipt'); }}
                                  style={{ background: '#192230', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem' }}
                                >
                                  View Receipt
                                </button>
                              ) : <span style={{ color: '#64748B', fontSize: '0.75rem' }}>None</span>}
                            </td>
                            <td style={{ padding: '12px' }}>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                {ord.status === 'pending_approval' && (
                                  <>
                                    <button
                                      onClick={() => handleApprove(ord.id)}
                                      style={{ background: '#008A45', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', fontWeight: 700, cursor: 'pointer', fontSize: '0.78rem' }}
                                    >
                                      Approve
                                    </button>
                                    <button
                                      onClick={() => { setSelectedOrder(ord); setModalType('reject'); }}
                                      style={{ background: 'rgba(239,68,68,0.2)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.4)', padding: '6px 12px', borderRadius: '6px', fontWeight: 700, cursor: 'pointer', fontSize: '0.78rem' }}
                                    >
                                      Reject
                                    </button>
                                  </>
                                )}
                                {ord.status === 'pending_fulfillment' && (
                                  <button
                                    onClick={() => { setSelectedOrder(ord); setModalType('fulfill'); }}
                                    style={{ background: '#008A45', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', fontWeight: 700, cursor: 'pointer', fontSize: '0.78rem' }}
                                  >
                                    Complete Delivery
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
              <div className="dash-card-header" style={{ marginBottom: '20px' }}>
                <div>
                  <h2 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>Gemini Pro Stock Manager</h2>
                  <div style={{ fontSize: '0.85rem', color: '#94A3B8', marginTop: '4px' }}>
                    Secure single-use Google activation links inventory • Auto-deduplicated on upload
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ background: '#131A24', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '6px 12px', borderRadius: '10px', fontSize: '0.8rem', color: '#10B981', fontWeight: 800 }}>
                      {stockData.summary?.available || 0} Available
                    </div>
                    <div style={{ background: '#131A24', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '6px 12px', borderRadius: '10px', fontSize: '0.8rem', color: '#94A3B8', fontWeight: 700 }}>
                      {stockData.summary?.allocated || 0} Allocated
                    </div>
                  </div>
                </div>
              </div>

              {/* Bulk Ingestion Card */}
              <div className="dash-card" style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '1rem', fontWeight: 800 }}>Bulk Ingest Activation Links</div>
                  <span style={{ fontSize: '0.75rem', color: '#10B981', background: 'rgba(16, 185, 129, 0.12)', padding: '3px 8px', borderRadius: '6px', fontWeight: 700 }}>
                    🛡 Duplicate Protection Active
                  </span>
                </div>
                <div style={{ fontSize: '0.84rem', color: '#94A3B8', marginBottom: '12px' }}>
                  Paste Google Gemini Pro redeem links line-by-line. Duplicate links already registered in stock will automatically be rejected.
                </div>
                <textarea
                  rows={4}
                  value={bulkLinks}
                  onChange={(e) => setBulkLinks(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#0B0F16',
                    border: '1px solid rgba(255,255,255,0.1)',
                    padding: '12px',
                    borderRadius: '12px',
                    color: '#fff',
                    fontSize: '0.88rem',
                    fontFamily: 'monospace',
                    boxSizing: 'border-box',
                    resize: 'vertical',
                  }}
                  placeholder="https://g.co/gemini/redeem?token=SAMPLE1&#10;https://g.co/gemini/redeem?token=SAMPLE2"
                />
                <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '12px' }}>
                  <button
                    onClick={handleAddStock}
                    disabled={!bulkLinks.trim()}
                    style={{
                      background: 'linear-gradient(135deg, #059669 0%, #008A45 100%)',
                      color: '#fff',
                      padding: '10px 24px',
                      borderRadius: '10px',
                      border: 'none',
                      fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: '0 4px 15px rgba(5, 150, 105, 0.4)',
                    }}
                  >
                    + Ingest Links to Stock
                  </button>
                </div>
              </div>

              {/* Secure Stock Inventory Table */}
              <div className="dash-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div style={{ fontSize: '1rem', fontWeight: 800 }}>
                    Stock Inventory ({stockData.items.length} total links)
                  </div>
                  <input
                    type="text"
                    placeholder="Search stock ID or status..."
                    value={stockSearch}
                    onChange={(e) => setStockSearch(e.target.value)}
                    style={{
                      background: '#131A24',
                      color: '#fff',
                      border: '1px solid rgba(255,255,255,0.1)',
                      padding: '8px 14px',
                      borderRadius: '12px',
                      fontSize: '0.85rem',
                      width: '240px',
                    }}
                  />
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#94A3B8', textAlign: 'left' }}>
                        <th style={{ width: '65px', padding: '12px 10px' }}>ID</th>
                        <th style={{ width: '160px', padding: '12px 10px' }}>Product</th>
                        <th style={{ width: 'auto', padding: '12px 10px' }}>Activation Token / Link (Secured)</th>
                        <th style={{ width: '120px', padding: '12px 10px', textAlign: 'center' }}>Status</th>
                        <th style={{ width: '120px', padding: '12px 10px' }}>Added Date</th>
                        <th style={{ width: '100px', padding: '12px 10px', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockData.items
                        .filter((it: any) => {
                          if (!stockSearch) return true;
                          const q = stockSearch.toLowerCase();
                          return (
                            String(it.id).includes(q) ||
                            it.product_id?.toLowerCase().includes(q) ||
                            it.status?.toLowerCase().includes(q) ||
                            it.payload?.toLowerCase().includes(q)
                          );
                        })
                        .map((it: any) => {
                          const isRevealed = revealedStockIds.has(it.id);
                          const maskedPreview = it.payload.length > 28
                            ? `${it.payload.substring(0, 24)}••••••••${it.payload.slice(-4)}`
                            : '••••••••••••••••••••••••';

                          return (
                            <tr key={it.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              <td style={{ padding: '12px 10px' }}>
                                <code style={{ background: '#131A24', padding: '2px 6px', borderRadius: '4px', color: '#94A3B8' }}>
                                  #{it.id}
                                </code>
                              </td>
                              <td style={{ padding: '12px 10px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <GeminiBrandIcon size={16} />
                                  <span style={{ fontWeight: 700, fontSize: '0.84rem' }}>Gemini Pro 18M</span>
                                </div>
                              </td>
                              <td style={{ padding: '12px 10px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', maxWidth: '100%' }}>
                                  <span
                                    style={{
                                      fontFamily: 'monospace',
                                      fontSize: '0.82rem',
                                      color: isRevealed ? '#34D399' : '#94A3B8',
                                      background: '#0B0F16',
                                      padding: '6px 10px',
                                      borderRadius: '8px',
                                      border: '1px solid rgba(255,255,255,0.06)',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      flex: 1,
                                    }}
                                    title={isRevealed ? it.payload : 'Masked for security (Click eye to view)'}
                                  >
                                    {isRevealed ? it.payload : maskedPreview}
                                  </span>
                                  <button
                                    onClick={() => toggleRevealStock(it.id)}
                                    title={isRevealed ? 'Mask secret link' : 'Reveal secret link'}
                                    style={{
                                      background: '#192230',
                                      border: '1px solid rgba(255,255,255,0.1)',
                                      color: isRevealed ? '#34D399' : '#94A3B8',
                                      borderRadius: '8px',
                                      padding: '6px 8px',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      flexShrink: 0,
                                    }}
                                  >
                                    {isRevealed ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
                                  </button>
                                  <button
                                    onClick={() => copyStockLink(it.payload)}
                                    title="Copy secret link to clipboard"
                                    style={{
                                      background: '#192230',
                                      border: '1px solid rgba(255,255,255,0.1)',
                                      color: '#94A3B8',
                                      borderRadius: '8px',
                                      padding: '6px 8px',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      flexShrink: 0,
                                    }}
                                  >
                                    <CopyIcon size={14} />
                                  </button>
                                </div>
                              </td>
                              <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                                <span
                                  style={{
                                    padding: '4px 10px',
                                    borderRadius: '9999px',
                                    fontSize: '0.72rem',
                                    fontWeight: 800,
                                    letterSpacing: '0.04em',
                                    background: it.status === 'available' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.12)',
                                    color: it.status === 'available' ? '#10B981' : '#94A3B8',
                                    border: it.status === 'available' ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(148, 163, 184, 0.2)',
                                  }}
                                >
                                  {it.status.toUpperCase()}
                                </span>
                              </td>
                              <td style={{ padding: '12px 10px', fontSize: '0.8rem', color: '#94A3B8' }}>
                                {new Date(it.created_at).toLocaleDateString()}
                              </td>
                              <td style={{ padding: '12px 10px', textAlign: 'right' }}>
                                {it.status === 'available' ? (
                                  <button
                                    onClick={() => handleDeleteStock(it.id)}
                                    title="Delete from inventory"
                                    style={{
                                      background: 'rgba(239,68,68,0.12)',
                                      color: '#FCA5A5',
                                      border: '1px solid rgba(239,68,68,0.3)',
                                      padding: '5px 10px',
                                      borderRadius: '8px',
                                      cursor: 'pointer',
                                      fontSize: '0.75rem',
                                      fontWeight: 700,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                    }}
                                  >
                                    <TrashIcon size={12} />
                                    Delete
                                  </button>
                                ) : (
                                  <span style={{ fontSize: '0.75rem', color: '#64748B' }}>Locked</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: USERS & CRM */}
          {activeTab === 'users' && (
            <div>
              <div className="dash-card-header" style={{ marginBottom: '20px' }}>
                <div>
                  <h2 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>User Directory &amp; CRM</h2>
                  <div style={{ fontSize: '0.85rem', color: '#94A3B8', marginTop: '4px' }}>Real registered Telegram users &amp; verified mobile numbers</div>
                </div>
                <input
                  type="text"
                  placeholder="Filter users..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  style={{ background: '#131A24', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', padding: '8px 14px', borderRadius: '12px', width: '220px' }}
                />
              </div>

              <div className="dash-card">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#94A3B8', textAlign: 'left' }}>
                      <th style={{ padding: '12px' }}>Telegram ID</th>
                      <th style={{ padding: '12px' }}>Username</th>
                      <th style={{ padding: '12px' }}>Phone Number</th>
                      <th style={{ padding: '12px' }}>Status</th>
                      <th style={{ padding: '12px' }}>Language</th>
                      <th style={{ padding: '12px' }}>Joined Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u: any) => (
                      <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '12px' }}><code>{u.id}</code></td>
                        <td style={{ padding: '12px' }}><strong>{u.username ? `@${u.username}` : 'No @handle'}</strong></td>
                        <td style={{ padding: '12px', color: u.phone_number ? '#10B981' : '#64748B', fontWeight: 700 }}>
                          {u.phone_number || 'Unregistered'}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span style={{ padding: '3px 8px', borderRadius: '9999px', fontSize: '0.72rem', fontWeight: 700, background: u.is_registered === 1 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.15)', color: u.is_registered === 1 ? '#10B981' : '#94A3B8' }}>
                            {u.is_registered === 1 ? 'VERIFIED' : 'PENDING'}
                          </span>
                        </td>
                        <td style={{ padding: '12px' }}>{u.language_code?.toUpperCase() || 'EN'}</td>
                        <td style={{ padding: '12px', fontSize: '0.78rem', color: '#94A3B8' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: SETTINGS */}
          {activeTab === 'settings' && (
            <div>
              <div className="dash-card-header" style={{ marginBottom: '20px' }}>
                <div>
                  <h2 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>Store &amp; Rate Controls</h2>
                  <div style={{ fontSize: '0.85rem', color: '#94A3B8', marginTop: '4px' }}>Real-time updates to bank accounts and exchange rates</div>
                </div>
              </div>

              {settingsSaved && (
                <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10B981', padding: '12px', borderRadius: '12px', color: '#10B981', fontWeight: 700, marginBottom: '20px' }}>
                  Settings saved. Live across bot and web app.
                </div>
              )}

              <form onSubmit={handleSaveSettings}>
                <div className="dash-card" style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '16px' }}>Rates &amp; Margins</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', color: '#94A3B8', fontWeight: 700 }}>ETB per 1 Telegram Star</label>
                      <input
                        type="number"
                        step="0.1"
                        value={settings.etb_per_star || '2.5'}
                        onChange={(e) => setSettings({ ...settings, etb_per_star: e.target.value })}
                        style={{ width: '100%', background: '#0B0F16', border: '1px solid rgba(255,255,255,0.1)', padding: '10px', borderRadius: '10px', color: '#fff', marginTop: '6px', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', color: '#94A3B8', fontWeight: 700 }}>ETB per 1 USD (Base)</label>
                      <input
                        type="number"
                        step="1"
                        value={settings.etb_per_usd || '135'}
                        onChange={(e) => setSettings({ ...settings, etb_per_usd: e.target.value })}
                        style={{ width: '100%', background: '#0B0F16', border: '1px solid rgba(255,255,255,0.1)', padding: '10px', borderRadius: '10px', color: '#fff', marginTop: '6px', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>
                </div>

                <div className="dash-card" style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '16px' }}>Bank Accounts</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', color: '#94A3B8', fontWeight: 700 }}>CBE Account Number</label>
                      <input
                        type="text"
                        value={settings.cbe_account || ''}
                        onChange={(e) => setSettings({ ...settings, cbe_account: e.target.value })}
                        style={{ width: '100%', background: '#0B0F16', border: '1px solid rgba(255,255,255,0.1)', padding: '10px', borderRadius: '10px', color: '#fff', marginTop: '6px', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', color: '#94A3B8', fontWeight: 700 }}>Telebirr Number</label>
                      <input
                        type="text"
                        value={settings.telebirr_account || ''}
                        onChange={(e) => setSettings({ ...settings, telebirr_account: e.target.value })}
                        style={{ width: '100%', background: '#0B0F16', border: '1px solid rgba(255,255,255,0.1)', padding: '10px', borderRadius: '10px', color: '#fff', marginTop: '6px', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', color: '#94A3B8', fontWeight: 700 }}>Support Telegram Username</label>
                      <input
                        type="text"
                        value={settings.support_username || ''}
                        onChange={(e) => setSettings({ ...settings, support_username: e.target.value })}
                        style={{ width: '100%', background: '#0B0F16', border: '1px solid rgba(255,255,255,0.1)', padding: '10px', borderRadius: '10px', color: '#fff', marginTop: '6px', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  style={{ background: 'linear-gradient(135deg, #059669 0%, #008A45 100%)', color: '#fff', padding: '12px 30px', borderRadius: '12px', border: 'none', fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 15px rgba(5, 150, 105, 0.4)' }}
                >
                  Save Store Settings
                </button>
              </form>
            </div>
          )}

          {/* TAB 6: BROADCAST */}
          {activeTab === 'broadcast' && (
            <div>
              <div className="dash-card-header" style={{ marginBottom: '20px' }}>
                <div>
                  <h2 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>Broadcast Announcements</h2>
                  <div style={{ fontSize: '0.85rem', color: '#94A3B8', marginTop: '4px' }}>Send rich notifications directly to bot users</div>
                </div>
              </div>

              {broadcastResult && (
                <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10B981', padding: '12px', borderRadius: '12px', color: '#10B981', fontWeight: 700, marginBottom: '20px' }}>
                  Broadcast complete! Delivered to {broadcastResult.sentCount} users.
                </div>
              )}

              <div className="dash-card">
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '0.8rem', color: '#94A3B8', fontWeight: 700 }}>Target Audience</label>
                  <select
                    value={broadcastTarget}
                    onChange={(e) => setBroadcastTarget(e.target.value as any)}
                    style={{ width: '100%', background: '#0B0F16', border: '1px solid rgba(255,255,255,0.1)', padding: '10px', borderRadius: '10px', color: '#fff', marginTop: '6px', boxSizing: 'border-box' }}
                  >
                    <option value="all">All Bot Users ({users.length} total)</option>
                    <option value="active_buyers">Active Settled Buyers Only</option>
                    <option value="registered">Phone-Verified Users Only</option>
                  </select>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '0.8rem', color: '#94A3B8', fontWeight: 700 }}>Message (HTML tags allowed)</label>
                  <textarea
                    rows={5}
                    value={broadcastMessage}
                    onChange={(e) => setBroadcastMessage(e.target.value)}
                    style={{ width: '100%', background: '#0B0F16', border: '1px solid rgba(255,255,255,0.1)', padding: '12px', borderRadius: '10px', color: '#fff', marginTop: '6px', boxSizing: 'border-box' }}
                    placeholder="<b>Exclusive Weekend Promo:</b> Gemini Pro links are currently available!"
                  />
                </div>

                <button
                  onClick={handleSendBroadcast}
                  disabled={broadcasting || !broadcastMessage.trim()}
                  style={{ background: 'linear-gradient(135deg, #059669 0%, #008A45 100%)', color: '#fff', padding: '12px 24px', borderRadius: '10px', border: 'none', fontWeight: 800, cursor: 'pointer', alignSelf: 'flex-start' }}
                >
                  {broadcasting ? 'Sending Broadcast...' : 'Send Message Now'}
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* RECEIPT PREVIEW MODAL */}
      {modalType === 'receipt' && selectedOrder && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#0E131B', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '20px', padding: '24px', maxWidth: '480px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Order #{selectedOrder.id} Receipt</h3>
              <button onClick={() => setModalType(null)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.3rem', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ background: '#131A24', padding: '12px', borderRadius: '10px', marginBottom: '16px', fontSize: '0.85rem' }}>
              <div>• <strong>Buyer:</strong> {selectedOrder.username ? `@${selectedOrder.username}` : selectedOrder.user_id}</div>
              <div>• <strong>Amount:</strong> {selectedOrder.amount_etb.toLocaleString()} ETB ({selectedOrder.payment_rail?.toUpperCase()})</div>
              <div>• <strong>Note:</strong> {selectedOrder.receipt_note || 'None'}</div>
            </div>
            {selectedOrder.receipt_file_id?.startsWith('data:image') || selectedOrder.receipt_file_id?.startsWith('base64') ? (
              <img src={selectedOrder.receipt_file_id} alt="Receipt" style={{ width: '100%', maxHeight: '300px', objectFit: 'contain', borderRadius: '10px', marginBottom: '16px' }} />
            ) : (
              <div style={{ padding: '24px', textAlign: 'center', color: '#94A3B8', background: '#131A24', borderRadius: '10px', marginBottom: '16px' }}>
                Telegram Photo ID: <code>{selectedOrder.receipt_file_id}</code>
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px' }}>
              {selectedOrder.status === 'pending_approval' && (
                <button
                  onClick={() => handleApprove(selectedOrder.id)}
                  style={{ flex: 1, background: '#008A45', color: '#fff', border: 'none', padding: '10px', borderRadius: '10px', fontWeight: 800, cursor: 'pointer' }}
                >
                  Approve Transfer
                </button>
              )}
              <button onClick={() => setModalType(null)} style={{ flex: 1, background: '#192230', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', padding: '10px', borderRadius: '10px', cursor: 'pointer' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REJECT MODAL */}
      {modalType === 'reject' && selectedOrder && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#0E131B', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '20px', padding: '24px', maxWidth: '420px', width: '100%' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '1.1rem', fontWeight: 800 }}>Reject Order #{selectedOrder.id}</h3>
            <p style={{ fontSize: '0.85rem', color: '#94A3B8', margin: '0 0 14px 0' }}>Reason for buyer notice:</p>
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Unreadable receipt screenshot"
              style={{ width: '100%', background: '#131A24', border: '1px solid rgba(255,255,255,0.1)', padding: '10px', borderRadius: '10px', color: '#fff', boxSizing: 'border-box', marginBottom: '16px' }}
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={handleReject} style={{ flex: 1, background: 'rgba(239,68,68,0.2)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.4)', padding: '10px', borderRadius: '10px', fontWeight: 800, cursor: 'pointer' }}>
                Confirm Rejection
              </button>
              <button onClick={() => setModalType(null)} style={{ flex: 1, background: '#192230', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', padding: '10px', borderRadius: '10px', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULFILL MODAL */}
      {modalType === 'fulfill' && selectedOrder && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#0E131B', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '20px', padding: '24px', maxWidth: '420px', width: '100%' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '1.1rem', fontWeight: 800 }}>Complete Delivery #{selectedOrder.id}</h3>
            <p style={{ fontSize: '0.85rem', color: '#94A3B8', margin: '0 0 14px 0' }}>Fulfillment proof or Fragment TX hash:</p>
            <input
              type="text"
              value={fulfillProof}
              onChange={(e) => setFulfillProof(e.target.value)}
              placeholder="e.g. Fragment Gift Ref #12345"
              style={{ width: '100%', background: '#131A24', border: '1px solid rgba(255,255,255,0.1)', padding: '10px', borderRadius: '10px', color: '#fff', boxSizing: 'border-box', marginBottom: '16px' }}
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={handleFulfill} style={{ flex: 1, background: '#008A45', color: '#fff', border: 'none', padding: '10px', borderRadius: '10px', fontWeight: 800, cursor: 'pointer' }}>
                Mark Delivered
              </button>
              <button onClick={() => setModalType(null)} style={{ flex: 1, background: '#192230', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', padding: '10px', borderRadius: '10px', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QUICK INGEST STOCK MODAL */}
      {quickStockOpen && (
        <div className="quick-modal-backdrop" onClick={() => setQuickStockOpen(false)}>
          <div className="quick-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="quick-modal-head">
              <div className="quick-modal-title">⚡ Quick Stock Ingestion</div>
              <button className="quick-modal-close" onClick={() => setQuickStockOpen(false)}>✕</button>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#94A3B8', margin: '0 0 16px 0' }}>
              Paste raw Gemini Pro 18-Month activation links (one per line). They will be encrypted and staged for instant automated delivery.
            </p>
            <textarea
              rows={6}
              value={bulkLinks}
              onChange={(e) => setBulkLinks(e.target.value)}
              placeholder="https://g.co/gemini/redeem?token=SAMPLE1&#10;https://g.co/gemini/redeem?token=SAMPLE2"
              style={{
                width: '100%',
                background: '#131A24',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '12px',
                padding: '12px',
                color: '#FFFFFF',
                fontSize: '0.85rem',
                fontFamily: 'monospace',
                boxSizing: 'border-box',
                marginBottom: '16px',
                resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={async () => {
                  if (!bulkLinks.trim()) return;
                  await handleAddStock();
                  setQuickStockOpen(false);
                }}
                style={{
                  flex: 1,
                  background: 'linear-gradient(135deg, #059669 0%, #008A45 100%)',
                  color: '#FFFFFF',
                  border: 'none',
                  padding: '12px',
                  borderRadius: '12px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 4px 15px rgba(5, 150, 105, 0.4)',
                }}
              >
                + Ingest Links
              </button>
              <button
                onClick={() => setQuickStockOpen(false)}
                style={{
                  flex: 1,
                  background: '#192230',
                  color: '#FFFFFF',
                  border: '1px solid rgba(255,255,255,0.1)',
                  padding: '12px',
                  borderRadius: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QUICK EXCHANGE RATE MODAL */}
      {quickRateOpen && (
        <div className="quick-modal-backdrop" onClick={() => setQuickRateOpen(false)}>
          <div className="quick-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="quick-modal-head">
              <div className="quick-modal-title">⚙ Quick Rate Adjuster</div>
              <button className="quick-modal-close" onClick={() => setQuickRateOpen(false)}>✕</button>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#94A3B8', margin: '0 0 16px 0' }}>
              Adjust live exchange rates used for dynamic Star calculations and USD banking conversion across both the Bot and Web App.
            </p>
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '6px' }}>
                ETB Per Telegram Star (ETB)
              </label>
              <input
                type="number"
                step="0.1"
                value={newRateStars}
                onChange={(e) => setNewRateStars(e.target.value)}
                style={{
                  width: '100%',
                  background: '#131A24',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px',
                  padding: '10px',
                  color: '#FFFFFF',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '6px' }}>
                USD to ETB Reference Rate
              </label>
              <input
                type="number"
                step="1"
                value={newRateUsd}
                onChange={(e) => setNewRateUsd(e.target.value)}
                style={{
                  width: '100%',
                  background: '#131A24',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px',
                  padding: '10px',
                  color: '#FFFFFF',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={async () => {
                  try {
                    const updated = {
                      ...settings,
                      etb_per_star: newRateStars || '2.5',
                      usd_to_etb_rate: newRateUsd || '135',
                    };
                    await updateAdminSettingsApi(updated);
                    setSettings(updated);
                    setQuickRateOpen(false);
                    showToast('Exchange rates updated successfully!', 'success');
                    loadAllAdminData(timeRange, categoryRail);
                  } catch (err: any) {
                    showToast(err.message || 'Failed to update rates', 'error');
                  }
                }}
                style={{
                  flex: 1,
                  background: 'linear-gradient(135deg, #059669 0%, #008A45 100%)',
                  color: '#FFFFFF',
                  border: 'none',
                  padding: '12px',
                  borderRadius: '12px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 4px 15px rgba(5, 150, 105, 0.4)',
                }}
              >
                Save Live Rates
              </button>
              <button
                onClick={() => setQuickRateOpen(false)}
                style={{
                  flex: 1,
                  background: '#192230',
                  color: '#FFFFFF',
                  border: '1px solid rgba(255,255,255,0.1)',
                  padding: '12px',
                  borderRadius: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL */}
      {confirmModal && (
        <div className="quick-modal-backdrop" onClick={() => setConfirmModal(null)}>
          <div className="quick-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="quick-modal-head">
              <div className="quick-modal-title">{confirmModal.title}</div>
              <button className="quick-modal-close" onClick={() => setConfirmModal(null)}>✕</button>
            </div>
            <p style={{ fontSize: '0.9rem', color: '#94A3B8', margin: '0 0 20px 0', lineHeight: 1.5 }}>
              {confirmModal.message}
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={confirmModal.onConfirm}
                style={{
                  flex: 1,
                  background: confirmModal.isDanger
                    ? 'rgba(239, 68, 68, 0.2)'
                    : 'linear-gradient(135deg, #059669 0%, #008A45 100%)',
                  color: confirmModal.isDanger ? '#FCA5A5' : '#FFFFFF',
                  border: confirmModal.isDanger ? '1px solid rgba(239, 68, 68, 0.4)' : 'none',
                  padding: '12px',
                  borderRadius: '12px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: confirmModal.isDanger ? 'none' : '0 4px 15px rgba(5, 150, 105, 0.4)',
                }}
              >
                {confirmModal.actionLabel}
              </button>
              <button
                onClick={() => setConfirmModal(null)}
                style={{
                  flex: 1,
                  background: '#192230',
                  color: '#FFFFFF',
                  border: '1px solid rgba(255,255,255,0.1)',
                  padding: '12px',
                  borderRadius: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION CONTAINER */}
      <div className="admin-toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`admin-toast ${t.type}`}>
            <span>
              {t.type === 'success' && '✓ '}
              {t.type === 'error' && '✕ '}
              {t.type === 'info' && 'ℹ '}
              {t.message}
            </span>
            <button
              onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
              style={{ background: 'none', border: 'none', color: 'inherit', opacity: 0.7, cursor: 'pointer', padding: 0, fontSize: '0.9rem' }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AdminDashboard;
