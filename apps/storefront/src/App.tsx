import React, { useEffect, useState, useMemo } from 'react';
import {
  MenuCategory,
  MenuItemSummary,
  FulfillmentChannel,
  PaymentMode,
  OrderStatus,
  OrderSummary,
  CreateOrderRequest,
} from '@aurel/shared-types';

interface CartItem {
  id: string; // unique cart entry key
  menuItem: MenuItemSummary;
  selectedOptionIds: string[];
  selectedOptionSummaries: Array<{ name: string; pricePaise: number }>;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
}

export default function App(): React.JSX.Element {
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';

  // Catalog State
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string>('all');
  const [loadingMenu, setLoadingMenu] = useState<boolean>(true);
  const [menuError, setMenuError] = useState<string | null>(null);

  // Fulfillment State
  const [fulfillmentChannel, setFulfillmentChannel] = useState<FulfillmentChannel>(
    FulfillmentChannel.DINE_IN,
  );

  // Cart State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState<boolean>(false);

  // Modifier Customization Modal State
  const [customizingItem, setCustomizingItem] = useState<MenuItemSummary | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string[]>>({});
  const [modalQuantity, setModalQuantity] = useState<number>(1);
  const [modalError, setModalError] = useState<string | null>(null);

  // Checkout Modal State
  const [isCheckoutOpen, setIsCheckoutOpen] = useState<boolean>(false);
  const [customerName, setCustomerName] = useState<string>('');
  const [customerEmail, setCustomerEmail] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [deliveryAddress, setDeliveryAddress] = useState<string>('');
  const [tableNumber, setTableNumber] = useState<string>('Table 4');
  const [specialInstructions, setSpecialInstructions] = useState<string>('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(PaymentMode.DEMO);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState<boolean>(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Active Tracked Order State
  const [activeOrder, setActiveOrder] = useState<OrderSummary | null>(null);
  const [orderTokens, setOrderTokens] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('aurel_order_tokens') || '{}');
    } catch {
      return {};
    }
  });
  const [lookupQuery, setLookupQuery] = useState<string>('');
  const [isLookupOpen, setIsLookupOpen] = useState<boolean>(false);
  const [lookupLoading, setLookupLoading] = useState<boolean>(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Fetch Menu on load
  const loadMenu = () => {
    setLoadingMenu(true);
    setMenuError(null);
    fetch(`${apiBase}/menu`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load menu`);
        return res.json();
      })
      .then((data: MenuCategory[]) => {
        setCategories(data);
        setLoadingMenu(false);
      })
      .catch((err: Error) => {
        setMenuError(err.message);
        setLoadingMenu(false);
      });
  };

  useEffect(() => {
    loadMenu();
  }, [apiBase]);

  // Live Order Status Polling (every 3 seconds when tracking an active order)
  useEffect(() => {
    if (!activeOrder) return;

    const token = activeOrder.guestAccessToken || orderTokens[activeOrder.id];
    const headers: Record<string, string> = {};
    if (token) headers['X-Order-Token'] = token;

    const interval = setInterval(() => {
      fetch(`${apiBase}/orders/${activeOrder.id}`, { headers })
        .then((res) => (res.ok ? res.json() : null))
        .then((updated: OrderSummary | null) => {
          if (updated && updated.status !== activeOrder.status) {
            setActiveOrder((current) => ({
              ...updated,
              guestAccessToken: current?.guestAccessToken || updated.guestAccessToken,
            }));
          }
        })
        .catch((err) => {
          console.debug('Polling error:', err);
        });
    }, 3000);

    return () => clearInterval(interval);
  }, [activeOrder, apiBase, orderTokens]);

  // Cart Calculations
  const subtotalPaise = useMemo(
    () => cart.reduce((acc, item) => acc + item.lineTotalPaise, 0),
    [cart],
  );
  const taxPaise = useMemo(() => Math.round(subtotalPaise * 0.05), [subtotalPaise]);
  const deliveryFeePaise = useMemo(
    () => (fulfillmentChannel === FulfillmentChannel.DELIVERY ? 5000 : 0),
    [fulfillmentChannel],
  );
  const totalPaise = subtotalPaise + taxPaise + deliveryFeePaise;
  const totalCartCount = useMemo(() => cart.reduce((acc, item) => acc + item.quantity, 0), [cart]);

  // Filtered Items
  const displayedCategories = useMemo(() => {
    if (activeCategoryId === 'all') return categories;
    return categories.filter((c) => c.id === activeCategoryId);
  }, [categories, activeCategoryId]);

  // Open item modal with default selections
  const openItemCustomization = (item: MenuItemSummary) => {
    const initialSelections: Record<string, string[]> = {};
    if (item.modifierGroups) {
      item.modifierGroups.forEach((group) => {
        const defaults = group.options.filter((o) => o.isDefault).map((o) => o.id);
        if (defaults.length > 0) {
          initialSelections[group.id] = defaults;
        } else if (group.minSelections > 0 && group.options.length > 0) {
          initialSelections[group.id] = [group.options[0].id];
        } else {
          initialSelections[group.id] = [];
        }
      });
    }
    setSelectedOptions(initialSelections);
    setModalQuantity(1);
    setModalError(null);
    setCustomizingItem(item);
  };

  const handleOptionToggle = (groupId: string, optionId: string, _min: number, max: number) => {
    const current = selectedOptions[groupId] || [];
    if (max === 1) {
      // Radio mode
      setSelectedOptions((prev) => ({ ...prev, [groupId]: [optionId] }));
    } else {
      // Checkbox mode
      if (current.includes(optionId)) {
        setSelectedOptions((prev) => ({
          ...prev,
          [groupId]: current.filter((id) => id !== optionId),
        }));
      } else {
        if (current.length < max) {
          setSelectedOptions((prev) => ({
            ...prev,
            [groupId]: [...current, optionId],
          }));
        }
      }
    }
  };

  // Calculate live modal unit price
  const modalUnitPricePaise = useMemo(() => {
    if (!customizingItem) return 0;
    let sum = customizingItem.pricePaise;
    if (customizingItem.modifierGroups) {
      customizingItem.modifierGroups.forEach((group) => {
        const picked = selectedOptions[group.id] || [];
        group.options.forEach((opt) => {
          if (picked.includes(opt.id)) {
            sum += opt.pricePaise;
          }
        });
      });
    }
    return sum;
  }, [customizingItem, selectedOptions]);

  // Add Item to Cart
  const handleAddToCart = () => {
    if (!customizingItem) return;

    // Validate min constraints
    if (customizingItem.modifierGroups) {
      for (const group of customizingItem.modifierGroups) {
        const picked = selectedOptions[group.id] || [];
        if (picked.length < group.minSelections) {
          setModalError(`Please select at least ${group.minSelections} for '${group.name}'.`);
          return;
        }
      }
    }

    const allPickedOptionIds: string[] = [];
    const optionSummaries: Array<{ name: string; pricePaise: number }> = [];

    if (customizingItem.modifierGroups) {
      customizingItem.modifierGroups.forEach((group) => {
        const picked = selectedOptions[group.id] || [];
        group.options.forEach((opt) => {
          if (picked.includes(opt.id)) {
            allPickedOptionIds.push(opt.id);
            optionSummaries.push({
              name: `${group.name}: ${opt.name}`,
              pricePaise: opt.pricePaise,
            });
          }
        });
      });
    }

    const cartKey = `${customizingItem.id}-${allPickedOptionIds.sort().join('-')}`;
    const unitPrice = modalUnitPricePaise;
    const lineTotal = unitPrice * modalQuantity;

    setCart((prev) => {
      const existingIdx = prev.findIndex((item) => item.id === cartKey);
      if (existingIdx >= 0) {
        const next = [...prev];
        const updatedQty = next[existingIdx].quantity + modalQuantity;
        next[existingIdx] = {
          ...next[existingIdx],
          quantity: updatedQty,
          lineTotalPaise: next[existingIdx].unitPricePaise * updatedQty,
        };
        return next;
      }
      return [
        ...prev,
        {
          id: cartKey,
          menuItem: customizingItem,
          selectedOptionIds: allPickedOptionIds,
          selectedOptionSummaries: optionSummaries,
          quantity: modalQuantity,
          unitPricePaise: unitPrice,
          lineTotalPaise: lineTotal,
        },
      ];
    });

    setCustomizingItem(null);
    setIsCartOpen(true);
  };

  const updateCartQty = (cartId: string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((item) => {
          if (item.id === cartId) {
            const nextQty = item.quantity + delta;
            if (nextQty <= 0) return null;
            return {
              ...item,
              quantity: nextQty,
              lineTotalPaise: item.unitPricePaise * nextQty,
            };
          }
          return item;
        })
        .filter(Boolean) as CartItem[];
    });
  };

  // Submit Order via API
  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;

    if (!customerName.trim() || !customerEmail.trim() || !customerPhone.trim()) {
      setCheckoutError('Please provide your name, email, and contact phone.');
      return;
    }

    if (fulfillmentChannel === FulfillmentChannel.DELIVERY && !deliveryAddress.trim()) {
      setCheckoutError('Delivery address is required for doorstep courier service.');
      return;
    }

    if (fulfillmentChannel === FulfillmentChannel.DINE_IN && !tableNumber.trim()) {
      setCheckoutError('Please specify your table number.');
      return;
    }

    setIsSubmittingOrder(true);
    setCheckoutError(null);

    // Client-side CSPRNG Idempotency Key
    const idempotencyKey = `ord-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const payload: CreateOrderRequest = {
      idempotencyKey,
      fulfillmentChannel,
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim().toLowerCase(),
      customerPhone: customerPhone.trim(),
      deliveryAddress:
        fulfillmentChannel === FulfillmentChannel.DELIVERY ? deliveryAddress.trim() : undefined,
      tableNumber:
        fulfillmentChannel === FulfillmentChannel.DINE_IN ? tableNumber.trim() : undefined,
      specialInstructions: specialInstructions.trim() || undefined,
      paymentMode,
      items: cart.map((c) => ({
        menuItemId: c.menuItem.id,
        quantity: c.quantity,
        selectedOptionIds: c.selectedOptionIds,
      })),
    };

    try {
      const res = await fetch(`${apiBase}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          errorData.detail || errorData.message || `Order submission failed (HTTP ${res.status})`,
        );
      }

      const orderData: OrderSummary = await res.json();
      if (orderData.guestAccessToken) {
        setOrderTokens((prev) => {
          const next = {
            ...prev,
            [orderData.id]: orderData.guestAccessToken!,
            [orderData.orderNumber]: orderData.guestAccessToken!,
          };
          try {
            sessionStorage.setItem('aurel_order_tokens', JSON.stringify(next));
          } catch (e) {
            console.debug('Failed to cache order token in sessionStorage:', e);
          }
          return next;
        });
      }
      setCart([]);
      setIsCheckoutOpen(false);
      setActiveOrder(orderData);
    } catch (err: any) {
      setCheckoutError(err.message || 'Failed to submit order.');
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  // Order Lookup
  const handleLookupOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = lookupQuery.trim();
    if (!query) return;

    setLookupLoading(true);
    setLookupError(null);

    try {
      const headers: Record<string, string> = {};
      const token = orderTokens[query];
      if (token) {
        headers['X-Order-Token'] = token;
      }

      const res = await fetch(`${apiBase}/orders/${query}`, { headers });
      if (!res.ok) {
        if (res.status === 404) throw new Error('No order found with this reference number.');
        if (res.status === 403)
          throw new Error('Access protected: Guest access token required to view this order.');
        throw new Error(`Lookup failed (HTTP ${res.status})`);
      }
      const data: OrderSummary = await res.json();
      setActiveOrder(data);
      setIsLookupOpen(false);
      setLookupQuery('');
    } catch (err: any) {
      setLookupError(err.message);
    } finally {
      setLookupLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0D0D11] text-[#E8E6E3] flex flex-col font-sans selection:bg-[#C5A880]/30">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-[#0D0D11]/90 backdrop-blur-md border-b border-[#23232C] px-6 lg:px-12 py-4 flex items-center justify-between">
        {/* Brand */}
        <div
          className="flex items-center space-x-3 cursor-pointer"
          onClick={() => setActiveOrder(null)}
        >
          <div className="w-10 h-10 rounded-full border border-[#C5A880] flex items-center justify-center bg-gradient-to-tr from-[#1A1813] to-[#2B2319]">
            <span className="font-serif text-[#C5A880] font-bold text-xl">A</span>
          </div>
          <div>
            <h1 className="text-xl font-serif tracking-widest uppercase font-semibold text-[#F7F4EE]">
              Aurel
            </h1>
            <p className="text-[10px] tracking-[0.25em] uppercase text-[#C5A880]">
              Haute Gastronomie
            </p>
          </div>
        </div>

        {/* Fulfillment Channel Pill Switcher */}
        <div className="hidden md:flex items-center bg-[#15151B] p-1 rounded-full border border-[#23232C]">
          <button
            onClick={() => setFulfillmentChannel(FulfillmentChannel.DINE_IN)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
              fulfillmentChannel === FulfillmentChannel.DINE_IN
                ? 'bg-[#C5A880] text-[#0D0D11] shadow-md font-semibold'
                : 'text-[#9E9BA3] hover:text-[#E8E6E3]'
            }`}
          >
            🍽️ Dine-In
          </button>
          <button
            onClick={() => setFulfillmentChannel(FulfillmentChannel.PICKUP)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
              fulfillmentChannel === FulfillmentChannel.PICKUP
                ? 'bg-[#C5A880] text-[#0D0D11] shadow-md font-semibold'
                : 'text-[#9E9BA3] hover:text-[#E8E6E3]'
            }`}
          >
            🛍️ Pickup
          </button>
          <button
            onClick={() => setFulfillmentChannel(FulfillmentChannel.DELIVERY)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
              fulfillmentChannel === FulfillmentChannel.DELIVERY
                ? 'bg-[#C5A880] text-[#0D0D11] shadow-md font-semibold'
                : 'text-[#9E9BA3] hover:text-[#E8E6E3]'
            }`}
          >
            🛵 Delivery (+₹50)
          </button>
        </div>

        {/* Actions: Lookup & Cart */}
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setIsLookupOpen(true)}
            className="text-xs px-3 py-2 rounded-lg border border-[#2A2A35] text-[#C5A880] hover:bg-[#1A1A22] transition-colors"
          >
            🔍 Track Order
          </button>

          <button
            onClick={() => setIsCartOpen(true)}
            className="relative px-4 py-2 rounded-lg bg-gradient-to-r from-[#C5A880] to-[#B39366] text-[#0D0D11] font-semibold text-xs flex items-center space-x-2 shadow-lg shadow-[#C5A880]/10 hover:brightness-105 transition-all"
          >
            <span>Cart</span>
            {totalCartCount > 0 && (
              <span className="bg-[#0D0D11] text-[#C5A880] px-1.5 py-0.5 rounded-full text-[10px] font-bold">
                {totalCartCount}
              </span>
            )}
            <span className="font-mono font-bold">₹{(totalPaise / 100).toFixed(0)}</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 lg:px-12 py-8">
        {/* Active Order Banner if tracking an order */}
        {activeOrder && (
          <div className="mb-10 bg-gradient-to-r from-[#171612] via-[#211E16] to-[#171612] border border-[#C5A880]/40 rounded-2xl p-6 lg:p-8 shadow-2xl relative overflow-hidden">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#C5A880]/20 pb-6">
              <div>
                <div className="flex items-center space-x-3">
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wider uppercase bg-[#C5A880] text-[#0D0D11]">
                    {activeOrder.fulfillmentChannel}
                  </span>
                  <span className="font-mono text-sm text-[#C5A880] font-semibold">
                    {activeOrder.orderNumber}
                  </span>
                </div>
                <h2 className="text-2xl lg:text-3xl font-serif text-[#F7F4EE] mt-2">
                  Live Order Tracker
                </h2>
                <p className="text-xs text-[#9E9BA3] mt-1">
                  Placed for {activeOrder.customerName} •{' '}
                  {activeOrder.tableNumber
                    ? `Table: ${activeOrder.tableNumber}`
                    : activeOrder.deliveryAddress}
                </p>
              </div>

              <div className="flex items-center space-x-3">
                <span className="text-xs text-[#9E9BA3]">Status:</span>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                    activeOrder.status === OrderStatus.SERVED ||
                    activeOrder.status === OrderStatus.DELIVERED
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : activeOrder.status === OrderStatus.READY
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : activeOrder.status === OrderStatus.PREPARING
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse'
                          : 'bg-[#C5A880]/20 text-[#C5A880] border border-[#C5A880]/30'
                  }`}
                >
                  {activeOrder.status}
                </span>
                <button
                  onClick={() => setActiveOrder(null)}
                  className="text-xs text-[#9E9BA3] hover:text-[#E8E6E3] underline ml-2"
                >
                  Dismiss
                </button>
              </div>
            </div>

            {/* Stepper Progress Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-8">
              {[
                { key: OrderStatus.PLACED, label: '1. Placed', desc: 'Received by kitchen' },
                { key: OrderStatus.ACCEPTED, label: '2. Confirmed', desc: 'Staff verified' },
                { key: OrderStatus.PREPARING, label: '3. Preparing', desc: 'Robata & Marra Forni' },
                { key: OrderStatus.READY, label: '4. Ready', desc: 'Plated & packaged' },
                { key: OrderStatus.SERVED, label: '5. Fulfilled', desc: 'Tableside / Delivered' },
              ].map((step, idx) => {
                const statusOrder = [
                  OrderStatus.PLACED,
                  OrderStatus.ACCEPTED,
                  OrderStatus.PREPARING,
                  OrderStatus.READY,
                  OrderStatus.SERVED,
                ];
                const activeIdx = statusOrder.indexOf(activeOrder.status as OrderStatus);
                const isPassed = activeIdx >= idx;
                const isCurrent = activeIdx === idx;

                return (
                  <div
                    key={step.key}
                    className={`p-3 rounded-xl border transition-all ${
                      isCurrent
                        ? 'bg-[#C5A880]/20 border-[#C5A880] text-[#F7F4EE] shadow-lg shadow-[#C5A880]/10 scale-[1.02]'
                        : isPassed
                          ? 'bg-[#15151B] border-emerald-500/40 text-emerald-400'
                          : 'bg-[#121217] border-[#22222B] text-[#5A5862]'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span
                        className={`w-2 h-2 rounded-full ${isCurrent ? 'bg-[#C5A880] animate-ping' : isPassed ? 'bg-emerald-400' : 'bg-gray-600'}`}
                      ></span>
                      <span className="text-xs font-bold uppercase tracking-wider">
                        {step.label}
                      </span>
                    </div>
                    <p className="text-[11px] mt-1 text-[#9E9BA3]">{step.desc}</p>
                  </div>
                );
              })}
            </div>

            {/* Receipt Summary Breakdown */}
            <div className="mt-6 pt-6 border-t border-[#C5A880]/10 flex flex-wrap items-center justify-between text-xs text-[#9E9BA3]">
              <div>
                Items: <strong className="text-[#E8E6E3]">{activeOrder.items.length} dishes</strong>{' '}
                • Total:{' '}
                <strong className="text-[#C5A880] font-mono text-sm">
                  ₹{(activeOrder.totalPaise / 100).toFixed(2)}
                </strong>{' '}
                (Incl. GST)
              </div>
              <div className="text-[11px] text-[#C5A880]/70 mt-2 sm:mt-0">
                ✨ Auto-refreshing in real time as floor staff updates status.
              </div>
            </div>
          </div>
        )}

        {/* Hero Section */}
        <section className="text-center py-10 lg:py-16">
          <span className="text-xs uppercase tracking-[0.3em] text-[#C5A880] font-semibold">
            Fine Dining & Table Hospitality
          </span>
          <h2 className="text-4xl sm:text-6xl font-serif text-[#F7F4EE] mt-3 tracking-wide leading-tight">
            Crafted Flavors, Wood-Fired Mastery & Salon Dining
          </h2>
          <p className="text-[#9E9BA3] max-w-2xl mx-auto mt-4 text-sm sm:text-base leading-relaxed">
            Welcome to Aurel. Our kitchen combines 48-hour fermented Neapolitan doughs, hand-rolled
            pastas, and prime Robata-charred cuts.
          </p>

          {/* Fulfillment details banner */}
          <div className="mt-8 inline-flex items-center bg-[#15151B] border border-[#2A2A35] rounded-full px-5 py-2 text-xs text-[#9E9BA3]">
            <span className="w-2 h-2 rounded-full bg-emerald-400 mr-2.5 animate-pulse"></span>
            <span>Current Dining Mode:</span>
            <strong className="text-[#F7F4EE] ml-1.5 uppercase tracking-wide">
              {fulfillmentChannel === FulfillmentChannel.DINE_IN && '🍽️ Dine-In Table Service'}
              {fulfillmentChannel === FulfillmentChannel.PICKUP && '🛍️ Curbside Pickup'}
              {fulfillmentChannel === FulfillmentChannel.DELIVERY && '🛵 Doorstep Delivery (₹50)'}
            </strong>
          </div>
        </section>

        {/* Category Filter Tabs */}
        <div className="flex items-center space-x-2 overflow-x-auto pb-4 scrollbar-none border-b border-[#202028] mb-8">
          <button
            onClick={() => setActiveCategoryId('all')}
            className={`px-5 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
              activeCategoryId === 'all'
                ? 'bg-[#C5A880] text-[#0D0D11] font-semibold shadow-md'
                : 'bg-[#15151B] text-[#9E9BA3] hover:text-[#E8E6E3] hover:bg-[#1E1E26]'
            }`}
          >
            All Offerings
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategoryId(cat.id)}
              className={`px-5 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                activeCategoryId === cat.id
                  ? 'bg-[#C5A880] text-[#0D0D11] font-semibold shadow-md'
                  : 'bg-[#15151B] text-[#9E9BA3] hover:text-[#E8E6E3] hover:bg-[#1E1E26]'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* Loading / Error States */}
        {loadingMenu && (
          <div className="text-center py-20">
            <div className="w-10 h-10 border-2 border-[#C5A880] border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-xs text-[#9E9BA3] mt-4 uppercase tracking-widest">
              Consulting Aurel Kitchen Ledger...
            </p>
          </div>
        )}

        {menuError && (
          <div className="bg-rose-950/30 border border-rose-800/40 rounded-xl p-6 text-center max-w-md mx-auto my-12">
            <p className="text-xs text-rose-300 font-semibold mb-2">Could Not Retrieve Menu</p>
            <p className="text-xs text-[#9E9BA3] mb-4">{menuError}</p>
            <button
              onClick={loadMenu}
              className="px-4 py-1.5 rounded bg-rose-800 text-white text-xs font-medium hover:bg-rose-700"
            >
              Retry Connection
            </button>
          </div>
        )}

        {/* Menu Items Grid */}
        <div className="space-y-12">
          {displayedCategories.map((cat) => (
            <section key={cat.id} className="space-y-6">
              <div className="border-b border-[#202028] pb-3 flex items-baseline justify-between">
                <div>
                  <h3 className="text-2xl font-serif text-[#F7F4EE] tracking-wide">{cat.name}</h3>
                  {cat.description && (
                    <p className="text-xs text-[#9E9BA3] mt-0.5">{cat.description}</p>
                  )}
                </div>
                <span className="text-xs text-[#C5A880] font-mono">
                  {cat.items.length} selections
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {cat.items.map((item) => (
                  <div
                    key={item.id}
                    className="bg-[#14141A] border border-[#22222C] rounded-2xl p-6 flex flex-col justify-between hover:border-[#C5A880]/50 transition-all hover:shadow-xl hover:shadow-[#C5A880]/5 group"
                  >
                    <div>
                      {/* Dietary Badges & Price */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                          {item.dietaryFlags.map((flag) => (
                            <span
                              key={flag}
                              className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                                flag === 'VEG'
                                  ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40'
                                  : flag === 'SIGNATURE'
                                    ? 'bg-[#C5A880]/20 text-[#C5A880] border border-[#C5A880]/30'
                                    : 'bg-[#22222C] text-[#9E9BA3]'
                              }`}
                            >
                              {flag}
                            </span>
                          ))}
                        </div>
                        <span className="text-lg font-serif font-bold text-[#C5A880]">
                          ₹{(item.pricePaise / 100).toLocaleString('en-IN')}
                        </span>
                      </div>

                      <h4 className="text-lg font-serif text-[#F7F4EE] font-semibold group-hover:text-[#C5A880] transition-colors leading-snug">
                        {item.name}
                      </h4>
                      <p className="text-xs text-[#9E9BA3] mt-2 leading-relaxed line-clamp-3">
                        {item.description}
                      </p>
                    </div>

                    <div className="mt-6 pt-4 border-t border-[#202028] flex items-center justify-between">
                      <span className="text-[11px] text-[#7A7882]">
                        {item.modifierGroups && item.modifierGroups.length > 0
                          ? 'Customizable'
                          : 'Chef Standard'}
                      </span>
                      <button
                        onClick={() => openItemCustomization(item)}
                        className="px-4 py-2 rounded-lg bg-[#20202B] hover:bg-[#C5A880] text-[#E8E6E3] hover:text-[#0D0D11] text-xs font-semibold transition-all flex items-center space-x-1"
                      >
                        <span>+ Add to Order</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>

      {/* Modifier Customization Modal */}
      {customizingItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#14141B] border border-[#2B2B38] rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-6 border-b border-[#202028] flex items-start justify-between">
              <div>
                <span className="text-[10px] tracking-widest uppercase text-[#C5A880] font-bold">
                  Culinary Options
                </span>
                <h3 className="text-xl font-serif text-[#F7F4EE] font-semibold mt-1">
                  {customizingItem.name}
                </h3>
                <p className="text-xs text-[#9E9BA3] mt-1">{customizingItem.description}</p>
              </div>
              <button
                onClick={() => setCustomizingItem(null)}
                className="text-[#9E9BA3] hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            {/* Modal Body: Modifier Groups */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {modalError && (
                <div className="p-3 bg-rose-950/50 border border-rose-800 rounded-lg text-xs text-rose-300">
                  {modalError}
                </div>
              )}

              {customizingItem.modifierGroups?.map((group) => {
                const picked = selectedOptions[group.id] || [];
                const isSingle = group.maxSelections === 1;

                return (
                  <div key={group.id} className="space-y-3">
                    <div className="flex items-baseline justify-between border-b border-[#202028] pb-1.5">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[#E8E6E3]">
                        {group.name}
                      </h4>
                      <span className="text-[10px] text-[#C5A880]">
                        {group.minSelections > 0
                          ? `Required (Pick ${group.maxSelections})`
                          : `Optional (Up to ${group.maxSelections})`}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {group.options.map((opt) => {
                        const isSelected = picked.includes(opt.id);

                        return (
                          <div
                            key={opt.id}
                            onClick={() =>
                              handleOptionToggle(
                                group.id,
                                opt.id,
                                group.minSelections,
                                group.maxSelections,
                              )
                            }
                            className={`p-3 rounded-xl border text-xs flex items-center justify-between cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-[#C5A880]/10 border-[#C5A880] text-[#F7F4EE]'
                                : 'bg-[#181820] border-[#22222C] text-[#9E9BA3] hover:bg-[#1E1E28]'
                            }`}
                          >
                            <div className="flex items-center space-x-3">
                              <span
                                className={`w-4 h-4 rounded-${isSingle ? 'full' : 'md'} border flex items-center justify-center text-[10px] ${
                                  isSelected
                                    ? 'border-[#C5A880] bg-[#C5A880] text-[#0D0D11] font-bold'
                                    : 'border-gray-600'
                                }`}
                              >
                                {isSelected ? (isSingle ? '•' : '✓') : ''}
                              </span>
                              <span className="font-medium text-[#E8E6E3]">{opt.name}</span>
                            </div>
                            <span className="font-mono text-[#C5A880]">
                              {opt.pricePaise > 0 ? `+₹${opt.pricePaise / 100}` : 'Free'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Quantity Stepper */}
              <div className="flex items-center justify-between pt-4 border-t border-[#202028]">
                <span className="text-xs font-bold uppercase tracking-wider text-[#9E9BA3]">
                  Quantity
                </span>
                <div className="flex items-center space-x-3 bg-[#181820] border border-[#262633] rounded-lg p-1">
                  <button
                    onClick={() => setModalQuantity((q) => Math.max(1, q - 1))}
                    className="w-7 h-7 rounded flex items-center justify-center text-xs hover:bg-[#252533]"
                  >
                    -
                  </button>
                  <span className="font-mono font-bold text-xs px-2">{modalQuantity}</span>
                  <button
                    onClick={() => setModalQuantity((q) => Math.min(20, q + 1))}
                    className="w-7 h-7 rounded flex items-center justify-center text-xs hover:bg-[#252533]"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-[#202028] bg-[#111116] flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase text-[#7A7882]">Total Item Cost</span>
                <div className="text-lg font-serif font-bold text-[#C5A880]">
                  ₹{((modalUnitPricePaise * modalQuantity) / 100).toLocaleString('en-IN')}
                </div>
              </div>
              <button
                onClick={handleAddToCart}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#C5A880] to-[#B39366] text-[#0D0D11] font-semibold text-xs shadow-lg hover:brightness-105 transition-all"
              >
                Confirm & Add to Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cart Drawer */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end">
          <div className="bg-[#13131A] border-l border-[#242430] w-full max-w-md h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-6 border-b border-[#202028] flex items-center justify-between">
              <div>
                <h3 className="text-xl font-serif text-[#F7F4EE] font-semibold">
                  Your Dining Cart
                </h3>
                <p className="text-xs text-[#9E9BA3]">
                  {fulfillmentChannel} Order • {totalCartCount} items
                </p>
              </div>
              <button
                onClick={() => setIsCartOpen(false)}
                className="text-[#9E9BA3] hover:text-white p-2"
              >
                ✕
              </button>
            </div>

            {/* Items List */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              {cart.length === 0 ? (
                <div className="text-center py-20 text-[#6B6874]">
                  <p className="text-3xl mb-2">🍽️</p>
                  <p className="text-xs uppercase tracking-widest font-semibold">
                    Your cart is vacant
                  </p>
                  <p className="text-[11px] mt-1">Select artisanal courses from our menu.</p>
                </div>
              ) : (
                cart.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 bg-[#181822] border border-[#242433] rounded-xl flex flex-col justify-between"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-serif text-sm text-[#F7F4EE] font-semibold">
                          {item.menuItem.name}
                        </h4>
                        {item.selectedOptionSummaries.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {item.selectedOptionSummaries.map((mod, idx) => (
                              <p key={idx} className="text-[10px] text-[#C5A880]/80">
                                • {mod.name}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="font-mono text-xs font-semibold text-[#C5A880]">
                        ₹{(item.lineTotalPaise / 100).toFixed(0)}
                      </span>
                    </div>

                    <div className="mt-3 pt-3 border-t border-[#20202B] flex items-center justify-between">
                      <div className="flex items-center space-x-2 bg-[#121217] rounded-md border border-[#22222E] px-2 py-0.5">
                        <button
                          onClick={() => updateCartQty(item.id, -1)}
                          className="text-xs text-[#9E9BA3] hover:text-white"
                        >
                          -
                        </button>
                        <span className="font-mono text-xs font-bold px-1.5">{item.quantity}</span>
                        <button
                          onClick={() => updateCartQty(item.id, 1)}
                          className="text-xs text-[#9E9BA3] hover:text-white"
                        >
                          +
                        </button>
                      </div>

                      <button
                        onClick={() => updateCartQty(item.id, -item.quantity)}
                        className="text-[11px] text-rose-400 hover:text-rose-300"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Calculations & Checkout CTA */}
            {cart.length > 0 && (
              <div className="p-6 border-t border-[#202028] bg-[#0F0F14] space-y-3">
                <div className="space-y-1.5 text-xs text-[#9E9BA3]">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span className="font-mono text-[#E8E6E3]">
                      ₹{(subtotalPaise / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Hospitality GST (5%)</span>
                    <span className="font-mono text-[#E8E6E3]">₹{(taxPaise / 100).toFixed(2)}</span>
                  </div>
                  {fulfillmentChannel === FulfillmentChannel.DELIVERY && (
                    <div className="flex justify-between text-[#C5A880]">
                      <span>White-Glove Courier Fee</span>
                      <span className="font-mono">₹50.00</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-serif font-bold text-[#F7F4EE] pt-2 border-t border-[#22222C]">
                    <span>Grand Total</span>
                    <span className="text-[#C5A880] font-mono text-base">
                      ₹{(totalPaise / 100).toFixed(2)}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setIsCartOpen(false);
                    setIsCheckoutOpen(true);
                  }}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-[#C5A880] to-[#B39366] text-[#0D0D11] font-bold text-xs uppercase tracking-widest shadow-xl hover:brightness-105 transition-all mt-3"
                >
                  Proceed to Checkout • ₹{(totalPaise / 100).toFixed(0)}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Checkout Modal */}
      {isCheckoutOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#14141B] border border-[#2B2B38] rounded-2xl max-w-lg w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-[#202028] flex items-center justify-between">
              <div>
                <span className="text-[10px] tracking-widest uppercase text-[#C5A880] font-bold">
                  Final Step
                </span>
                <h3 className="text-xl font-serif text-[#F7F4EE] font-semibold mt-0.5">
                  Complete Your Order
                </h3>
              </div>
              <button
                onClick={() => setIsCheckoutOpen(false)}
                className="text-[#9E9BA3] hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={handlePlaceOrder}
              className="p-6 overflow-y-auto space-y-4 flex-1 text-xs"
            >
              {checkoutError && (
                <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-lg text-rose-300">
                  {checkoutError}
                </div>
              )}

              {/* Guest Information */}
              <div className="space-y-3">
                <h4 className="font-bold text-[11px] uppercase tracking-wider text-[#C5A880]">
                  Contact & Guest Identity
                </h4>
                <div>
                  <label className="block text-[#9E9BA3] mb-1">Full Legal / Guest Name</label>
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="e.g. Elena Rostova"
                    className="w-full bg-[#181822] border border-[#262635] rounded-lg px-3 py-2 text-[#E8E6E3] focus:border-[#C5A880] outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#9E9BA3] mb-1">Email (for receipts)</label>
                    <input
                      type="email"
                      required
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder="elena@example.com"
                      className="w-full bg-[#181822] border border-[#262635] rounded-lg px-3 py-2 text-[#E8E6E3] focus:border-[#C5A880] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[#9E9BA3] mb-1">Contact Phone</label>
                    <input
                      type="tel"
                      required
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="+919876543210"
                      className="w-full bg-[#181822] border border-[#262635] rounded-lg px-3 py-2 text-[#E8E6E3] focus:border-[#C5A880] outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Channel-Specific Requirements */}
              <div className="space-y-3 pt-3 border-t border-[#202028]">
                <h4 className="font-bold text-[11px] uppercase tracking-wider text-[#C5A880]">
                  Fulfillment Specification ({fulfillmentChannel})
                </h4>

                {fulfillmentChannel === FulfillmentChannel.DINE_IN && (
                  <div>
                    <label className="block text-[#9E9BA3] mb-1">Table Number</label>
                    <input
                      type="text"
                      required
                      value={tableNumber}
                      onChange={(e) => setTableNumber(e.target.value)}
                      placeholder="e.g. Table 4"
                      className="w-full bg-[#181822] border border-[#262635] rounded-lg px-3 py-2 text-[#E8E6E3] focus:border-[#C5A880] outline-none"
                    />
                  </div>
                )}

                {fulfillmentChannel === FulfillmentChannel.DELIVERY && (
                  <div>
                    <label className="block text-[#9E9BA3] mb-1">
                      Delivery Address & Instructions
                    </label>
                    <textarea
                      required
                      rows={2}
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      placeholder="Street, Tower, Apartment, Landmark..."
                      className="w-full bg-[#181822] border border-[#262635] rounded-lg px-3 py-2 text-[#E8E6E3] focus:border-[#C5A880] outline-none"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-[#9E9BA3] mb-1">Chef / Dietary Requests</label>
                  <input
                    type="text"
                    value={specialInstructions}
                    onChange={(e) => setSpecialInstructions(e.target.value)}
                    placeholder="Allergies, seating preference, etc."
                    className="w-full bg-[#181822] border border-[#262635] rounded-lg px-3 py-2 text-[#E8E6E3] focus:border-[#C5A880] outline-none"
                  />
                </div>
              </div>

              {/* Payment Settlement Mode */}
              <div className="space-y-3 pt-3 border-t border-[#202028]">
                <h4 className="font-bold text-[11px] uppercase tracking-wider text-[#C5A880]">
                  Payment Method
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div
                    onClick={() => setPaymentMode(PaymentMode.DEMO)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      paymentMode === PaymentMode.DEMO
                        ? 'bg-[#C5A880]/15 border-[#C5A880] text-[#F7F4EE]'
                        : 'bg-[#181822] border-[#262635] text-[#9E9BA3]'
                    }`}
                  >
                    <div className="font-bold">💳 Demo Instant Pay</div>
                    <div className="text-[10px] text-[#9E9BA3] mt-0.5">
                      Pre-authorized test checkout
                    </div>
                  </div>
                  <div
                    onClick={() => setPaymentMode(PaymentMode.CASH)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      paymentMode === PaymentMode.CASH
                        ? 'bg-[#C5A880]/15 border-[#C5A880] text-[#F7F4EE]'
                        : 'bg-[#181822] border-[#262635] text-[#9E9BA3]'
                    }`}
                  >
                    <div className="font-bold">💵 Cash / Pay on Arrival</div>
                    <div className="text-[10px] text-[#9E9BA3] mt-0.5">
                      Settle with floor captain
                    </div>
                  </div>
                </div>
              </div>

              {/* Submit CTA */}
              <div className="pt-4 border-t border-[#202028]">
                <button
                  type="submit"
                  disabled={isSubmittingOrder}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-[#C5A880] to-[#B39366] text-[#0D0D11] font-bold text-xs uppercase tracking-widest shadow-xl hover:brightness-105 transition-all disabled:opacity-50"
                >
                  {isSubmittingOrder
                    ? 'Submitting to Kitchen...'
                    : `Authorize & Place Order (₹${(totalPaise / 100).toFixed(0)})`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Order Status Lookup Modal */}
      {isLookupOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#14141B] border border-[#2B2B38] rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4 border-b border-[#202028] pb-3">
              <h3 className="font-serif text-lg font-semibold text-[#F7F4EE]">Track Order</h3>
              <button
                onClick={() => setIsLookupOpen(false)}
                className="text-[#9E9BA3] hover:text-white"
              >
                ✕
              </button>
            </div>

            {lookupError && (
              <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-lg text-xs text-rose-300 mb-3">
                {lookupError}
              </div>
            )}

            <form onSubmit={handleLookupOrder} className="space-y-4">
              <div>
                <label className="block text-xs text-[#9E9BA3] mb-1">
                  Enter Order Number or Order UUID
                </label>
                <input
                  type="text"
                  required
                  value={lookupQuery}
                  onChange={(e) => setLookupQuery(e.target.value)}
                  placeholder="e.g. AUR-20261013-1001"
                  className="w-full bg-[#181822] border border-[#262635] rounded-lg px-3 py-2 text-xs text-[#E8E6E3] focus:border-[#C5A880] outline-none font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={lookupLoading}
                className="w-full py-2.5 rounded-xl bg-[#C5A880] text-[#0D0D11] font-bold text-xs uppercase tracking-wider hover:brightness-105 transition-all disabled:opacity-50"
              >
                {lookupLoading ? 'Locating Record...' : 'Locate Order'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-[#1C1C24] py-8 text-center text-xs text-[#6B6874] mt-16">
        <div className="flex justify-center space-x-6 mb-3">
          <span>Central Kitchen & Salon: Marine Drive, Mumbai</span>
          <span>•</span>
          <span>Operations Tel: +91 22 5550 1900</span>
        </div>
        <p>
          © 2026 Aurel Restaurant Group. Pure server-authoritative integer-paise commerce engine.
        </p>
      </footer>
    </div>
  );
}
