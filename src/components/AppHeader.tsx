import Link from "next/link";

export function AppHeader({
  title,
  right,
}: {
  title?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[color-mix(in_oklab,var(--color-ink)_12%,transparent)] px-4 py-3 sm:px-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="seal px-2 py-1 text-xs font-semibold">
          读
        </Link>
        <div>
          <p className="font-[family-name:var(--font-sans)] text-[11px] uppercase tracking-[0.22em] text-ink-soft">
            Pronunciation reader
          </p>
          <h1 className="hanzi text-xl leading-tight">{title ?? "课文"}</h1>
        </div>
      </div>
      <div className="flex items-center gap-2">{right}</div>
    </header>
  );
}
