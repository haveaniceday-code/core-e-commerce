import { useCartStore } from '../store/cart.store';

/**
 * Cupon: campo de codigo y accion de aplicar (FK-R2.2, FK-R3.5).
 *
 * Es el componente que hace visible la separacion entre el **borrador** y el **aplicado**.
 * El campo esta enlazado a `couponDraft`, asi que teclear solo actualiza texto: ninguna
 * tecla llega a la red. La peticion del desglose la dispara `applyCoupon`, que promueve el
 * borrador a `appliedCoupon`. HU 2 dice "ingresar el codigo y presionar Aplicar", y esta es
 * literalmente esa frase repartida en dos campos del store.
 *
 * **No valida el codigo.** Un cupon desconocido o expirado no es un error (D4 / FK-R2.6):
 * el backend responde `200` con la linea `COUPON` en `applied: false`, y esa linea del
 * desglose es la senal. Validar aqui obligaria a copiar el catalogo de cupones en el
 * cliente, que seria lo primero que se desincroniza.
 *
 * Se suscribe solo a `couponDraft` —una cadena, referencia estable— y no al estado
 * completo: un cambio en el carrito no tiene por que volver a renderizar este campo.
 */

/** Se invocan unidas a su store, nunca desligadas (`@typescript-eslint/unbound-method`). */
const setCouponDraft = (value: string): void => {
  useCartStore.getState().setCouponDraft(value);
};

const applyCoupon = (): void => {
  useCartStore.getState().applyCoupon();
};

export const CouponInput = (): JSX.Element => {
  const couponDraft = useCartStore((state) => state.couponDraft);

  return (
    <section aria-labelledby="cupon-titulo">
      <h2 id="cupon-titulo">Cupón</h2>

      {/*
        `<label htmlFor>` en lugar de `aria-label` porque aqui el texto tambien es la
        instruccion visible del campo, y un `placeholder` no es un nombre accesible: el
        que lleva el campo es un ejemplo del formato, no su nombre.
      */}
      <div className="cupon__campo">
        <label htmlFor="cupon-codigo">Código de cupón</label>
        <input
          id="cupon-codigo"
          name="cupon-codigo"
          type="text"
          autoComplete="off"
          placeholder="WELCOME2026"
          value={couponDraft}
          onChange={(event) => {
            setCouponDraft(event.target.value);
          }}
        />

        {/*
          Sin `disabled` cuando el campo esta vacio: aplicar en blanco es la via para
          **retirar** un cupon ya aplicado, y el store resuelve el borrador vacio a "sin
          cupon". Deshabilitarlo dejaria al usuario sin forma de deshacer.
        */}
        <button
          type="button"
          className="boton--primario"
          onClick={() => {
            applyCoupon();
          }}
        >
          Aplicar
        </button>
      </div>
    </section>
  );
};
