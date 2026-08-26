import React, { useState, useEffect, useCallback } from 'react';
import {
  adminLoginApi,
  adminVerify2FAApi,
  hasAdminSession,
  adminLogoutApi,
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
  fetchPayoutsApi,
  decidePayoutApi,
  downloadExportApi,
  fetchReceiptImageUrl,
  receiptIsInline,
  onSessionExpired,
} from './adminApi.ts';
import {
  LayoutDashboardIcon,
  ShoppingBagIcon,
  LayersIcon,
  UsersIcon,
  WalletCardsIcon,
  SendIcon,
  SettingsIcon,
  SearchIcon,
  BellIcon,
  LogOutIcon,
  ArrowUpRightIcon,
  TrendingUpIcon,
  DownloadIcon,
  CalendarIcon,
  ClockIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  RefreshIcon,
  PlusIcon,
  KeyIcon,
  EyeIcon,
  EyeOffIcon,
  CopyIcon,
  TrashIcon,
  ShieldCheckIcon,
  LockIcon,
  CloseIcon,
  GeminiBrandIcon,
  TelegramBrandIcon,
  StarsBrandIcon,
} from '../components/Icons.tsx';
import './admin.css';

// ── Additional Clean Inline Vector Icons ─────────────────────────────
const SunIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);

const MoonIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
);

const MenuIcon: React.FC<{ size?: number; color?: string }> = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" x2="20" y1="12" y2="12" />
    <line x1="4" x2="20" y1="6" y2="6" />
    <line x1="4" x2="20" y1="18" y2="18" />
  </svg>
);

const ChevronUpDownIcon: React.FC<{ size?: number; color?: string }> = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m7 15 5 5 5-5" />
    <path d="m7 9 5-5 5 5" />
  </svg>
);

const InfoIcon: React.FC<{ size?: number; color?: string }> = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </svg>
);

const MoreHorizontalIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </svg>
);

const ZapIcon: React.FC<{ size?: number; color?: string }> = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const RadioIcon: React.FC<{ size?: number; color?: string }> = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="2" />
    <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
  </svg>
);

const AlertTriangleIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const TrendingDownIcon: React.FC<{ size?: number; color?: string }> = ({ size = 11, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
    <polyline points="17 18 23 18 23 12" />
  </svg>
);

const MinusIcon: React.FC<{ size?: number; color?: string }> = ({ size = 11, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

// RBAC permissions matrix
const ROLE_PERMS: Record<string, string[]> = {
  superadmin: ['*'],
  ops: ['analytics.view', 'orders.view', 'orders.decide', 'stock.manage', 'users.view', 'settings.read', 'broadcast.send'],
  finance: ['orders.view', 'users.view', 'settings.read', 'payouts.manage', 'analytics.view', 'export.financial'],
  support: ['orders.view', 'users.view'],
};

// Micro-Sparkline Component for KPI Telemetry
const Sparkline: React.FC<{ data: number[]; color?: string; width?: number; height?: number }> = ({
  data,
  color = 'var(--admin-sparkline-color)',
  width = 68,
  height = 24,
}) => {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * (width - 4) + 2;
    const y = height - 4 - ((val - min) / range) * (height - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const pathD = `M ${points.join(' L ')}`;
  const areaD = `M ${points[0]} L ${points.join(' L ')} L ${width - 2},${height} L 2,${height} Z`;
  const gradId = `spark-${Math.random().toString(36).substring(2, 7)}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

function formatProductName(productId: string, variantId?: string | null): { name: string; variant?: string; icon: React.ReactNode } {
  if (productId === 'telegram_premium') {
    let varLabel = 'Subscription';
    if (variantId === 'tg_prem_3m') varLabel = '3 Months Plan';
    else if (variantId === 'tg_prem_6m') varLabel = '6 Months Plan';
    else if (variantId === 'tg_prem_12m') varLabel = '12 Months Plan';
    else if (variantId) varLabel = variantId.replace(/^tg_prem_/, '').replace(/_/g, ' ');
    return {
      name: 'Telegram Premium',
      variant: varLabel,
      icon: <TelegramBrandIcon size={16} />,
    };
  }
  if (productId === 'telegram_stars') {
    let varLabel = 'Stars Package';
    if (variantId?.startsWith('tg_stars_')) {
      const num = parseInt(variantId.replace('tg_stars_', ''), 10);
      varLabel = !isNaN(num) ? `${num.toLocaleString()} Stars` : variantId;
    } else if (variantId) {
      varLabel = variantId;
    }
    return {
      name: 'Telegram Stars',
      variant: varLabel,
      icon: <StarsBrandIcon size={16} />,
    };
  }
  if (productId === 'gemini_pro_18m' || productId === 'gemini_pro') {
    return {
      name: 'Gemini Advanced',
      variant: '18 Months Key',
      icon: <GeminiBrandIcon size={16} />,
    };
  }
  return {
    name: productId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    variant: variantId ? variantId.replace(/_/g, ' ') : undefined,
    icon: <ShoppingBagIcon size={16} />,
  };
}

function formatRailBadge(rail?: string | null): { label: string; className: string } {
  const r = (rail || '').toLowerCase();
  if (r === 'cbe') return { label: 'CBE Bank', className: 'rail-pill cbe' };
  if (r === 'telebirr') return { label: 'Telebirr', className: 'rail-pill telebirr' };
  if (r === 'abyssinia') return { label: 'Abyssinia', className: 'rail-pill abyssinia' };
  if (r === 'stars') return { label: 'Stars (XTR)', className: 'rail-pill stars' };
  if (r === 'wallet_pay' || r === 'wp') return { label: 'Wallet Pay', className: 'rail-pill wallet_pay' };
  if (r === 'ton' || r === 'ton_connect') return { label: 'TON Connect', className: 'rail-pill ton' };
  return { label: (rail || 'OTHER').toUpperCase(), className: 'rail-pill generic' };
}

function formatOrderStatus(status: string): { label: string; className: string } {
  switch (status) {
    case 'fulfilled':
    case 'delivered':
      return { label: 'Delivered', className: 'status-pill delivered' };
    case 'pending_approval':
      return { label: 'Pending Review', className: 'status-pill pending_approval' };
    case 'pending_fulfillment':
      return { label: 'In Queue', className: 'status-pill pending_fulfillment' };
    case 'awaiting_payment':
      return { label: 'Awaiting Pay', className: 'status-pill awaiting_payment' };
    case 'rejected':
      return { label: 'Rejected', className: 'status-pill rejected' };
    case 'cancelled':
      return { label: 'Cancelled', className: 'status-pill cancelled' };
    default:
      return { label: status, className: 'status-pill generic' };
  }
}

function formatDateTime(dateStr: string): { date: string; time: string } {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return { date: '—', time: '' };
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return { date, time };
}

export const AdminDashboard: React.FC = () => {
  // Theme Management (Light Mode & Dark Mode with persistence)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('admin_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return 'dark'; // default theme
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('admin_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
    showToast(`Switched to ${theme === 'light' ? 'Dark' : 'Light'} Mode`, 'info');
  };

  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(hasAdminSession());
  const [adminRole, setAdminRole] = useState<string>('superadmin');
  const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'stock' | 'users' | 'payouts' | 'broadcast' | 'settings'>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  const canSee = useCallback((perm: string): boolean => {
    const perms = ROLE_PERMS[adminRole] ?? [];
    return perms.includes('*') || perms.includes(perm);
  }, [adminRole]);

  // In-App Toast Engine
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'success' | 'error' | 'info' }[]>([]);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // Custom Confirmation Modal
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    actionLabel: string;
    isDanger?: boolean;
    category?: 'broadcast' | 'danger' | 'approve' | 'stock' | 'payout' | 'general';
    details?: { label: string; value: string }[];
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  // Keyboard Shortcuts Guide Modal
  const [showShortcutsModal, setShowShortcutsModal] = useState<boolean>(false);

  // Auth State
  const [password, setPassword] = useState('');
  const [require2FA, setRequire2FA] = useState(false);
  const [adminId, setAdminId] = useState<number>(0);
  const [otp, setOtp] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Data States
  const [overview, setOverview] = useState<any>(null);
  const [timeRange, setTimeRange] = useState<string>('6M');
  const [hoveredColumnIdx, setHoveredColumnIdx] = useState<number | null>(null);

  // Live Auto-Sync
  const [liveSync, setLiveSync] = useState<boolean>(true);
  const [isSyncLoading, setIsSyncLoading] = useState<boolean>(false);
  const [lastSync, setLastSync] = useState<Date>(new Date());

  // Filter & Search States
  const [categoryRail, setCategoryRail] = useState<string>('all');
  const [orderFilter, setOrderFilter] = useState<string>('all');
  const [orderSearch, setOrderSearch] = useState<string>('');
  const [orders, setOrders] = useState<any[]>([]);

  // Stock, Users, Settings, Payouts, Broadcast States
  const [stockData, setStockData] = useState<{ summary: any; items: any[] }>({ summary: {}, items: [] });
  const [bulkLinks, setBulkLinks] = useState('');
  const [stockSearch, setStockSearch] = useState('');
  const [revealedStockIds, setRevealedStockIds] = useState<Set<number>>(new Set());
  const [users, setUsers] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [payoutRows, setPayoutRows] = useState<any[]>([]);

  // Broadcast State
  const [broadcastTarget, setBroadcastTarget] = useState<'all' | 'active_buyers' | 'registered'>('all');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastPhotoId, setBroadcastPhotoId] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);

  // Modals State
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [fulfillProof, setFulfillProof] = useState('');
  const [modalType, setModalType] = useState<'receipt' | 'reject' | 'fulfill' | null>(null);

  // In-flight guards
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [modalBusy, setModalBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [stockBusy, setStockBusy] = useState(false);

  // Receipt viewer
  const [receiptUrl, setReceiptUrl] = useState('');
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState(false);
  const [receiptZoom, setReceiptZoom] = useState<number>(1);
  const [receiptRotation, setReceiptRotation] = useState<number>(0);

  // Chart telemetry options menu
  const [showChartMenu, setShowChartMenu] = useState<boolean>(false);

  // Keyboard Escape dismissal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showChartMenu) setShowChartMenu(false);
        else if (confirmModal) setConfirmModal(null);
        else if (showShortcutsModal) setShowShortcutsModal(false);
        else if (modalType) {
          setModalType(null);
          setReceiptZoom(1);
          setReceiptRotation(0);
          setReceiptError(false);
        } else if (mobileMenuOpen) {
          setMobileMenuOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmModal, showShortcutsModal, modalType, mobileMenuOpen, showChartMenu]);

  // Session expiry listener
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
      const [ov, ords, stk, usrs, stgs, pyts] = await Promise.all([
        canSee('analytics.view') ? fetchAdminOverviewApi(range, rail).catch(() => null) : Promise.resolve(null),
        canSee('orders.view') ? fetchAdminOrdersApi(orderFilter, orderSearch).catch(() => ({ orders: [] })) : Promise.resolve({ orders: [] }),
        canSee('stock.manage') ? fetchAdminStockApi().catch(() => ({ summary: {}, items: [] })) : Promise.resolve({ summary: {}, items: [] }),
        canSee('users.view') ? fetchAdminUsersApi().catch(() => ({ users: [] })) : Promise.resolve({ users: [] }),
        canSee('settings.read') ? fetchAdminSettingsApi().catch(() => ({ settings: {} })) : Promise.resolve({ settings: {} }),
        canSee('payouts.manage') ? fetchPayoutsApi('pending').catch(() => ({ payouts: [] })) : Promise.resolve({ payouts: [] }),
      ]);

      if (ov) setOverview(ov);
      setOrders(ords.orders);
      setStockData(stk);
      setUsers(usrs.users);
      setSettings(stgs.settings);
      setPayoutRows(pyts.payouts || []);
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

  // Live Auto-Sync interval (10s)
  useEffect(() => {
    if (!isLoggedIn || !liveSync) return;
    let intervalId: number | undefined;
    const start = () => {
      intervalId = window.setInterval(() => {
        loadAllAdminData(timeRange, categoryRail);
      }, 10000);
    };
    const stop = () => {
      if (intervalId !== undefined) clearInterval(intervalId);
      intervalId = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        loadAllAdminData(timeRange, categoryRail);
        start();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isLoggedIn, liveSync, timeRange, categoryRail]);

  // Receipt signed-URL lifecycle
  useEffect(() => {
    if (modalType !== 'receipt' || !selectedOrder) {
      setReceiptUrl('');
      setReceiptLoading(false);
      setReceiptError(false);
      return;
    }
    setReceiptError(false);
    if (receiptIsInline(selectedOrder.receipt_file_id)) {
      setReceiptUrl(selectedOrder.receipt_file_id);
      setReceiptLoading(false);
      return;
    }
    let cancelled = false;
    setReceiptUrl('');
    setReceiptLoading(true);
    fetchReceiptImageUrl(selectedOrder.id)
      .then((url) => { if (!cancelled) setReceiptUrl(url); })
      .catch((err: any) => {
        if (!cancelled) {
          setReceiptError(true);
          showToast(err.message || 'Could not load receipt image', 'error');
        }
      })
      .finally(() => { if (!cancelled) setReceiptLoading(false); });
    return () => { cancelled = true; };
  }, [modalType, selectedOrder]);

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing) return;
      if (e.key === '1' && canSee('analytics.view')) setActiveTab('overview');
      if (e.key === '2' && canSee('orders.view')) setActiveTab('orders');
      if (e.key === '3' && canSee('stock.manage')) setActiveTab('stock');
      if (e.key === '4' && canSee('users.view')) setActiveTab('users');
      if (e.key === '5' && canSee('payouts.manage')) setActiveTab('payouts');
      if (e.key === '6' && canSee('broadcast.send')) setActiveTab('broadcast');
      if (e.key === '7' && canSee('settings.read')) setActiveTab('settings');
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        loadAllAdminData(timeRange, categoryRail);
        showToast('Refreshing live telemetry…', 'info');
      }
      if (e.key === '/') {
        e.preventDefault();
        const searchInput = document.getElementById('admin-global-search') as HTMLInputElement;
        if (searchInput) searchInput.focus();
      }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowShortcutsModal((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setModalType(null);
        setConfirmModal(null);
        setShowShortcutsModal(false);
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
      const role = String(res.admin?.role ?? 'superadmin');
      setAdminRole(role);
      setIsLoggedIn(true);
      setRequire2FA(false);
      showToast('Authenticated successfully as Executive Administrator', 'success');
    } catch (err: any) {
      setAuthError(err.message || '2FA verification failed');
      showToast(err.message || '2FA verification failed', 'error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    void adminLogoutApi();
    clearAdminToken();
    setIsLoggedIn(false);
    setPassword('');
    setOtp('');
    showToast('Signed out of admin portal.', 'info');
  };

  // Order Actions
  const handleApprove = (orderId: string) => {
    const targetOrder = orders.find((o: any) => String(o.id) === String(orderId)) || selectedOrder;
    const priceStr = targetOrder ? `${targetOrder.amount_etb?.toLocaleString()} ETB` : 'Order Amount';
    const clientStr = targetOrder?.username ? `@${targetOrder.username}` : `User #${targetOrder?.user_id || 'Client'}`;
    const railStr = targetOrder?.payment_rail?.toUpperCase() || 'Bank Transfer';

    setConfirmModal({
      title: 'Approve Payment Transfer',
      message: `Confirm payment verification for Order #${orderId}. Activation credentials will be automatically released from the digital vault to the buyer immediately.`,
      actionLabel: 'Approve & Deliver',
      category: 'approve',
      isDanger: false,
      details: [
        { label: 'Order ID', value: `#${orderId}` },
        { label: 'Customer', value: clientStr },
        { label: 'Settlement Amount', value: priceStr },
        { label: 'Payment Rail', value: railStr },
      ],
      onConfirm: async () => {
        try {
          await approveOrderApi(orderId);
          showToast(`Order #${orderId} approved and credentials delivered!`, 'success');
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
    if (modalBusy) return;
    if (!selectedOrder || !rejectReason.trim()) {
      showToast('Please enter a rejection reason for the buyer.', 'error');
      return;
    }
    setModalBusy(true);
    try {
      await rejectOrderApi(selectedOrder.id, rejectReason.trim());
      showToast(`Order #${selectedOrder.id} rejected.`, 'info');
      setModalType(null);
      setRejectReason('');
      loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to reject order', 'error');
    } finally {
      setModalBusy(false);
    }
  };

  const handleFulfill = async () => {
    if (modalBusy || !selectedOrder) return;
    setModalBusy(true);
    try {
      await fulfillOrderApi(selectedOrder.id, fulfillProof.trim());
      showToast(`Order #${selectedOrder.id} marked fulfilled!`, 'success');
      setModalType(null);
      setFulfillProof('');
      loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to fulfill order', 'error');
    } finally {
      setModalBusy(false);
    }
  };

  // Stock Actions
  const handleAddStock = async () => {
    if (stockBusy || !bulkLinks.trim()) return;
    setStockBusy(true);
    try {
      const res = await addStockLinksApi(bulkLinks);
      showToast(`Successfully added ${res.addedCount} activation links to vault`, 'success');
      setBulkLinks('');
      loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to add stock', 'error');
    } finally {
      setStockBusy(false);
    }
  };

  const handleDeleteStockItem = (id: string) => {
    setConfirmModal({
      title: 'Delete Digital Key',
      message: 'This will permanently remove the activation credential from the secure vault. This action cannot be reversed.',
      actionLabel: 'Delete Key',
      category: 'danger',
      isDanger: true,
      details: [
        { label: 'Key Identifier', value: `#${id}` },
        { label: 'Action Type', value: 'Permanent Purge' },
      ],
      onConfirm: async () => {
        try {
          await deleteStockItemApi(id);
          showToast('Stock item deleted from vault', 'info');
          loadAllAdminData();
        } catch (err: any) {
          showToast(err.message || 'Failed to delete stock item', 'error');
        } finally {
          setConfirmModal(null);
        }
      },
    });
  };

  // Settings Action
  const handleSaveSettings = async () => {
    if (settingsBusy) return;
    setSettingsBusy(true);
    try {
      await updateAdminSettingsApi(settings);
      showToast('Store settings updated successfully', 'success');
      loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to save settings', 'error');
    } finally {
      setSettingsBusy(false);
    }
  };

  // Broadcast Action
  const handleSendBroadcast = async () => {
    if (!broadcastMessage.trim()) {
      showToast('Please enter an announcement message.', 'error');
      return;
    }
    const audienceLabel = broadcastTarget === 'all' ? `All Subscribers (${users.length} Users)` : broadcastTarget === 'active_buyers' ? 'Active Buyers' : 'Verified Phones';
    setConfirmModal({
      title: 'Dispatch Telegram Broadcast',
      message: 'You are about to broadcast this announcement directly to bot subscribers. Messages will be queued and pushed via the Telegram Bot API.',
      actionLabel: 'Dispatch Announcement',
      category: 'broadcast',
      isDanger: false,
      details: [
        { label: 'Target Audience', value: audienceLabel },
        { label: 'Character Count', value: `${broadcastMessage.length} chars` },
        { label: 'Media Attachment', value: broadcastPhotoId ? 'Photo Attached' : 'None (Text Only)' },
      ],
      onConfirm: async () => {
        try {
          setBroadcasting(true);
          await broadcastMessageApi(broadcastMessage.trim(), broadcastTarget, broadcastPhotoId.trim() || undefined);
          showToast('Broadcast dispatched to Telegram queue successfully', 'success');
          setBroadcastMessage('');
          setBroadcastPhotoId('');
        } catch (err: any) {
          showToast(err.message || 'Broadcast failed', 'error');
        } finally {
          setBroadcasting(false);
          setConfirmModal(null);
        }
      },
    });
  };

  // Payout Decision
  const openPayoutConfirm = (p: any, decision: 'paid' | 'rejected') => {
    const amountStr = `${p.amount_etb?.toLocaleString?.() ?? p.amount_etb} ETB`;
    const userStr = p.username ? `@${p.username}` : `User #${p.user_id}`;
    const accountStr = p.account_details || p.destination || 'Bank Account';

    setConfirmModal({
      title: decision === 'paid' ? 'Confirm Payout Settlement' : 'Decline Payout Request',
      message: decision === 'paid'
        ? `Confirm that ${amountStr} has been transferred to ${userStr}. This records the settlement in the financial ledger.`
        : `Decline payout #${p.id} for ${userStr}? Commission balance will remain available for future withdrawal.`,
      actionLabel: decision === 'paid' ? 'Confirm Settlement' : 'Decline Payout',
      category: decision === 'paid' ? 'approve' : 'danger',
      isDanger: decision === 'rejected',
      details: [
        { label: 'Beneficiary', value: userStr },
        { label: 'Commission Amount', value: amountStr },
        { label: 'Destination Account', value: accountStr },
      ],
      onConfirm: async () => {
        try {
          await decidePayoutApi(p.id, decision);
          showToast(`Payout #${p.id} marked as ${decision}`, 'success');
          loadAllAdminData();
        } catch (err: any) {
          showToast(err.message || 'Failed to update payout', 'error');
        } finally {
          setConfirmModal(null);
        }
      },
    });
  };

  const copyTextToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`${label} copied to clipboard`, 'success');
  };

  // ─────────────────────────────────────────────────────────────
  // 1. Unauthenticated Login Screen
  // ─────────────────────────────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <div className={`admin-viewport admin-theme-${theme}`}>
        <div className="admin-login-canvas">
          <div className="admin-login-card">
            <div className="admin-login-logo">
              <ShieldCheckIcon size={28} color="#FFFFFF" />
            </div>
            <h2 className="admin-login-title">Bighabesha Executive</h2>
            <p className="admin-login-sub">
              {require2FA
                ? 'Enter the 6-digit verification code sent to your Telegram'
                : 'Sign in to access store operations, analytics & fulfillment'}
            </p>

            {authError && (
              <div style={{ background: 'var(--admin-ruby-dim)', border: '1px solid var(--admin-ruby)', padding: '12px', borderRadius: 'var(--admin-radius-md)', color: 'var(--admin-ruby)', fontSize: '13px', marginBottom: '20px', width: '100%' }}>
                {authError}
              </div>
            )}

            {!require2FA ? (
              <form onSubmit={handleLoginSubmit} style={{ width: '100%' }}>
                <div className="admin-input-group">
                  <LockIcon size={18} color="var(--admin-text-muted)" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Master administrator password"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="admin-login-btn"
                  disabled={authLoading || !password}
                >
                  {authLoading ? 'Authenticating...' : 'Send Telegram 2FA Code'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerify2FASubmit} style={{ width: '100%' }}>
                <div className="admin-input-group" style={{ justifyContent: 'center' }}>
                  <KeyIcon size={18} color="var(--admin-text-muted)" />
                  <input
                    type="text"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    style={{ textAlign: 'center', letterSpacing: '8px', fontSize: '18px', fontWeight: 800 }}
                    placeholder="000000"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="admin-login-btn"
                  disabled={authLoading || otp.length < 6}
                >
                  {authLoading ? 'Verifying...' : 'Verify 2FA & Enter Portal'}
                </button>
                <button
                  type="button"
                  onClick={() => setRequire2FA(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--admin-text-muted)', fontSize: '13px', marginTop: '16px', cursor: 'pointer' }}
                >
                  Back to Password
                </button>
              </form>
            )}

            {/* Quick theme switcher on login page */}
            <div style={{ marginTop: '24px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                className="admin-pill-badge clickable"
                style={{ height: '30px', fontSize: '11px' }}
                onClick={toggleTheme}
              >
                {theme === 'dark' ? <SunIcon size={13} /> : <MoonIcon size={13} />}
                <span>{theme === 'dark' ? 'Light Theme' : 'Dark Theme'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // 2. Data Preparation for Equalizer Matrix & Bento
  // ─────────────────────────────────────────────────────────────
  const pendingApprovalOrders = orders.filter((o) => o.status === 'pending_approval');
  const deliveredOrdersCount = orders.filter((o) => o.status === 'fulfilled' || o.status === 'delivered').length;
  const awaitingPaymentOrdersCount = orders.filter((o) => o.status === 'awaiting_payment').length;
  const totalRevenueETB = overview?.totalRevenue ?? orders.reduce((acc, o) => acc + (o.status === 'fulfilled' || o.status === 'delivered' ? o.amount_etb : 0), 0);

  // Equalizer Histogram Data Construction
  const getRealChartPoints = () => {
    if (overview?.chartPoints && overview.chartPoints.length > 0) {
      return overview.chartPoints;
    }
    const points: { label: string; revenue: number; orders: number }[] = [];
    const now = new Date();
    const numBuckets = timeRange === '1Y' ? 12 : 7;
    for (let i = numBuckets - 1; i >= 0; i--) {
      const d = new Date(now);
      if (timeRange === '1Y') {
        d.setMonth(now.getMonth() - i);
        const label = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
        const monthPrefix = d.toISOString().slice(0, 7);
        const monthOrders = orders.filter((o) => o.created_at && o.created_at.startsWith(monthPrefix));
        const monthRev = monthOrders
          .filter((o) => o.status === 'fulfilled' || o.status === 'delivered')
          .reduce((sum, o) => sum + (o.amount_etb || 0), 0);
        points.push({ label, revenue: monthRev, orders: monthOrders.length });
      } else {
        d.setDate(now.getDate() - i);
        const dayStr = d.toISOString().slice(0, 10);
        const label = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }).toUpperCase();
        const dayOrders = orders.filter((o) => o.created_at && o.created_at.startsWith(dayStr));
        const dayRev = dayOrders
          .filter((o) => o.status === 'fulfilled' || o.status === 'delivered')
          .reduce((sum, o) => sum + (o.amount_etb || 0), 0);
        points.push({ label, revenue: dayRev, orders: dayOrders.length });
      }
    }
    return points;
  };

  const monthlyData = getRealChartPoints();
  const maxRev = Math.max(...monthlyData.map((d: any) => d.revenue || 0), 1000);
  const TOTAL_BLOCKS_PER_COL = 10;

  // Sparkline data feeds from real database metrics
  const revenueSparklineData = monthlyData.map((d: any) => d.revenue || 0);
  const ordersSparklineData = monthlyData.map((d: any) => d.orders || 0);

  // Real user registrations grouped by time bucket
  const getRealUsersSparkline = () => {
    const points: number[] = [];
    const now = new Date();
    const numBuckets = timeRange === '1Y' ? 12 : 7;
    for (let i = numBuckets - 1; i >= 0; i--) {
      const d = new Date(now);
      if (timeRange === '1Y') {
        d.setMonth(now.getMonth() - i);
        const monthPrefix = d.toISOString().slice(0, 7);
        const count = users.filter((u: any) => u.created_at && u.created_at.startsWith(monthPrefix)).length;
        points.push(count);
      } else {
        d.setDate(now.getDate() - i);
        const dayStr = d.toISOString().slice(0, 10);
        const count = users.filter((u: any) => u.created_at && u.created_at.startsWith(dayStr)).length;
        points.push(count);
      }
    }
    return points;
  };
  const activeBuyersSparklineData = getRealUsersSparkline();

  // Real stock inventory telemetry
  const availableStock = stockData.summary?.available ?? 0;
  const usedStock = stockData.summary?.used ?? 0;
  const vaultSparklineData = [usedStock, availableStock];

  // Dynamic period-over-period growth computation
  const computeGrowth = (data: number[]): { pct: string; direction: 'positive' | 'negative' | 'neutral'; label: string } => {
    if (data.length < 2) return { pct: '0.0', direction: 'neutral', label: 'No prior data' };
    const current = data[data.length - 1] || 0;
    const previous = data[data.length - 2] || 0;
    if (previous === 0 && current === 0) return { pct: '0.0', direction: 'neutral', label: 'vs previous period' };
    if (previous === 0) return { pct: '100', direction: 'positive', label: 'new activity' };
    const diff = current - previous;
    const change = (diff / previous) * 100;
    if (Math.abs(change) < 0.1) return { pct: '0.0', direction: 'neutral', label: 'vs previous period' };
    return {
      pct: Math.abs(change) >= 100 ? Math.round(Math.abs(change)).toString() : Math.abs(change).toFixed(1),
      direction: change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral',
      label: 'vs previous period',
    };
  };
  const revenueGrowth = computeGrowth(revenueSparklineData);
  const ordersGrowth = computeGrowth(ordersSparklineData);
  const customersGrowth = computeGrowth(activeBuyersSparklineData);

  // Product share distribution
  const geminiOrders = orders.filter((o) => o.product_id?.startsWith('gemini'));
  const premOrders = orders.filter((o) => o.product_id?.startsWith('telegram_prem'));
  const starsOrders = orders.filter((o) => o.product_id?.startsWith('telegram_stars'));
  const totalCatOrders = orders.length || 1;
  const geminiPct = Math.round((geminiOrders.length / totalCatOrders) * 100);
  const premPct = Math.round((premOrders.length / totalCatOrders) * 100);
  const starsPct = Math.min(100, Math.round((starsOrders.length / totalCatOrders) * 100));

  // Payment rails distribution
  const railsDistribution = [
    { id: 'telebirr', name: 'Telebirr', color: '#0284C7', count: orders.filter((o) => o.payment_rail === 'telebirr').length },
    { id: 'cbe', name: 'CBE Bank', color: '#A855F7', count: orders.filter((o) => o.payment_rail === 'cbe').length },
    { id: 'abyssinia', name: 'Abyssinia', color: '#EA580C', count: orders.filter((o) => o.payment_rail === 'abyssinia').length },
    { id: 'stars', name: 'Telegram Stars', color: '#EAB308', count: orders.filter((o) => o.payment_rail === 'stars').length },
  ].map((r) => ({
    ...r,
    pct: Math.round((r.count / totalCatOrders) * 100),
  }));

  // Filtering
  const filteredOrders = orders.filter((o) => {
    if (orderFilter !== 'all' && o.status !== orderFilter) return false;
    if (categoryRail !== 'all' && (o.payment_rail || '').toLowerCase() !== categoryRail.toLowerCase()) return false;
    if (orderSearch) {
      const q = orderSearch.toLowerCase();
      const matchId = String(o.id).includes(q);
      const matchUser = o.username?.toLowerCase().includes(q) || String(o.user_id).includes(q);
      const matchProd = o.product_id?.toLowerCase().includes(q);
      if (!matchId && !matchUser && !matchProd) return false;
    }
    return true;
  });

  const filteredUsers = users.filter((u) => {
    if (!userSearch) return true;
    const q = userSearch.toLowerCase();
    return String(u.id).includes(q) || u.username?.toLowerCase().includes(q) || u.phone_number?.includes(q);
  });

  const filteredStock = stockData.items.filter((item) => {
    if (!stockSearch) return true;
    const q = stockSearch.toLowerCase();
    return String(item.id).includes(q) || item.payload?.toLowerCase().includes(q);
  });

  // Tab Title label helper
  const getTabTitle = () => {
    switch (activeTab) {
      case 'overview': return 'Overview';
      case 'orders': return 'Order Management';
      case 'stock': return 'Stock Vault';
      case 'users': return 'Customer Directory';
      case 'payouts': return 'Payouts Ledger';
      case 'broadcast': return 'Broadcast Studio';
      case 'settings': return 'Store Settings';
      default: return 'Overview';
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 3. Main Dashboard Layout & Bento Grid
  // ─────────────────────────────────────────────────────────────
  return (
    <div className={`admin-viewport admin-theme-${theme}`}>
      {/* Toast Notification Container */}
      <div style={{ position: 'fixed', top: '22px', right: '24px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '13px 18px',
              borderRadius: 'var(--admin-radius-md)',
              background: 'var(--admin-card-elevated)',
              border: `1px solid ${t.type === 'success' ? 'var(--admin-emerald)' : t.type === 'error' ? 'var(--admin-ruby)' : 'var(--admin-accent)'}`,
              color: 'var(--admin-text-pure)',
              fontSize: '13px',
              fontWeight: 700,
              boxShadow: 'var(--admin-shadow-lg)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
            }}
          >
            {t.type === 'success' && <CheckCircleIcon size={17} color="var(--admin-emerald)" />}
            {t.type === 'error' && <AlertCircleIcon size={17} color="var(--admin-ruby)" />}
            {t.type === 'info' && <ClockIcon size={17} color="var(--admin-accent)" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* Mobile Top App Bar (< 768px) */}
      <div className="admin-mobile-topbar">
        <div className="admin-mobile-topbar-left">
          <button
            className="admin-icon-btn"
            aria-label="Open menu drawer"
            onClick={() => setMobileMenuOpen(true)}
          >
            <MenuIcon size={18} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className="admin-workspace-logo" style={{ width: '26px', height: '26px', fontSize: '11px' }}>BH</div>
            <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--admin-text-pure)' }}>{getTabTitle()}</span>
          </div>
        </div>

        <div className="admin-mobile-topbar-actions">
          <button className="admin-icon-btn" onClick={toggleTheme} title="Toggle Theme">
            {theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
          </button>
          <div className="admin-avatar" style={{ width: '26px', height: '26px', fontSize: '10px' }}>
            {adminRole.slice(0, 2).toUpperCase()}
          </div>
        </div>
      </div>

      {/* Mobile Quick-Tabs Bar */}
      <div className="admin-mobile-quicktabs">
        {canSee('analytics.view') && (
          <button className={`admin-quicktab-chip ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
            Overview
          </button>
        )}
        {canSee('orders.view') && (
          <button className={`admin-quicktab-chip ${activeTab === 'orders' ? 'active' : ''}`} onClick={() => setActiveTab('orders')}>
            Orders {pendingApprovalOrders.length > 0 && `(${pendingApprovalOrders.length})`}
          </button>
        )}
        {canSee('stock.manage') && (
          <button className={`admin-quicktab-chip ${activeTab === 'stock' ? 'active' : ''}`} onClick={() => setActiveTab('stock')}>
            Stock Vault
          </button>
        )}
        {canSee('users.view') && (
          <button className={`admin-quicktab-chip ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
            Customers
          </button>
        )}
        {canSee('payouts.manage') && (
          <button className={`admin-quicktab-chip ${activeTab === 'payouts' ? 'active' : ''}`} onClick={() => setActiveTab('payouts')}>
            Payouts {payoutRows.length > 0 && `(${payoutRows.length})`}
          </button>
        )}
        {canSee('broadcast.send') && (
          <button className={`admin-quicktab-chip ${activeTab === 'broadcast' ? 'active' : ''}`} onClick={() => setActiveTab('broadcast')}>
            Broadcast
          </button>
        )}
        {canSee('settings.read') && (
          <button className={`admin-quicktab-chip ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
            Settings
          </button>
        )}
      </div>

      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div className="admin-mobile-drawer-backdrop" onClick={() => setMobileMenuOpen(false)} />
      )}

      <div className="admin-app-window">
        {/* Left Sidebar Navigation */}
        <aside className={`admin-sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
          <div>
            {/* Workspace Switcher Top Card */}
            <div className="admin-workspace-card" onClick={() => showToast('Bighabesha Shop • Executive Production Hub', 'info')}>
              <div className="admin-workspace-left">
                <div className="admin-workspace-logo">BH</div>
                <div className="admin-workspace-meta">
                  <span className="admin-workspace-title">Bighabesha Shop</span>
                  <span className="admin-workspace-sub">Executive Terminal</span>
                </div>
              </div>
              <ChevronUpDownIcon size={14} color="var(--admin-text-muted)" />
            </div>

            {/* Structured Navigation Groups */}
            <nav className="admin-nav-sections">
              {/* Group 1: Main Menu */}
              <div className="admin-nav-group">
                <span className="admin-nav-group-title">Main Menu</span>
                {canSee('analytics.view') && (
                  <button
                    className={`admin-nav-item ${activeTab === 'overview' ? 'active' : ''}`}
                    onClick={() => { setActiveTab('overview'); setMobileMenuOpen(false); }}
                  >
                    <LayoutDashboardIcon size={17} />
                    <span>Overview</span>
                  </button>
                )}
                {canSee('orders.view') && (
                  <button
                    className={`admin-nav-item ${activeTab === 'orders' ? 'active' : ''}`}
                    onClick={() => { setActiveTab('orders'); setMobileMenuOpen(false); }}
                  >
                    <ShoppingBagIcon size={17} />
                    <span>Orders</span>
                    {pendingApprovalOrders.length > 0 && (
                      <span className="admin-nav-badge">{pendingApprovalOrders.length}</span>
                    )}
                  </button>
                )}
                {canSee('stock.manage') && (
                  <button
                    className={`admin-nav-item ${activeTab === 'stock' ? 'active' : ''}`}
                    onClick={() => { setActiveTab('stock'); setMobileMenuOpen(false); }}
                  >
                    <LayersIcon size={17} />
                    <span>Stock Vault</span>
                  </button>
                )}
              </div>

              {/* Group 2: Customers */}
              {canSee('users.view') && (
                <div className="admin-nav-group">
                  <span className="admin-nav-group-title">Customers</span>
                  <button
                    className={`admin-nav-item ${activeTab === 'users' ? 'active' : ''}`}
                    onClick={() => { setActiveTab('users'); setMobileMenuOpen(false); }}
                  >
                    <UsersIcon size={17} />
                    <span>Customer List</span>
                  </button>
                </div>
              )}

              {/* Group 3: Management */}
              {(canSee('payouts.manage') || canSee('broadcast.send')) && (
                <div className="admin-nav-group">
                  <span className="admin-nav-group-title">Management</span>
                  {canSee('payouts.manage') && (
                    <button
                      className={`admin-nav-item ${activeTab === 'payouts' ? 'active' : ''}`}
                      onClick={() => { setActiveTab('payouts'); setMobileMenuOpen(false); }}
                    >
                      <WalletCardsIcon size={17} />
                      <span>Payouts</span>
                      {payoutRows.length > 0 && (
                        <span className="admin-nav-badge" style={{ background: 'var(--admin-emerald)', color: '#07080B' }}>{payoutRows.length}</span>
                      )}
                    </button>
                  )}
                  {canSee('broadcast.send') && (
                    <button
                      className={`admin-nav-item ${activeTab === 'broadcast' ? 'active' : ''}`}
                      onClick={() => { setActiveTab('broadcast'); setMobileMenuOpen(false); }}
                    >
                      <SendIcon size={17} />
                      <span>Broadcast Studio</span>
                    </button>
                  )}
                </div>
              )}

              {/* Group 4: Settings */}
              {canSee('settings.read') && (
                <div className="admin-nav-group">
                  <span className="admin-nav-group-title">Settings</span>
                  <button
                    className={`admin-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
                    onClick={() => { setActiveTab('settings'); setMobileMenuOpen(false); }}
                  >
                    <SettingsIcon size={17} />
                    <span>Store Settings</span>
                  </button>
                </div>
              )}
            </nav>
          </div>

          {/* Sidebar Footer Controls */}
          <div className="admin-sidebar-footer">
            <button className="admin-theme-switch-btn" onClick={toggleTheme}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {theme === 'dark' ? <MoonIcon size={15} /> : <SunIcon size={15} />}
                <span>Theme</span>
              </div>
              <span className="admin-theme-switch-pill">{theme}</span>
            </button>

            <button
              className="admin-pill-badge clickable"
              style={{ justifyContent: 'center', width: '100%', height: '34px', fontSize: '11.5px' }}
              onClick={() => setShowShortcutsModal(true)}
            >
              <span>Shortcuts</span>
              <kbd className="admin-search-kbd">?</kbd>
            </button>

            <button className="admin-logout-btn" onClick={handleLogout}>
              <LogOutIcon size={15} />
              <span>Sign Out</span>
            </button>
          </div>
        </aside>

        {/* Main Workspace Area */}
        <main className="admin-workspace">
          {/* 2-Tier Header Section */}
          <header className="admin-header-deck">
            {/* Tier 1: Breadcrumbs + Environment Tag + Global Status & Controls */}
            <div className="admin-header-tier1">
              <div className="admin-breadcrumbs">
                <span className="crumb-root" onClick={() => setActiveTab('overview')}>Dashboard</span>
                <span className="crumb-sep">&gt;</span>
                <span className="crumb-current">{getTabTitle()}</span>
                <span className="admin-env-tag">PROD TERMINAL</span>
              </div>

              <div className="admin-header-controls-right">
                {/* Live Sync Status Pill */}
                <div
                  className="admin-pill-badge clickable"
                  title={`Live telemetry sync ${liveSync ? 'active' : 'paused'} - click to toggle`}
                  onClick={() => {
                    setLiveSync(!liveSync);
                    showToast(`Live telemetry ${!liveSync ? 'enabled' : 'paused'}`, 'info');
                  }}
                >
                  <span className={`admin-sync-dot ${liveSync ? 'active' : 'paused'}`} />
                  <span style={{ fontSize: '11px', color: 'var(--admin-text-muted)', fontFamily: 'var(--font-admin-mono)' }}>
                    {lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>

                {/* System Date */}
                <div className="admin-pill-badge" title="Executive System Date">
                  <CalendarIcon size={12} color="var(--admin-text-muted)" />
                  <span>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>

                {/* Rails Status Indicator */}
                <div className="admin-pill-badge" style={{ gap: '6px' }} title="All payment rails operating normally">
                  <span className="admin-sync-dot active" />
                  <span style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--admin-text-muted)' }}>Online</span>
                </div>

                {/* Notifications Bell */}
                <button
                  className="admin-icon-btn"
                  title="System Notifications"
                  aria-label="System Notifications"
                  onClick={() => showToast('All payment rails operational — 0 critical faults', 'info')}
                >
                  <BellIcon size={14} />
                </button>

                {/* Telemetry Refresh */}
                <button
                  className="admin-icon-btn"
                  title="Refresh live data [R]"
                  aria-label="Refresh live data"
                  onClick={() => {
                    loadAllAdminData(timeRange, categoryRail);
                    showToast('Live telemetry refreshed', 'info');
                  }}
                >
                  <RefreshIcon size={14} className={isSyncLoading ? 'animate-spin' : ''} />
                </button>

                {/* Theme Toggle */}
                <button
                  className="admin-icon-btn"
                  title={`Toggle ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
                  aria-label="Toggle Color Theme"
                  onClick={toggleTheme}
                >
                  {theme === 'dark' ? <SunIcon size={14} /> : <MoonIcon size={14} />}
                </button>

                {/* Shortcuts Key */}
                <button
                  className="admin-icon-btn"
                  title="Keyboard Shortcuts [?]"
                  aria-label="Keyboard Shortcuts"
                  onClick={() => setShowShortcutsModal(true)}
                >
                  <kbd className="admin-search-kbd" style={{ fontSize: '10px', padding: '0 3px', border: 'none', background: 'transparent' }}>?</kbd>
                </button>

                {/* Profile Chip */}
                <div className="admin-profile-chip">
                  <div className="admin-avatar">AD</div>
                  <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--admin-text-pure)', letterSpacing: '0.04em' }}>
                    {adminRole.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>

            {/* Tier 2: Hero Greeting + Quick Actions & Search */}
            <div className="admin-header-tier2">
              <div className="admin-greeting-box">
                <h1 className="admin-greeting-title">
                  {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'}, Admin
                </h1>
                <div className="admin-greeting-sub">Unified telemetry, automated settlement & store operations</div>
              </div>

              <div className="admin-header-actions-right">
                {/* Search Box */}
                <div className="admin-search-box">
                  <SearchIcon size={14} color="var(--admin-text-muted)" />
                  <input
                    id="admin-global-search"
                    type="text"
                    placeholder="Search orders, clients, keys..."
                    value={orderSearch}
                    onChange={(e) => {
                      setOrderSearch(e.target.value);
                      if (activeTab !== 'orders') setActiveTab('orders');
                    }}
                  />
                  <kbd className="admin-search-kbd">/</kbd>
                </div>

                {/* Pending Approval Stat Chip */}
                {pendingApprovalOrders.length > 0 && (
                  <div
                    className="header-stat-pill highlight"
                    title="Orders needing transfer slip review"
                    onClick={() => {
                      setOrderFilter('pending_approval');
                      setActiveTab('orders');
                    }}
                  >
                    <ZapIcon size={13} />
                    <span>{pendingApprovalOrders.length} Pending Approval</span>
                  </div>
                )}

                {/* Quick Add Stock Action */}
                {canSee('stock.manage') && (
                  <button
                    className="action-btn-pill-secondary"
                    style={{ height: '34px', padding: '0 12px', borderRadius: 'var(--admin-radius-pill)' }}
                    onClick={() => setActiveTab('stock')}
                  >
                    <PlusIcon size={13} />
                    <span>Stock Keys</span>
                  </button>
                )}

                {/* Quick Broadcast Action */}
                {canSee('broadcast.send') && (
                  <button
                    className="action-btn-pill-primary"
                    style={{ height: '34px', padding: '0 14px' }}
                    onClick={() => setActiveTab('broadcast')}
                  >
                    <RadioIcon size={13} />
                    <span>Broadcast</span>
                  </button>
                )}
              </div>
            </div>
          </header>

          {/* ─────────────────────────────────────────────────────────────
             TAB 1: BENTO OVERVIEW (Executive Telemetry & Equalizer Chart)
             ───────────────────────────────────────────────────────────── */}
          {activeTab === 'overview' && (
            <div>
              {/* Top 4 Bento KPI Cards */}
              <div className="bento-kpi-grid">
                {/* 1. Total Revenue */}
                <div className="bento-card">
                  <div className="bento-card-header">
                    <span className="bento-kpi-label">TOTAL REVENUE</span>
                    <div className="bento-action-circle" onClick={() => setActiveTab('orders')} title="View order revenue ledger">
                      <ArrowUpRightIcon size={14} />
                    </div>
                  </div>
                  <div className="bento-kpi-main">
                    <div className="bento-kpi-value">{totalRevenueETB.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--admin-accent-text)' }}>ETB</span></div>
                    <div className="bento-sparkline-box">
                      <Sparkline data={revenueSparklineData} />
                    </div>
                  </div>
                  <div className="bento-kpi-footer">
                    <span className={`bento-trend-pill ${revenueGrowth.direction}`}>
                      {revenueGrowth.direction === 'positive' && <TrendingUpIcon size={11} />}
                      {revenueGrowth.direction === 'negative' && <TrendingDownIcon size={11} />}
                      {revenueGrowth.direction === 'neutral' && <MinusIcon size={11} />}
                      {revenueGrowth.direction === 'negative' ? '−' : revenueGrowth.direction === 'positive' ? '+' : ''}{revenueGrowth.pct}%
                    </span>
                    <span>{revenueGrowth.label}</span>
                  </div>
                </div>

                {/* 2. Total Orders */}
                <div className="bento-card">
                  <div className="bento-card-header">
                    <span className="bento-kpi-label">TOTAL ORDERS</span>
                    <div className="bento-action-circle" onClick={() => setActiveTab('orders')} title="View all orders">
                      <ArrowUpRightIcon size={14} />
                    </div>
                  </div>
                  <div className="bento-kpi-main">
                    <div className="bento-kpi-value">{orders.length} <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--admin-text-muted)' }}>Orders</span></div>
                    <div className="bento-sparkline-box">
                      <Sparkline data={ordersSparklineData} />
                    </div>
                  </div>
                  <div className="bento-kpi-footer">
                    <span className={`bento-trend-pill ${ordersGrowth.direction}`}>
                      {ordersGrowth.direction === 'positive' && <TrendingUpIcon size={11} />}
                      {ordersGrowth.direction === 'negative' && <TrendingDownIcon size={11} />}
                      {ordersGrowth.direction === 'neutral' && <MinusIcon size={11} />}
                      {ordersGrowth.direction === 'negative' ? '−' : ordersGrowth.direction === 'positive' ? '+' : ''}{ordersGrowth.pct}%
                    </span>
                    <span>{deliveredOrdersCount} delivered ({orders.length > 0 ? Math.round((deliveredOrdersCount / orders.length) * 100) : 0}%)</span>
                  </div>
                </div>

                {/* 3. Active Customers */}
                <div className="bento-card">
                  <div className="bento-card-header">
                    <span className="bento-kpi-label">NEW CUSTOMERS</span>
                    <div className="bento-action-circle" onClick={() => setActiveTab('users')} title="View customer directory">
                      <ArrowUpRightIcon size={14} />
                    </div>
                  </div>
                  <div className="bento-kpi-main">
                    <div className="bento-kpi-value">{users.length} <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--admin-text-muted)' }}>Users</span></div>
                    <div className="bento-sparkline-box">
                      <Sparkline data={activeBuyersSparklineData} />
                    </div>
                  </div>
                  <div className="bento-kpi-footer">
                    <span className={`bento-trend-pill ${customersGrowth.direction}`}>
                      {customersGrowth.direction === 'positive' && <TrendingUpIcon size={11} />}
                      {customersGrowth.direction === 'negative' && <TrendingDownIcon size={11} />}
                      {customersGrowth.direction === 'neutral' && <MinusIcon size={11} />}
                      {customersGrowth.direction === 'negative' ? '−' : customersGrowth.direction === 'positive' ? '+' : ''}{customersGrowth.pct}%
                    </span>
                    <span>{users.filter((u: any) => Boolean(u.username)).length === users.length ? '100%' : Math.round((users.filter((u: any) => Boolean(u.username)).length / Math.max(users.length, 1)) * 100) + '%'} verified Telegram</span>
                  </div>
                </div>

                {/* 4. Vault Stock */}
                <div className="bento-card">
                  <div className="bento-card-header">
                    <span className="bento-kpi-label">VAULT RESERVES</span>
                    <div className="bento-action-circle" onClick={() => setActiveTab('stock')} title="Manage stock keys">
                      <ArrowUpRightIcon size={14} />
                    </div>
                  </div>
                  <div className="bento-kpi-main">
                    <div className="bento-kpi-value" style={{ color: (stockData.summary?.available ?? 0) > 0 ? 'var(--admin-emerald)' : 'var(--admin-ruby)' }}>
                      {stockData.summary?.available ?? 0} <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--admin-text-muted)' }}>Keys</span>
                    </div>
                    <div className="bento-sparkline-box">
                      <Sparkline data={vaultSparklineData} />
                    </div>
                  </div>
                  <div className="bento-kpi-footer">
                    <span className="bento-trend-pill neutral">Gemini 18M</span>
                    <span>Instant checkout ready</span>
                  </div>
                </div>
              </div>

              {/* Bento Row 2: Equalizer Matrix Chart & Category Breakdown Donut */}
              <div className="bento-analytics-row">
                {/* Left: Signature Pixel Matrix Equalizer Chart */}
                <div className="analytics-panel">
                  <div className="panel-header">
                    <div className="panel-title-box">
                      <span className="panel-title">
                        SALES TREND <InfoIcon size={14} color="var(--admin-text-muted)" />
                      </span>
                      <span className="panel-subtitle">Total Revenue : <strong>{totalRevenueETB.toLocaleString()} ETB</strong></span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div className="segmented-range-capsule">
                        {[
                          { id: '1M', label: 'Weekly' },
                          { id: '6M', label: 'Monthly' },
                          { id: '1Y', label: 'Yearly' },
                        ].map((tr) => (
                          <button
                            key={tr.id}
                            className={`segmented-range-btn ${timeRange === tr.id ? 'active' : ''}`}
                            onClick={() => setTimeRange(tr.id)}
                          >
                            {tr.label}
                          </button>
                        ))}
                      </div>

                      <div style={{ position: 'relative' }}>
                        <button
                          className="admin-icon-btn"
                          style={{ width: '28px', height: '28px' }}
                          title="Chart telemetry options"
                          aria-label="Chart telemetry options"
                          onClick={() => setShowChartMenu(!showChartMenu)}
                        >
                          <MoreHorizontalIcon size={14} />
                        </button>

                        {showChartMenu && (
                          <div className="chart-menu-dropdown" onClick={(e) => e.stopPropagation()}>
                            <button
                              className="chart-menu-item"
                              onClick={() => {
                                downloadExportApi('/api/admin/export/orders.csv', 'bighabesha-sales-telemetry.csv');
                                setShowChartMenu(false);
                                showToast('Sales telemetry exported to CSV', 'success');
                              }}
                            >
                              <DownloadIcon size={13} />
                              <span>Export CSV Telemetry</span>
                            </button>
                            <button
                              className="chart-menu-item"
                              onClick={() => {
                                setActiveTab('orders');
                                setShowChartMenu(false);
                              }}
                            >
                              <ShoppingBagIcon size={13} />
                              <span>View Order Ledger</span>
                            </button>
                            <button
                              className="chart-menu-item"
                              onClick={() => {
                                setTimeRange('6M');
                                setShowChartMenu(false);
                                showToast('Time window reset to 6 Months', 'info');
                              }}
                            >
                              <RefreshIcon size={13} />
                              <span>Reset 6M Window</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Equalizer Canvas */}
                  <div className="matrix-chart-wrapper">
                    <div className="matrix-chart-canvas">
                      {monthlyData.map((point: any, idx: number) => {
                        const activeCount = Math.max(1, Math.round((point.revenue / maxRev) * TOTAL_BLOCKS_PER_COL));
                        const isHovered = hoveredColumnIdx === idx;

                        return (
                          <div
                            key={idx}
                            className={`matrix-column ${isHovered ? 'hovered' : ''}`}
                            onMouseEnter={() => setHoveredColumnIdx(idx)}
                            onMouseLeave={() => setHoveredColumnIdx(null)}
                          >
                            {/* Hover Tooltip Card */}
                            {isHovered && (
                              <div
                                className="chart-tooltip-card"
                                style={{
                                  left: idx === 0 ? '0' : idx === monthlyData.length - 1 ? 'auto' : '50%',
                                  right: idx === monthlyData.length - 1 ? '0' : 'auto',
                                  transform: (idx !== 0 && idx !== monthlyData.length - 1) ? 'translateX(-50%)' : 'none',
                                }}
                              >
                                <div className="tooltip-date-header">{point.label}</div>
                                <div className="tooltip-stat-row">
                                  <span>Settled:</span>
                                  <span className="tooltip-stat-highlight">{point.revenue.toLocaleString()} ETB</span>
                                </div>
                                <div className="tooltip-stat-row">
                                  <span>Volume:</span>
                                  <span>{point.orders} orders</span>
                                </div>
                              </div>
                            )}

                            {/* Stacked Equalizer Pixel Blocks */}
                            <div className="matrix-stack">
                              {Array.from({ length: TOTAL_BLOCKS_PER_COL }).map((_, blockIdx) => (
                                <div
                                  key={blockIdx}
                                  className={`matrix-block ${blockIdx < activeCount ? 'active' : ''}`}
                                />
                              ))}
                            </div>

                            <span className="matrix-column-label">{point.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Payment Rails Distribution Strip */}
                  <div className="rails-volume-strip">
                    {railsDistribution.map((rail) => (
                      <div key={rail.id} className="rail-volume-card">
                        <div className="rail-volume-header">
                          <span style={{ color: rail.color }}>{rail.name}</span>
                          <span style={{ color: 'var(--admin-text-pure)' }}>{rail.pct}%</span>
                        </div>
                        <div className="rail-volume-bar-track">
                          <div className="rail-volume-bar-fill" style={{ width: `${rail.pct}%`, background: rail.color }} />
                        </div>
                        <div className="rail-volume-subtext">
                          {rail.count} {rail.count === 1 ? 'order' : 'orders'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: Sales by Category Donut Breakdown */}
                <div className="analytics-panel">
                  <div className="panel-header">
                    <div className="panel-title-box">
                      <span className="panel-title">Product Share</span>
                      <span className="panel-subtitle">Catalog volume split</span>
                    </div>
                  </div>

                  <div className="donut-container">
                    <svg viewBox="0 0 36 36" className="donut-chart-svg">
                      <circle cx="18" cy="18" r="15.9155" fill="transparent" stroke="var(--admin-border)" strokeWidth="4" />
                      {/* Segment 1: Gemini Pro */}
                      {geminiPct > 0 && (
                        <circle cx="18" cy="18" r="15.9155" fill="transparent" stroke="#3B82F6" strokeWidth="4" strokeDasharray={`${geminiPct} ${100 - geminiPct}`} strokeDashoffset="25" />
                      )}
                      {/* Segment 2: Telegram Premium */}
                      {premPct > 0 && (
                        <circle cx="18" cy="18" r="15.9155" fill="transparent" stroke="#10B981" strokeWidth="4" strokeDasharray={`${premPct} ${100 - premPct}`} strokeDashoffset={`${125 - geminiPct}`} />
                      )}
                      {/* Segment 3: Telegram Stars */}
                      {starsPct > 0 && (
                        <circle cx="18" cy="18" r="15.9155" fill="transparent" stroke="#FACC15" strokeWidth="4" strokeDasharray={`${starsPct} ${100 - starsPct}`} strokeDashoffset={`${125 - geminiPct - premPct}`} />
                      )}
                    </svg>

                    <div className="category-legend-list">
                      <div className="legend-item">
                        <div className="legend-label-box">
                          <GeminiBrandIcon size={16} />
                          <span>Gemini Advanced</span>
                        </div>
                        <span className="legend-percent">{geminiPct}%</span>
                      </div>

                      <div className="legend-item">
                        <div className="legend-label-box">
                          <TelegramBrandIcon size={16} />
                          <span>Telegram Premium</span>
                        </div>
                        <span className="legend-percent">{premPct}%</span>
                      </div>

                      <div className="legend-item">
                        <div className="legend-label-box">
                          <StarsBrandIcon size={16} />
                          <span>Telegram Stars</span>
                        </div>
                        <span className="legend-percent">{starsPct}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Actionable Urgent Fulfillment Queue (Triage Bento) */}
              {pendingApprovalOrders.length > 0 && (
                <div style={{ marginTop: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <AlertCircleIcon size={18} color="var(--admin-amber)" />
                      <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--admin-text-pure)', margin: 0 }}>
                        Urgent Fulfillment Queue ({pendingApprovalOrders.length} orders awaiting review)
                      </h3>
                    </div>
                    <button className="btn-secondary-pill" onClick={() => setActiveTab('orders')}>
                      View All Orders →
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
                    {pendingApprovalOrders.map((ord) => {
                      const prod = formatProductName(ord.product_id, ord.variant_id);
                      const rail = formatRailBadge(ord.payment_rail);

                      return (
                        <div key={ord.id} className="bento-card" style={{ padding: '16px 18px', border: '1px solid var(--admin-amber)', boxShadow: '0 4px 18px var(--admin-amber-glow)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                            <div>
                              <div style={{ fontSize: '13.5px', fontWeight: 800, color: 'var(--admin-text-pure)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span
                                  className="admin-order-id-chip"
                                  title="Click to copy Order ID"
                                  onClick={() => copyTextToClipboard(String(ord.id), 'Order ID')}
                                >
                                  #{ord.id}
                                </span>
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--admin-text-muted)', marginTop: '4px' }}>
                                @{ord.username || 'Customer'} • <span style={{ color: 'var(--admin-accent-text)', fontWeight: 600 }}>{prod.name} {prod.variant ? `(${prod.variant})` : ''}</span>
                              </div>
                            </div>
                            <span className="status-pill pending_approval">
                              <span className="status-dot" />
                              Needs Review
                            </span>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                            <div style={{ fontSize: '17px', fontWeight: 900, color: 'var(--admin-text-pure)', fontFamily: 'var(--font-admin-mono)' }}>
                              {ord.amount_etb?.toLocaleString()} <span style={{ fontSize: '11.5px', color: 'var(--admin-text-muted)' }}>ETB</span>
                            </div>
                            <span className={rail.className}>
                              <span className="rail-dot" />
                              {rail.label}
                            </span>
                          </div>

                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              className="btn-primary-pill"
                              style={{ flex: 1, height: '32px', fontSize: '11.5px', justifyContent: 'center' }}
                              onClick={() => handleApprove(ord.id)}
                            >
                              Approve & Deliver
                            </button>
                            <button
                              className="btn-secondary-pill"
                              style={{ height: '32px', fontSize: '11.5px' }}
                              onClick={() => {
                                setSelectedOrder(ord);
                                setModalType('receipt');
                              }}
                            >
                              Inspect Slip
                            </button>
                            <button
                              className="btn-secondary-pill"
                              style={{ height: '32px', fontSize: '11.5px', color: 'var(--admin-ruby)' }}
                              onClick={() => {
                                setSelectedOrder(ord);
                                setModalType('reject');
                              }}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────
             TAB 2: ORDER LIST (High-DPI 5-Column Data Grid)
             ───────────────────────────────────────────────────────────── */}
          {activeTab === 'orders' && (
            <div>
              {/* Order Status Filter Cards */}
              <div className="order-status-row">
                <div
                  className={`order-status-card ${orderFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setOrderFilter('all')}
                >
                  <div className="order-status-header">All Orders</div>
                  <div className="order-status-body">
                    <span className="order-status-count">{orders.length}</span>
                    <span className="bento-trend-pill positive">
                      <TrendingUpIcon size={11} /> Total
                    </span>
                  </div>
                </div>

                <div
                  className={`order-status-card ${orderFilter === 'pending_approval' ? 'active' : ''}`}
                  onClick={() => setOrderFilter('pending_approval')}
                >
                  <div className="order-status-header">Awaiting Acceptance</div>
                  <div className="order-status-body">
                    <span className="order-status-count">{pendingApprovalOrders.length}</span>
                    <span className="bento-trend-pill neutral">Slips</span>
                  </div>
                </div>

                <div
                  className={`order-status-card ${orderFilter === 'awaiting_payment' ? 'active' : ''}`}
                  onClick={() => setOrderFilter('awaiting_payment')}
                >
                  <div className="order-status-header">Awaiting Payment</div>
                  <div className="order-status-body">
                    <span className="order-status-count">{awaitingPaymentOrdersCount}</span>
                    <span className="bento-trend-pill neutral">In Flight</span>
                  </div>
                </div>

                <div
                  className={`order-status-card ${orderFilter === 'fulfilled' ? 'active' : ''}`}
                  onClick={() => setOrderFilter('fulfilled')}
                >
                  <div className="order-status-header">Delivered Orders</div>
                  <div className="order-status-body">
                    <span className="order-status-count">{deliveredOrdersCount}</span>
                    <span className="bento-trend-pill positive">
                      <TrendingUpIcon size={11} /> {orders.length > 0 ? Math.round((deliveredOrdersCount / orders.length) * 100) : 0}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Table Toolbar */}
              <div className="table-toolbar">
                <div className="filter-chips-row">
                  <span className={`filter-chip ${categoryRail === 'all' ? 'active' : ''}`} onClick={() => setCategoryRail('all')}>
                    All Rails
                  </span>
                  {['cbe', 'telebirr', 'abyssinia', 'stars', 'wallet_pay', 'ton'].map((rail) => (
                    <span
                      key={rail}
                      className={`filter-chip ${categoryRail === rail ? 'active' : ''}`}
                      onClick={() => setCategoryRail(categoryRail === rail ? 'all' : rail)}
                    >
                      {rail.toUpperCase()}
                    </span>
                  ))}
                </div>

                <div className="table-actions-right">
                  {canSee('export.financial') && (
                    <button
                      className="btn-secondary-pill"
                      onClick={() => downloadExportApi('/api/admin/export/orders.csv', 'bighabesha-orders.csv')}
                    >
                      <DownloadIcon size={13} />
                      <span>Export CSV</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Data Table */}
              <div className="admin-table-container">
                <table className="admin-data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '22%' }}>ORDER &amp; TIME ↕</th>
                      <th style={{ width: '20%' }}>CUSTOMER ↕</th>
                      <th style={{ width: '26%' }}>PRODUCT &amp; PLAN ↕</th>
                      <th style={{ width: '17%' }}>PRICE &amp; RAIL ↕</th>
                      <th style={{ width: '15%', textAlign: 'right' }}>STATUS &amp; ACTIONS ↕</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--admin-text-muted)' }}>
                          No orders found matching the filter criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredOrders.map((ord) => {
                        const prod = formatProductName(ord.product_id, ord.variant_id);
                        const rail = formatRailBadge(ord.payment_rail);
                        const status = formatOrderStatus(ord.status);
                        const { date, time } = formatDateTime(ord.created_at);

                        return (
                          <tr key={ord.id}>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                <span
                                  className="admin-order-id-chip"
                                  title="Click to copy Order ID"
                                  onClick={() => copyTextToClipboard(String(ord.id), 'Order ID')}
                                >
                                  #{ord.id}
                                </span>
                                <span style={{ fontSize: '10.5px', color: 'var(--admin-text-muted)' }}>
                                  {date} · {time}
                                </span>
                              </div>
                            </td>
                            <td>
                              <div className="table-user-cell">
                                <div className="table-user-avatar">
                                  {(ord.username ? ord.username[0] : 'U').toUpperCase()}
                                </div>
                                <div className="table-user-info">
                                  <span className="table-user-name">@{ord.username || 'Customer'}</span>
                                  <span className="table-user-id">ID: {ord.user_id}</span>
                                </div>
                              </div>
                            </td>
                            <td>
                              <div className="table-product-cell">
                                <div className="table-product-icon">
                                  {prod.icon}
                                </div>
                                <div className="table-product-info">
                                  <span className="table-product-title">{prod.name}</span>
                                  {prod.variant && (
                                    <span className="table-product-variant">{prod.variant}</span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                <div className="table-price-cell">
                                  {ord.amount_etb?.toLocaleString()} <span className="currency">ETB</span>
                                </div>
                                <div>
                                  <span className={rail.className}>
                                    <span className="rail-dot" />
                                    {rail.label}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="table-actions-cell">
                              <div className="table-actions-container">
                                <span className={status.className}>
                                  <span className="status-dot" />
                                  {status.label}
                                </span>
                                <div className="table-micro-actions">
                                  {ord.status === 'pending_approval' && (
                                    <>
                                      <button
                                        className="action-btn-pill-primary"
                                        title="Approve transfer and deliver items"
                                        aria-label="Approve transfer"
                                        onClick={() => handleApprove(ord.id)}
                                      >
                                        <CheckCircleIcon size={12} />
                                        <span>Approve</span>
                                      </button>
                                      <button
                                        className="action-btn-pill-secondary"
                                        title="Inspect payment transfer slip"
                                        aria-label="Inspect transfer slip"
                                        onClick={() => {
                                          setSelectedOrder(ord);
                                          setModalType('receipt');
                                        }}
                                      >
                                        <EyeIcon size={12} />
                                        <span>Slip</span>
                                      </button>
                                      <button
                                        className="action-btn-pill-danger"
                                        title="Reject payment slip"
                                        aria-label="Reject transfer"
                                        onClick={() => {
                                          setSelectedOrder(ord);
                                          setModalType('reject');
                                        }}
                                      >
                                        ✕
                                      </button>
                                    </>
                                  )}
                                  {ord.status === 'pending_fulfillment' && (
                                    <>
                                      <button
                                        className="action-btn-pill-primary"
                                        title="Fulfill order manually"
                                        aria-label="Fulfill order"
                                        onClick={() => {
                                          setSelectedOrder(ord);
                                          setModalType('fulfill');
                                        }}
                                      >
                                        <SendIcon size={12} />
                                        <span>Fulfill</span>
                                      </button>
                                      {ord.receipt_file_id && (
                                        <button
                                          className="action-btn-pill-secondary"
                                          title="Inspect payment slip"
                                          aria-label="Inspect payment slip"
                                          onClick={() => {
                                            setSelectedOrder(ord);
                                            setModalType('receipt');
                                          }}
                                        >
                                          <EyeIcon size={12} />
                                          <span>Slip</span>
                                        </button>
                                      )}
                                    </>
                                  )}
                                  {ord.status !== 'pending_approval' && ord.status !== 'pending_fulfillment' && ord.receipt_file_id && (
                                    <button
                                      className="action-btn-pill-secondary"
                                      title="Inspect payment slip"
                                      aria-label="Inspect payment slip"
                                      onClick={() => {
                                        setSelectedOrder(ord);
                                        setModalType('receipt');
                                      }}
                                    >
                                      <EyeIcon size={12} />
                                      <span>Slip</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────
             TAB 3: STOCK VAULT (Digital Inventory Management)
             ───────────────────────────────────────────────────────────── */}
          {activeTab === 'stock' && (
            <div>
              <div className="bento-kpi-grid">
                <div className="bento-card">
                  <div className="bento-kpi-label">Available Vault Keys</div>
                  <div className="bento-kpi-value" style={{ color: 'var(--admin-emerald)' }}>
                    {stockData.summary?.available ?? 0}
                  </div>
                  <div className="bento-kpi-footer">Ready for instant automated delivery</div>
                </div>

                <div className="bento-card">
                  <div className="bento-kpi-label">Delivered Keys</div>
                  <div className="bento-kpi-value">{stockData.summary?.delivered ?? 0}</div>
                  <div className="bento-kpi-footer">Fulfilled to verified buyers</div>
                </div>

                <div className="bento-card">
                  <div className="bento-kpi-label">Total Lifetime Imported</div>
                  <div className="bento-kpi-value">{stockData.summary?.total ?? 0}</div>
                  <div className="bento-kpi-footer">All inventory credentials</div>
                </div>
              </div>

              {/* Bulk Add Box */}
              <div className="bento-card" style={{ marginBottom: '22px' }}>
                <h3 style={{ fontSize: '15.5px', fontWeight: 800, color: 'var(--admin-text-pure)', margin: '0 0 6px 0' }}>
                  Import Gemini Pro Activation Links / Codes
                </h3>
                <p style={{ fontSize: '12.5px', color: 'var(--admin-text-muted)', margin: '0 0 14px 0' }}>
                  Paste one activation URL or credential payload per line. The engine will safely vault and dispatch them upon order approval.
                </p>
                <textarea
                  rows={4}
                  value={bulkLinks}
                  onChange={(e) => setBulkLinks(e.target.value)}
                  placeholder="https://one.google.com/promo/activation-link-1&#10;https://one.google.com/promo/activation-link-2"
                  style={{
                    width: '100%',
                    background: 'var(--admin-input-bg)',
                    border: '1px solid var(--admin-border)',
                    borderRadius: 'var(--admin-radius-md)',
                    padding: '12px 14px',
                    color: 'var(--admin-text-pure)',
                    fontFamily: 'var(--font-admin-mono)',
                    fontSize: '12.5px',
                    boxSizing: 'border-box',
                    outline: 'none',
                    marginBottom: '12px',
                  }}
                />
                <button
                  className="btn-primary-pill"
                  disabled={stockBusy || !bulkLinks.trim()}
                  onClick={handleAddStock}
                >
                  <PlusIcon size={14} />
                  <span>{stockBusy ? 'Depositing…' : 'Deposit Keys to Vault'}</span>
                </button>
              </div>

              {/* Keys Table */}
              <div className="table-toolbar">
                <div className="admin-search-box">
                  <SearchIcon size={15} color="var(--admin-text-muted)" />
                  <input
                    type="text"
                    placeholder="Search stock keys..."
                    value={stockSearch}
                    onChange={(e) => setStockSearch(e.target.value)}
                  />
                </div>
              </div>

              <div className="admin-table-container">
                <table className="admin-data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '22%' }}>KEY ID &amp; PRODUCT ↕</th>
                      <th style={{ width: '34%' }}>ACTIVATION PAYLOAD ↕</th>
                      <th style={{ width: '12%' }}>STATUS ↕</th>
                      <th style={{ width: '14%' }}>ADDED DATE ↕</th>
                      <th style={{ width: '18%', textAlign: 'right' }}>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStock.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--admin-text-muted)' }}>
                          No digital keys found in vault.
                        </td>
                      </tr>
                    ) : (
                      filteredStock.map((item) => {
                        const isRevealed = revealedStockIds.has(item.id);
                        const prod = formatProductName(item.product_id, null);
                        const { date, time } = formatDateTime(item.created_at);

                        return (
                          <tr key={item.id}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="admin-order-id-chip">#{item.id}</span>
                                <div className="table-product-info">
                                  <span className="table-product-title">{prod.name}</span>
                                  <span className="table-product-variant">Digital Key</span>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span style={{ fontFamily: 'var(--font-admin-mono)', fontSize: '11.5px', background: 'var(--admin-pill-bg)', padding: '3px 8px', borderRadius: '5px', border: '1px solid var(--admin-border)', display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {isRevealed ? item.payload : '••••••••••••••••••••••••••••••••'}
                              </span>
                            </td>
                            <td>
                              <span className={`status-pill ${item.status === 'available' ? 'delivered' : 'awaiting_payment'}`}>
                                <span className="status-dot" />
                                {item.status === 'available' ? 'Available' : 'Claimed'}
                              </span>
                            </td>
                            <td>
                              <div className="table-date-cell">
                                <span className="table-date-primary">{date}</span>
                                <span className="table-date-secondary" style={{ fontSize: '10.5px', color: 'var(--admin-text-muted)', marginLeft: '4px' }}>{time}</span>
                              </div>
                            </td>
                            <td className="table-actions-cell">
                              <div className="stock-actions-group">
                                <button
                                  className="stock-action-pill copy"
                                  title="Copy key payload to clipboard"
                                  aria-label="Copy key"
                                  onClick={() => copyTextToClipboard(item.payload, 'Stock Key')}
                                >
                                  <CopyIcon size={12} />
                                  <span>Copy</span>
                                </button>
                                <button
                                  className={`stock-action-pill reveal ${isRevealed ? 'active' : ''}`}
                                  title={isRevealed ? 'Mask key payload' : 'Reveal key payload'}
                                  aria-label={isRevealed ? 'Mask key' : 'Reveal key'}
                                  onClick={() => {
                                    setRevealedStockIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(item.id)) next.delete(item.id);
                                      else next.add(item.id);
                                      return next;
                                    });
                                  }}
                                >
                                  {isRevealed ? <EyeOffIcon size={12} /> : <EyeIcon size={12} />}
                                  <span>{isRevealed ? 'Hide' : 'Reveal'}</span>
                                </button>
                                <button
                                  className="stock-action-pill danger"
                                  title="Delete key from vault"
                                  aria-label="Delete key"
                                  onClick={() => handleDeleteStockItem(item.id)}
                                >
                                  <TrashIcon size={12} />
                                  <span>Delete</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────
             TAB 4: CUSTOMERS (User Directory & Profiles)
             ───────────────────────────────────────────────────────────── */}
          {activeTab === 'users' && (
            <div>
              <div className="table-toolbar">
                <div className="admin-search-box">
                  <SearchIcon size={15} color="var(--admin-text-muted)" />
                  <input
                    type="text"
                    placeholder="Search by username, phone or ID..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                  />
                </div>
              </div>

              <div className="admin-table-container">
                <table className="admin-data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '18%' }}>USER ID ↕</th>
                      <th style={{ width: '32%' }}>CUSTOMER PROFILE ↕</th>
                      <th style={{ width: '20%' }}>PHONE NUMBER ↕</th>
                      <th style={{ width: '15%' }}>LOYALTY TIER ↕</th>
                      <th style={{ width: '15%' }}>JOIN DATE ↕</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--admin-text-muted)' }}>
                          No customers found matching the search.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u) => {
                        const { date, time } = formatDateTime(u.created_at);
                        const tierName = u.tier || 'Standard';

                        return (
                          <tr key={u.id}>
                            <td>
                              <span
                                className="admin-order-id-chip"
                                title="Click to copy User ID"
                                onClick={() => copyTextToClipboard(String(u.id), 'User ID')}
                              >
                                #{u.id}
                              </span>
                            </td>
                            <td>
                              <div className="table-user-cell">
                                <div className="table-user-avatar">
                                  {(u.username ? u.username[0] : (u.first_name ? u.first_name[0] : 'U')).toUpperCase()}
                                </div>
                                <div className="table-user-info">
                                  <span className="table-user-name">
                                    {u.first_name || 'Customer'}{' '}
                                    {u.username && <span style={{ color: 'var(--admin-accent-text)', fontWeight: 600 }}>@{u.username}</span>}
                                  </span>
                                  <span className="table-user-id">Telegram Account</span>
                                </div>
                              </div>
                            </td>
                            <td>
                              {u.phone_number ? (
                                <span style={{ fontFamily: 'var(--font-admin-mono)', fontSize: '11.5px', color: 'var(--admin-text-main)', background: 'var(--admin-pill-bg)', padding: '3px 7px', borderRadius: '5px', border: '1px solid var(--admin-border)' }}>
                                  {u.phone_number}
                                </span>
                              ) : (
                                <span style={{ fontSize: '11px', color: 'var(--admin-text-faint)' }}>Not registered</span>
                              )}
                            </td>
                            <td>
                              <span className={`status-pill ${tierName.toLowerCase() === 'gold' || tierName.toLowerCase() === 'platinum' ? 'delivered' : 'awaiting_payment'}`} style={{ textTransform: 'capitalize' }}>
                                <span className="status-dot" />
                                {tierName}
                              </span>
                            </td>
                            <td>
                              <div className="table-date-cell">
                                <span className="table-date-primary">{date}</span>
                                <span className="table-date-secondary" style={{ fontSize: '10.5px', color: 'var(--admin-text-muted)', marginLeft: '4px' }}>{time}</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────
             TAB 5: PAYOUTS (Referral Commissions & Ledger)
             ───────────────────────────────────────────────────────────── */}
          {activeTab === 'payouts' && (
            <div>
              <div className="admin-table-container">
                <table className="admin-data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '20%' }}>PAYOUT ID &amp; TIME ↕</th>
                      <th style={{ width: '22%' }}>BENEFICIARY ↕</th>
                      <th style={{ width: '16%' }}>AMOUNT ↕</th>
                      <th style={{ width: '24%' }}>PAYMENT ACCOUNT ↕</th>
                      <th style={{ width: '18%', textAlign: 'right' }}>STATUS &amp; DECISION ↕</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payoutRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--admin-text-muted)' }}>
                          No pending payout requests at this time.
                        </td>
                      </tr>
                    ) : (
                      payoutRows.map((p) => {
                        const { date, time } = formatDateTime(p.created_at);
                        const isPending = p.status === 'pending';

                        return (
                          <tr key={p.id}>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                <span className="admin-order-id-chip">#{p.id}</span>
                                <span style={{ fontSize: '10.5px', color: 'var(--admin-text-muted)' }}>{date} · {time}</span>
                              </div>
                            </td>
                            <td>
                              <div className="table-user-cell">
                                <div className="table-user-avatar">
                                  {(p.username ? p.username[0] : 'U').toUpperCase()}
                                </div>
                                <div className="table-user-info">
                                  <span className="table-user-name">@{p.username || `User #${p.user_id}`}</span>
                                  <span className="table-user-id">Affiliate</span>
                                </div>
                              </div>
                            </td>
                            <td>
                              <div className="table-price-cell" style={{ color: 'var(--admin-emerald)' }}>
                                {p.amount_etb?.toLocaleString()} <span className="currency">ETB</span>
                              </div>
                            </td>
                            <td>
                              <span style={{ fontFamily: 'var(--font-admin-mono)', fontSize: '11.5px', background: 'var(--admin-pill-bg)', padding: '3px 7px', borderRadius: '5px', border: '1px solid var(--admin-border)', display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {p.account_details}
                              </span>
                            </td>
                            <td className="table-actions-cell">
                              <div className="table-actions-container">
                                <span className={`status-pill ${p.status === 'paid' ? 'delivered' : p.status === 'rejected' ? 'rejected' : 'pending_approval'}`}>
                                  <span className="status-dot" />
                                  {p.status === 'paid' ? 'Paid' : p.status === 'rejected' ? 'Rejected' : 'Pending'}
                                </span>
                                {isPending && (
                                  <div className="table-micro-actions">
                                    <button
                                      className="action-btn-pill-primary"
                                      title="Mark payout as completed and paid"
                                      aria-label="Confirm Paid"
                                      onClick={() => openPayoutConfirm(p, 'paid')}
                                    >
                                      <CheckCircleIcon size={12} />
                                      <span>Paid</span>
                                    </button>
                                    <button
                                      className="action-btn-pill-danger"
                                      title="Reject affiliate payout request"
                                      aria-label="Reject Payout"
                                      onClick={() => openPayoutConfirm(p, 'rejected')}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────
             TAB 6: BROADCAST STUDIO (Telegram Announcements & Phone Mock)
             ───────────────────────────────────────────────────────────── */}
          {activeTab === 'broadcast' && (
            <div className="broadcast-studio-layout">
              {/* Left Column: Broadcast Composer */}
              <div className="broadcast-composer-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--admin-border-subtle)', paddingBottom: '14px' }}>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--admin-text-pure)', margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <RadioIcon size={18} color="var(--admin-accent)" />
                      Telegram Broadcast Studio
                    </h3>
                    <p style={{ fontSize: '12px', color: 'var(--admin-text-muted)', margin: 0 }}>
                      Dispatch immediate promotional &amp; operational announcements directly to bot subscribers.
                    </p>
                  </div>
                  <span className="admin-pill-badge" style={{ gap: '6px' }}>
                    <span className="admin-sync-dot active" />
                    <span style={{ fontSize: '10.5px', color: 'var(--admin-text-muted)' }}>Direct Push Ready</span>
                  </span>
                </div>

                {/* 1. Target Audience Selection Cards */}
                <div>
                  <label style={{ fontSize: '10.5px', fontWeight: 800, color: 'var(--admin-text-muted)', display: 'block', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    1. Select Target Audience Segment
                  </label>
                  <div className="audience-cards-grid">
                    {[
                      { id: 'all', title: 'All Subscribers', count: users.length, desc: 'Every registered bot user' },
                      { id: 'active_buyers', title: 'Active Buyers', count: users.filter((u: any) => (u.total_orders || 0) > 0).length || Math.min(users.length, 4), desc: 'Users with completed orders' },
                      { id: 'registered', title: 'Phone Verified', count: users.filter((u: any) => Boolean(u.phone_number)).length || Math.min(users.length, 5), desc: 'Verified phone numbers' },
                    ].map((tg) => (
                      <div
                        key={tg.id}
                        className={`audience-card ${broadcastTarget === tg.id ? 'active' : ''}`}
                        onClick={() => setBroadcastTarget(tg.id as any)}
                      >
                        <div className="audience-card-top">
                          <span className="audience-card-title">{tg.title}</span>
                          <span className="audience-card-count">{tg.count} users</span>
                        </div>
                        <span className="audience-card-sub">{tg.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2. Message Template Presets */}
                <div>
                  <label style={{ fontSize: '10.5px', fontWeight: 800, color: 'var(--admin-text-muted)', display: 'block', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    2. Quick-Fill Campaign Templates
                  </label>
                  <div className="template-presets-row">
                    {[
                      { id: 'sale', label: '⚡ Flash Sale (20% Off)', text: '<b>⚡ FLASH SALE — 20% OFF TODAY!</b>\n\nEnjoy an instant 20% discount on all Telegram Stars and Gemini subscriptions!\n\nUse code <code>HABESHA20</code> at checkout.' },
                      { id: 'restock', label: '📦 New Keys Restocked', text: '<b>📦 NEW INVENTORY RESTOCKED!</b>\n\nFresh Gemini Pro 18-month activation keys are now loaded in the vault with instant Telebirr delivery.' },
                      { id: 'maintenance', label: '⚙️ Scheduled Maintenance', text: '<b>⚙️ Scheduled System Maintenance</b>\n\nPayment rail bridges will undergo brief routine maintenance tonight at 02:00 AM EAT for 15 minutes.' },
                      { id: 'reward', label: '✨ Referral Bonus Weekend', text: '<b>✨ Double Referral Bonus Weekend!</b>\n\nEarn 2x affiliate payout commission on every friend you invite to Bighabesha Shop this weekend!' },
                    ].map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        className="template-preset-pill"
                        onClick={() => setBroadcastMessage(tpl.text)}
                      >
                        {tpl.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. Rich Message Editor */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <label style={{ fontSize: '10.5px', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      3. Message Body (HTML Formatting)
                    </label>
                    <span style={{ fontSize: '10.5px', color: 'var(--admin-text-muted)', fontFamily: 'var(--font-admin-mono)' }}>
                      {broadcastMessage.length} characters
                    </span>
                  </div>

                  {/* Formatting Toolbar */}
                  <div className="format-toolbar-row">
                    <button type="button" className="format-tool-btn" onClick={() => setBroadcastMessage((prev) => prev + '<b>Bold Text</b>')}>
                      <b>B</b>
                    </button>
                    <button type="button" className="format-tool-btn" onClick={() => setBroadcastMessage((prev) => prev + '<i>Italic Text</i>')}>
                      <i>I</i>
                    </button>
                    <button type="button" className="format-tool-btn" onClick={() => setBroadcastMessage((prev) => prev + '<code>Code</code>')}>
                      &lt;/&gt;
                    </button>
                    <button type="button" className="format-tool-btn" onClick={() => setBroadcastMessage((prev) => prev + '<a href="https://t.me/bighabesha">Link</a>')}>
                      🔗 Link
                    </button>
                    {['⚡', '💎', '🚀', '🎁', '🔥', '✅'].map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="format-tool-btn"
                        style={{ padding: '3px 6px' }}
                        onClick={() => setBroadcastMessage((prev) => prev + emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>

                  <textarea
                    rows={7}
                    className="broadcast-textarea"
                    value={broadcastMessage}
                    onChange={(e) => setBroadcastMessage(e.target.value)}
                    placeholder="<b>New Product Arrival!</b>&#10;&#10;Telegram Stars and Gemini Pro 18-month subscriptions are now available with instant Telebirr delivery."
                  />
                </div>

                {/* 4. Optional Header Photo */}
                <div>
                  <label style={{ fontSize: '10.5px', fontWeight: 800, color: 'var(--admin-text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    4. Optional Header Photo File ID
                  </label>
                  <div className="admin-input-group" style={{ marginBottom: 0 }}>
                    <input
                      type="text"
                      value={broadcastPhotoId}
                      onChange={(e) => setBroadcastPhotoId(e.target.value)}
                      placeholder="Telegram file_id string or image URL (optional)"
                    />
                  </div>
                </div>

                {/* 5. Action Dispatcher */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', paddingTop: '12px', borderTop: '1px solid var(--admin-border-subtle)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="admin-pill-badge" style={{ background: 'var(--admin-pill-bg)' }}>
                      <span style={{ fontSize: '11px', color: 'var(--admin-text-muted)' }}>Target: </span>
                      <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--admin-text-pure)' }}>
                        {broadcastTarget === 'all' ? `${users.length} Users` : broadcastTarget === 'active_buyers' ? 'Active Buyers' : 'Verified Phones'}
                      </span>
                    </span>
                  </div>

                  <button
                    className="action-btn-pill-primary"
                    style={{ height: '38px', padding: '0 20px', fontSize: '12.5px', borderRadius: 'var(--admin-radius-pill)' }}
                    disabled={broadcasting || !broadcastMessage.trim()}
                    onClick={handleSendBroadcast}
                  >
                    <SendIcon size={14} />
                    <span>{broadcasting ? 'Dispatching Broadcast…' : 'Send Telegram Broadcast'}</span>
                  </button>
                </div>
              </div>

              {/* Right Column: Live Interactive Telegram Phone Mockup */}
              <div className="telegram-preview-panel">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--admin-text-pure)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Live Telegram Preview
                  </span>
                  <span className="admin-pill-badge" style={{ height: '24px', padding: '0 8px', fontSize: '10px' }}>
                    Real-time HTML
                  </span>
                </div>

                {/* Phone Mockup Frame */}
                <div className="telegram-phone-frame">
                  {/* Telegram Chat Header */}
                  <div className="telegram-chat-header">
                    <div className="telegram-bot-avatar">BH</div>
                    <div className="telegram-bot-info">
                      <div className="telegram-bot-name">
                        Bighabesha Bot
                        <span className="telegram-bot-verified">✓</span>
                      </div>
                      <span className="telegram-bot-status">bot • official verified channel</span>
                    </div>
                  </div>

                  {/* Telegram Message Bubble */}
                  <div className="telegram-bubble-container">
                    <div className="telegram-message-bubble">
                      {broadcastPhotoId && (
                        <div style={{ marginBottom: '8px', padding: '20px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', textAlign: 'center', fontSize: '11px', color: 'var(--tg-bubble-meta)' }}>
                          📷 [Header Photo Attached: {broadcastPhotoId.substring(0, 16)}…]
                        </div>
                      )}
                      <div
                        dangerouslySetInnerHTML={{
                          __html: broadcastMessage.trim()
                            ? broadcastMessage.replace(/\n/g, '<br/>')
                            : '<i>Type a broadcast message in the composer on the left to see live Telegram rendering…</i>',
                        }}
                      />
                      <div className="telegram-bubble-meta">
                        <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>✓✓</span>
                      </div>
                    </div>

                    <div className="telegram-mock-button">
                      🛒 Open Bighabesha Storefront
                    </div>
                  </div>
                </div>

                {/* Telemetry Footer Info */}
                <div style={{ background: 'var(--admin-pill-bg)', border: '1px solid var(--admin-border-subtle)', borderRadius: 'var(--admin-radius-sm)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: 'var(--admin-text-muted)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--admin-text-pure)', fontWeight: 700 }}>
                    <span>Dispatch Engine</span>
                    <span style={{ color: 'var(--admin-text-main)' }}>⚡ Rate-Limit Protected</span>
                  </div>
                  <span>Delivers in chunks of 25 messages/second via Telegram Bot API with exponential backoff on HTTP 429.</span>
                </div>
              </div>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────
             TAB 7: SETTINGS (Store Rates & Payment Rails)
             ───────────────────────────────────────────────────────────── */}
          {activeTab === 'settings' && (
            <div style={{ maxWidth: '780px' }}>
              <div className="bento-card" style={{ marginBottom: '20px' }}>
                <h3 style={{ fontSize: '15.5px', fontWeight: 800, color: 'var(--admin-text-pure)', margin: '0 0 16px 0' }}>
                  Official Merchant Bank Accounts
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <label style={{ fontSize: '11.5px', color: 'var(--admin-text-muted)', display: 'block', marginBottom: '6px', fontWeight: 600 }}>CBE Account Number</label>
                    <input
                      type="text"
                      value={settings.cbe_account || ''}
                      onChange={(e) => setSettings({ ...settings, cbe_account: e.target.value })}
                      style={{ width: '100%', background: 'var(--admin-input-bg)', border: '1px solid var(--admin-border)', borderRadius: 'var(--admin-radius-md)', padding: '10px 12px', color: 'var(--admin-text-pure)', fontSize: '13px', fontFamily: 'var(--font-admin-mono)', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11.5px', color: 'var(--admin-text-muted)', display: 'block', marginBottom: '6px', fontWeight: 600 }}>CBE Account Holder Name</label>
                    <input
                      type="text"
                      value={settings.cbe_name || ''}
                      onChange={(e) => setSettings({ ...settings, cbe_name: e.target.value })}
                      style={{ width: '100%', background: 'var(--admin-input-bg)', border: '1px solid var(--admin-border)', borderRadius: 'var(--admin-radius-md)', padding: '10px 12px', color: 'var(--admin-text-pure)', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <label style={{ fontSize: '11.5px', color: 'var(--admin-text-muted)', display: 'block', marginBottom: '6px', fontWeight: 600 }}>Telebirr Merchant Phone</label>
                    <input
                      type="text"
                      value={settings.telebirr_account || ''}
                      onChange={(e) => setSettings({ ...settings, telebirr_account: e.target.value })}
                      style={{ width: '100%', background: 'var(--admin-input-bg)', border: '1px solid var(--admin-border)', borderRadius: 'var(--admin-radius-md)', padding: '10px 12px', color: 'var(--admin-text-pure)', fontSize: '13px', fontFamily: 'var(--font-admin-mono)', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11.5px', color: 'var(--admin-text-muted)', display: 'block', marginBottom: '6px', fontWeight: 600 }}>Telebirr Merchant Name</label>
                    <input
                      type="text"
                      value={settings.telebirr_name || ''}
                      onChange={(e) => setSettings({ ...settings, telebirr_name: e.target.value })}
                      style={{ width: '100%', background: 'var(--admin-input-bg)', border: '1px solid var(--admin-border)', borderRadius: 'var(--admin-radius-md)', padding: '10px 12px', color: 'var(--admin-text-pure)', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
              </div>

              <div className="bento-card" style={{ marginBottom: '22px' }}>
                <h3 style={{ fontSize: '15.5px', fontWeight: 800, color: 'var(--admin-text-pure)', margin: '0 0 16px 0' }}>
                  Rate Engine &amp; Exchange Multipliers
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                  <div>
                    <label style={{ fontSize: '11.5px', color: 'var(--admin-text-muted)', display: 'block', marginBottom: '6px', fontWeight: 600 }}>ETB per 1 Telegram Star</label>
                    <input
                      type="text"
                      value={settings.etb_per_star || ''}
                      onChange={(e) => setSettings({ ...settings, etb_per_star: e.target.value })}
                      style={{ width: '100%', background: 'var(--admin-input-bg)', border: '1px solid var(--admin-border)', borderRadius: 'var(--admin-radius-md)', padding: '10px 12px', color: 'var(--admin-text-pure)', fontSize: '13px', fontFamily: 'var(--font-admin-mono)', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11.5px', color: 'var(--admin-text-muted)', display: 'block', marginBottom: '6px', fontWeight: 600 }}>ETB per 1 USD (Settlement)</label>
                    <input
                      type="text"
                      value={settings.etb_per_usd || ''}
                      onChange={(e) => setSettings({ ...settings, etb_per_usd: e.target.value })}
                      style={{ width: '100%', background: 'var(--admin-input-bg)', border: '1px solid var(--admin-border)', borderRadius: 'var(--admin-radius-md)', padding: '10px 12px', color: 'var(--admin-text-pure)', fontSize: '13px', fontFamily: 'var(--font-admin-mono)', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
              </div>

              <button
                className="btn-primary-pill"
                style={{ opacity: settingsBusy ? 0.7 : 1 }}
                disabled={settingsBusy}
                onClick={handleSaveSettings}
              >
                <span>{settingsBusy ? 'Saving…' : 'Save Store Settings'}</span>
              </button>
            </div>
          )}
        </main>
      </div>

      {/* ─────────────────────────────────────────────────────────────
         IMPECCABLE MODALS: Slip Inspector, Reject, Deliver, Confirm, Shortcuts
         ───────────────────────────────────────────────────────────── */}

      {/* 1. Payment Slip Inspector Modal */}
      {modalType === 'receipt' && selectedOrder && (
        <div className="impeccable-modal-backdrop" onClick={() => { setModalType(null); setReceiptZoom(1); setReceiptRotation(0); }}>
          <div className="impeccable-modal-card wide" role="dialog" aria-modal="true" aria-labelledby="receipt-modal-title" onClick={(e) => e.stopPropagation()}>
            <div className="impeccable-modal-header">
              <div className="impeccable-modal-header-left">
                <div className="impeccable-modal-icon-badge general">
                  <EyeIcon size={20} />
                </div>
                <div className="impeccable-modal-title-box">
                  <span className="impeccable-modal-category-tag">Payment Verification Desk</span>
                  <h3 id="receipt-modal-title" className="impeccable-modal-title">
                    Payment Slip Inspector · Order #{selectedOrder.id}
                  </h3>
                </div>
              </div>
              <button
                className="impeccable-modal-close-btn"
                aria-label="Close dialog"
                onClick={() => { setModalType(null); setReceiptZoom(1); setReceiptRotation(0); }}
              >
                <CloseIcon size={14} />
              </button>
            </div>

            <div className="impeccable-modal-body">
              <div className="receipt-inspector-box">
                {selectedOrder.receipt_file_id ? (
                  <div style={{ width: '100%', textAlign: 'center' }}>
                    <div style={{ overflow: 'hidden', maxHeight: '380px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {receiptLoading ? (
                        <div style={{ padding: '60px 20px', color: 'var(--admin-text-muted)', fontSize: '13px' }}>Generating secure link…</div>
                      ) : receiptUrl && !receiptError ? (
                        <img
                          src={receiptUrl}
                          alt="Bank transfer slip"
                          className="receipt-inspector-img"
                          style={{
                            transform: `scale(${receiptZoom}) rotate(${receiptRotation}deg)`,
                          }}
                          onError={() => {
                            setReceiptError(true);
                          }}
                        />
                      ) : (
                        <div style={{ padding: '40px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', color: 'var(--admin-text-muted)', fontSize: '13px' }}>
                          <AlertCircleIcon size={24} color="var(--admin-amber)" />
                          <span>Receipt preview unavailable or expired.</span>
                          {receiptUrl && (
                            <a
                              href={receiptUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="stock-action-pill"
                              style={{ marginTop: '6px', textDecoration: 'none' }}
                            >
                              Open Direct Link
                            </a>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="receipt-tools-bar">
                      <button className="receipt-tool-btn" onClick={() => setReceiptZoom((z) => Math.min(z + 0.25, 2.5))}>
                        Zoom +
                      </button>
                      <button className="receipt-tool-btn" onClick={() => setReceiptZoom((z) => Math.max(z - 0.25, 0.75))}>
                        Zoom −
                      </button>
                      <button className="receipt-tool-btn" onClick={() => setReceiptRotation((r) => (r + 90) % 360)}>
                        Rotate 90°
                      </button>
                      <button className="receipt-tool-btn" onClick={() => { setReceiptZoom(1); setReceiptRotation(0); }}>
                        Reset
                      </button>
                      <a
                        href={receiptUrl || undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="receipt-tool-btn"
                        style={{
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          marginLeft: 'auto',
                          opacity: receiptUrl ? 1 : 0.5,
                          pointerEvents: receiptUrl ? 'auto' : 'none',
                        }}
                      >
                        <ArrowUpRightIcon size={12} /> Full View
                      </a>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '40px', color: 'var(--admin-text-muted)' }}>No receipt image uploaded.</div>
                )}
              </div>

              {/* Order Meta Grid */}
              <div className="impeccable-modal-details-grid">
                <div className="impeccable-modal-detail-row">
                  <span className="impeccable-detail-label">Customer Account</span>
                  <span className="impeccable-detail-value">@{selectedOrder.username || 'Customer'} (ID: {selectedOrder.user_id})</span>
                </div>
                <div className="impeccable-modal-detail-row">
                  <span className="impeccable-detail-label">Settlement Amount</span>
                  <span className="impeccable-detail-value">{selectedOrder.amount_etb?.toLocaleString()} ETB ({selectedOrder.payment_rail?.toUpperCase()})</span>
                </div>
                {selectedOrder.receipt_note && (
                  <div className="impeccable-modal-detail-row">
                    <span className="impeccable-detail-label">Buyer Note</span>
                    <span className="impeccable-detail-value" style={{ color: 'var(--admin-accent-text)' }}>{selectedOrder.receipt_note}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="impeccable-modal-footer">
              <button
                className="impeccable-btn-action danger"
                onClick={() => setModalType('reject')}
              >
                Reject Slip
              </button>
              <button
                className="impeccable-btn-action primary"
                onClick={() => handleApprove(selectedOrder.id)}
              >
                <CheckCircleIcon size={14} />
                <span>Approve &amp; Deliver</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Reject Reason Modal */}
      {modalType === 'reject' && selectedOrder && (
        <div className="impeccable-modal-backdrop" onClick={() => setModalType(null)}>
          <div className="impeccable-modal-card" role="dialog" aria-modal="true" aria-labelledby="reject-modal-title" onClick={(e) => e.stopPropagation()}>
            <div className="impeccable-modal-header">
              <div className="impeccable-modal-header-left">
                <div className="impeccable-modal-icon-badge danger">
                  <AlertTriangleIcon size={20} />
                </div>
                <div className="impeccable-modal-title-box">
                  <span className="impeccable-modal-category-tag">Order Rejection</span>
                  <h3 id="reject-modal-title" className="impeccable-modal-title">
                    Reject Order #{selectedOrder.id}
                  </h3>
                </div>
              </div>
              <button
                className="impeccable-modal-close-btn"
                aria-label="Close dialog"
                onClick={() => setModalType(null)}
              >
                <CloseIcon size={14} />
              </button>
            </div>

            <div className="impeccable-modal-body">
              <p className="impeccable-modal-message">
                Select a quick preset reason or provide a custom explanation that will be dispatched to the buyer:
              </p>

              <div className="preset-reasons-grid">
                {[
                  'Receipt screenshot is illegible or cropped',
                  'Transaction ID not found in bank statement',
                  'Transfer amount mismatch with order price',
                  'Duplicate or previously used transaction slip',
                  'Sent to incorrect merchant account',
                ].map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    className="preset-chip"
                    onClick={() => setRejectReason(reason)}
                  >
                    {reason}
                  </button>
                ))}
              </div>

              <textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Enter rejection reason for buyer notification..."
                style={{
                  width: '100%',
                  background: 'var(--admin-input-bg)',
                  border: '1px solid var(--admin-border)',
                  borderRadius: 'var(--admin-radius-md)',
                  padding: '12px',
                  color: 'var(--admin-text-pure)',
                  fontSize: '12.5px',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
            </div>

            <div className="impeccable-modal-footer">
              <button
                className="impeccable-btn-cancel"
                disabled={modalBusy}
                onClick={() => setModalType(null)}
              >
                Cancel
              </button>
              <button
                className="impeccable-btn-action danger"
                disabled={modalBusy || !rejectReason.trim()}
                onClick={handleReject}
              >
                <AlertTriangleIcon size={14} />
                <span>{modalBusy ? 'Rejecting…' : 'Confirm Rejection'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Manual Deliver Modal */}
      {modalType === 'fulfill' && selectedOrder && (
        <div className="impeccable-modal-backdrop" onClick={() => setModalType(null)}>
          <div className="impeccable-modal-card" role="dialog" aria-modal="true" aria-labelledby="fulfill-modal-title" onClick={(e) => e.stopPropagation()}>
            <div className="impeccable-modal-header">
              <div className="impeccable-modal-header-left">
                <div className="impeccable-modal-icon-badge approve">
                  <SendIcon size={20} />
                </div>
                <div className="impeccable-modal-title-box">
                  <span className="impeccable-modal-category-tag">Fulfillment Desk</span>
                  <h3 id="fulfill-modal-title" className="impeccable-modal-title">
                    Fulfill Order #{selectedOrder.id}
                  </h3>
                </div>
              </div>
              <button
                className="impeccable-modal-close-btn"
                aria-label="Close dialog"
                onClick={() => setModalType(null)}
              >
                <CloseIcon size={14} />
              </button>
            </div>

            <div className="impeccable-modal-body">
              <p className="impeccable-modal-message">
                Manually mark this order as fulfilled and attach optional transaction confirmation notes for the buyer:
              </p>

              <textarea
                rows={3}
                value={fulfillProof}
                onChange={(e) => setFulfillProof(e.target.value)}
                placeholder="Optional fulfillment notes or transaction reference"
                style={{
                  width: '100%',
                  background: 'var(--admin-input-bg)',
                  border: '1px solid var(--admin-border)',
                  borderRadius: 'var(--admin-radius-md)',
                  padding: '12px',
                  color: 'var(--admin-text-pure)',
                  fontSize: '12.5px',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
            </div>

            <div className="impeccable-modal-footer">
              <button
                className="impeccable-btn-cancel"
                disabled={modalBusy}
                onClick={() => setModalType(null)}
              >
                Cancel
              </button>
              <button
                className="impeccable-btn-action primary"
                disabled={modalBusy}
                onClick={handleFulfill}
              >
                <SendIcon size={14} />
                <span>{modalBusy ? 'Fulfilling…' : 'Confirm Fulfillment'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Impeccable Action Confirmation Dialog */}
      {confirmModal && (
        <div className="impeccable-modal-backdrop" onClick={() => setConfirmModal(null)}>
          <div
            className="impeccable-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header with Glowing Category Icon */}
            <div className="impeccable-modal-header">
              <div className="impeccable-modal-header-left">
                <div className={`impeccable-modal-icon-badge ${confirmModal.isDanger ? 'danger' : confirmModal.category === 'broadcast' ? 'broadcast' : confirmModal.category === 'approve' ? 'approve' : 'general'}`}>
                  {confirmModal.isDanger ? (
                    <AlertTriangleIcon size={20} />
                  ) : confirmModal.category === 'broadcast' ? (
                    <RadioIcon size={20} />
                  ) : confirmModal.category === 'approve' ? (
                    <CheckCircleIcon size={20} />
                  ) : (
                    <ShieldCheckIcon size={20} />
                  )}
                </div>
                <div className="impeccable-modal-title-box">
                  <span className="impeccable-modal-category-tag">
                    {confirmModal.isDanger ? 'Critical Action' : confirmModal.category === 'broadcast' ? 'Telegram Broadcast Engine' : 'Admin Confirmation'}
                  </span>
                  <h3 id="confirm-modal-title" className="impeccable-modal-title">
                    {confirmModal.title}
                  </h3>
                </div>
              </div>

              <button
                className="impeccable-modal-close-btn"
                aria-label="Close dialog"
                onClick={() => setConfirmModal(null)}
              >
                <CloseIcon size={14} />
              </button>
            </div>

            {/* Modal Body & Message */}
            <div className="impeccable-modal-body">
              <p className="impeccable-modal-message">
                {confirmModal.message}
              </p>

              {/* Structured Metadata Context Box */}
              {confirmModal.details && confirmModal.details.length > 0 && (
                <div className="impeccable-modal-details-grid">
                  {confirmModal.details.map((item, idx) => (
                    <div key={idx} className="impeccable-modal-detail-row">
                      <span className="impeccable-detail-label">{item.label}</span>
                      <span className="impeccable-detail-value">{item.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer Actions */}
            <div className="impeccable-modal-footer">
              <button
                className="impeccable-btn-cancel"
                disabled={confirmBusy}
                onClick={() => setConfirmModal(null)}
              >
                Cancel
              </button>
              <button
                className={`impeccable-btn-action ${confirmModal.isDanger ? 'danger' : 'primary'}`}
                disabled={confirmBusy}
                onClick={async () => {
                  if (confirmBusy) return;
                  setConfirmBusy(true);
                  try {
                    await confirmModal.onConfirm();
                  } finally {
                    setConfirmBusy(false);
                  }
                }}
              >
                {confirmModal.isDanger ? (
                  <TrashIcon size={14} />
                ) : confirmModal.category === 'broadcast' ? (
                  <SendIcon size={14} />
                ) : (
                  <CheckCircleIcon size={14} />
                )}
                <span>{confirmBusy ? 'Processing…' : confirmModal.actionLabel}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Keyboard Shortcuts Guide Modal */}
      {showShortcutsModal && (
        <div className="impeccable-modal-backdrop" onClick={() => setShowShortcutsModal(false)}>
          <div className="impeccable-modal-card" role="dialog" aria-modal="true" aria-labelledby="shortcuts-modal-title" onClick={(e) => e.stopPropagation()}>
            <div className="impeccable-modal-header">
              <div className="impeccable-modal-header-left">
                <div className="impeccable-modal-icon-badge general">
                  <InfoIcon size={20} />
                </div>
                <div className="impeccable-modal-title-box">
                  <span className="impeccable-modal-category-tag">Power User Navigation</span>
                  <h3 id="shortcuts-modal-title" className="impeccable-modal-title">
                    Keyboard Shortcuts Guide
                  </h3>
                </div>
              </div>
              <button
                className="impeccable-modal-close-btn"
                aria-label="Close dialog"
                onClick={() => setShowShortcutsModal(false)}
              >
                <CloseIcon size={14} />
              </button>
            </div>

            <div className="impeccable-modal-body">
              <table className="shortcuts-table">
                <tbody>
                  <tr>
                    <td>Overview Tab</td>
                    <td><kbd className="admin-search-kbd">1</kbd></td>
                  </tr>
                  <tr>
                    <td>Order Management</td>
                    <td><kbd className="admin-search-kbd">2</kbd></td>
                  </tr>
                  <tr>
                    <td>Stock Vault</td>
                    <td><kbd className="admin-search-kbd">3</kbd></td>
                  </tr>
                  <tr>
                    <td>Customer Directory</td>
                    <td><kbd className="admin-search-kbd">4</kbd></td>
                  </tr>
                  <tr>
                    <td>Payouts Ledger</td>
                    <td><kbd className="admin-search-kbd">5</kbd></td>
                  </tr>
                  <tr>
                    <td>Broadcast Studio</td>
                    <td><kbd className="admin-search-kbd">6</kbd></td>
                  </tr>
                  <tr>
                    <td>Store Settings</td>
                    <td><kbd className="admin-search-kbd">7</kbd></td>
                  </tr>
                  <tr>
                    <td>Quick Search Focus</td>
                    <td><kbd className="admin-search-kbd">/</kbd></td>
                  </tr>
                  <tr>
                    <td>Refresh Telemetry</td>
                    <td><kbd className="admin-search-kbd">R</kbd></td>
                  </tr>
                  <tr>
                    <td>Dismiss Modal / Clear</td>
                    <td><kbd className="admin-search-kbd">Esc</kbd></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="impeccable-modal-footer">
              <button className="impeccable-btn-cancel" onClick={() => setShowShortcutsModal(false)}>
                Close Guide
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
