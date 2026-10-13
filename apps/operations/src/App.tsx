import React, { useEffect, useState, useCallback } from 'react';
import {
  StaffUserResponse,
  OrderSummary,
  OrderStatus,
  FulfillmentChannel,
  UserRole,
  MenuCategory,
} from '@aurel/shared-types';

export default function App(): React.JSX.Element {
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';

  // Auth State
  const [currentUser, setCurrentUser] = useState<StaffUserResponse | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [loginEmail, setLoginEmail] = useState<string>('staff@aurel.restaurant');
  const [loginPassword, setLoginPassword] = useState<string>('OperationsPassword2026!');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  // Operations Navigation
  const [activeTab, setActiveTab] = useState<'orders' | 'menu'>('orders');

  // Orders State
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [channelFilter, setChannelFilter] = useState<'ALL' | FulfillmentChannel>('ALL');
  const [refreshInterval, setRefreshInterval] = useState<number>(3000); // 3s polling
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [ordersLoading, setOrdersLoading] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Menu 86 Management State
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuLoading, setMenuLoading] = useState<boolean>(false);

  // Check existing session on load
  const checkSession = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/auth/me`, { credentials: 'include' });
      if (res.ok) {
        const user = await res.json();
        if (user.role !== UserRole.CUSTOMER) {
          setCurrentUser(user);
        }
      }
    } catch {
      // not logged in
    } finally {
      setAuthLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // Fetch Operations Order Queue
  const fetchOrders = useCallback(async () => {
    if (!currentUser) return;
    try {
      setOrdersLoading(true);
      const res = await fetch(`${apiBase}/orders/operations/queue?limit=100`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data: OrderSummary[] = await res.json();
        setOrders(data);
        setLastRefreshed(new Date());
        setActionError(null);
      } else if (res.status === 401) {
        setCurrentUser(null);
      }
    } catch (err: any) {
      console.error('Failed to poll operations queue:', err);
    } finally {
      setOrdersLoading(false);
    }
  }, [currentUser, apiBase]);

  // Fetch Menu for 86 Management
  const fetchMenu = useCallback(async () => {
    if (!currentUser) return;
    try {
      setMenuLoading(true);
      const res = await fetch(`${apiBase}/menu?all=true`, { credentials: 'include' });
      if (res.ok) {
        const data: MenuCategory[] = await res.json();
        setCategories(data);
      }
    } catch (err: any) {
      console.error('Failed to fetch menu:', err);
    } finally {
      setMenuLoading(false);
    }
  }, [currentUser, apiBase]);

  // Polling Effect
  useEffect(() => {
    if (!currentUser) return;
    fetchOrders();

    if (refreshInterval > 0) {
      const interval = setInterval(fetchOrders, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [currentUser, fetchOrders, refreshInterval]);

  // Handle Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const res = await fetch(`${apiBase}/auth/operations-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: loginEmail.trim().toLowerCase(),
          password: loginPassword,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.message || `Login failed (HTTP ${res.status})`);
      }

      const user: StaffUserResponse = await res.json();
      setCurrentUser(user);
      fetchOrders();
    } catch (err: any) {
      setLoginError(err.message || 'Authentication failed');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    try {
      await fetch(`${apiBase}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // ignore
    } finally {
      setCurrentUser(null);
      setOrders([]);
    }
  };

  // Mutate Order Status
  const handleUpdateStatus = async (orderId: string, targetStatus: OrderStatus) => {
    setActionError(null);
    try {
      const res = await fetch(`${apiBase}/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: targetStatus }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          errorData.detail || errorData.message || `Action failed (HTTP ${res.status})`,
        );
      }

      // Optimistic refresh
      await fetchOrders();
    } catch (err: any) {
      setActionError(err.message || 'Failed to update order status');
    }
  };

  // Toggle Item Availability
  const handleToggleAvailability = async (itemId: string, currentAvailable: boolean) => {
    try {
      const res = await fetch(`${apiBase}/menu/items/${itemId}/availability`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isAvailable: !currentAvailable }),
      });

      if (res.ok) {
        fetchMenu();
      }
    } catch (err) {
      console.error('Failed to toggle availability:', err);
    }
  };

  // Filter Orders by Channel
  const filteredOrders = orders.filter((o) => {
    if (channelFilter === 'ALL') return true;
    return o.fulfillmentChannel === channelFilter;
  });

  // Buckets for Kanban Board
  const incomingOrders = filteredOrders.filter(
    (o) => o.status === OrderStatus.PLACED || o.status === OrderStatus.ACCEPTED,
  );
  const kitchenOrders = filteredOrders.filter((o) => o.status === OrderStatus.PREPARING);
  const readyOrders = filteredOrders.filter(
    (o) => o.status === OrderStatus.READY || o.status === OrderStatus.DISPATCHED,
  );
  const completedOrders = filteredOrders.filter(
    (o) =>
      o.status === OrderStatus.SERVED ||
      o.status === OrderStatus.DELIVERED ||
      o.status === OrderStatus.COLLECTED ||
      o.status === OrderStatus.CANCELLED ||
      o.status === OrderStatus.REJECTED,
  );

  // If loading session
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0B0F19] text-[#F8FAFC] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-ops-accent border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // Login Screen
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#090D16] text-[#F8FAFC] flex flex-col justify-center items-center p-6 font-sans">
        <div className="max-w-md w-full bg-[#111827] border border-[#1E293B] rounded-2xl p-8 shadow-2xl">
          {/* Brand */}
          <div className="text-center mb-6">
            <div className="w-12 h-12 bg-ops-accent/10 border border-ops-accent/30 rounded-xl flex items-center justify-center mx-auto mb-3">
              <span className="text-ops-accent font-bold text-xl font-mono">AO</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Aurel Operations</h1>
            <p className="text-xs text-ops-muted mt-1 uppercase tracking-widest">
              Kitchen Display & Floor Terminal
            </p>
          </div>

          {loginError && (
            <div className="mb-4 p-3 bg-rose-950/50 border border-rose-800 rounded-lg text-xs text-rose-300">
              {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-ops-muted mb-1">
                Employee Email
              </label>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="staff@aurel.restaurant"
                className="w-full bg-[#0F172A] border border-[#334155] rounded-xl px-4 py-2.5 text-xs text-white focus:border-ops-accent outline-none font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-ops-muted mb-1">Password</label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full bg-[#0F172A] border border-[#334155] rounded-xl px-4 py-2.5 text-xs text-white focus:border-ops-accent outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3 rounded-xl bg-ops-accent text-[#090D16] font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all disabled:opacity-50 mt-2 shadow-lg shadow-ops-accent/10"
            >
              {isLoggingIn ? 'Authenticating...' : 'Sign In to Operations'}
            </button>
          </form>

          {/* Quick Demo Credentials Autofill - Strictly isolated to local dev */}
          {import.meta.env.DEV && import.meta.env.VITE_ENABLE_LOCAL_DEMO !== 'false' && (
            <div className="mt-8 pt-6 border-t border-[#1E293B]">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ops-muted">
                  Local Demo Profiles:
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
                  DEV ONLY
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    setLoginEmail('staff@aurel.restaurant');
                    setLoginPassword(
                      import.meta.env.VITE_DEMO_PASSWORD || 'OperationsPassword2026!',
                    );
                  }}
                  className="p-2 rounded-lg bg-[#1E293B] border border-[#334155] hover:border-ops-accent text-center text-ops-muted hover:text-white transition-all"
                >
                  🤵 Staff
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoginEmail('kitchen@aurel.restaurant');
                    setLoginPassword(
                      import.meta.env.VITE_DEMO_PASSWORD || 'OperationsPassword2026!',
                    );
                  }}
                  className="p-2 rounded-lg bg-[#1E293B] border border-[#334155] hover:border-ops-accent text-center text-ops-muted hover:text-white transition-all"
                >
                  👨‍🍳 Kitchen
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoginEmail('admin@aurel.restaurant');
                    setLoginPassword(
                      import.meta.env.VITE_DEMO_PASSWORD || 'OperationsPassword2026!',
                    );
                  }}
                  className="p-2 rounded-lg bg-[#1E293B] border border-[#334155] hover:border-ops-accent text-center text-ops-muted hover:text-white transition-all"
                >
                  👑 Admin
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Authenticated Operations Command Center
  return (
    <div className="min-h-screen bg-[#090D16] text-[#F8FAFC] flex flex-col font-sans">
      {/* Top Operations Header */}
      <header className="bg-[#111827] border-b border-[#1E293B] px-6 py-3 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-40">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2.5">
            <span className="w-3 h-3 bg-ops-accent rounded-sm animate-pulse"></span>
            <h1 className="text-base font-bold tracking-wider text-white">AUREL OPERATIONS</h1>
          </div>
          <span className="text-[11px] px-2.5 py-0.5 rounded bg-[#1E293B] text-ops-muted font-mono border border-[#334155]">
            Central Kitchen #1 (Marine Drive)
          </span>

          {/* Navigation Tabs */}
          <div className="hidden md:flex items-center space-x-1 ml-4 bg-[#0F172A] p-1 rounded-lg border border-[#1E293B]">
            <button
              onClick={() => setActiveTab('orders')}
              className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                activeTab === 'orders'
                  ? 'bg-ops-accent text-[#090D16]'
                  : 'text-ops-muted hover:text-white'
              }`}
            >
              📋 Live Orders Board ({orders.length})
            </button>
            {(currentUser.role === UserRole.MANAGER || currentUser.role === UserRole.ADMIN) && (
              <button
                onClick={() => {
                  setActiveTab('menu');
                  fetchMenu();
                }}
                className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                  activeTab === 'menu'
                    ? 'bg-ops-accent text-[#090D16]'
                    : 'text-ops-muted hover:text-white'
                }`}
              >
                ⚡ 86 Menu Manager
              </button>
            )}
          </div>
        </div>

        {/* User Info & Controls */}
        <div className="flex items-center space-x-4 text-xs">
          {/* Polling indicator */}
          <div className="flex items-center space-x-2 text-ops-muted">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span className="font-mono text-[11px]">
              {ordersLoading ? 'Refreshing...' : `Updated ${lastRefreshed.toLocaleTimeString()}`}
            </span>
            <button onClick={fetchOrders} className="text-ops-accent hover:underline text-[11px]">
              ↻ Refresh
            </button>
          </div>

          {/* User Badge */}
          <div className="flex items-center space-x-2 bg-[#1E293B] px-3 py-1 rounded-lg border border-[#334155]">
            <span
              className={`text-[10px] font-bold uppercase px-1.5 py-0.2 rounded ${
                currentUser.role === UserRole.ADMIN
                  ? 'bg-amber-400 text-black'
                  : currentUser.role === UserRole.MANAGER
                    ? 'bg-purple-400 text-black'
                    : currentUser.role === UserRole.KITCHEN
                      ? 'bg-emerald-400 text-black'
                      : 'bg-blue-400 text-black'
              }`}
            >
              {currentUser.role}
            </span>
            <span className="font-medium text-white">{currentUser.fullName}</span>
          </div>

          <button
            onClick={handleLogout}
            className="px-3 py-1 rounded border border-[#334155] text-ops-muted hover:text-rose-400 hover:border-rose-900 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Action Notification Banner */}
      {actionError && (
        <div className="bg-rose-950/80 border-b border-rose-800 px-6 py-2 text-xs text-rose-200 flex justify-between items-center">
          <span>⚠️ {actionError}</span>
          <button onClick={() => setActionError(null)} className="text-white">
            ✕
          </button>
        </div>
      )}

      {/* Main Workspace */}
      <main className="flex-1 p-6 max-w-[1600px] mx-auto w-full flex flex-col">
        {activeTab === 'orders' ? (
          <>
            {/* Filter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-semibold uppercase text-ops-muted tracking-wider">
                  Channel Filter:
                </span>
                {(
                  [
                    'ALL',
                    FulfillmentChannel.DINE_IN,
                    FulfillmentChannel.PICKUP,
                    FulfillmentChannel.DELIVERY,
                  ] as const
                ).map((ch) => (
                  <button
                    key={ch}
                    onClick={() => setChannelFilter(ch)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      channelFilter === ch
                        ? 'bg-ops-accent text-[#090D16] shadow-md'
                        : 'bg-[#111827] text-ops-muted hover:text-white border border-[#1E293B]'
                    }`}
                  >
                    {ch === 'ALL' ? 'All Channels' : ch}
                  </button>
                ))}
              </div>

              <div className="flex items-center space-x-3 text-xs text-ops-muted">
                <span>Polling Interval:</span>
                <select
                  value={refreshInterval}
                  onChange={(e) => setRefreshInterval(Number(e.target.value))}
                  className="bg-[#111827] border border-[#1E293B] rounded px-2 py-1 text-white font-mono"
                >
                  <option value={2000}>2s (Real-Time)</option>
                  <option value={3000}>3s (Standard)</option>
                  <option value={10000}>10s (Relaxed)</option>
                  <option value={0}>Manual Only</option>
                </select>
              </div>
            </div>

            {/* Kanban Columns Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 flex-1 items-start">
              {/* Column 1: Incoming Orders */}
              <div className="bg-[#111827] border border-[#1E293B] rounded-2xl flex flex-col max-h-[85vh]">
                <div className="p-4 border-b border-[#1E293B] flex items-center justify-between bg-[#151F32] rounded-t-2xl">
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                    <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                      1. Incoming / Placed
                    </h2>
                  </div>
                  <span className="bg-[#1E293B] text-amber-400 font-mono font-bold text-xs px-2 py-0.5 rounded">
                    {incomingOrders.length}
                  </span>
                </div>

                <div className="p-4 overflow-y-auto space-y-4 flex-1">
                  {incomingOrders.length === 0 ? (
                    <p className="text-center py-12 text-xs text-ops-muted">No pending orders</p>
                  ) : (
                    incomingOrders.map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        currentUser={currentUser}
                        onUpdateStatus={handleUpdateStatus}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Column 2: Kitchen Display (Preparing) */}
              <div className="bg-[#111827] border border-[#1E293B] rounded-2xl flex flex-col max-h-[85vh]">
                <div className="p-4 border-b border-[#1E293B] flex items-center justify-between bg-[#132328] rounded-t-2xl">
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                      2. Kitchen (Preparing)
                    </h2>
                  </div>
                  <span className="bg-[#1E293B] text-emerald-400 font-mono font-bold text-xs px-2 py-0.5 rounded">
                    {kitchenOrders.length}
                  </span>
                </div>

                <div className="p-4 overflow-y-auto space-y-4 flex-1">
                  {kitchenOrders.length === 0 ? (
                    <p className="text-center py-12 text-xs text-ops-muted">Kitchen idle</p>
                  ) : (
                    kitchenOrders.map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        currentUser={currentUser}
                        onUpdateStatus={handleUpdateStatus}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Column 3: Ready for Service / Dispatch */}
              <div className="bg-[#111827] border border-[#1E293B] rounded-2xl flex flex-col max-h-[85vh]">
                <div className="p-4 border-b border-[#1E293B] flex items-center justify-between bg-[#192138] rounded-t-2xl">
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-400"></span>
                    <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                      3. Ready / Floor Dispatch
                    </h2>
                  </div>
                  <span className="bg-[#1E293B] text-blue-400 font-mono font-bold text-xs px-2 py-0.5 rounded">
                    {readyOrders.length}
                  </span>
                </div>

                <div className="p-4 overflow-y-auto space-y-4 flex-1">
                  {readyOrders.length === 0 ? (
                    <p className="text-center py-12 text-xs text-ops-muted">
                      No items awaiting floor
                    </p>
                  ) : (
                    readyOrders.map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        currentUser={currentUser}
                        onUpdateStatus={handleUpdateStatus}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Column 4: Fulfilled / Completed */}
              <div className="bg-[#111827] border border-[#1E293B] rounded-2xl flex flex-col max-h-[85vh]">
                <div className="p-4 border-b border-[#1E293B] flex items-center justify-between bg-[#1E293B] rounded-t-2xl">
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-gray-400"></span>
                    <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                      4. Completed / Settled
                    </h2>
                  </div>
                  <span className="bg-[#0F172A] text-ops-muted font-mono font-bold text-xs px-2 py-0.5 rounded">
                    {completedOrders.length}
                  </span>
                </div>

                <div className="p-4 overflow-y-auto space-y-4 flex-1 opacity-80">
                  {completedOrders.length === 0 ? (
                    <p className="text-center py-12 text-xs text-ops-muted">
                      No fulfilled orders yet
                    </p>
                  ) : (
                    completedOrders
                      .slice(0, 15)
                      .map((order) => (
                        <OrderCard
                          key={order.id}
                          order={order}
                          currentUser={currentUser}
                          onUpdateStatus={handleUpdateStatus}
                          isArchived
                        />
                      ))
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          /* Menu 86'd Availability Management Tab */
          <div className="bg-[#111827] border border-[#1E293B] rounded-2xl p-6 flex-1">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-[#1E293B]">
              <div>
                <h2 className="text-lg font-bold text-white">
                  Culinary Inventory & 86 Item Manager
                </h2>
                <p className="text-xs text-ops-muted mt-0.5">
                  Real-time stock toggling for managers and chefs. Instantly updates customer
                  storefront.
                </p>
              </div>
              <button
                onClick={fetchMenu}
                disabled={menuLoading}
                className="px-4 py-1.5 rounded-lg bg-ops-accent text-[#090D16] text-xs font-bold"
              >
                {menuLoading ? 'Updating...' : 'Reload Menu'}
              </button>
            </div>

            <div className="space-y-6">
              {categories.map((cat) => (
                <div key={cat.id} className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-ops-accent border-b border-[#1E293B] pb-1">
                    {cat.name}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {cat.items.map((item) => (
                      <div
                        key={item.id}
                        className={`p-4 rounded-xl border flex items-center justify-between transition-all ${
                          item.isAvailable
                            ? 'bg-[#0F172A] border-[#1E293B]'
                            : 'bg-rose-950/20 border-rose-900/40'
                        }`}
                      >
                        <div>
                          <div className="font-semibold text-xs text-white">{item.name}</div>
                          <div className="text-[11px] text-ops-muted font-mono mt-0.5">
                            ₹{(item.pricePaise / 100).toFixed(0)}
                          </div>
                        </div>

                        <button
                          onClick={() => handleToggleAvailability(item.id, item.isAvailable)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                            item.isAvailable
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-rose-500/20 hover:text-rose-400 hover:border-rose-500/30'
                              : 'bg-rose-500 text-white shadow-md hover:bg-emerald-500'
                          }`}
                        >
                          {item.isAvailable ? '✓ In Stock' : '✕ 86 Out'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// Subcomponent: Individual Order Card with Actions
function OrderCard({
  order,
  currentUser,
  onUpdateStatus,
  isArchived = false,
}: {
  order: OrderSummary;
  currentUser: StaffUserResponse;
  onUpdateStatus: (id: string, s: OrderStatus) => void;
  isArchived?: boolean;
}) {
  const isKitchen = currentUser.role === UserRole.KITCHEN;
  const isStaff = currentUser.role === UserRole.STAFF;
  const isAdminOrManager =
    currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.MANAGER;

  return (
    <div
      className={`p-4 rounded-xl border flex flex-col justify-between transition-all ${
        order.status === OrderStatus.PREPARING
          ? 'bg-[#0F1D21] border-emerald-500/40 shadow-lg shadow-emerald-500/5'
          : order.status === OrderStatus.READY
            ? 'bg-[#111A2E] border-blue-500/40'
            : 'bg-[#0F172A] border-[#1E293B]'
      }`}
    >
      <div>
        {/* Header: Order Number & Fulfillment Channel */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono font-bold text-xs text-ops-accent">{order.orderNumber}</span>
          <span
            className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
              order.fulfillmentChannel === FulfillmentChannel.DINE_IN
                ? 'bg-purple-950/60 text-purple-300 border border-purple-800/50'
                : order.fulfillmentChannel === FulfillmentChannel.PICKUP
                  ? 'bg-amber-950/60 text-amber-300 border border-amber-800/50'
                  : 'bg-sky-950/60 text-sky-300 border border-sky-800/50'
            }`}
          >
            {order.fulfillmentChannel === FulfillmentChannel.DINE_IN
              ? `🍽️ ${order.tableNumber || 'Dine-In'}`
              : order.fulfillmentChannel === FulfillmentChannel.PICKUP
                ? '🛍️ Pickup'
                : '🛵 Delivery'}
          </span>
        </div>

        {/* Customer & Location */}
        <div className="text-xs text-white font-medium">{order.customerName}</div>
        <div className="text-[11px] text-ops-muted">
          {order.customerPhone}
          {order.deliveryAddress && ` • ${order.deliveryAddress}`}
        </div>

        {/* Dishes and Modifiers */}
        <div className="mt-3 pt-3 border-t border-[#1E293B] space-y-2">
          {order.items.map((item, idx) => (
            <div key={idx} className="text-xs">
              <div className="flex justify-between font-medium text-white">
                <span>
                  <strong className="text-ops-accent">{item.quantity}x</strong> {item.name}
                </span>
                <span className="font-mono text-ops-muted">
                  ₹{(item.lineTotalPaise / 100).toFixed(0)}
                </span>
              </div>
              {item.modifiers.length > 0 && (
                <div className="pl-4 text-[10px] text-ops-muted space-y-0.5 mt-0.5">
                  {item.modifiers.map((m, mIdx) => (
                    <div key={mIdx}>• {m.name}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Special Instructions */}
        {order.specialInstructions && (
          <div className="mt-2.5 p-2 bg-[#172033] rounded text-[11px] text-amber-200 border border-amber-900/30">
            💬 "{order.specialInstructions}"
          </div>
        )}

        {/* Financial Breakdown */}
        <div className="mt-3 pt-2.5 border-t border-[#1E293B] flex items-center justify-between text-[11px] text-ops-muted">
          <span>
            Mode: <strong className="text-white">{order.paymentMode}</strong> ({order.paymentStatus}
            )
          </span>
          <span className="font-mono font-bold text-xs text-white">
            ₹{(order.totalPaise / 100).toFixed(2)}
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      {!isArchived && (
        <div className="mt-4 pt-3 border-t border-[#1E293B] flex flex-wrap gap-2">
          {order.status === OrderStatus.PLACED && (
            <button
              onClick={() => onUpdateStatus(order.id, OrderStatus.ACCEPTED)}
              disabled={isKitchen}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                isKitchen
                  ? 'opacity-40 bg-gray-800 text-gray-400 cursor-not-allowed'
                  : 'bg-amber-400 text-black hover:brightness-110 shadow-md'
              }`}
            >
              ✓ Accept Order
            </button>
          )}

          {order.status === OrderStatus.ACCEPTED && (
            <button
              onClick={() => onUpdateStatus(order.id, OrderStatus.PREPARING)}
              disabled={isStaff && !isAdminOrManager}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                isStaff && !isAdminOrManager
                  ? 'opacity-40 bg-gray-800 text-gray-400 cursor-not-allowed'
                  : 'bg-emerald-400 text-black hover:brightness-110 shadow-md animate-pulse'
              }`}
            >
              🔥 Start Kitchen Prep
            </button>
          )}

          {order.status === OrderStatus.PREPARING && (
            <button
              onClick={() => onUpdateStatus(order.id, OrderStatus.READY)}
              disabled={isStaff && !isAdminOrManager}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                isStaff && !isAdminOrManager
                  ? 'opacity-40 bg-gray-800 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-400 text-black hover:brightness-110 shadow-md'
              }`}
            >
              🍽️ Mark Plated & Ready
            </button>
          )}

          {order.status === OrderStatus.READY && (
            <button
              onClick={() =>
                onUpdateStatus(
                  order.id,
                  order.fulfillmentChannel === FulfillmentChannel.DELIVERY
                    ? OrderStatus.DISPATCHED
                    : OrderStatus.SERVED,
                )
              }
              disabled={isKitchen && !isAdminOrManager}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                isKitchen && !isAdminOrManager
                  ? 'opacity-40 bg-gray-800 text-gray-400 cursor-not-allowed'
                  : 'bg-ops-accent text-black hover:brightness-110 shadow-md'
              }`}
            >
              {order.fulfillmentChannel === FulfillmentChannel.DELIVERY
                ? '🛵 Dispatch Courier'
                : '🛎️ Serve Tableside'}
            </button>
          )}

          {order.status === OrderStatus.DISPATCHED && (
            <button
              onClick={() => onUpdateStatus(order.id, OrderStatus.DELIVERED)}
              disabled={isKitchen && !isAdminOrManager}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                isKitchen && !isAdminOrManager
                  ? 'opacity-40 bg-gray-800 text-gray-400 cursor-not-allowed'
                  : 'bg-emerald-400 text-black hover:brightness-110 shadow-md'
              }`}
            >
              ✓ Mark Delivered
            </button>
          )}
        </div>
      )}
    </div>
  );
}
