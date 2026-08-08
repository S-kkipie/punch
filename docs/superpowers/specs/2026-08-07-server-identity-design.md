# Sub-proyecto 3a — Identidad, wallet custodial y demo

**Estado:** Diseño aprobado
**Fecha:** 2026-08-07
**Depende de:** Spec maestra (`2026-08-07-punch-master-spec.md`) §05, §18, §20, §22
**Bloquea a:** 3b (cafe domain), relayer, emisión

---

## Objetivo

Extender el Better Auth existente para que:

1. Todo usuario tenga una cuenta EVM custodial invisible (spec §20: custodial declarado en MVP).
2. Un mismo usuario pueda ser consumidor y operador de café (membership).
3. Cualquier juez/tester entre a la app en menos de 10 segundos (botones demo + seed).

## Decisiones

| Decisión | Razón |
|---|---|
| Better Auth como identidad; sin wallet-connect ni WDK | Usuario nunca ve wallet/gas (§05). WDK evaluado: Node/React Native, seed-phrase self-custodial, sin historia browser/AA — no apto para hackathon. Mencionable como ruta post-MVP. |
| Custodia por derivación HD, no privkeys cifradas | Master mnemonic en env; DB guarda solo `wallet_index` + `address`. Privkey se deriva on-demand y nunca se persiste. Menos superficie de fuga. |
| User + tabla membership, no roles excluyentes ni plugin organizations | Dueño de café también es consumidor. Evita fricción de crear organizaciones desde cero en demo. |
| Botones de demo login + seed idempotente | Hackatones se pierden cuando el juez no puede probar. |

## Componentes

### 1. Wallet custodial — `src/core/chain/server/wallet.ts`

- Env nuevo: `WALLET_MASTER_MNEMONIC` (validado en `src/config/env.ts`; solo server).
- Derivación: viem `mnemonicToAccount(mnemonic, { addressIndex: N })` con path estándar `m/44'/60'/0'/0/N`.
- `N` = `user.wallet_index`, entero único asignado al crear usuario (secuencia Postgres).
- API del módulo:
  - `deriveUserAccount(walletIndex): LocalAccount` — cuenta viem lista para firmar EIP-712.
  - `assignWallet(userId): { walletIndex, address }` — idempotente; si el usuario ya tiene índice, retorna el existente.
- Hook Better Auth (databaseHooks user.create.after): llama `assignWallet`.
- Las cuentas de usuario nunca necesitan ETH: los contratos verifican firmas (ecrecover); el relayer paga gas.

### 2. Schema

```text
user (Better Auth existente) +
  wallet_index  integer unique  (secuencia)
  wallet_address text unique
  is_ops        boolean default false

cafe_member
  id         uuid pk
  user_id    fk user
  cafe_id    uuid            -- fk real llega en 3b; en 3a solo columna
  role       'owner' | 'barista'
  unique (user_id, cafe_id)
```

Nota: 3a crea `cafe_member` sin FK a `cafe` (tabla nace en 3b). La migración de 3b agrega la FK.

### 3. Autorización — `src/core/chain/../auth` helpers

- `requireSession` ya existe en scaffold.
- Nuevo `requireCafeRole(cafeId, roles: Role[])`: guard para rutas Elysia; consulta `cafe_member`.
- Nuevo `requireOps`: guard `user.is_ops`.

### 4. Demo y seed — `scripts/seed.ts`

- Crea (idempotente, keyed por email):
  - `demo-ops@punch.pe` (is_ops).
  - 4 owners: `brujula@punch.pe`, `patio9@punch.pe`, `nube@punch.pe`, `esquinasur@punch.pe` (memberships se completan en 3b cuando existan cafés).
  - `demo-consumer@punch.pe`.
- Password común desde env `DEMO_PASSWORD`.
- Página de auth: sección "Probar demo" con botones que ejecutan sign-in directo como consumidor demo, Café Brújula y Ops. Visible solo si `NEXT_PUBLIC_DEMO_MODE=true`.
- Registro normal sigue disponible; wallet se crea sola en signup.

## Errores

| Condición | Respuesta |
|---|---|
| Mnemonic ausente/ inválido en boot | Falla env validation al arrancar, mensaje claro |
| `assignWallet` concurrente para mismo user | Idempotente vía unique(wallet_index) + retry de lectura |
| Usuario sin wallet_index (dato legacy) | `deriveUserAccount` lanza; `assignWallet` disponible como backfill |
| Demo buttons con `DEMO_PASSWORD` ausente | Botones ocultos |

## Testing

- Derivación determinista: mismo índice → misma address (fixture con mnemonic de prueba).
- Índices distintos → addresses distintas.
- `assignWallet` idempotente.
- `requireCafeRole` permite/deniega según membership.
- Seed corre dos veces sin duplicar.

## Fuera de alcance

Emisión, firmas de consumo, relayer, passkeys/AA (post-MVP), UI de panel café (3b), recuperación de cuenta avanzada.
