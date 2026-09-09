# Implementation Plan: frontend-cart

## Overview

Tres piezas y su andamiaje: el workspace de Vite, el cliente de la API, el store de Zustand con su
selector, y la pantalla que los compone. Se construye de dentro hacia afuera —cliente, estado,
pantalla— para que la lógica del carrito quede probada sin renderizar antes de que exista ningún
componente.

Lenguaje: TypeScript con `strict: true`. Cero `any`, cero assertions salvo `as const` y la única
excepción documentada de la frontera de red. Todas las pruebas son **por ejemplo**, con casos fijos
y montos verificables a mano.

## Tasks

- [x] 1. Andamiaje del workspace `apps/frontend`
  - [x] 1.1 Crear la configuración base
    - `package.json` con nombre `@core/frontend`, versiones exactas, dependencia de `@core/shared`, y los scripts `dev`, `build`, `typecheck`, `lint`, `test`, `test:cov`
    - `tsconfig.json` que extiende `../../tsconfig.base.json` sobrescribiendo **solo** lo que el navegador exige: `module: ESNext`, `moduleResolution: bundler`, `lib: ["ES2022","DOM","DOM.Iterable"]`, `jsx: react-jsx`, `noEmit: true`
    - `eslint.config.mjs` alineado con el resto de workspaces
    - `index.html` y `src/main.tsx` mínimos
    - _Requisitos: FC-R1.1, FC-R1.2, FC-R1.5_

  - [x] 1.2 Escribir `vite.config.ts` con alias, proxy y Vitest
    - `plugins: [react()]`
    - `resolve.alias` de `@core/shared` a `packages/shared/src/index.ts`: a las **fuentes**, para que `dev` no dependa de un build previo del paquete
    - `server.proxy` de `/api` a `http://localhost:3000`, de modo que el navegador no emita peticiones de origen cruzado
    - Bloque `test` en el mismo archivo —no un `vitest.config.ts` aparte—: `environment: 'jsdom'`, `setupFiles`, cobertura v8 con `thresholds` de `80` en líneas y ramas, excluyendo `src/main.tsx` y los specs
    - `src/test/setup.ts` con `@testing-library/jest-dom`
    - _Requisitos: FC-R1.3, FC-R1.4, FC-R6.1, FC-R6.6_

- [x] 2. Cliente de la API
  - [x] 2.1 Implementar `src/api/catalog.api.ts`
    - `ApiClientError` y `fetchCatalog(): Promise<readonly Product[]>` contra `GET /api/products`
    - `messageFrom(response)`: toma el mensaje del cuerpo cuando respeta la forma `ApiError`, y cae a un mensaje genérico si no lo respeta o si no es JSON
    - Fallo de red y respuesta no satisfactoria producen el mismo error tipado
    - Es el **único** módulo de la app que invoca `fetch`; documentar en el archivo la excepción de assertion en `response.json()`, que es la frontera de red
    - _Requisitos: FC-R2.1, FC-R2.2, FC-R2.3_

  - [x] 2.2 Escribir `src/api/catalog.api.spec.ts`
    - Con `fetch` doblado: `200` devuelve los productos tipados; `500` con cuerpo `ApiError` usa su mensaje; cuerpo no-JSON y fallo de red caen al mensaje genérico
    - _Requisitos: FC-R6.1_

- [x] 3. Estado del carrito
  - [x] 3.1 Implementar `src/store/cart.store.ts`
    - Store de Zustand fuera de los componentes con `catalog`, `items` (`Record<string, number>`), `status` y `errorMessage`; estado inicial vacío
    - `loadCatalog()` delega en el Cliente_Api y traduce el fallo a `status: 'error'` con su mensaje
    - `add`: crea la línea con cantidad `1` o incrementa en `1`. **No consulta el stock**: superarlo es un estado válido y su rechazo es del backend
    - `decrement`: resta `1` y **elimina la línea al llegar a `0`**, para que no exista una línea con cantidad cero que la UI tenga que saber pintar
    - `remove`: elimina la línea entera
    - Sin precios en las líneas: el precio se resuelve contra el catálogo, para que no haya dos copias que puedan divergir
    - `selectCartLines` une `items` con `catalog` descartando identificadores que el catálogo no conoce, y `selectSubtotalCents` suma `priceCents × quantity`: producto de enteros, sin redondeo, sin float, derivado en cada lectura y nunca almacenado
    - _Requisitos: FC-R3.1, FC-R3.2, FC-R3.3, FC-R3.4, FC-R3.5, FC-R3.6, FC-R4.1, FC-R4.2, FC-R4.3_

  - [x] 3.2 Escribir `src/store/cart.store.spec.ts`
    - `add`: producto ausente → cantidad `1`; producto presente → incrementa
    - `decrement`: de `2` a `1`; de `1` a `0` → la línea desaparece; producto ausente → no hace nada
    - `remove`: línea con cantidad `3` → desaparece entera
    - `selectSubtotalCents`: carrito vacío → `0`; una línea; varias líneas; cantidad mayor a `1`
    - Stock superado: agregar `PROD-005` seis veces con stock `3` → cantidad `6` y subtotal `35400` (`5900 × 6`), sin error
    - Montos del catálogo canónico, verificables a mano
    - _Requisitos: FC-R6.2, FC-R6.3, FC-R6.4_

- [x] 4. Pantalla
  - [x] 4.1 Implementar `src/App.tsx`
    - Catálogo: nombre, categoría vía `CATEGORY_LABEL` —con tilde—, precio formateado, stock y acción de agregar
    - Carrito: por línea, nombre, cantidad, total de línea formateado y controles `+`, `−` y quitar; al pie, el subtotal
    - Estados de `loading` y `error` del catálogo, y mensaje explícito cuando el carrito está vacío en lugar de una tabla sin filas
    - Todo monto se formatea con `formatCents` de `@core/shared`. **Prohibido `toFixed`** y cualquier aritmética de dinero en el componente
    - `loadCatalog` se dispara desde un `useEffect` en el montaje
    - _Requisitos: FC-R4.4, FC-R5.1, FC-R5.2, FC-R5.3, FC-R5.4, FC-R5.5, FC-R5.6_

  - [x] 4.2 Escribir `src/App.spec.tsx`
    - Con React Testing Library y el Cliente_Api doblado: el catálogo se renderiza; hacer clic en agregar actualiza el **subtotal visible en pantalla**; el carrito vacío muestra su mensaje; un fallo del catálogo muestra el mensaje del error
    - Afirmar sobre el texto renderizado y no sobre el estado: es lo que verifica que la UI pinta el entero del selector sin reformatearlo
    - _Requisitos: FC-R6.5_

- [x] 5. Checkpoint final - Umbral de cobertura y scripts de la raíz
  - Ejecutar `npm run typecheck`, `npm run lint` y `npm run test:cov` en la raíz, verificando que los tres workspaces pasan y que el umbral del 80% en líneas y ramas se cumple en `apps/frontend`
  - Levantar el backend y la app y comprobar a mano que el catálogo carga por el proxy y que agregar y quitar mueve el subtotal
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- **Ninguna subtarea es opcional.** Lo que quedó en el plan o entrega la pantalla o sostiene el
  umbral del 80%.
- Tres archivos de producción con lógica y tres specs. No hay carpeta `components/` con un archivo
  por botón: la pantalla es una tabla de catálogo y una de carrito, y partirla ahora sería
  estructura sin beneficio. Si la entrega del cupón la hace crecer, se parte entonces.
- Vitest se configura dentro de `vite.config.ts`. Un `vitest.config.ts` aparte sería un segundo
  sitio donde el alias y el entorno se desincronizan.
- Verificaciones que deliberadamente **no** son tests: que el store no guarde precios (lo garantiza
  el tipo `Record<string, number>`), que el subtotal no se almacene (no existe el campo) y que
  ningún componente invoque `fetch` (un solo módulo lo importa). Son ausencias, no comportamientos.
- Fuera de alcance y sin tarea: el cupón, el desglose de descuentos, la alerta del 35% y
  `POST /api/checkout`. Esta entrega no llama a `preview`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1"] },
    { "id": 3, "tasks": ["3.2", "4.1"] },
    { "id": 4, "tasks": ["4.2"] }
  ]
}
```
