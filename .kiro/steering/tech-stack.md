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
- **Base de datos:** PostgreSQL.
- **ORM:** Prisma. Se elige por sus tipos generados, que refuerzan el tipado estricto de
  extremo a extremo.
- **Validación en runtime:** class-validator con `ValidationPipe` global.
- **Tests backend:** Jest.
- **Tests frontend:** Vitest con React Testing Library.
- **Gestor de paquetes:** npm workspaces.

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
