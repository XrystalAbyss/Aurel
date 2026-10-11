import React, { useEffect, useState } from 'react';
import { HealthCheckResponse } from '@aurel/shared-types';

export default function App(): React.JSX.Element {
  const [health, setHealth] = useState<HealthCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';
    fetch(`${apiBase}/health`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json();
      })
      .then((data: HealthCheckResponse) => {
        setHealth(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return (
    <div className="min-h-screen flex flex-col justify-between">
      {/* Header */}
      <header className="border-b border-brand-charcoal/10 px-8 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif tracking-wider uppercase text-brand-charcoal">
            Aurel Table
          </h1>
          <p className="text-xs text-brand-stone uppercase tracking-widest mt-0.5">
            Dining & Epicurean Commerce
          </p>
        </div>
        <div className="flex items-center space-x-3 text-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-brand-stone font-medium">Platform Online</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-4xl mx-auto px-6 py-16 text-center flex flex-col items-center justify-center">
        <span className="text-xs uppercase tracking-widest text-brand-gold font-semibold mb-3">
          Omnichannel Gastronomy
        </span>
        <h2 className="text-4xl sm:text-5xl font-serif text-brand-charcoal leading-tight max-w-2xl">
          Crafted Dining, Thoughtful Delivery & Table Hospitality.
        </h2>
        <p className="text-brand-stone mt-4 max-w-lg leading-relaxed text-sm sm:text-base">
          Welcome to the Aurel customer storefront. This foundation powers our three fulfillment
          channels: Delivery, Pickup, and Dine-in.
        </p>

        {/* API Health Smoke Test Indicator */}
        <div className="mt-10 p-6 bg-white rounded-xl shadow-sm border border-brand-charcoal/10 w-full max-w-md text-left">
          <div className="flex items-center justify-between mb-3 border-b border-gray-100 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-stone">
              Backend API Connectivity
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                health?.status === 'ok'
                  ? 'bg-emerald-50 text-emerald-700'
                  : loading
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-rose-50 text-rose-700'
              }`}
            >
              {loading
                ? 'Probing...'
                : health?.status === 'ok'
                  ? 'Connected (PostgreSQL Active)'
                  : 'Offline / Standby'}
            </span>
          </div>

          {loading && (
            <p className="text-xs text-brand-stone">
              Testing connection to Core API (/api/v1/health)...
            </p>
          )}
          {error && (
            <p className="text-xs text-rose-600 bg-rose-50/50 p-2 rounded">
              Could not reach backend: {error} (Ensure NestJS API is booted on port 4000)
            </p>
          )}
          {health && (
            <div className="space-y-1 text-xs text-brand-charcoal">
              <div className="flex justify-between">
                <span className="text-brand-stone">Service:</span>
                <span className="font-mono">
                  {health.service} v{health.version}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-brand-stone">Database Probe:</span>
                <span className="font-mono text-emerald-600 font-semibold">
                  {health.checks.database}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-brand-stone">Uptime:</span>
                <span className="font-mono">{health.checks.uptimeSeconds}s</span>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-brand-charcoal/10 px-8 py-4 text-center text-xs text-brand-stone">
        Aurel Table &copy; 2026 &bull; High-Reliability Restaurant Commerce Platform
      </footer>
    </div>
  );
}
