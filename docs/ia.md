# Gobernanza de IA y Bitácora de Co-creación

Registra cómo se usaron asistentes de IA en este proyecto y el criterio de ingeniería del
desarrollador.

Herramienta principal: Claude Code, gobernada mediante archivos de steering en `.kiro/`
(reglas siempre activas), una skill y un agente auditor.

---

## 1. Skills / Prompts automatizados

### `generate-unit-tests`

Definición completa: [`.kiro/skills/generate-unit-tests/SKILL.md`](../.kiro/skills/generate-unit-tests/SKILL.md)

Convierte "escribe tests para este archivo" en un procedimiento fijo, en vez de dejar que el
asistente improvise una suite distinta cada vez. Fija el umbral del 80%, la lista cerrada de
casos borde del dominio y el runner que corresponde a cada capa. Se activa por descripción
—al pedir generar tests, cubrir un módulo o subir cobertura—, no por comando.

Las dos reglas que la hacen algo más que un prompt genérico, ambas nacidas de errores reales:

- **Cada workspace se mide con su propio comando.** El motor vive en `packages/shared`, así
  que la cobertura de `apps/backend` no lo incluye por más que el backend lo importe.
- **El tope del 35% se prueba inyectando estrategias stub**, no buscando un carrito que lo
  dispare, porque con el catálogo del enunciado es inalcanzable (máximo real: 27.325%). Sin
  esa instrucción la generación automática produce tests que fallan por una razón que se
  confunde con un bug del motor.

## 2. Agents / Sub-agentes

### `test-coverage-auditor`

Definición completa: [`.kiro/agents/test-coverage-auditor.md`](../.kiro/agents/test-coverage-auditor.md)

Auditor independiente: ejecuta las suites de los tres workspaces, verifica el 80% por área y
comprueba que cada caso borde tenga un test real detrás.

Lo separé de la skill a propósito, porque **quien escribe los tests no puede ser quien los
aprueba**: si el mismo agente genera y valida, acaba juzgando su propio trabajo y declarándolo
suficiente. Por eso sus herramientas son de solo lectura y ejecución. Cuando encuentra un
hueco no lo tapa, lo reporta y lo delega en `generate-unit-tests`.

Rechaza por caso borde faltante aunque el porcentaje global pase, y señala la cobertura
inflada: un archivo con el 90% de líneas ejecutadas pero sin asserts sobre el resultado del
cálculo no cuenta como cubierto.

---

## 3. Bitácora de co-creación

### Reparto de autoría

Porcentajes aproximados, medidos a ojo sobre el código entregado hasta ahora. La lectura útil
no es el número sino el patrón: **lo que la IA hace bien es volumen estructurado; lo que hay
que escribir a mano son las costuras** —tipos que cruzan una frontera, configuración de
proyectos y decisiones de contrato.

| área | sugerido por IA | escrito o reescrito a mano | qué quedó a mano |
|------|-----------------|----------------------------|------------------|
| Motor de descuentos (`packages/shared`) | ~70% | ~30% | La política de redondeo completa (ver corrección [1]): micro-centavos, tasas en bps, redondeo único, reparto por mayor resto. |
| API backend (`apps/backend`) | ~80% | ~20% | La costura de tipos del seed (corrección [2]), la topología de los `tsconfig` y la decisión del código de error del `500`. |
| UI frontend (`apps/frontend`) | — | — | Pendiente: el workspace no está implementado en esta entrega. |
| Tests | ~75% | ~25% | Los fixtures y los valores esperados. La IA genera la estructura de la tabla de casos; el número contra el que se afirma se calcula a mano, porque un valor esperado sugerido por quien escribió la implementación no prueba nada. |

Detalle del backend, que es lo que añade esta entrega: el andamiaje —schema Prisma y migración,
módulos de Nest, `jest.config.ts`, `eslint.config.mjs`, dobles en memoria— es casi todo generado, y
ahí la IA rinde. Lo que hubo que rehacer no fue de estilo. La corrección [2] es el caso
representativo; hubo otras dos del mismo tipo que no se detallan para no alargar el documento: un
contrato de error sin código para el `500`, que se quiso tapar con una assertion `as ErrorCode` y
terminó extendiendo `ERROR_CODES` en `packages/shared` (razonada en `docs/arquitectura.md`), y una
topología de `tsconfig` cuyo `typecheck` no podía pasar nunca, con TS6059 determinista. Las tres se
sostenían en el razonamiento del asistente, pero no en `tsc`.

### Correcciones a sugerencias de la IA

#### [1] Redondeo en cascada en vez de redondeo único al final

**Cómo apareció.** Fui al enunciado a buscar qué decía sobre redondeo y resulta que no dice
nada: exige "re-calcular con precisión" y devolver "totales desglosados exactos", pero en
ningún momento fija dónde se redondea. Al volver sobre el steering vi que la IA ya había
tapado ese hueco por su cuenta mientras definíamos las reglas de producto. Lo había tapado
mal.

**Lo que había escrito.** La política que encontré en `product-rules.md` era redondear
half-up en cada paso de la cascada, para que cada regla le entregara un entero a la
siguiente:

> "Cada regla de la cascada calcula su monto de descuento y lo redondea a centavo entero con
> half-up (`Math.round`). El total tras cada paso es siempre un entero, de modo que la regla
> siguiente opera sobre un entero."

Entiendo por qué le salió así. Mantiene la invariante cómoda de "todo es entero siempre" y
te ahorra pensar en aritmética exacta. A primera vista parece la opción prudente.

**Por qué no la acepté.** Por dos cosas concretas.

La primera es que el error se acumula. Cada paso mete hasta medio centavo de error y el paso
siguiente opera sobre ese valor ya contaminado. El resultado final acaba dependiendo de en
qué punto exacto redondeas, en un cálculo que además ya es sensible al orden por las reglas
de precedencia del enunciado. Eso choca de frente con el "con precisión" y los "totales
exactos" que pide HU 3.

La segunda me preocupaba más, porque es la que revienta en producción y no en los tests: con
el redondeo repartido por toda la cascada, cualquiera que redondee en un punto distinto
obtiene otro total. Es el mecanismo por el que el desglose que ve el usuario en pantalla y la
orden que queda persistida terminan difiriendo en un centavo. No rompe ningún test obvio;
aparece semanas después como un descuadre contable que nadie sabe de dónde sale.

**La instrucción que di.** Textual, tal cual la escribí:

> verifica los archivos de steering existentes y corrijelos, el redondeo debe hacerse al
> final y no en cascada, el redondeo debe ser consistente tanto en el frontend como en el
> backend.

**Lo que pedí comprobar antes de dar la corrección por buena.** Quería saber si esto era una
objeción teórica o si de verdad cambiaba números, así que hicimos simular las dos políticas
sobre todo el espacio de carritos posibles dentro del stock del catálogo, con y sin cupón, y
con half-up estricto para replicar la semántica de `Math.round` en JS. **El 10.5% de los
carritos da un total distinto según la política.** No era teórico.

El caso más pequeño que diverge es un carrito con 1 × `PROD-001` y `WELCOME2026`, y hoy es un
fixture de test:

| paso | valor exacto | half-up por paso (lo que se descartó) |
|------|--------------|---------------------------------------|
| subtotal original | `129900` | `129900` |
| categoría 10% | `12990` | `12990` |
| volumen 5% | `5845.5` | `5846` |
| cupón 15% | `16659.675` | `16660` |
| **descuento total** | `35495.175` → **`35495`** | **`35496`** |

**Cómo quedó.** Cascada exacta y un solo redondeo, al final:

- La cascada opera en **micro-centavos** (`MICRO = 1_000_000`) y no redondea en ningún paso
  intermedio. Comprobamos que la escala es exacta para las tres tasas: los denominadores
  acumulados son 10, 20 y 20, y su producto (4000) divide a 1.000.000, así que ninguna
  división de la cascada pierde precisión.
- Las tasas dejan de ser floats y pasan a **puntos básicos enteros** (`1000`, `500`, `1500`;
  tope `3500`), aplicadas como `× bps / 10000`. El efecto secundario me gustó: en todo el
  cálculo de dinero ya no aparece un solo número de punto flotante, así que pude eliminar la
  excepción que las reglas de tipado hacían para las tasas.
- El redondeo es uno: `rawDiscountCents = round(rawDiscountMicros / MICRO)`, half-up. El tope
  se queda con `floor`, porque el descuento no puede *superar* el 35% y redondear hacia
  arriba lo violaría por un centavo.
- Las líneas del desglose reparten sus centavos por **mayor resto**, para que lo que el
  usuario ve sumado en pantalla dé exactamente el ahorro reportado.
- La consistencia frontend/backend queda **estructural, no por convención**: una sola
  implementación en `packages/shared`, el frontend no recalcula ni re-redondea, `toFixed()`
  prohibido sobre montos calculados, y `preview` y `checkout` llamando al mismo motor.

**Lo que costó.** No fue un cambio cosmético, y por eso me interesaba resolverlo antes de
escribir el motor y no después: cambió el contrato de la API (los campos `*Micros` conviven
ahora con los `*Cents`), cambió la responsabilidad de las estrategias —dejaron de redondear y
devuelven montos exactos, quedando el ensamblador de totales como único punto autorizado a
redondear— y obligó a propagar la corrección a cinco archivos de steering. Añadimos además un
test de regresión construido a propósito para fallar si alguien reintroduce el redondeo por
paso.

#### [2] Una firma tipada contra Prisma que ningún doble de prueba podía satisfacer

- **Contexto:** `apps/backend/prisma/seed.ts` y su prueba de idempotencia
  `apps/backend/test/seed.spec.ts` (BP-R3.2, BP-R6.1).

- **Sugerencia de la IA:** el seed recibe el cliente por parámetro —la costura correcta, porque
  permite probar la idempotencia sin levantar SQLite— pero tipado contra Prisma:

  ```ts
  export const seedProducts = async (
    client: Pick<PrismaClient, 'product'>,
    products: readonly Product[] = CATALOG_PRODUCTS,
  ): Promise<number> => { /* ... */ };
  ```

- **Por qué se rechazó:** `Pick` no reduce nada aquí. Selecciona la propiedad `product`, y esa
  propiedad **es** el delegado completo de Prisma: `findMany`, `findUnique`, `aggregate`,
  `groupBy`, `createMany`, `fields`, todas con firmas genéricas que devuelven tipos internos del
  cliente generado (`$Result`, `Prisma__ProductClient`). El seed emite una sola operación, un
  `upsert`, pero el tipo exige las treinta.

  El almacén doble de la prueba tendría que implementar ese delegado entero para satisfacer el
  tipo, lo que solo es posible con `any` o con una type assertion, ambas prohibidas. La firma
  anulaba el propósito de su propia costura: existía para poder probar sin base de datos y estaba
  tipada de forma que solo la base de datos podía atravesarla.

- **Qué se hizo en su lugar:** se invirtió la dirección de la dependencia de tipos. En vez de que
  el seed dependa del tipo de Prisma, declara la interfaz estructural mínima que necesita, y el
  `PrismaClient` real la satisface por estructura:

  ```ts
  export interface ProductUpsertClient {
    readonly product: {
      upsert(args: ProductUpsertArgs): Promise<unknown>;
    };
  }
  ```

  La verificación no se pierde, se mueve: `tsc` comprueba en el sitio de llamada de `main` que el
  `PrismaClient` concreto encaja en `ProductUpsertClient`, así que un cambio incompatible en el
  cliente generado sigue rompiendo la compilación. El doble de prueba queda tipado sin un solo
  `any`. Es la regla del proyecto aplicada a un caso nuevo: el consumidor define la interfaz.

  Al ejecutar la prueba apareció un segundo problema en el mismo archivo: `void main()` estaba en el
  nivel superior, así que importar `seedProducts` desde el spec ejecutaba `main`, abría una conexión
  real contra la base y dejaba `process.exitCode = 1`. Jest salía con código distinto de `0` con
  todos los tests en verde, que es la peor forma de romper un pipeline porque el síntoma no apunta a
  la causa. Se corrigió con la guarda de punto de entrada:

  ```ts
  if (require.main === module) {
    void main().catch((error: unknown) => { /* stderr + exitCode 1 */ });
  }
  ```
