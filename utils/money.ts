export function centsToDollars(cents: number): number {
  return cents / 100;
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function formatCurrency(cents: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatCompactCurrency(cents: number): string {
  const abs = Math.abs(cents);
  if (abs >= 1_000_000_00) return `${(cents / 1_000_000_00).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(cents / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000_00) return `${(cents / 1_000_00).toFixed(1)}K`;
  return formatCurrency(cents);
}

export function roundHalfUp(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}