export type PricingLineInput = {
  quantity: number;
  priceCents: number;
  taxRateBps: number;
};

export type PricingLineResult = {
  lineSubtotalCents: number;
  lineTaxCents: number;
  lineTotalCents: number;
};

export type PricingResult = {
  lines: PricingLineResult[];
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
};

export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export function priceLine(line: PricingLineInput): PricingLineResult {
  const lineSubtotalCents = line.priceCents * line.quantity;
  const lineTaxCents = roundHalfUp((lineSubtotalCents * line.taxRateBps) / 10000);

  return {
    lineSubtotalCents,
    lineTaxCents,
    lineTotalCents: lineSubtotalCents + lineTaxCents,
  };
}

export function computeOrderTotals(
  lines: PricingLineInput[],
  discountCents: number,
  paidCents: number,
): PricingResult & { paidCents: number; changeCents: number } {
  const priced = lines.map(priceLine);

  const subtotalCents = priced.reduce((sum, line) => sum + line.lineSubtotalCents, 0);
  const taxCents = priced.reduce((sum, line) => sum + line.lineTaxCents, 0);

  if (discountCents > subtotalCents) {
    throw new Error('Discount cannot exceed subtotal');
  }

  const totalCents = subtotalCents + taxCents - discountCents;

  if (paidCents < totalCents) {
    throw new Error('Payments do not cover the order total');
  }

  return {
    lines: priced,
    subtotalCents,
    taxCents,
    discountCents,
    totalCents,
    paidCents,
    changeCents: paidCents - totalCents,
  };
}
