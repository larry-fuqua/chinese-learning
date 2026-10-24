import { SESSION_COOKIE, authDecision } from "@/lib/auth";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ReaderLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const jar = await cookies();
  const decision = authDecision({
    authorization: headerList.get("authorization"),
    session: jar.get(SESSION_COOKIE)?.value ?? null,
  });
  if (decision === "deny") redirect("/login");
  return children;
}
