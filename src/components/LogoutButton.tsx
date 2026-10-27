"use client";

import { apiFetch } from "@/lib/api-fetch";
import { apiUrl } from "@/lib/base-path";

export function LogoutButton() {
  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    window.location.assign(apiUrl("/login"));
  }

  return (
    <button
      type="button"
      onClick={() => void logout()}
      className="rounded-full border border-[color-mix(in_oklab,var(--color-ink)_16%,transparent)] px-3 py-1.5 font-[family-name:var(--font-sans)] text-sm"
    >
      Log out
    </button>
  );
}
