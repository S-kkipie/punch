# SELLO

> **El sello de tu cafetería, pero vale en toda la ciudad.**
> Red abierta de consumo, lealtad y adquisición para cafeterías.

Hackathon Ethereum Lima 2026 · Arbitrum Track · Arbitrum Sepolia · Arequipa

---

## Core

> **Cada tap en el mostrador de una cafetería es un consumo verificable. Y toda plata
> que un café promete —rewards o campañas— está bloqueada en un contrato antes de
> prometerla.**

Dos primitivos. Todo lo demás sale de ellos:

```text
   1. PROOF OF CONSUMPTION          2. MERCHANT ESCROW
   café y consumidor co-firman      café bloquea plata, el contrato
   un consumo → va a la cadena      la libera si un proof cumple X
              │                                │
              └────────────┬───────────────────┘
                           ▼
        ┌──────────┬───────────┬──────────┬──────────┐
        ▼          ▼           ▼          ▼          ▼
    Coffee     Rewards     Canje en   Campaña    Passport
    Score                  otro café  adquisición
```

Ni rewards, ni campañas, ni settlement son contratos aparte. Son **usos del mismo
escrow con distinta condición de liberación**.

---

## El problema

**La tarjeta de sellos es una isla.** Todos tenemos seis cartones a medio llenar y
ninguno completo. Cada uno vale en un solo local, y el café no sabe nada del cliente
más allá de los sellos que él mismo puso.

**Y el café pequeño no puede adquirir clientes.**

| Canal | Costo | Qué compra |
|---|---|---|
| Volanteo | S/0.10 c/u | Impresiones. Cero atribución. |
| Instagram Ads | S/20-40 CAC | Un click. No sabe si la persona toma café. |

Ninguno le permite decir: *"quiero a la gente que ya toma 15 cafés al mes en otro lado
y nunca entró acá"*. Esa persona existe, está a 300 metros, y hoy es invisible.

---

## Cómo funciona

### La unidad

**1 punto = S/0.01.** Fijo. Respaldado 1:1 por dinero depositado en el contrato.
No flota, no lo fijamos nosotros, no se puede devaluar.

### Consumo → emisión

Diego pide un cortado. S/12. El café tiene tasa 10%.

```text
Barista marca S/12 en su panel
        │
   QR:  { cafeId, 1200 céntimos, nonce, expiry, FIRMA DEL CAFÉ }
        │
   Diego escanea → su wallet firma
        │
   Backend relayea la tx y paga el gas
        │
        ├──→ ConsumptionLog.record()   proof con las 2 firmas
        └──→ RewardVault.issue()       +120 puntos a Diego
```

Diego ve `+120 puntos · racha día 7 🔥`. No ve wallet, no paga gas, no lee la palabra
"blockchain".

**10 cafés = 1,200 puntos = S/12 = un cortado gratis.** La misma matemática que el
cartón de sellos de siempre. A propósito.

### Canje: en cualquier café de la red

```text
   RewardVault.redeem(1200)
        │
        ├──→ quema 1,200 puntos
        └──→ transfiere S/12 del pool al café
```

Cobró completo, al instante. **Y no le reclama nada al café que emitió los puntos**,
porque la emisión es prefondeada: esa plata ya estaba depositada.

```text
   OTROS DISEÑOS (deuda)          SELLO (prefondeado)

   A emite ────► usuario          A DEPOSITA ────► pool
        │                              │
   B le reclama a A               B cobra del pool
        │                              │
   ¿y si A no paga?               ya estaba pagado
```

Cero riesgo de contraparte. Cero cobranza. Nada que arbitrar.

### Lealtad y portabilidad, separadas

| | Dónde vive | Cómo |
|---|---|---|
| **Lealtad** | En la **emisión** | Racha 7 días → 2x · martes → 1.5x · producto X → 3x |
| **Portabilidad** | En el **canje** | 1 punto = S/0.01 en cualquier café. Sin letra chica. |

> **Ganas más donde eres fiel. Gastas donde quieras.**

---

## Campañas: comprar clientes verificados

Café Tostado abre. Cero clientes. Deposita S/500.

```text
CAMPAÑA — Tostado

Segmento:   Coffee Score > 500      (≈15+ cafés/mes verificados)
            Nunca hizo tap acá
            Radio 2 km

Reward:     S/5 en puntos, al primer consumo
Budget:     S/500  →  100 conversiones máx.
```

El contrato retiene los S/500. Un consumidor que califica recibe la oferta, camina,
hace tap → **el contrato le paga solo**. Tostado no aprueba nada. Nosotros tampoco.

> **Pagas por consumo. No por impresión, no por click.**

Si el 30% vuelve solo: CAC real ≈ S/17 por cliente recurrente.

---

## Por qué Arbitrum

**1. Precedente directo.** [Blackbird](https://www.blackbird.xyz) —la referencia del
sector, fundada por el creador de Resy— corre en **Flynet, un L3 de Arbitrum Orbit**.
El caso de uso ya está probado sobre este stack.

**2. Costo por proof.** Un café con 200 tickets/día genera 200 proofs diarios. En L1 el
modelo no existe. Acá cada proof cuesta una fracción de céntimo y el relayer lo absorbe.

**3. Neutralidad verificable.** El punto no es velocidad: es que **nosotros no podemos
hacer trampa**. Colateral, peg y condiciones de campaña están en el contrato. Si SELLO
desaparece mañana, los cafés recuperan su colateral y los usuarios canjean sus puntos.
Eso en Postgres no se puede prometer.

---

## Contra Blackbird

**1. Su modelo depende de ser el rail de pago — y por eso no puede entrar a Perú.**
Su 2% requiere que pagues con la app. Acá se paga con efectivo, Yape y Plin. Nuestro
proof depende del **tap**, no del pago.

**2. Política monetaria discrecional.** Blackbird Labs fija el valor de `$FLY` desde un
panel interno — el mismo problema de las millas que dicen resolver. SELLO: colateral
obligatorio, peg en el contrato. **No podemos devaluar aunque queramos.**

**3. Onboarding a mano.** NYC, LA y Charleston en ~3 años, invite-only. SELLO es
**permissionless**: wallet + nombre + QR + 5 minutos, sin comercial.

**4. App cerrada, no protocolo.** Su data vive adentro. Nuestro consumption graph es
legible on-chain; un tercero construye encima sin pedirnos permiso.

**5. Restaurantes = frecuencia baja. Cafés = frecuencia diaria.** Cena: 1-4 veces al
mes. Café: todos los días. Con los mismos usuarios el grafo se densifica ~20x más
rápido — y rachas, hábitos y tiers **solo funcionan con frecuencia diaria**.

> Blackbird necesita ser el medio de pago. Acá el medio de pago es efectivo y Yape.
> Nuestro proof no depende de cómo pagas — depende del tap.
> Y quién emite, cuánto, y con qué respaldo, está en el contrato. No en nuestro panel
> de admin.

---

## Contratos

Arbitrum Sepolia · Solidity · Foundry

| Contrato | Responsabilidad |
|---|---|
| `CafeRegistry` | Café se registra solo: wallet, nombre, geohash. Permissionless. |
| `ConsumptionLog` | Proofs con las dos firmas (EIP-712). El consumption graph. |
| `RewardVault` | ERC-20 de puntos **100% colateralizado**. Emitir = descontar crédito. Canjear = quemar y pagar. |
| `CampaignEscrow` | Presupuesto retenido + condición + payout automático. |
| `MockPEN` | ERC-20 de prueba con faucet. Solo testnet. |

Direcciones desplegadas y enlaces a Arbiscan: *pendiente*.

---

## Qué va en la cadena y qué no

| Arbitrum Sepolia | Postgres |
|---|---|
| Proofs de consumo | Coffee Score, rachas, tiers |
| Colateral de puntos | Segmentación y matching de campañas |
| Emisión / canje | Notificaciones, geo, catálogo |
| Presupuesto y payout de campaña | Dashboards, analytics, CRM, UI |

**La cadena guarda plata y compromisos. Postgres guarda todo lo demás.**

---

## Modelo de negocio

| Fuente | Cuánto |
|---|---|
| **Campaign fee** | 10-15% del presupuesto de adquisición |
| **SaaS por café** | mensual — dashboard, CRM, segmentación, analytics |
| Redemption fee | **0%**, a propósito |

Arbitrum es infraestructura, **no es el modelo de negocio**. Sin token especulativo.

---

## Alcance del hackathon

**Sí:** 5 contratos desplegados y testeados · flujo tap → proof → puntos · canje
cruzado · campañas de punta a punta · PWA consumidor + panel de cobro + dashboard café
· red simulada sembrada (~8 cafés, ~50 consumidores, ~3 meses).

**No (declarado):** pagos y rail de cobro · integración POS · on-ramp fiat · mainnet ·
NFC nativo · app nativa · expiración de puntos · multi-ciudad · wallet no-custodial ·
token especulativo.

Dos límites que se dicen en voz alta durante el demo, no se esconden:
el MVP usa **wallet custodial** (la firma del consumidor la produce nuestro servidor),
y la red del demo es **data sembrada**, no tracción real.

---

## Stack

Next 16 · React 19 · Elysia (`/api/v1`) · Better Auth · Drizzle ORM + Postgres ·
Eden + TanStack Query · zod · shadcn/ui + Tailwind v4 · LogTape · viem ·
Solidity + Foundry · Vitest · Biome.

### Setup

```bash
pnpm install
cp .env.example .env      # DATABASE_URL, BETTER_AUTH_SECRET, NEXT_PUBLIC_APP_URL
pnpm db:migrate
pnpm dev                  # http://localhost:3000
```

`BETTER_AUTH_SECRET`: `openssl rand -base64 32`. `DATABASE_URL`: cualquier Postgres
(Supabase, Neon, local). El env se valida al arrancar en `src/config/env.ts`.

### Convenciones del código

Los dominios viven en `src/core/<domain>/`:

| Capa | Contiene |
|---|---|
| `domain/` | zod `schemas.ts` + `types.ts` inferidos (única fuente de tipos) |
| `server/repository/` | acceso Drizzle (`import "server-only"` + `db` compartido) |
| `server/services/` | orquestación, devuelve `AsyncAppResult<T>`, valida ownership |
| `server/api/` | rutas hoja Elysia `*.route.ts` + `router.ts` del dominio |
| `client/` | hooks Eden/TanStack Query + UI shadcn |

Dominios de SELLO: `cafe/` · `consumption/` · `rewards/` · `campaign/`.

Reglas: toda respuesta usa el envelope `CommonResponse` (`{ response?, code, status }`);
los 4xx esperados son valores `err(AppErrors.x)`, no throws; las rutas autenticadas
llevan `.use(authed)` **y** `authed: true`.

**Añadir un dominio:** clonar `src/core/project/` → `src/core/<domain>/`, añadir
`schemas/<domain>-schema.ts` (exportar desde `schemas/index.ts`) y montar el router en
`src/server/router.ts` con `.use(<domain>Router)`. **Un router no existe hasta que se
hace `.use()` en `server/router.ts`.** Después: `pnpm db:generate && pnpm db:migrate`.

`src/core/project/` es el dominio de referencia del starter y se elimina una vez que
`cafe/` esté funcionando.

### Scripts

`pnpm dev | build | start` · `pnpm test` · `pnpm check` (Biome) · `pnpm typecheck` ·
`pnpm db:generate | db:migrate | db:studio`.

---

## Software de terceros reutilizado

Conforme a las reglas del track:

- **Base del proyecto:** [`S-kkipie/hackaton-starter`](https://github.com/S-kkipie/hackaton-starter),
  starter propio (Next + Elysia + Better Auth + Drizzle). El historial de git arranca
  después del KickOff (31 jul 2026, 16:00). Todo el MVP evaluable —contratos, proofs,
  vault, campañas, PWA— se desarrolla durante la hackathon.
- Bibliotecas open source listadas en `package.json`.

### Notas heredadas del starter

- OpenAPI (Scalar) es solo dev, en `/api/v1/openapi`.
- `eden-tanstack-react-query` está en `^0.1.10`; si un typing de proxy se rompe tras
  actualizar, fijar la versión.
- Los componentes de Better Auth UI se instalaron vía
  `pnpm dlx shadcn@latest add https://better-auth-ui.com/r/auth.json` y están vendorizados
  (editables) en `src/frontend/components/auth/`.
- `db.ts` usa `ssl: { rejectUnauthorized: false }` por comodidad con Postgres gestionado;
  revisar antes de producción.

---

## Documentación

- [**Spec maestra**](./docs/superpowers/specs/2026-08-06-sello-design.md) — diseño
  completo, economía con números, arquitectura, contratos, ventaja contra Blackbird,
  plan de 6 días, guion del demo, riesgos y registro de decisiones.
