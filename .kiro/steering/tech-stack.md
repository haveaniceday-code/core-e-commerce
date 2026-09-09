---
inclusion: always
---

# Stack Tecnológico

Monorepo Full Stack de un módulo de checkout de e-commerce con motor de descuentos
acumulativos.

## Tecnologías

- **Lenguaje:** TypeScript en todo el stack, con `strict: true` en cada `tsconfig.json`.
- **Backend:** NestJS. API REST.
- **Frontend:** React con Vite.
- **Estado del frontend:** Zustand.
- **Base de datos:** PostgreSQL. **Decisión abierta** — ver nota más abajo.
- **ORM:** Prisma. Se elige por sus tipos generados, que refuerzan el tipado estricto de
  extremo a extremo.
- **Validación en runtime:** class-validator con `ValidationPipe` global.
- **Tests backend:** Jest.
- **Tests frontend:** Vitest con React Testing Library.
- **Tests de `packages/shared`:** Vitest. El paquete es puro TypeScript sin dependencias de
  framework, así que no necesita el runner de NestJS.
- **Gestor de paquetes:** npm workspaces.

### Nota sobre la base de datos

El enunciado sugiere persistencia "en memoria, SQLite o JSON". PostgreSQL es válido —la
sección 4.1 es flexible en el stack— pero obliga al evaluador a levantar una base de datos
para correr el repositorio y añade riesgo a los 7 minutos de demo en vivo.

SQLite con Prisma conserva íntegra la justificación de los tipos generados y hace que el
proyecto arranque con `npm install && npm run dev`. Si se mantiene PostgreSQL, es
obligatorio incluir un `docker-compose.yml` y justificar la elección en
`docs/arquitectura.md`.

## Estructura del monorepo

```
examen-ecommerce/
├── apps/
│   ├── backend/      # API NestJS: valida stock, invoca el motor, persiste órdenes
│   └── frontend/     # React: carrito reactivo, checkout con desglose, alerta del 35%
├── packages/
│   └── shared/       # Contratos, tipos y motor de descuentos compartidos
├── docs/
│   ├── arquitectura.md
│   └── ia.md
└── README.md
```

## Reglas transversales

- Los contratos (DTOs, tipos de request y response) viven en `packages/shared` y se
  importan tanto en backend como en frontend. Una sola fuente de verdad para los tipos.
- Todo endpoint expuesto tiene su DTO de entrada y de salida tipado.
- El motor de descuentos vive en `packages/shared` y no depende de NestJS, Prisma ni HTTP.
- `packages/shared` es un workspace de primera clase: tiene sus propios tests y su propio
  umbral de cobertura del 80%, porque es donde vive el motor.
- `packages/shared` es también dueño único del redondeo y del formateo de dinero
  (`MICRO`, `roundHalfUp`, `formatCents`). Ni el backend ni el frontend redondean por su
  cuenta: es lo que garantiza que ambos muestren el mismo centavo.

## Steering relacionado

- `architecture.md` — patrones, capas y el hallazgo del tope inalcanzable.
- `product-rules.md` — catálogo, cupones, umbrales, redondeo, contrato de API y textos de UI.
- `typing-rules.md` — tipado estricto.
- `testing-standards.md` — cobertura y casos borde.
