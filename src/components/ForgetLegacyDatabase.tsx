"use client";

import { useEffect } from "react";

const LEGACY_DB = "chinese-reader";

/** Drop the pre-server IndexedDB library. The server is the only store. */
export function ForgetLegacyDatabase() {
  useEffect(() => {
    if (typeof indexedDB === "undefined") return;
    try {
      const request = indexedDB.deleteDatabase(LEGACY_DB);
      request.onerror = () => undefined;
      request.onblocked = () => undefined;
    } catch {
      /* ignore */
    }
  }, []);
  return null;
}
