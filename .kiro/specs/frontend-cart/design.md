# Design Document

## Overview

`apps/frontend` entra al monorepo como una aplicación Vite + React + TypeScript con tres piezas y
nada más: un **cliente de API** que es el único que habla HTTP, un **store de Zustand** que guarda
el catálogo y las líneas del carrito, y una **pantalla** que compone catálogo y carrito.

La idea que gobierna el diseño es la misma del backend, girada hacia el cliente: **el frontend no
calcula descuentos**. Lo único que suma es el subtotal optimista del carrito, y es un producto de
enteros (`precioCentavos × cantidad`), que es la única aritmética de dinero que
`.kiro/steering/product-rules.md` autoriza en esta capa. Todo lo demás —cascada, redondeo, tope—
llega ya resuelto desde el backend en la entrega siguiente.

Lenguaje: TypeScript con `strict: true`. Cero `any`, cero assertions salvo `as const`. Pruebas por
ejemplo con Vitest y React Testing Library.

### Decisiones de alcance ya cerradas

| # | Decisión |
|---|----------|
| D1 | El carrito **no limita por stock**. Muestra el disponible pero deja superarlo: el rechazo del backend es un paso de la demo en vivo, y un tope en la UI lo haría indemostrable. |
| D2 | El subtotal es **optimista y local**. Esta entrega no llama a `preview`; el desglose llega con el cupón. |
| D3 | Vite resuelve `@core/shared` a las **fuentes** del paquete, no a `dist/`, para no encadenar un build antes de cada `dev`. |
| D4 | Una sola pantalla, **sin router**. |

## Architecture

```
    Pantalla (App)                       componentes tontos: leen del store y despachan
        │                                acciones. Cero fetch, cero aritmética de dinero.
        ├──► store/cart.store.ts         Zustand: catalog, items, acciones y el selector
        │        │                       puro del subtotal. Fuera de React.
        │        ▼
        └──► api/catalog.api.ts          único punto que invoca fetch. Devuelve tipos
                                         de @core/shared o lanza ApiClientError.
```

La flecha que importa es que **el store llama al cliente y los componentes no**. Eso es lo que
permite probar toda la lógica del carrito sin renderizar y, en el test de pantalla, sustituir el
cliente por un doble sin tocar componentes.

### Archivos

```
apps/frontend/
├── index.html
├── package.json
├── tsconfig.json               # extiende ../../tsconfig.base.json; ESM, bundler, DOM, JSX
├── vite.config.ts              # plugin react + alias + proxy /api + bloque `test` de Vitest
├── eslint.config.mjs
└── src/
    ├── main.tsx                # monta React. Excluido de cobertura: no tiene ramas
    ├── App.tsx                 # Pantalla_Carrito: catálogo + carrito + subtotal
    ├── App.spec.tsx
    ├── api/
    │   ├── catalog.api.ts      # fetchCatalog + ApiClientError
    │   └── catalog.api.spec.ts
    ├── store/
    │   ├── cart.store.ts       # store + selectSubtotalCents + selectCartLines
    │   └── cart.store.spec.ts
    └── test/setup.ts           # jest-dom
```

Tres archivos de producción con lógica y tres specs. No hay carpeta `components/` con un archivo por
botón: la pantalla es una tabla de catálogo y una tabla de carrito, y partirla en cinco componentes
para esta entrega sería estructura sin beneficio. Si la entrega del cupón la hace crecer, se parte
entonces.

### Configuración

`vite.config.ts` concentra las cuatro decisiones de infraestructura en un archivo:

```ts
export default defineConfig({
  plugins: [react()],
  resolve: {
    // D3: a las fuentes, no a dist/. `dev` no depende de un build previo de shared.
    alias: { '@core/shared': resolve(__dirname, '../../packages/shared/src/index.ts') },
  },
  server: {
    // El navegador pide /api al propio origen de Vite; nada de CORS.
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/test/**', '**/*.spec.{ts,tsx}'],
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
```

Vitest vive dentro de `vite.config.ts` y no en un `vitest.config.ts` aparte: un segundo archivo
sería un segundo sitio donde el alias y el entorno se desincronizan.

`tsconfig.json` extiende la base y sobrescribe **solo** lo que el navegador exige: `module: ESNext`,
`moduleResolution: bundler`, `lib: ["ES2022", "DOM", "DOM.Iterable"]`, `jsx: react-jsx` y
`noEmit: true`. `strict`, `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes` se heredan.

## Cliente de la API

```ts
// src/api/catalog.api.ts
export class ApiClientError extends Error {}

const GENERIC = 'No se pudo contactar con el servidor.';

/** Único punto de la app que invoca fetch (R2.1). */
export const fetchCatalog = async (): Promise<readonly Product[]> => {
  let response: Response;
  try {
    response = await fetch('/api/products');
  } catch {
    throw new ApiClientError(GENERIC);          // fallo de red
  }
  if (!response.ok) throw new ApiClientError(await messageFrom(response));
  return (await response.json()) as readonly Product[];
};
```

`messageFrom` intenta leer el cuerpo como `ApiError` y cae al mensaje genérico si no lo respeta o si
no es JSON. Es la única rama del módulo con dos caminos, y por eso tiene test.

> El `as` del `json()` es la excepción inevitable en la frontera de red: `Response.json()` devuelve
> `Promise<any>` y el proyecto prohíbe `any`. Se resuelve estrechando en un único punto y
> documentándolo, en lugar de propagar `any` hacia el store. Es el mismo criterio que
> `toProduct` aplicó en el backend sobre las filas de Prisma.

## Store del carrito

```ts
// src/store/cart.store.ts
interface CartState {
  readonly catalog: readonly Product[];
  /** productId → quantity. Sin precios: una sola copia del precio, la del catálogo (R3.2). */
  readonly items: Readonly<Record<string, number>>;
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly errorMessage: string | null;

  loadCatalog(): Promise<void>;
  add(productId: string): void;
  decrement(productId: string): void;
  remove(productId: string): void;
}
```

**Por qué el store no guarda precios.** Si la línea llevara su propio `priceCents`, existirían dos
copias del precio —la del catálogo y la del carrito— que pueden divergir en cuanto el catálogo se
recargue tras un checkout. Guardando solo `productId` y `quantity`, el precio tiene una sola fuente.

Tres reglas de las acciones, que son las ramas que se prueban:

| acción | producto ausente | producto presente |
|---|---|---|
| `add` | crea la línea con cantidad `1` | incrementa en `1` |
| `decrement` | no hace nada | resta `1`; **si llega a `0`, elimina la línea** |
| `remove` | no hace nada | elimina la línea entera |

`decrement` elimina en lugar de dejar una línea en cero porque una línea con cantidad `0` no es un
estado que la UI deba saber pintar, y sería una fuente permanente de `if (quantity > 0)` repartidos.

**`add` no consulta el stock** (D1). El carrito puede exceder el disponible, y eso es lo que permite
demostrar en vivo el `409` del backend en la entrega siguiente.

### Selectores

```ts
/** Suma de productos de enteros. Sin redondeo, sin float, sin toFixed (R4.1). */
export const selectSubtotalCents = (state: CartState): number =>
  selectCartLines(state).reduce((acc, l) => acc + l.product.priceCents * l.quantity, 0);
```

Derivado en cada lectura, nunca almacenado (R4.2): un campo `subtotalCents` en el estado sería un
segundo lugar que mantener sincronizado con `items`, y el primer bug sería un subtotal viejo tras
un `remove`.

`selectCartLines` une `items` con `catalog` y descarta los identificadores que el catálogo no
conoce, de modo que un carrito que sobrevive a un cambio de catálogo no rompe el render. Carrito
vacío devuelve `[]` y el subtotal `0` sin caso especial: `reduce` con acumulador inicial `0` ya lo
cubre.

## Pantalla

`App.tsx` compone dos bloques y no contiene aritmética de dinero: lee del store y formatea con
`formatCents`.

- **Catálogo**: nombre, categoría vía `CATEGORY_LABEL` —la tilde vive ahí, nunca en el literal—,
  precio formateado, stock y un botón de agregar.
- **Carrito**: por línea, nombre, cantidad, total de línea formateado y los controles `+`, `−` y
  quitar. Al pie, el subtotal.
- **Estados**: `loading` mientras se pide el catálogo, `error` con el mensaje del `ApiClientError`,
  y un texto explícito cuando el carrito está vacío en lugar de una tabla sin filas.

`loadCatalog` se dispara desde un `useEffect` en el montaje. Es la única llamada a la API de la
entrega.

## Testing Strategy

Todo por ejemplo. Tres specs, alineados con las tres piezas.

**`cart.store.spec.ts`** — sin renderizar React, sobre el store directamente:

| bloque | casos |
|---|---|
| `add` | producto ausente → cantidad `1`; producto presente → incrementa |
| `decrement` | de `2` a `1`; de `1` a `0` → **la línea desaparece**; producto ausente → no hace nada |
| `remove` | línea con cantidad `3` → desaparece entera |
| `selectSubtotalCents` | carrito vacío → `0`; una línea; varias líneas; cantidad mayor a `1` |
| stock | agregar `PROD-005` seis veces con stock `3` → cantidad `6` y subtotal `35400`, sin error |

Los montos salen del catálogo canónico y se verifican a mano: `PROD-005` a `5900` × 6 = `35400`.

**`catalog.api.spec.ts`** — con `fetch` doblado: respuesta `200` devuelve los productos tipados;
respuesta `500` con cuerpo `ApiError` usa su mensaje; respuesta no-JSON y fallo de red caen al
mensaje genérico.

**`App.spec.tsx`** — React Testing Library con el cliente doblado: el catálogo se renderiza; hacer
clic en agregar actualiza el subtotal **visible en pantalla**; el carrito vacío muestra su mensaje;
un fallo del catálogo muestra el mensaje del error.

Probar el subtotal en pantalla y no solo en el selector es deliberado: es lo que verifica que la UI
pinta el entero que el selector devuelve, sin reformatearlo por su cuenta.

**Cobertura.** Umbral del 80% en líneas y ramas, rompiendo el comando. `main.tsx` queda excluido por
ser el montaje y no tener ramas.

## Invariantes verificados

| # | invariante | verificado por |
|---|---|---|
| I1 | Una línea nunca queda con cantidad `0`: `decrement` elimina | `cart.store.spec.ts` |
| I2 | El precio tiene una sola fuente: el store guarda `productId` y `quantity`, nunca montos | **estructural** — el tipo de `items` es `Record<string, number>` |
| I3 | El subtotal es suma de productos de enteros, sin redondeo ni float | `cart.store.spec.ts`, con montos verificables a mano |
| I4 | El subtotal se deriva, no se almacena: no puede quedar obsoleto | **estructural** — no existe el campo |
| I5 | Superar el stock es un estado válido del carrito | `cart.store.spec.ts` |
| I6 | La UI pinta el entero del selector sin reformatearlo | `App.spec.tsx`, sobre el texto renderizado |
| I7 | Ningún componente invoca `fetch` | **estructural** — un solo módulo lo importa |

I2, I4 e I7 no llevan prueba porque son ausencias, no comportamientos: no hay campo de precio en la
línea, no hay campo de subtotal en el estado, y no hay segundo módulo con `fetch`. Probarlas
exigiría afirmar que algo no existe, que es lo que el tipo y la estructura ya garantizan.
