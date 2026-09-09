# Requirements Document

## Introduction

Primera entrega de `apps/frontend`: el arranque de Vite con React y TypeScript, el cliente de la
API, el estado del carrito con Zustand y la pantalla que lista el catálogo y refleja el carrito en
tiempo real. Cubre **HU 1 — Gestión del Carrito**.

No aplica cupones, no muestra desglose de descuentos y no compra: esas son la entrega siguiente. Lo
único que calcula esta entrega es el **subtotal optimista** del carrito, que es un producto de
enteros y no un descuento.

**Cadena de specs:** `monorepo-foundation` → `shared-contracts-seed` → `discount-engine` →
`backend-persistence` → `backend-checkout` → `frontend-cart`. Referencias entre specs con prefijo
(`MF-`, `SCS-`, `DE-`, `BP-`, `BC-`, `FC-`); dentro del documento, `R2.3` es "Requerimiento 2,
criterio 3". Criterios en EARS.

**Hereda y no repite.** De `monorepo-foundation`: npm workspaces, Node `>=20`, `strict: true`, cero
`any` y cero assertions salvo `as const`, y los scripts homogéneos por workspace. De
`shared-contracts-seed`: `Product`, `CartItem`, `ProductCategory`, `CATEGORY_LABEL` y `formatCents`.
De `backend-persistence`: el endpoint `GET /api/products` y la forma `ApiError`.

**Alcance acotado por decisión explícita:**

- El carrito **no limita por stock**. Muestra el stock disponible pero deja agregar por encima de
  él, porque el rechazo del backend es un paso de la demostración en vivo. Un tope en la UI haría
  imposible demostrarlo.
- El subtotal es **optimista y local**: `precioCentavos × cantidad`, producto de enteros. Esta
  entrega no llama a `POST /api/checkout/preview`; el desglose de descuentos llega con el cupón.
- Una sola pantalla, sin router.

**Fuera de alcance:** el cupón, el desglose de descuentos, la alerta del 35%, `POST /api/checkout`
y la confirmación de orden.

## Glossary

- **App_Frontend**: la aplicación React de `apps/frontend`, servida por Vite.
- **Cliente_Api**: el módulo que habla HTTP con el backend; único punto que invoca `fetch`.
- **Store_Carrito**: el store de Zustand con el catálogo, las líneas del carrito y sus acciones.
- **Selector_Subtotal**: la función pura que deriva el subtotal del estado del Store_Carrito.
- **Pantalla_Carrito**: la vista que compone la lista de catálogo y el panel del carrito.
- **Paquete_Shared**: el paquete `@core/shared`, consumido únicamente por su entry público.
- **Suite_Frontend**: la configuración y el conjunto de pruebas de Vitest de `apps/frontend`.

## Requirements

### Requerimiento 1: Arranque del workspace frontend

**User Story:** Como desarrollador, quiero un frontend arrancable con tipado estricto, para añadir
pantallas sin reconfigurar nada.

#### Acceptance Criteria

1. LA App_Frontend DEBERÁ vivir en `apps/frontend` como workspace de npm con Vite, React y
   TypeScript, exponiendo los scripts `dev`, `build`, `typecheck`, `lint`, `test` y `test:cov`, de
   modo que los scripts agregadores de la raíz la alcancen.
2. LA App_Frontend DEBERÁ compilar con `strict: true` heredado de `tsconfig.base.json`,
   sobrescribiendo únicamente lo que el navegador exige —módulos ESM, resolución de bundler, `lib`
   con `DOM` y la transformación de JSX—, y `npm run typecheck --workspace apps/frontend` DEBERÁ
   terminar sin errores.
3. LA App_Frontend DEBERÁ importar del Paquete_Shared exclusivamente por su entry público
   `@core/shared`, sin rutas internas, resolviéndolo a las fuentes del paquete para no depender de
   un build previo.
4. LA App_Frontend DEBERÁ redirigir las peticiones a `/api` hacia el backend desde el servidor de
   desarrollo, de modo que el navegador no emita peticiones de origen cruzado.
5. LA App_Frontend DEBERÁ tener su `eslint.config.mjs` alineado con el resto de workspaces: cero
   `any`, cero assertions salvo `as const` y cero comentarios `@ts-`.

### Requerimiento 2: Cliente de la API

**User Story:** Como desarrollador, quiero el acceso HTTP detrás de un módulo propio, para que los
componentes y el estado no conozcan `fetch` ni las rutas.

#### Acceptance Criteria

1. EL Cliente_Api DEBERÁ ser el **único** punto de la App_Frontend que invoca `fetch`; ni los
   componentes ni el Store_Carrito lo llaman directamente.
2. EL Cliente_Api DEBERÁ pedir el catálogo a `GET /api/products` y devolverlo tipado como
   `readonly Product[]` del Paquete_Shared, sin redeclarar la forma del producto.
3. SI la respuesta no es satisfactoria o la petición falla por red, ENTONCES EL Cliente_Api DEBERÁ
   fallar con un error tipado que la interfaz pueda mostrar, tomando el mensaje del cuerpo cuando
   respeta la forma `ApiError` y usando un mensaje genérico en cualquier otro caso.

### Requerimiento 3: Estado del carrito

**User Story:** Como cliente de la tienda, quiero agregar y quitar productos y ver el carrito
actualizarse al instante, para armar mi compra sin recargar la página.

#### Acceptance Criteria

1. EL Store_Carrito DEBERÁ declararse fuera de los componentes, con el catálogo, las líneas del
   carrito y sus acciones, de modo que se pruebe sin renderizar React. SU estado inicial DEBERÁ ser
   catálogo vacío y carrito vacío.
2. EL Store_Carrito DEBERÁ guardar por línea únicamente el identificador de producto y la cantidad;
   el precio, el nombre y la categoría se resuelven contra el catálogo, para que no existan dos
   copias del precio que puedan divergir.
3. CUANDO se agrega un producto ausente del carrito, EL Store_Carrito DEBERÁ crear su línea con
   cantidad `1`; CUANDO el producto ya está en el carrito, DEBERÁ incrementar su cantidad en `1`.
4. CUANDO se decrementa una línea, EL Store_Carrito DEBERÁ reducir su cantidad en `1`, y CUANDO la
   cantidad llega a `0`, DEBERÁ eliminar la línea en lugar de conservarla con cantidad cero.
5. CUANDO se quita una línea, EL Store_Carrito DEBERÁ eliminarla completa con independencia de su
   cantidad.
6. EL Store_Carrito no DEBERÁ limitar la cantidad al `stock` disponible: agregar por encima del
   stock es un estado válido del carrito, y su rechazo es responsabilidad del backend.

### Requerimiento 4: Subtotal optimista y formateo

**User Story:** Como cliente, quiero ver el subtotal actualizarse de inmediato al cambiar el
carrito, para saber cuánto llevo sin esperar al servidor.

#### Acceptance Criteria

1. EL Selector_Subtotal DEBERÁ calcular el subtotal como la suma de `precioCentavos × cantidad` de
   cada línea: producto de enteros, exacto, **sin redondeo y sin punto flotante**.
2. EL Selector_Subtotal DEBERÁ derivarse del estado en cada lectura y no almacenarse como campo,
   de modo que no pueda desincronizarse de las líneas.
3. CUANDO el carrito está vacío, EL Selector_Subtotal DEBERÁ devolver `0` sin lanzar excepción.
4. LA App_Frontend DEBERÁ formatear todo monto con `formatCents` del Paquete_Shared, y no DEBERÁ
   usar `toFixed` ni ninguna otra aritmética de dinero sobre montos calculados.

### Requerimiento 5: Pantalla de catálogo y carrito

**User Story:** Como cliente de la tienda, quiero ver los productos disponibles y mi carrito en la
misma pantalla, para agregar y quitar sin perder de vista lo que llevo.

#### Acceptance Criteria

1. LA Pantalla_Carrito DEBERÁ listar los productos del catálogo con su nombre, su categoría
   mostrada mediante `CATEGORY_LABEL` —con tilde—, su precio formateado y su stock disponible.
2. CADA producto del catálogo DEBERÁ ofrecer una acción para agregarlo al carrito.
3. LA Pantalla_Carrito DEBERÁ listar las líneas del carrito con la cantidad, el total de la línea
   formateado y controles para incrementar, decrementar y quitar.
4. CUANDO el carrito cambia, LA Pantalla_Carrito DEBERÁ reflejar el subtotal actualizado de
   inmediato, sin recargar ni esperar respuesta del servidor.
5. CUANDO el carrito está vacío, LA Pantalla_Carrito DEBERÁ mostrar un mensaje explícito en lugar
   de una lista vacía.
6. LA Pantalla_Carrito DEBERÁ distinguir en pantalla la carga del catálogo y su fallo, mostrando en
   el segundo caso el mensaje del error tipado del Cliente_Api.

### Requerimiento 6: Pruebas y umbral de cobertura

**User Story:** Como desarrollador, quiero el estado del carrito y la pantalla cubiertos, para que
la reactividad sea una condición verificada.

#### Acceptance Criteria

1. LA Suite_Frontend DEBERÁ ejecutarse con Vitest y React Testing Library sobre `jsdom`, sin
   servidor real y sin base de datos: el Cliente_Api se sustituye por un doble tipado, sin `any`.
2. LA Suite_Frontend DEBERÁ probar el Store_Carrito de forma directa, sin renderizar componentes:
   agregar un producto ausente, incrementar uno presente, decrementar, decrementar hasta `0` —que
   elimina la línea— y quitar una línea con cantidad mayor a `1`.
3. LA Suite_Frontend DEBERÁ probar el Selector_Subtotal con carrito vacío, una línea, varias líneas
   y una cantidad mayor a `1`, con montos cuyo resultado se verifique a mano.
4. LA Suite_Frontend DEBERÁ probar que agregar una cantidad superior al `stock` disponible es un
   estado válido que el subtotal refleja sin error.
5. LA Suite_Frontend DEBERÁ probar la Pantalla_Carrito con React Testing Library: el catálogo
   renderizado, que agregar un producto actualiza el subtotal visible, el mensaje de carrito vacío
   y el mensaje de fallo del catálogo.
6. LA Suite_Frontend DEBERÁ configurar `coverageThreshold` en `80` por ciento de líneas y de ramas,
   y `npm run test:cov --workspace apps/frontend` DEBERÁ salir con código distinto de `0` cuando
   cualquiera de los dos porcentajes queda por debajo.
