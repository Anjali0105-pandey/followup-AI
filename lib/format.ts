export function money(value: number | null | undefined, currency = "USD"): string {
  if (value == null) return "—";
  const opts: Intl.NumberFormatOptions = {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  };
  return new Intl.NumberFormat("en-US", opts).format(value);
}

/** Compact form for dense chips and column totals: $18K, $1.2M. */
export function moneyShort(value: number | null | undefined, currency = "USD"): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
