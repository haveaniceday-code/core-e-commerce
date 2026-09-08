---
name: generate-unit-tests
description: Genera suites de tests unitarios exhaustivas para servicios, clases o funciones de lógica, apuntando a 80% de cobertura y cubriendo los casos borde del motor de descuentos y del checkout. Úsala cuando el usuario pida generar tests, cubrir con pruebas, crear mocks de prueba o subir cobertura de un archivo o módulo.
---

# Generación de Tests Unitarios

Automatiza la creación de tests unitarios para el módulo de checkout con descuentos
acumulativos.

## Objetivo

Dado un archivo de lógica (una estrategia de descuento, un servicio de NestJS o el store
del carrito), generar una suite de tests que:

1. Alcance al menos 80% de cobertura de líneas y ramas.
2. Cubra los caminos felices y todos los casos borde relevantes.
3. Use el runner correcto según la capa: Jest en el backend, Vitest con React Testing
   Library en el frontend.
4. Sea determinista y verificable a mano.

## Procedimiento

1. Leer el archivo objetivo completo y sus dependencias directas: interfaces, tipos y
   contratos importados desde `packages/shared`.
2. Identificar la capa para elegir el runner y los matchers adecuados.
3. Enumerar los caminos de ejecución: cada rama condicional, cada regla de negocio, cada
   retorno posible y cada excepción lanzada.
4. Mockear las dependencias de infraestructura (repositorios, cliente HTTP, Prisma) con
   dobles de prueba tipados. Un test unitario nunca golpea la base de datos ni la red. El
   motor de descuentos se testea puro, sin mocks.
5. Escribir los tests agrupados en bloques `describe`, uno por método o comportamiento, con
   nombres que describan el comportamiento esperado y no la implementación.
6. Incluir los casos borde obligatorios cuando el objetivo sea el motor de descuentos o el
   checkout.
7. Ejecutar el comando de cobertura y confirmar que se alcanza el 80%. Si no se alcanza,
   añadir los tests que cubran las líneas y ramas faltantes.

## Casos borde obligatorios

- Cascada que supera el 35%, con truncamiento exacto en 35%.
- Frontera del 35%: un caso justo por debajo y otro justo por encima.
- Carrito vacío, que devuelve descuento cero sin excepción.
- Carrito con datos corruptos: cantidad negativa, precio inválido, producto inexistente.
- Cupón no registrado o expirado, que se ignora sin interrumpir el cálculo.
- Cupón `WELCOME2026` válido, que aplica 15% en su orden de precedencia.
- Stock insuficiente, que rechaza el checkout sin decrementar stock ni persistir la orden.
- Cascada multiplicativa verificada con montos calculados a mano.
- Solo categoría, categoría más volumen, y las tres reglas combinadas.

## Convenciones

- Nombres de test con la forma `should <comportamiento> when <condicion>`.
- Un assert conceptual por test cuando sea posible.
- Montos de prueba en centavos enteros, elegidos para que el resultado sea verificable a
  mano.
- Sin `any` en los tests ni en los dobles de prueba.

## Salida

Al terminar, reportar:

- Los archivos de test creados.
- Los casos borde cubiertos.
- El comando exacto para verificar la cobertura, por ejemplo
  `npm run test:cov --workspace apps/backend`.
- Cualquier camino que no se haya podido cubrir, con la razón técnica.
