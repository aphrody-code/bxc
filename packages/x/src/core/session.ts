// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface XSessionData {
  auth_token: string;
  ct0: string;
  handle?: string;
  transaction_id?: string;
}

export class XSession implements XSessionData {
  public auth_token: string;
  public ct0: string;
  public handle?: string;
  public transaction_id?: string;
  public filePath?: string;

  constructor(data: XSessionData) {
    this.auth_token = data.auth_token;
    this.ct0 = data.ct0;
    this.handle = data.handle;
    this.transaction_id = data.transaction_id;
    this.validate();
  }

  /** Load credentials from ~/.aphrody/x-session.json */
  public static load(): XSession {
    const home = homedir();
    if (!home) {
      throw new Error("Cannot determine home directory");
    }
    const path = join(home, ".aphrody", "x-session.json");
    if (!existsSync(path)) {
      throw new Error(`Session file not found at ${path}`);
    }
    try {
      const raw = readFileSync(path, "utf-8");
      const data = JSON.parse(raw) as XSessionData;
      const session = new XSession(data);
      session.filePath = path;
      return session;
    } catch (e: any) {
      throw new Error(`Failed to load session file ${path}: ${e.message}`);
    }
  }

  /** Save the updated session back to disk using Bun.write */
  public async save(): Promise<void> {
    if (!this.filePath) return;
    const raw = JSON.stringify(
      {
        auth_token: this.auth_token,
        ct0: this.ct0,
        handle: this.handle,
        transaction_id: this.transaction_id,
      },
      null,
      2
    ) + "\n";
    await Bun.write(this.filePath, raw);
  }

  /** Load credentials from environment variables X_AUTH_TOKEN and X_CT0 */
  public static fromEnv(): XSession {
    const auth_token = process.env.X_AUTH_TOKEN;
    const ct0 = process.env.X_CT0;
    if (!auth_token || !ct0) {
      throw new Error("X_AUTH_TOKEN and X_CT0 env vars must be set");
    }
    return new XSession({
      auth_token,
      ct0,
      handle: process.env.X_HANDLE,
      transaction_id: process.env.X_TRANSACTION_ID,
    });
  }

  /** Try loading from file first, then environment */
  public static loadOrEnv(): XSession {
    try {
      return XSession.load();
    } catch {
      return XSession.fromEnv();
    }
  }

  /** Parse from cookie string, e.g. "auth_token=abc; ct0=xyz" */
  public static fromCookieString(str: string): XSession {
    let auth_token: string | undefined;
    let ct0: string | undefined;
    for (const part of str.split(";")) {
      const [key, val] = part.split("=").map((s) => s.trim());
      if (key === "auth_token") {
        auth_token = val;
      } else if (key === "ct0") {
        ct0 = val;
      }
    }
    if (!auth_token || !ct0) {
      throw new Error("Cookie string must contain both auth_token and ct0");
    }
    return new XSession({ auth_token, ct0 });
  }

  /** Format as cookie header value */
  public cookieHeader(): string {
    return `auth_token=${this.auth_token}; ct0=${this.ct0}`;
  }

  private validate(): void {
    if (!this.auth_token) {
      throw new Error("auth_token is empty");
    }
    if (!this.ct0) {
      throw new Error("ct0 is empty");
    }
  }
}
