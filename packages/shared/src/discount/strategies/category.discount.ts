import { applyBps, toMicros } from '../../money/micro';
import { notApplied } from '../discount.types';
import type { DiscountContext, DiscountResult, DiscountStrategy } from '../discount.types';

/** Categoria objetivo. Literal SIN TILDE: ver el comentario de isApplicable. */
const TARGET_CATEGORY = 'Tecnologia';

/** 10% sobre los productos de categoria Tecnologia (DE-R1.3, DE-R1.4). */
export class CategoryDiscount implements DiscountStrategy {
  readonly name = 'CATEGORY' as const;
  readonly order = 1;
  readonly rateBps = 1000;

  /**
   * La comparacion es contra el LITERAL 'Tecnologia', nunca contra
   * CATEGORY_LABEL.Tecnologia ('Tecnología', con tilde). Comparar contra la
   * etiqueta no daria error: simplemente el descuento dejaria de aplicarse, en
   * silencio y sin que ningun test obvio lo detecte (MF-R2.5).
   */
  isApplicable(ctx: DiscountContext): boolean {
    return ctx.lines.some((line) => line.category === TARGET_CATEGORY);
  }

  apply(ctx: DiscountContext): DiscountResult {
    if (!this.isApplicable(ctx)) return notApplied(this.name);

    const baseCents = ctx.lines
      .filter((line) => line.category === TARGET_CATEGORY)
      .reduce((acc, line) => acc + line.priceCents * line.quantity, 0);

    const baseAmountMicros = toMicros(baseCents);

    return {
      name: this.name,
      applied: true,
      rateBps: this.rateBps,
      baseAmountMicros,
      discountMicros: applyBps(baseAmountMicros, this.rateBps),
    };
  }
}
