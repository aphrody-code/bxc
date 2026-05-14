/**
 * Re-export of Puppeteer's `ConnectionTransport` interface so our internal
 * modules can import it without depending on the puppeteer-core package at
 * type-check time (puppeteer-core is a peerDependency, not a devDependency).
 *
 * This must stay structurally compatible with:
 *   puppeteer-core/src/common/ConnectionTransport.ts
 */

/** @public */
export interface ConnectionTransport {
  send(message: string): void;
  close(): void;
  onmessage?: (message: string) => void;
  onclose?: () => void;
}
