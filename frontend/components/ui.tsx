// Small, shared presentational pieces so every page looks consistent.

export const buttonStyles = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-ink-850 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40",
  ghost:
    "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-white/5 hover:text-white disabled:opacity-40",
};

export const inputStyles =
  "w-full rounded-lg border border-line bg-ink-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-rose-400";

type Tone = "neutral" | "green" | "amber" | "red" | "rose" | "blue";
const TONES: Record<Tone, string> = {
  neutral: "bg-white/5 text-zinc-300 ring-white/10",
  green: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20",
  amber: "bg-amber-400/10 text-amber-200 ring-amber-400/25",
  red: "bg-red-500/10 text-red-300 ring-red-500/25",
  rose: "bg-rose-500/10 text-rose-200 ring-rose-500/25",
  blue: "bg-sky-500/10 text-sky-300 ring-sky-500/20",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Card({ title, actions, children, className = "" }: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-line bg-ink-850/60 ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium tracking-wide text-rose-300/80 uppercase">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Page({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className={`mx-auto px-4 py-8 sm:px-8 ${wide ? "max-w-7xl" : "max-w-5xl"}`}>{children}</div>
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "red" }) {
  return (
    <div className="rounded-2xl border border-line bg-ink-850/60 p-5">
      <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tracking-tight ${tone === "red" ? "text-red-300" : "text-white"}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <p className="font-medium text-zinc-200">{title}</p>
      {children && <div className="mt-2 text-sm text-zinc-400">{children}</div>}
    </div>
  );
}

/** "3h ago" style relative time, rendered on the server. */
export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const steps: [number, string][] = [
    [60, "s"],
    [60, "m"],
    [24, "h"],
    [30, "d"],
    [12, "mo"],
  ];
  let value = seconds;
  for (const [size, unit] of steps) {
    if (value < size) return `${Math.floor(value)}${unit} ago`;
    value /= size;
  }
  return `${Math.floor(value)}y ago`;
}
