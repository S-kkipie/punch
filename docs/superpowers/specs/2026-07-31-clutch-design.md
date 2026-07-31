# CLUTCH — Spec maestra

| | |
|---|---|
| **Fecha** | 2026-07-31 |
| **Estado** | Diseño aprobado — pendiente plan de implementación |
| **Evento** | Hackathon Ethereum Lima 2026 — Arbitrum Track |
| **Entrega** | ~2026-08-12 (12 días desde KickOff 31 jul 16:00) |
| **Red** | Arbitrum Sepolia (MVP) |
| **Juego** | Counter-Strike 2 |

---

## 1. Resumen

> **CLUTCH — every moment counts.**
> The identity and engagement layer for esports fandom.

Plataforma donde ver una competición de esports significa **participar, apostar,
coleccionar y construir una identidad verificable como fan**.

El stream es contenido prestado (embed de Twitch/YouTube). El producto real es el
**Esports Passport**: el historial verificable de todo lo que hiciste alrededor de
competiciones reales.

Durante la partida, un **agente de IA abre mercados de predicción en vivo** a partir
del estado real del juego (`1v3 clutch`, `bomba plantada`, `match point`). Los fans
apuestan, ganan XP y collectibles, y su historia se acumula on-chain.

**No somos "Twitch en blockchain".** El vídeo nunca toca la cadena.

---

## 2. Problema

### Para el fan

El fandom de esports está fragmentado en plataformas que no se hablan:

```text
Ve partidas          → Twitch / YouTube
Sigue resultados     → Liquipedia
Habla con comunidad  → Discord
Juega                → Steam / Riot
Compra merch         → tiendas separadas
```

Ninguna representa su historia. Cuando termina un stream con 40,000 espectadores,
toda esa interacción desaparece. Nadie puede afirmar de forma verificable:

> "Adrian sigue a AQP desde 2026, estuvo en su primera temporada, participó en 37
> partidos, acertó el 68% de sus predicciones y es uno de sus 500 founding supporters."

### Para equipos y torneos

Generan la audiencia, pero **la plataforma de distribución es dueña de la relación
con esa audiencia**. Un organizador universitario transmite en Twitch, junta 300
espectadores, termina el torneo y no se queda con nada.

---

## 3. Producto

### Core loop

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

### Las cuatro identidades

El registro on-chain no es solo de fans. Eso es lo que convierte el producto de
"app de badges" a **grafo social verificable de esports**:

```text
ORGS / TORNEOS  ──── crean matches, publican resultados oficiales
      │
   TEAMS ────────── rosters, palmarés, supporters
      │
  PLAYERS ───────── historial de equipos, logros
      │
    FANS ────────── Passport, XP, colección, predicciones
```

Cada entidad se registra con **su propia wallet**. Un torneo firma sus propios
resultados; la plataforma no puede inventarlos.

### Posicionamiento

```text
Twitch       → where you WATCH
Discord      → where you TALK
Liquipedia   → where you LEARN
Steam        → where you PLAY

              ↓

CLUTCH       → where your FANDOM lives
```

**Liquipedia documenta qué ocurrió en esports. CLUTCH documenta qué viviste tú
dentro de esports.**

---

## 4. Proof of Fandom

La primitiva del producto.

> **Tu historia como fan = la suma de acciones económicas verificables que tomaste
> alrededor de competiciones reales.**

### Qué cuenta como prueba

| Acción | Firmada por | Falsificable por la plataforma |
|---|---|---|
| Apostar en un mercado | el usuario | **No** |
| Comprar un MembershipPass | el usuario | **No** |
| Apoyar a un equipo | el usuario | **No** |
| Completar una quest on-chain | el usuario | **No** |
| Resultado oficial del match | el organizador | **No** |

**Decisión de diseño: no existe atestación de watch-time.**

Una versión anterior del diseño contemplaba heartbeats firmados por la plataforma
para probar que alguien "vio" un partido. Se descartó: era el único dato del sistema
falsificable por nosotros, y obligaba a pedir confianza. Al basar la prueba
exclusivamente en acciones económicas on-chain, **la transacción es la prueba** y no
queda nada que confiar.

Consecuencia positiva: el volumen de transacciones baja de decenas de miles por
partido a cientos, y cada una tiene valor real, así que pagar su gas tiene sentido.

Frase de pitch:

> Ni el equipo, ni el torneo, ni nosotros podemos reescribir tu historia como fan.

---

## 5. FanPassport vs MembershipPass

Distinción central del modelo de negocio.

| | **FanPassport** | **MembershipPass** |
|---|---|---|
| Qué es | Tu identidad global de esports | Producto de un equipo/torneo concreto |
| Cuántos | 1 por persona, permanente | N, uno por equipo/temporada |
| Precio | Gratis | De pago (lo cobra el equipo) |
| Transferible | **No** (soulbound, ERC-5192) | **Sí** (mercado secundario) |
| Alcance | Cross-team, cross-game, cross-torneo | Un equipo, un torneo |
| Contiene | XP, nivel, historial, colección | Acceso, utilidad, status |
| Analogía | Tu pasaporte | Ser socio del club |

```text
FanPassport      = QUIÉN ERES
MembershipPass   = QUÉ COMPRASTE / A QUIÉN APOYAS
```

El Passport es la **cuenta**. El MembershipPass es un **producto que se vende encima
de la cuenta**.

**Por qué el Passport no puede ser transferible:** si se puede comprar el nivel 47 de
otro, la reputación deja de significar algo y el proyecto entero se cae.

**Por qué el MembershipPass sí:** es lo que monetiza, y su escasez es el punto.

### Interacción

```text
comprar AQP Founder Pass  →  MembershipPass #47/500  (transferible)
                          →  achievement "AQP Founder" en tu Passport
                             (soulbound, permanente)
```

Si mañana vendes el Pass pierdes el acceso, **pero el achievement de haber sido
founder se queda contigo para siempre**. Historia ≠ propiedad.

---

## 6. AI Market Maker

> La IA **abre mercados de predicción en vivo** a partir del estado real de la partida.

**No hay análisis de vídeo.** Se descartó por latencia, coste e innecesario.

### Fuente de verdad: CS2 Game State Integration

```text
CS2 GSI
  el servidor de juego hace POST de JSON a nuestro endpoint (~10 Hz)
  contiene: players vivos, HP, bomba, economía, ronda, tiempo, score
  oficial, gratis, latencia ~0
```

Esto es el desbloqueo técnico de todo el pipeline: estado de juego real sin tocar un
solo frame de vídeo y sin depender de proveedores de datos de pago.

> **CS2 es una decisión de arquitectura, no de gusto.** Valorant no expone API pública
> en vivo; requeriría un proveedor comercial (GRID / PandaScore / Abios) y la IA
> perdería fuerza.

### Pipeline

```text
GSI stream (JSON, ~10 Hz)
        │
        ▼
┌─ DETECTOR (determinista, µs) ───────────────┐
│  1vX clutch, bomba plantada, eco round,     │
│  match point, low HP, comeback              │
└─────────────────────────────────────────────┘
        │  situación candidata + contexto
        ▼
┌─ AGENTE LLM (~1-2s) ────────────────────────┐
│  decide SI la situación merece mercado      │
│  redacta la pregunta en lenguaje natural    │
│  fija la duración de ventana                │
│  ► emite un PREDICADO DE RESOLUCIÓN         │
└─────────────────────────────────────────────┘
        │
        ▼
   LiveMarkets.openPool()          ← 1 tx
        │
   fans apuestan $CLUTCH (parimutuel)
        │
   GSI confirma outcome
        ▼
   LiveMarkets.settle()            ← 1 tx
        │
        ▼
   XP + collectible al Passport de los ganadores
```

### Invariante crítico: el LLM propone, el código liquida

El LLM **nunca** decide el ganador. Emite un predicado evaluable contra campos de GSI,
y un resolver determinista lo evalúa:

```json
{
  "question": "skkippie está 1v3 con 34 HP. ¿Gana el clutch?",
  "outcomes": ["Clutch", "Falla"],
  "windowSeconds": 12,
  "resolver": {
    "source": "gsi",
    "expr": "round.winner == 'CT' && round.survivors.CT >= 1"
  }
}
```

Si el predicado no es evaluable contra el esquema de GSI, **el mercado no se abre**.
Dejar que un LLM resuelva un mercado con dinero dentro sería un mercado no auditable.

### Por qué esta IA no es decorativa

Nadie puede escribir y abrir 40 micro-mercados por partido, con criterio de resolución
válido, en menos de 2 segundos, en vivo, para N partidos simultáneos. Es literalmente
el trabajo del agente. **Sin agente no hay producto.**

---

## 7. Ventana de mercado y defensa contra front-running

### Qué es la ventana

El tiempo durante el cual un pool acepta apuestas.

```text
t=0     GSI detecta 1v3 (skkippie, 34 HP, 3 CT vivos)
        │
        │  ← offset del delay del stream (calibrado por stream)
        ▼
t=12    POOL ABRE        el espectador ve el 1v3 justo ahora
        │
        │  ◄── VENTANA DE MERCADO (8s) ──►
        │
t=20    POOL CIERRA      el contrato rechaza apuestas posteriores
        │
t=27    ocurre el desenlace real
t=27    RESOLVER liquida contra GSI → paga
```

Dos restricciones en tensión:

```text
DEMASIADO CORTA   el humano no alcanza a reaccionar   → mínimo ~6-8s
DEMASIADO LARGA   sigue abierta con el desenlace ya
                  decidido                            → front-running
```

Antes de abrir, el agente valida `duración esperada > ventana + margen`. Si no se
cumple, no abre el mercado.

### Ventanas naturales en CS2

| Situación | Duración real | Ventana viable | Carril |
|---|---|---|---|
| Freeze time entre rondas | 15-20s | 15s | **Macro** |
| Pistol round | ~2 min | 20s | **Macro** |
| Match point | toda la ronda | 20s | **Macro** |
| Bomba plantada | 40s de timer | 12s | Micro |
| Clutch 1vX | 10-40s | 8s | Micro |

**Estrategia de dos carriles:**

- **Macro** — se abren en pausas naturales (freeze time), donde no está pasando nada
  en el juego. El delay del stream es irrelevante. Cimientos del producto.
- **Micro** — intra-ronda. Alto impacto en demo, exige calibración de delay.
  Es el número de circo, no los cimientos.

**Se construye macro primero.**

### El ataque: "¿y si alguien ve el stream sin delay?"

Reconocimiento honesto: **la asimetría de información no se puede eliminar.** Un
espectador con el cliente de CS2 abierto como observer tiene delay cero. Toda casa de
apuestas en vivo convive con esto. Lo que se hace es **acotarla y volverla
económicamente irrelevante**.

#### Defensa 1 — Parimutuel: la información privilegiada se diluye sola

No hay cuota fija que snipear. Pago = `stake / pool_ganador × pool_total`. Apostar
con información privilegiada te diluye a ti mismo:

```text
Pool inicial: 600 en A, 400 en B.  Insider sabe que gana A.

  apuesta   1,000  → A=1,600    total=2,000    cobra 1,250   → +25%
  apuesta  10,000  → A=10,600   total=11,000   cobra 10,377  → +3.8%
  apuesta 100,000  → …                                       → +0.4%
```

**Cuanto más explota la ventaja, peor es el retorno.** Un libro de cuota fija se
desangra con un sharp; un parimutuel se lo come.

#### Defensa 2 — Cierre contra el reloj del servidor, no del stream

GSI viene del servidor de juego. Es más rápido que cualquier feed del planeta:

```text
GSI (servidor)      t=0      ← nada es más rápido que esto
observer in-game    t=+0.5s
stream low-latency  t=+4s
Twitch estándar     t=+12s
```

`closesAt` se fija al abrir el pool, referenciado al reloj del servidor, con margen
conservador antes de que el desenlace pueda existir. El contrato rechaza cualquier
apuesta posterior. No es confianza, es un `require`.

#### Defensa 3 — Si la realidad adelanta a la ventana, se anula

```text
GSI detecta que la situación se resolvió ANTES de closesAt
        ↓
resolver llama voidPool()
        ↓
reembolso total, nadie gana, nadie pierde
```

**Preferimos anular mil pools antes que pagar uno injusto.**

#### Defensa 4 — Tope de apuesta por Passport

El edge residual queda acotado en valor absoluto. El tope es **por Passport, no por
wallet**; como el Passport es soulbound, dividirse en 100 wallets no multiplica el
tope. Sybil no es gratis.

#### Defensa 5 — El premio no es dinero retirable

`$CLUTCH` es testnet, sin cash-out. Lo que se gana de verdad es XP y collectibles
**soulbound, no vendibles**.

> Montar infraestructura de baja latencia para hacer front-running… y ganar reputación
> intransferible.

El incentivo económico para atacarlo es cero por construcción.

#### Respuesta de 20 segundos para el jurado

> "Toda casa de apuestas en vivo tiene asimetría de información. Los libros de cuota
> fija la sufren de verdad. Nosotros somos parimutuel, así que apostar con información
> privilegiada se diluye a sí mismo — cuanto más apuestas, menos ganas. Cerramos contra
> el reloj del servidor de juego, que es más rápido que cualquier stream. Si la realidad
> adelanta a la ventana, anulamos y reembolsamos. Y el premio es reputación
> intransferible, así que ni siquiera hay incentivo para atacarlo."

---

## 8. Por qué Arbitrum

No es una elección de patrocinio. Es un **requisito físico** del producto.

```text
Ventana de apuesta de un clutch:  ~10 segundos

Ethereum L1    12s / bloque,  $2-15 por tx     → imposible
Polygon PoS    2s,            barato           → justo
Arbitrum One   ~0.25s / bloque, ~$0.01 por tx  → cómodo
```

Un mercado que vive 10 segundos **no puede existir** en L1. Y se necesitan cientos de
apuestas pequeñas por partido, lo que exige que cada una cueste centavos.

Segundo motivo, complementario: las credenciales del Passport son **persistentes,
verificables, portables e interoperables** — una app de terceros puede reconocer un
achievement sin que nuestra base de datos sea la autoridad.

### Session keys: cómo caber en 10 segundos

```text
inicio del match  → el usuario aprueba una session key
                    límite: 500 $CLUTCH, expira al acabar el match
                    UNA sola firma

durante el match  → cada apuesta = 1 tap, sin popup, sin gas
                    (paymaster patrocina)
```

Sin esto el usuario tarda ~15s en confirmar en el wallet y la ventana ya cerró. Es un
**requisito funcional, no un lujo de UX**.

Wallet embebida con login por email. El jurado no debería instalar nada.

### $CLUTCH

ERC-20 propio en Arbitrum Sepolia + faucet en la app. El jurado entra, pulsa
"Get 1000 $CLUTCH", apuesta. Cero fricción, cero necesidad de testnet ETH.

Mercados **parimutuel** (sin casa, las cuotas las fija el pool): evita el problema de
quién aporta liquidez y esquiva la narrativa de casino.

---

## 9. Arquitectura

```text
┌──────────────── WEB2 ─────────────────┐   ┌────────── ARBITRUM ──────────┐
│                                       │   │                              │
│  Watch page (embed Twitch/YT)         │   │  EsportsRegistry             │
│  Chat                                 │   │  FanPassport (SBT)           │
│  Postgres + Drizzle                   │──▶│  LiveMarkets                 │
│  Indexer (lee eventos on-chain)       │◀──│  ClutchToken (ERC-20)        │
│                                       │   │  MembershipPass (ERC-721)    │
│  ┌─ AI MARKET MAKER ───────────────┐  │   │  Collectibles (ERC-1155 SBT) │
│  │ CS2 GSI endpoint                │  │   │                              │
│  │   → detector determinista       │  │   └──────────────┬───────────────┘
│  │   → agente LLM                  │  │                  │
│  │   → openPool / settle           │  │                  ▼
│  └─────────────────────────────────┘  │           lectura pública
└───────────────────────────────────────┘         (cualquier tercero)
             ▲
             │ session key, gasless
    ┌────────┴───────────┐
    │        FAN         │
    │  embedded wallet   │
    └────────────────────┘
```

**Regla de qué va on-chain:**

```text
ON-CHAIN                          OFF-CHAIN (Postgres)
────────────────────────          ────────────────────────
Passport (1 por fan)              vídeo
Identidad de team/player/org      chat
Resultados oficiales              rankings derivados
Apuestas y liquidación            analytics
Achievements y collectibles       telemetría
MembershipPass                    estado de GSI crudo
```

Regla: on-chain lo que quieres que **otra app reconozca**. Lo demás es Postgres.

---

## 10. Contratos

Red: **Arbitrum Sepolia**. Lenguaje: **Solidity** (Stylus/Rust descartado por curva
de aprendizaje dentro del evento).

| Contrato | Responsabilidad |
|---|---|
| `EsportsRegistry` | Orgs, teams, players, matches. Cada entidad con su wallet. Social graph. |
| `FanPassport` | ERC-721 soulbound. XP, nivel, historial. Solo módulos autorizados otorgan XP. |
| `LiveMarkets` | Pools parimutuel. `openPool` (rol agente), `settle` (rol resolver), `voidPool` + reembolso. |
| `ClutchToken` | ERC-20 `$CLUTCH` + faucet. Testnet. |
| `MembershipPass` | ERC-721 transferible. Supply limitado por equipo. Al comprar → achievement soulbound. |
| `Collectibles` | ERC-1155 soulbound. Achievements y moments derivados de resultados de mercados. |

### Invariantes

1. `FanPassport` es intransferible. `transferFrom` revierte siempre. Un Passport por
   dirección.
2. Solo direcciones con `XP_GRANTER_ROLE` pueden otorgar XP. Los granters son
   contratos, nunca EOAs.
3. `LiveMarkets` rechaza apuestas con `block.timestamp > closesAt`. `closesAt` es
   inmutable tras `openPool`.
4. Un pool solo puede terminar en `settled` o `voided`. `voided` reembolsa el 100% de
   cada stake.
5. Solo el registrante de un match (su wallet de org) puede publicar su resultado.
6. Tope de apuesta acumulado **por Passport y por pool**, no por dirección.
7. Ningún contrato custodia fondos más allá del pool activo.

---

## 11. Stack

Base: [`S-kkipie/hackaton-starter`](https://github.com/S-kkipie/hackaton-starter) —
Next 16 · React 19 · Elysia (`/api/v1`) · Better Auth · Drizzle + Postgres · Eden +
TanStack Query · shadcn/ui + Tailwind v4 · Vitest · Biome.

> Reutilización declarada conforme a las reglas del track. El historial de git de
> CLUTCH arranca después del KickOff (31 jul 16:00). Todo el MVP evaluable — contratos,
> agente de IA, mercados, Passport, watch experience — se desarrolla durante la
> hackathon.

Añadidos:

| Pieza | Elección |
|---|---|
| Contratos | Solidity + Foundry |
| Cliente de cadena | viem / wagmi |
| Wallet | embebida con login por email + session keys |
| Indexer | lector de eventos → Postgres |
| Agente | servicio Node con endpoint GSI + LLM |
| Vídeo | embed de Twitch (a cargo del equipo) |

---

## 12. Fuera de alcance

Decisiones explícitas de NO hacer, y por qué:

| Descartado | Motivo |
|---|---|
| **Streaming propio (CDN/transcoding)** | No es la ventaja del producto ni cabe en el evento. Agregador/embed, y se declara como decisión, no como limitación. |
| **Análisis de vídeo con VLM** | Latencia incompatible con ventanas de 8s. GSI da el mismo dato mejor y gratis. |
| **Heartbeats de watch-time** | Único dato falsificable por la plataforma. Eliminarlo fortalece la tesis. |
| **Merkle batching** | Innecesario al basar la prueba en acciones económicas. |
| **SDK público** | Solo se documenta como superficie de integración futura. No se construye. |
| **Dinero real** | Testnet, token sin valor, sin cash-out. Evita el problema regulatorio. |
| **Arbitrum Stylus / Rust** | Curva de aprendizaje dentro del evento. |
| **Token especulativo** | Explícitamente fuera de la tesis. `participa → construye historia → gana status`, no `compra token → especula`. |

---

## 13. Riesgos

| Riesgo | Mitigación |
|---|---|
| Front-running por stream más rápido | Parimutuel + cierre por reloj de servidor + void/refund + tope por Passport. Ver §7. |
| Mercado no resoluble (predicado inválido) | Validación del predicado contra el esquema GSI antes de `openPool`. Si falla, no se abre. |
| Agente LLM lento o caído | El detector determinista puede abrir mercados macro con plantillas fijas sin LLM. Degradación elegante. |
| Sin match real durante el evento | Torneo propio de CS2 con servidor propio. GSI funciona igual en un scrim. |
| Sybil para saltarse el tope | Tope por Passport soulbound + gating del minteo de Passport. Reconocido como imperfecto. |
| Embed de Twitch requiere dominio autorizado | Verificar el parámetro `parent` el día 1. Fallback: iframe de YouTube. |
| Integración entre squads | Congelar interfaces de contratos el día 2. Todos programan contra interfaces. |
| Regla de 4 integrantes del track | 12 desarrollan, 4 se inscriben. Los 4 inscritos deben figurar como autores principales en el historial de commits. |
| Nombre "CLUTCH" ya usado | Riesgo asumido para el hackathon. Verificar dominio y marca antes de constituir empresa. |

---

## 14. Entregables del track

| Requisito | Estado |
|---|---|
| Desplegado en red Arbitrum | Arbitrum Sepolia |
| Al menos un contrato funcional | 6 contratos |
| MVP funcional | Watch page + mercados en vivo + Passport |
| Video pitch (2-3 min) | Pendiente |
| Pitch deck (PDF) | Pendiente |
| Link demo | Pendiente |
| Video demo | Pendiente |
| Repo público | Este repo — pasar a público antes de la entrega |
| Direcciones de contratos + Arbiscan | Pendiente |
| Diagrama de arquitectura | §9, exportar a Excalidraw |
| Primer commit tras KickOff | Cumplido (31 jul, 17:xx) |

**Criterios de evaluación:** Innovación 25% · Ejecución técnica 25% · Impacto 20% ·
UX 15% · Presentación 15%.

---

## 15. Decisiones abiertas

1. **Contenido para la demo** — torneo propio de CS2 en vivo vs partida controlada
   grabada con timeline sincronizada. Recomendación: partida controlada propia, donde
   el delay se controla, para grabar los micro-mercados.
2. **Bot de Discord como segundo consumidor** — ~80 líneas leyendo `FanPassport` con
   viem. Refuerza el argumento de portabilidad sin construir el SDK. Opcional según
   capacidad.
3. **Reparto de squads** sobre las 12 personas.

---

## Registro de decisiones

| # | Decisión | Motivo |
|---|---|---|
| 1 | El vídeo nunca va on-chain; agregador vía embed | Coste, latencia, y no aporta valor |
| 2 | Proof of Fandom = acciones económicas, no watch-time | Elimina el único dato falsificable por la plataforma |
| 3 | IA abre mercados, no analiza vídeo | Latencia y coste; GSI da mejor dato gratis |
| 4 | El LLM propone, el resolver determinista liquida | Mercados con valor dentro deben ser auditables |
| 5 | Parimutuel en vez de cuota fija | Neutraliza la información privilegiada y no requiere liquidez de casa |
| 6 | FanPassport soulbound, MembershipPass transferible | Reputación no comprable; monetización sí |
| 7 | CS2 como juego | GSI es la única fuente de estado en vivo gratuita y oficial |
| 8 | Solidity, no Stylus | Curva de Rust dentro del evento |
| 9 | Macro markets antes que micro | Los macro son inmunes al delay del stream |
| 10 | SDK documentado, no construido | Coste alto, valor demostrable con menos |
