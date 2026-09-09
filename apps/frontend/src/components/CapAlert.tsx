import { useCartStore } from '../store/cart.store';

/**
 * Alerta_Tope: la notificacion del limite maximo de ahorro (FK-R4.1 - FK-R4.4).
 *
 * El componente mas simple de la pantalla y el mas facil de equivocar. Tres decisiones
 * deliberadas, cada una contra una forma concreta de romperlo:
 *
 * 1. **La condicion es `capApplied` y nada mas** (FK-R4.1, FK-R4.4). No se compara
 *    `totalSavingsCents` con `capCents` ni `effectiveDiscountBps` con `3500`, porque un
 *    descuento de exactamente el 35% **no** dispara la alerta y ninguna de esas dos
 *    derivaciones sabe distinguir ese caso del truncamiento: en ambos el ahorro vale lo
 *    mismo. La diferencia esta en si hubo recorte, y eso solo lo sabe el backend, que lo
 *    decide con `rawDiscountCents > capCents` y lo envia resuelto en la respuesta.
 * 2. **El texto es una constante con la redaccion exacta** de `product-rules.md`
 *    (FK-R4.2). Interpolar el `35%` desde `capCents` o desde el tope en puntos basicos
 *    seria una segunda fuente para un texto que ya es literal, y la prueba lo afirma
 *    caracter por caracter.
 * 3. **Sin temporizador y sin boton de cerrar** (FK-R4.3). "Persistente" significa que la
 *    alerta vive exactamente mientras la condicion se cumpla: aparece cuando `capApplied`
 *    pasa a `true` y desaparece cuando el desglose deja de reportarlo. Un cierre manual
 *    dejaria la condicion activa y la senal oculta.
 *
 * `role="alert"` para que un lector de pantalla la anuncie al aparecer, y `<strong>` para
 * que sea visualmente distintiva sin depender de hojas de estilo que esta app no tiene.
 *
 * Se suscribe solo a `totals`, que cambia de identidad unicamente cuando el store hace
 * `set`: teclear el cupon o recargar el catalogo no vuelve a renderizar la alerta.
 */

/**
 * Redaccion canonica de `product-rules.md`, sin variaciones (FK-R4.2). Es contrato de UI:
 * se declara una sola vez y no se compone en el punto de uso.
 */
export const CAP_ALERT_TEXT =
  '¡Enhorabuena! Has alcanzado el límite máximo de ahorro permitido (35%)';

export const CapAlert = (): JSX.Element | null => {
  const totals = useCartStore((state) => state.totals);

  // Sin desglose no hay nada que anunciar; con desglose, manda `capApplied` (FK-R4.1).
  if (totals === null || !totals.capApplied) {
    return null;
  }

  return (
    <p role="alert" data-testid="cap-alert">
      <strong>{CAP_ALERT_TEXT}</strong>
    </p>
  );
};
