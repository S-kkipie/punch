# CLUTCH

> **every moment counts**
> The identity and engagement layer for esports fandom.

Ver una competición de esports debería significar **participar, apostar, coleccionar y
construir una identidad verificable como fan**. CLUTCH convierte cada partido que ves
en parte de tu historia.

Hackathon Ethereum Lima 2026 · Arbitrum Track · Arbitrum Sepolia · CS2

---

## El problema

El fandom de esports está fragmentado. Ves partidas en Twitch, sigues resultados en
Liquipedia, hablas en Discord, juegas en Steam. **Ninguna plataforma representa tu
historia como fan.**

Cuando termina un stream con 40,000 espectadores, toda esa interacción desaparece.
Nadie puede afirmar de forma verificable:

> "Adrian sigue a AQP desde 2026, participó en 37 partidos, acertó el 68% de sus
> predicciones y es uno de sus 500 founding supporters."

Y para equipos y torneos hay un segundo problema: **generan la audiencia, pero la
plataforma de distribución es dueña de la relación con esa audiencia.**

---

## La solución

```text
                  MATCH EN VIVO
                        │
              embed Twitch / YouTube
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
  AI live markets    Quests         Memberships
   (apostar)       (completar)    (comprar pase)
        │               │                │
        └───────────────┼────────────────┘
                        ▼
                   XP + $CLUTCH
                        │
                 ESPORTS PASSPORT
                        │
       ┌────────────────┼────────────────┐
       ▼                ▼                ▼
   Reputación      Collectibles      Acceso
```

Mientras ves la partida, un **agente de IA abre mercados de predicción en vivo** a
partir del estado real del juego:

> *"skkippie está 1v3 con 34 HP. ¿Gana el clutch?"* — 8 segundos para apostar.

Apuestas, ganas XP y collectibles, y tu historia se acumula on-chain de forma que
nadie —ni el equipo, ni el torneo, ni nosotros— puede reescribir.

---

## Proof of Fandom

> **Tu historia como fan = la suma de acciones económicas verificables que tomaste
> alrededor de competiciones reales.**

No hay atestación de watch-time. No hay "confía en nuestro servidor". Cada credencial
nace de una acción firmada por su dueño:

| Acción | Firmada por |
|---|---|
| Apostar en un mercado | el usuario |
| Comprar un MembershipPass | el usuario |
| Apoyar a un equipo | el usuario |
| Resultado oficial del match | el organizador |

**La transacción es la prueba.**

---

## Esports Passport

```text
ADRIAN
━━━━━━━━━━━━━━━━━━━━━━

CLUTCH LEVEL      47

CS2               LVL 32

TEAMS
AQP               LVL 38
Liquid            LVL 14

HISTORY
✓ AQP Founder
✓ Lima Major 2027
✓ 100 Matches
✓ 37 Predictions Won

COLLECTION
🏆 Championship   🔥 The Clutch
👑 Founder        🎯 Prediction Master
```

Steam registra lo que juegas. Twitch registra lo que ves. Liquipedia registra qué
ocurrió. **CLUTCH registra tu historia dentro de esports.**

| | **FanPassport** | **MembershipPass** |
|---|---|---|
| Qué es | Tu identidad global | Producto de un equipo concreto |
| Precio | Gratis | De pago |
| Transferible | **No** (soulbound) | **Sí** |
| Analogía | Tu pasaporte | Ser socio del club |

Vendes tu Founder Pass y pierdes el acceso, **pero el achievement de haber sido
founder se queda contigo**. Historia ≠ propiedad.

---

## La IA: mercados en vivo, sin analizar vídeo

```text
CS2 Game State Integration (JSON, ~10 Hz, latencia ~0)
        │
   DETECTOR determinista        1vX, bomba plantada, match point…
        │
   AGENTE LLM (~1-2s)           ¿merece mercado? pregunta, ventana,
        │                       y un PREDICADO DE RESOLUCIÓN
        ▼
   LiveMarkets.openPool()       parimutuel, 8-15s de ventana
        │
   GSI confirma outcome → settle → XP + collectible
```

**Invariante: el LLM propone, el código liquida.** El agente nunca decide el ganador;
emite un predicado evaluable contra campos de GSI y un resolver determinista lo evalúa.
Si el predicado no es válido, el mercado no se abre.

Nadie puede escribir y abrir 40 micro-mercados por partido, con criterio de resolución
válido, en menos de 2 segundos, en vivo. **Sin agente no hay producto.**

---

## Por qué Arbitrum

No es patrocinio, es física:

```text
Ventana de apuesta de un clutch:  ~10 segundos

Ethereum L1    12s / bloque,  $2-15 por tx     → imposible
Arbitrum One   ~0.25s / bloque, ~$0.01 por tx  → cómodo
```

Un mercado que vive 10 segundos **no puede existir** en L1, y se necesitan cientos de
apuestas pequeñas por partido.

Y como las credenciales viven on-chain, una app de terceros puede reconocer tu
achievement sin que nuestra base de datos sea la autoridad.

**Session keys** para que la apuesta quepa en la ventana: una firma al inicio del
match, después cada apuesta es 1 tap sin popup ni gas.

---

## Contratos

Arbitrum Sepolia · Solidity · Foundry

| Contrato | Responsabilidad |
|---|---|
| `EsportsRegistry` | Orgs, teams, players, matches. Grafo social. |
| `FanPassport` | ERC-721 soulbound. XP, nivel, historial. |
| `LiveMarkets` | Pools parimutuel. Open / settle / void + refund. |
| `ClutchToken` | ERC-20 `$CLUTCH` + faucet testnet. |
| `MembershipPass` | ERC-721 transferible. Supply limitado por equipo. |
| `Collectibles` | ERC-1155 soulbound. Achievements y moments. |

Direcciones desplegadas y enlaces a Arbiscan: *pendiente*.

---

## Front-running: cómo lo manejamos

La asimetría de información no se puede eliminar —un observer in-game siempre tendrá
delay cero. Se acota hasta volverla económicamente irrelevante:

1. **Parimutuel** — apostar con información privilegiada te diluye a ti mismo. Con
   1,000 ganas +25%; con 100,000 ganas +0.4%. Cuanto más explotas la ventaja, peor el
   retorno.
2. **Cierre por reloj del servidor de juego**, más rápido que cualquier stream.
3. **Void + reembolso** si la realidad adelanta a la ventana. Preferimos anular mil
   pools antes que pagar uno injusto.
4. **Tope por Passport** (soulbound), no por wallet. Sybil no es gratis.
5. **El premio no es dinero retirable** — es reputación intransferible. No hay
   incentivo económico para atacarlo.

Y los mercados **macro** se abren en freeze time, donde no está pasando nada: inmunes
al delay por construcción.

---

## Modelo de negocio

| Cliente | Monetización |
|---|---|
| Fans | Free + Premium |
| Teams | SaaS / fan CRM |
| Tournaments | SaaS / engagement infrastructure |
| Sponsors | Campañas y quests patrocinadas |

Arbitrum es infraestructura, **no es el modelo de negocio**. Nada de token
especulativo: `participa → construye historia → gana status → desbloquea`.

---

## Posicionamiento

```text
Twitch       → where you WATCH
Discord      → where you TALK
Liquipedia   → where you LEARN
Steam        → where you PLAY

              ↓

CLUTCH       → where your FANDOM lives
```

---

## Stack

Next 16 · React 19 · Elysia (`/api/v1`) · Better Auth · Drizzle ORM + Postgres ·
Eden + TanStack Query · zod · shadcn/ui + Tailwind v4 · LogTape · viem/wagmi ·
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

Reglas: toda respuesta usa el envelope `CommonResponse` (`{ response?, code, status }`);
los 4xx esperados son valores `err(AppErrors.x)`, no throws; las rutas autenticadas
llevan `.use(authed)` **y** `authed: true`.

**Añadir un dominio:** clonar `src/core/project/` → `src/core/<domain>/`, añadir
`schemas/<domain>-schema.ts` (exportar desde `schemas/index.ts`) y montar el router en
`src/server/router.ts` con `.use(<domain>Router)`. **Un router no existe hasta que se
hace `.use()` en `server/router.ts`.** Después: `pnpm db:generate && pnpm db:migrate`.

### Scripts

`pnpm dev | build | start` · `pnpm test` · `pnpm check` (Biome) · `pnpm typecheck` ·
`pnpm db:generate | db:migrate | db:studio`.

---

## Software de terceros reutilizado

Conforme a las reglas del track, se declara:

- **Base del proyecto:** [`S-kkipie/hackaton-starter`](https://github.com/S-kkipie/hackaton-starter),
  starter propio (Next + Elysia + Better Auth + Drizzle). El historial de git de CLUTCH
  arranca después del KickOff (31 jul 2026, 16:00). Todo el MVP evaluable —contratos,
  agente de IA, mercados, Passport, watch experience— se desarrolla durante la hackathon.
- **Counter-Strike 2 Game State Integration** (Valve) como fuente de estado de juego.
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

- [**Spec maestra**](./docs/superpowers/specs/2026-07-31-clutch-design.md) — diseño
  completo, arquitectura, contratos, defensa contra front-running, riesgos y registro
  de decisiones.
