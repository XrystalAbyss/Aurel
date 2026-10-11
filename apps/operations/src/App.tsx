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
    <div className="min-h-screen bg-ops-dark flex flex-col font-sans">
      {/* Top Operations Bar */}
      <header className="bg-ops-card border-b border-ops-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 bg-ops-accent rounded-sm"></span>
            <h1 className="text-lg font-bold tracking-wide text-ops-text">Aurel Operations</h1>
          </div>
          <span className="text-xs px-2 py-0.5 rounded bg-ops-border text-ops-muted font-mono">
            Location: Central Kitchen #1
          </span>
        </div>

        <div className="flex items-center space-x-6 text-xs">
          <div className="flex items-center space-x-2">
            <span
              className={`w-2 h-2 rounded-full ${
                health?.status === 'ok' ? 'bg-ops-emerald animate-pulse' : 'bg-ops-amber'
              }`}
            ></span>
            <span className="text-ops-muted">
              API Bridge:{' '}
              <strong className="text-ops-text">
                {loading
                  ? 'Probing...'
                  : health?.status === 'ok'
                    ? 'Connected'
                    : 'Degraded / Offline'}
              </strong>
            </span>
          </div>
          <span className="text-ops-muted">Timezone: Asia/Kolkata (IST)</span>
        </div>
      </header>

      {/* Main Workspace Grid Shell */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        {/* Metric Cards Row */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-ops-card border border-ops-border p-4 rounded-lg">
            <span className="text-xs uppercase tracking-wider text-ops-muted font-medium">
              Core API Status
            </span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono text-ops-text">
                {loading ? '...' : health?.status === 'ok' ? '200 OK' : 'OFFLINE'}
              </span>
              <span className="text-xs text-ops-emerald font-semibold font-mono">
                {health?.checks.database === 'connected' ? 'DB Active' : 'DB Wait'}
              </span>
            </div>
          </div>

          <div className="bg-ops-card border border-ops-border p-4 rounded-lg">
            <span className="text-xs uppercase tracking-wider text-ops-muted font-medium">
              Kitchen Display
            </span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono text-ops-text">Standby</span>
              <span className="text-xs text-ops-muted font-mono">Milestone P1</span>
            </div>
          </div>

          <div className="bg-ops-card border border-ops-border p-4 rounded-lg">
            <span className="text-xs uppercase tracking-wider text-ops-muted font-medium">
              Active Dining Tables
            </span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono text-ops-text">0 / 12</span>
              <span className="text-xs text-ops-muted font-mono">Vacant</span>
            </div>
          </div>

          <div className="bg-ops-card border border-ops-border p-4 rounded-lg">
            <span className="text-xs uppercase tracking-wider text-ops-muted font-medium">
              Uptime / Heartbeat
            </span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono text-ops-text">
                {health ? `${health.checks.uptimeSeconds}s` : '0s'}
              </span>
              <span className="text-xs text-ops-accent font-mono">PostgreSQL 16</span>
            </div>
          </div>
        </div>

        {/* Dashboard Placeholder Shell */}
        <div className="bg-ops-card border border-ops-border rounded-lg p-6">
          <div className="flex items-center justify-between border-b border-ops-border pb-4 mb-4">
            <div>
              <h2 className="text-base font-semibold text-ops-text">
                Operations Foundation & Health Diagnostic
              </h2>
              <p className="text-xs text-ops-muted mt-1">
                Monorepo workspace initialized. Ready for domain module integration in upcoming
                milestones.
              </p>
            </div>
            <span className="text-xs bg-ops-border text-ops-accent px-2.5 py-1 rounded font-mono font-medium">
              Vite + React 18 + Tailwind
            </span>
          </div>

          {error && (
            <div className="p-3 mb-4 bg-ops-rose/10 border border-ops-rose/30 text-ops-rose text-xs rounded">
              Backend Connection Warning: {error}. Boot the NestJS API server on port 4000 to
              complete handshake.
            </div>
          )}

          {health && (
            <div className="space-y-2 text-xs font-mono bg-ops-dark p-4 rounded border border-ops-border">
              <p className="text-ops-emerald">// Core Handshake Confirmed:</p>
              <p className="text-ops-muted">
                Service ID: <span className="text-ops-text">{health.service}</span>
              </p>
              <p className="text-ops-muted">
                Version: <span className="text-ops-text">v{health.version}</span>
              </p>
              <p className="text-ops-muted">
                Timestamp: <span className="text-ops-text">{health.timestamp}</span>
              </p>
              <p className="text-ops-muted">
                Storage Layer: <span className="text-ops-emerald">{health.checks.database}</span>
              </p>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-ops-card border-t border-ops-border px-6 py-3 text-xs text-ops-muted flex justify-between">
        <span>Aurel Operations Workspace &bull; v1.0.0-foundation</span>
        <span>Engineering Mode &bull; PostgreSQL 16 Verified</span>
      </footer>
    </div>
  );
}
