import { SESSION_COOKIE, authDecision } from "@/lib/auth";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const headerList = await headers();
  const jar = await cookies();
  if (
    authDecision({
      authorization: headerList.get("authorization"),
      session: jar.get(SESSION_COOKIE)?.value ?? null,
    }) === "allow"
  ) {
    redirect("/");
  }
  const { next } = await searchParams;
  return <LoginForm nextPath={next ?? ""} />;
}
