import { computeOrderTotals, priceLine, roundHalfUp } from '../../app/services/pricing.service';

describe('pricing.service', () => {
  describe('roundHalfUp', () => {
    it('rounds .5 up', () => {
      expect(roundHalfUp(2.5)).toBe(3);
      expect(roundHalfUp(0.5)).toBe(1);
    });

    it('rounds below .5 down', () => {
      expect(roundHalfUp(2.4)).toBe(2);
    });
  });

  describe('priceLine', () => {
    it('prices a line without tax', () => {
      const line = priceLine({ quantity: 2, priceCents: 500, taxRateBps: 0 });
      expect(line).toEqual({ lineSubtotalCents: 1000, lineTaxCents: 0, lineTotalCents: 1000 });
    });

    it('applies tax in basis points with half-up rounding', () => {
      const line = priceLine({ quantity: 1, priceCents: 333, taxRateBps: 800 });
      expect(line.lineSubtotalCents).toBe(333);
      expect(line.lineTaxCents).toBe(27);
      expect(line.lineTotalCents).toBe(360);
    });
  });

  describe('computeOrderTotals', () => {
    const lines = [
      { quantity: 2, priceCents: 1000, taxRateBps: 800 },
      { quantity: 1, priceCents: 350, taxRateBps: 0 },
    ];

    it('computes subtotal, tax, discount, total and change', () => {
      const result = computeOrderTotals(lines, 100, 2500);

      expect(result.subtotalCents).toBe(2350);
      expect(result.taxCents).toBe(160);
      expect(result.discountCents).toBe(100);
      expect(result.totalCents).toBe(2410);
      expect(result.paidCents).toBe(2500);
      expect(result.changeCents).toBe(90);
    });

    it('rejects payments below the total', () => {
      expect(() => computeOrderTotals(lines, 0, 100)).toThrow('Payments do not cover the order total');
    });

    it('rejects discounts above the subtotal', () => {
      expect(() => computeOrderTotals(lines, 99999, 99999)).toThrow('Discount cannot exceed subtotal');
    });

    it('handles zero discount exactly covering the total', () => {
      const result = computeOrderTotals(lines, 0, 2510);
      expect(result.changeCents).toBe(0);
    });
  });
});
