# PUNCH

> Una red de cafeterías independientes que compite como una cadena.

PUNCH es una coalición de lealtad y demanda para cafeterías independientes. El cliente paga directamente al café mediante Yape; PUNCH no es wallet ni rail de pago.

## Mecánica

```text
Compra producto elegible en Café A
→ paga por Yape al café
→ recibe 1 PUNCH

Reúne 12 PUNCH
→ canjea producto reward de hasta S/12 en un café activo
→ contrato quema 12 PUNCH
→ anfitrión recibe S/3.60
```

PUNCH:

- No equivale a S/1.
- No es efectivo.
- No es transferible ni retirable.
- No se aplica libremente a cualquier factura.
- No expira durante MVP.

## Modelo para cafeterías

Plan mensual — hipótesis MVP:

```text
S/49
├─ S/30 reserva de rewards
├─ S/5 fondo común
├─ S/14 operación PUNCH
└─ 100 créditos de emisión
```

Pack adicional:

```text
S/40
├─ S/30 reserva
├─ S/5 fondo común
├─ S/5 operación PUNCH
└─ 100 créditos adicionales
```

Valor principal: visitas pagadas incrementales y retornos pagados. Upsell es secundario. Margen directo del reward cubre fulfillment.

## Arquitectura

```text
Arbitrum manda.
Postgres proyecta.
```

Arbitrum controla membresías, créditos, reserva, balances, burns, payouts, fondo común y campañas. Postgres guarda PII, auth, CRM, analytics, UX e índices de eventos.

MVP usa `MockPEN` en Arbitrum Sepolia. Arbitrum no puede verificar objetivamente que Yape ocurrió; café y usuario firman una atestación con nonce, expiry y receipt hash.

## Fuente canónica

[**Spec maestra de PUNCH**](./docs/superpowers/specs/2026-08-07-punch-master-spec.md)

Es única fuente de verdad para producto, economía, contratos, MVP, riesgos y pruebas. Si README, código o UI contradicen spec, spec gana.

Documentos visuales locales:

- [`docs/economia/index.html`](./docs/economia/index.html)
- [`docs/simulacion-4-cafes/index.html`](./docs/simulacion-4-cafes/index.html)
- [`docs/pitch/index.html`](./docs/pitch/index.html)

Simulación de cuatro cafés es ficticia y sembrada; no constituye evidencia de piloto.

## Desarrollo

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm dev
```

Comandos principales:

```text
pnpm dev
pnpm build
pnpm test
pnpm check
pnpm typecheck
pnpm db:generate
pnpm db:migrate
```

Stack actual: Next.js 16, React 19, Elysia, Better Auth, Drizzle/Postgres, TanStack Query, zod, Tailwind v4, viem, Solidity y Foundry.

Convenciones de implementación: [`docs/code-review/`](./docs/code-review/README.md).
