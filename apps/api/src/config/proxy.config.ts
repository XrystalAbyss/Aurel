import { INestApplication, Logger } from '@nestjs/common';

const logger = new Logger('ProxyConfig');

/**
 * Configures Express's reverse proxy trust policy at the application framework boundary.
 *
 * Security Model:
 * 1. Default (trustProxy === false):
 *    - Express `trust proxy` is set to `false`.
 *    - Express derives `req.ip` exclusively from the direct TCP socket connection (`req.socket.remoteAddress`).
 *    - Any client-supplied `X-Forwarded-*` headers are completely ignored.
 *    - Safe for direct-to-internet deployments, container-internal networking, or development without reverse proxies.
 *
 * 2. Enabled (trustProxy === true):
 *    - Express `trust proxy` is set to `1` (1 hop).
 *    - Trusts the immediate front-facing reverse proxy directly in front of the Node.js application (e.g. AWS ALB, Nginx, Cloudflare, Traefik).
 *    - Express parses `X-Forwarded-For` from right-to-left: the client IP recorded by the 1 trusted reverse proxy is extracted as `req.ip`.
 *    - An unrestricted client cannot spoof its client IP by prefixing `X-Forwarded-For` values because Express does not trust further upstream hops.
 *
 * Operational Requirement for Production:
 * - When `TRUST_PROXY=true` is enabled, the external reverse proxy (e.g. Nginx/ALB) MUST sanitize client-submitted
 *   `X-Forwarded-For` headers by overwriting or cleanly appending the client's actual TCP connection address.
 * - Enabling `TRUST_PROXY=true` when the application is directly exposed to untrusted network traffic allows attackers
 *   to spoof client IPs.
 */
export function configureTrustProxy(app: INestApplication, trustProxy: boolean): void {
  const expressApp = app.getHttpAdapter().getInstance();

  if (trustProxy) {
    // Trust 1 hop (the immediate upstream reverse proxy)
    expressApp.set('trust proxy', 1);
    logger.log('Reverse proxy trust enabled: Express configured with trust proxy = 1 hop.');
  } else {
    expressApp.set('trust proxy', false);
    logger.log('Reverse proxy trust disabled: client IP derived from socket connection.');
  }
}
