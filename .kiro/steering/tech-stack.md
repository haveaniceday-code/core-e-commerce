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
- **Base de datos:** SQLite en archivo local. Ver la justificación más abajo.
- **ORM:** Prisma. Se elige por sus tipos generados, que refuerzan el tipado estricto de
  extremo a extremo.
- **Validación en runtime:** class-validator con `ValidationPipe` global.
- **Tests backend:** Jest.
- **Tests frontend:** Vitest con React Testing Library.
- **Tests de `packages/shared`:** Vitest. El paquete es puro TypeScript sin dependencias de
  framework, así que no necesita el runner de NestJS.
- **Gestor de paquetes:** npm workspaces.

### Por qué SQLite

Se elige SQLite por dos
razones:

- **Persistencia real y demostrable.** con SQLite se puede
  reiniciar el backend y mostrar que la orden sigue ahí, cosa que la persistencia en
  memoria no permite.

- **Conserva el argumento de Prisma.** Los tipos generados por el ORM refuerzan el tipado
  estricto de extremo a extremo igual que con cualquier otro motor.

Trade-off a documentar en `docs/arquitectura.md`: SQLite no cubre concurrencia de escritura
seria. Es irrelevante para este MVP, y como el acceso a datos está detrás de las interfaces
`ProductRepository` y `OrderRepository`, cambiar de motor no toca la lógica de dominio.

El archivo `.db` **no se versiona**: se genera con las migraciones y el seed del catálogo al
arrancar.

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
