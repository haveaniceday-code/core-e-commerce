# Gobernanza de IA y Bitácora de Co-creación

Registra cómo se usaron asistentes de IA
en este proyecto y el criterio de ingenieria del desarrollador.

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

> **Pendiente.** Porcentaje aproximado de código sugerido por IA frente a lógica crítica
> escrita a mano, desglosado por área (motor, API, UI, tests). Se completa con el código ya
> implementado.

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

