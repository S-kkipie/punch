# SELLO — Spec maestra

| | |
|---|---|
| **Fecha** | 2026-08-06 |
| **Estado** | Diseño aprobado — pendiente plan de implementación |
| **Evento** | Hackathon Ethereum Lima 2026 — Arbitrum Track |
| **Entrega** | 2026-08-12 (~6 días desde el pivot) |
| **Red** | Arbitrum Sepolia |
| **Vertical** | Cafeterías |
| **Mercado inicial** | Arequipa, Perú |
| **Reemplaza a** | `2026-07-31-clutch-design.md` (CLUTCH, esports — descartado) |

---

## 1. Resumen

> **SELLO**
> El sello de tu cafetería, pero vale en toda la ciudad.

Red abierta de consumo, lealtad y adquisición para cafeterías, sobre Arbitrum.

Core en una línea:

> **Cada tap en el mostrador de una cafetería es un consumo verificable. Y toda plata
> que un café promete —rewards o campañas— está bloqueada en un contrato antes de
> prometerla.**

Dos primitivos. Todo lo demás se deriva de ellos:

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

Ni "rewards" ni "campañas" ni "settlement" son contratos separados. Son **usos del
mismo escrow con distinta condición de liberación**.

**No es un token especulativo.** 1 punto = S/0.01, fijo, respaldado 1:1.

---

## 2. Problema

### 2.1 La tarjeta de sellos es una isla

```text
Café A → sellos A
Café B → sellos B
Café C → sellos C
```

Cada cartón vale en un solo local. El consumidor acumula seis cartones a medio llenar
y no completa ninguno. El café no sabe nada del cliente más allá de los sellos que él
mismo puso.

### 2.2 El café pequeño no puede adquirir clientes

Una cafetería que abre hoy tiene tres canales:

| Canal | Costo | Qué compra |
|---|---|---|
| Volanteo | S/0.10 c/u | Impresiones. Cero atribución. |
| Instagram Ads | S/20-40 CAC | Un click. No sabe si la persona toma café. |
| Boca a boca | gratis | No se puede acelerar. |

Ninguno le permite decir: *"quiero a la gente que ya toma 15 cafés al mes en otro
lado y nunca entró acá"*. Esa persona existe, está a 300 metros, y es invisible.

### 2.3 Los puntos de loyalty son deuda no fondeada

Un programa de puntos es un pasivo que la empresa emisora puede devaluar cuando
quiera. Es exactamente lo que hacen las aerolíneas con las millas. El consumidor no
tiene forma de verificar que sus puntos están respaldados, porque no lo están.

---

## 3. Producto

### 3.1 Para el consumidor

```text
Entras a cualquier cafetería de la red
        │
   Escaneas el QR del mostrador
        │
   +120 puntos · racha día 7 🔥
        │
   Los gastas en CUALQUIER cafetería de la red
```

Nunca ve una wallet. Nunca paga gas. Nunca lee la palabra "blockchain".
Ve: puntos, racha, nivel, y ofertas de cafés cerca que le quieren pagar por probarlos.

### 3.2 Para el café

```text
Se registra solo:  wallet + nombre + geo + tag/QR    (sin comercial, sin permiso nuestro)
        │
   Deposita colateral      → puede emitir puntos
   Define tasa + reglas    → 10% base, 2x racha, 3x los martes
        │
   Ve su CRM: quién viene, cada cuánto, cuánto gasta, quién dejó de venir
        │
   Deposita presupuesto de campaña → compra clientes verificados de la competencia
```

### 3.3 Split de diseño: dónde vive cada cosa

| | Dónde vive | Cómo |
|---|---|---|
| **Lealtad** | En la **emisión** | Multiplicadores: racha 7 días → 2x · martes → 1.5x · 5ª visita → bonus · producto específico → 3x |
| **Portabilidad** | En el **canje** | 1 punto = S/0.01 en cualquier café. Sin castigo, sin letra chica. |

> **Ganas más donde eres fiel. Gastas donde quieras.**

Este split es la decisión de producto central. Resuelve la objeción del dueño del café
(*"¿por qué voy a regalar puntos que se gastan donde mi competencia?"*) sin romper la
portabilidad, que es lo único que hace a SELLO distinto de un cartón de sellos.

---

## 4. Economía

### 4.1 La unidad

**1 punto = S/0.01.** Fijo. Respaldado 1:1 por dinero depositado en el contrato.

No flota. No lo fijamos nosotros. No se puede devaluar. Está en el contrato.

En testnet el dinero es `mPEN`, un ERC-20 de prueba con faucet ("soles simulados").
En producción sería un stablecoin o custodia fiat. **Esto se declara explícito en el
demo.**

### 4.2 De dónde sale la plata

Del café. Tres bolsillos distintos, no se mezclan:

| Bolsillo | Para qué | Referencia |
|---|---|---|
| **Colateral de emisión** | Respaldar los puntos que reparte a **sus** clientes | ~10% de ventas |
| **Presupuesto de campaña** | Comprar clientes **nuevos** verificados | discrecional |
| **Suscripción** | Dashboard, CRM, segmentación, analytics | mensual |

El colateral **no es ingreso nuestro**. Es plata del café que vuelve a sus clientes.
Nosotros vivimos de campañas y suscripción.

### 4.3 Flujo A — El café se fondea

```text
Café Quinta deposita S/1,000 en RewardVault
        │
        ▼
Crédito de emisión: 100,000 puntos
        │
   (plata bloqueada; Quinta no la puede retirar
    mientras haya puntos suyos circulando)
```

**Emitir puntos que no puedes pagar es imposible: el contrato revierte.**

### 4.4 Flujo B — Consumo → emisión

Diego pide un cortado. S/12. Quinta tiene tasa 10%.

```text
Barista marca S/12 en su panel
        │
   QR:  { cafeId, 1200 céntimos, nonce, expiry, FIRMA DE QUINTA }
        │
   Diego escanea → su wallet firma
        │
   Backend relayea la tx y paga el gas
        │
        ├──→ ConsumptionLog.record()      proof con las 2 firmas
        │
        └──→ RewardVault.issue()          −120 del crédito de Quinta
                                          +120 puntos a Diego
        │
   Postgres: Coffee Score +, racha día 7
```

Diego ve: `+120 puntos · racha 7 días 🔥`

**10 cafés = 1,200 puntos = S/12 = un cortado gratis.** Es la misma matemática que el
cartón de sellos de toda la vida. A propósito.

### 4.5 Flujo C — Canje (en cualquier café)

Diego tiene 1,200 puntos. Entra a **Café Tostado**, que nunca lo vio.

```text
Diego: "pago con puntos"
        │
   Escanea el QR de Tostado (S/12)
        │
   RewardVault.redeem(1200)
        │
        ├──→ quema 1,200 puntos
        │
        └──→ transfiere S/12 del pool a Tostado
        │
   Tostado cobró completo, al instante, sin factura,
   sin cobranza, sin confiar en nadie.
```

### 4.6 Por qué NO hay deuda entre cafés

Esto corrige el diseño original del documento fuente, que proponía un settlement layer
para registrar obligaciones entre comercios.

**No hace falta.** La emisión es **prefondeada**: la plata ya está en el pool desde que
Quinta la depositó.

```text
   DISEÑO ORIGINAL (deuda)        SELLO (prefondeado)

   A emite ────► usuario          A DEPOSITA ────► pool
        │                              │
        │  usuario gasta en B          │  usuario gasta en B
        ▼                              ▼
   B le reclama a A               B cobra del pool
        │                              │
   ¿y si A no paga?               ya estaba pagado
   ¿quién arbitra?                no hay nada que arbitrar
```

Cero riesgo de contraparte. Cero cobranza. Liquidación instantánea. Más simple **y**
más fuerte.

### 4.7 Flujo D — Campaña de adquisición

Café Tostado abre. Cero clientes. Deposita **S/500**.

```text
CAMPAÑA — Tostado

Segmento:
  Coffee Score > 500          (≈15+ cafés/mes verificados)
  Nunca hizo tap en Tostado
  Radio 2 km

Reward:
  S/5 en puntos, al primer consumo

Presupuesto:
  S/500  →  100 conversiones máx.
```

El contrato retiene los S/500. Diego califica → le llega la oferta → camina → tap →
**el contrato le paga solo**. Tostado no aprobó nada. Nosotros tampoco.

| Canal | Costo | Qué compra |
|---|---|---|
| Volanteo | S/0.10 c/u | Impresiones, sin atribución |
| Instagram Ads | S/20-40 CAC | Un click, sin saber si toma café |
| **SELLO** | **S/5 verificado** | Una persona que **entró y consumió**, con historial de 15 cafés/mes |

> **Pagas por consumo. No por impresión, no por click.**

Si el 30% vuelve solo: CAC real ≈ S/17 por cliente recurrente.

### 4.8 Coffee Score

Se calcula **off-chain** a partir de los proofs on-chain. Fórmula del MVP, ajustable:

```text
score =  15 × visitas_30d
       +  5 × cafés_distintos_90d
       + 0.5 × soles_90d
       +  2 × racha_actual
                                       (cap 1000)
```

| Tier | Score |
|---|---|
| Bronce | < 200 |
| Plata | 200 – 499 |
| Oro | 500 – 799 |
| Negro | 800 + |

Los proofs son la fuente de verdad y viven en la cadena. La fórmula es nuestra y puede
cambiar; cualquiera puede calcular la suya con los mismos proofs.

---

## 5. Arquitectura

### 5.1 Qué va en la cadena y qué no

| Arbitrum Sepolia | Postgres |
|---|---|
| Proofs de consumo | Coffee Score, rachas, tiers |
| Colateral de puntos | Segmentación y matching de campañas |
| Emisión / canje | Notificaciones, geo, catálogo, fotos |
| Presupuesto y payout de campaña | Dashboards, analytics, CRM, UI |

**Regla:** la cadena guarda **plata y compromisos**. Postgres guarda todo lo demás.

Respuesta a *"¿por qué no todo en Postgres?"*: porque Postgres no puede impedir que
**nosotros** devaluemos tus puntos, ni que un café emita puntos que no puede pagar.

### 5.2 Contratos

Solidity · Foundry · Arbitrum Sepolia · en `contracts/`

| Contrato | Responsabilidad |
|---|---|
| `CafeRegistry` | Café se registra solo: wallet, nombre, geohash. Permissionless. |
| `ConsumptionLog` | Recibe proofs con las dos firmas (EIP-712). Es el consumption graph. |
| `RewardVault` | ERC-20 de puntos **100% colateralizado**. Colateral pooled. Emitir = descontar crédito. Canjear = quemar y pagar. |
| `CampaignEscrow` | Presupuesto retenido + condición de liberación + payout automático por proof calificado. |
| `MockPEN` | ERC-20 de prueba con faucet. Solo testnet. |

`RewardVault` es el diferencial contra Blackbird (colateral vs política monetaria
discrecional). `CampaignEscrow` es el clímax del demo.

### 5.3 El tap, en concreto

**Dato duro: iOS no permite leer NFC desde una PWA.** Web NFC es solo Chrome/Android.
Con 6 días, NFC nativo no entra.

→ **QR dinámico en el mostrador**, en la tablet o el celular del café:

```text
{ cafeId, montoCentimos, nonce, expiry, sigCafe }
```

El nonce y el expiry impiden replay. La firma del café impide que un tercero fabrique
un cobro a su nombre. La firma del consumidor impide que el café acredite consumos a
gente que no estuvo.

El **puck NFC** queda como upgrade post-hackathon, y como la foto del pitch.

### 5.4 Wallet y gas

El consumidor no ve wallet ni paga gas.

| | Hackathon (6 días) | Producción |
|---|---|---|
| Clave del usuario | Custodial, cifrada en Postgres | Privy MPC / account abstraction |
| Gas | Relayer EOA nuestro paga todo | Paymaster |

**Honestidad requerida:** con clave custodial, la "firma del consumidor" la produce
nuestro servidor en su nombre, así que la garantía criptográfica del MVP es más débil
que la del diseño. El diseño es de firmas y **no cambian los contratos** al pasar a
no-custodial. Esto se dice en el demo si preguntan; no se esconde.

### 5.5 Backend

Stack existente del starter, sin cambios estructurales.

Dominios nuevos en `src/core/`:

| Dominio | Contiene |
|---|---|
| `cafe/` | Registro, perfil, catálogo, reglas de emisión, panel de cobro |
| `consumption/` | Emisión del QR firmado, verificación, relay, mirror de proofs |
| `rewards/` | Saldo de puntos, canje, colateral, Coffee Score, racha, tier |
| `campaign/` | Creación, segmentación, matching, notificación, conversión |

Cada uno sigue la convención del starter: `domain/` (zod + tipos) →
`server/repository/` → `server/services/` (`AsyncAppResult<T>`) → `server/api/` →
`client/`. Un router no existe hasta que se hace `.use()` en `src/server/router.ts`.

El dominio de referencia `src/core/project/` se elimina una vez que `cafe/` está
funcionando.

### 5.6 Superficies

| Superficie | Ruta | Contenido |
|---|---|---|
| **PWA consumidor** | `/app` | Escanear, saldo, racha, Coffee Score, mapa de cafés, canje, ofertas |
| **Panel de cobro** | `/cafe/pos` | Barista marca monto → QR firmado en pantalla |
| **Dashboard café** | `/cafe` | Registro, fondeo, reglas de emisión, CRM, campañas, analytics |

---

## 6. Por qué Arbitrum

No es adorno. Tres razones concretas:

**1. Precedente directo.** Blackbird —la referencia del sector, fundada por el creador
de Resy— corre en **Flynet, un L3 de Arbitrum Orbit**. Eligieron Arbitrum por block
times bajos y gas token propio. El caso de uso ya está probado sobre este stack.

**2. Costo por proof.** Un café con 200 tickets/día genera 200 proofs diarios. A
precios de L1 el modelo no existe. En Arbitrum cada proof cuesta una fracción de
céntimo, y el relayer puede absorberlo sin trasladarlo al usuario.

**3. Neutralidad verificable.** El argumento no es velocidad, es que **nosotros no
podemos hacer trampa**. El colateral, el peg y las condiciones de campaña están en el
contrato. Si SELLO desaparece mañana, los cafés recuperan su colateral y los usuarios
canjean sus puntos. Eso en Postgres no se puede prometer.

---

## 7. Ventaja frente a Blackbird

Blackbird (Ben Leventhal, ex-Resy/Eater): puck NFC en el mostrador, `$FLY` como moneda
de red, Blackbird Pay al 2% vs 3.5-4% de tarjeta, L3 en Arbitrum Orbit, +100k wallets,
NYC / LA / Charleston.

Cinco grietas reales:

**1. Su modelo depende de ser el rail de pago — y por eso no puede entrar a Perú.**
Su 2% requiere que el comensal pague con la app. Acá se paga con efectivo, Yape y
Plin. Nuestro proof depende del **tap**, no del pago. No es una limitación nuestra:
es la razón por la que existimos donde ellos no pueden.

**2. Política monetaria discrecional.** Blackbird Labs fija el valor de `$FLY` desde un
panel interno — el mismo problema de las millas que dicen resolver. SELLO: colateral
obligatorio, peg en el contrato. **No podemos devaluar aunque queramos.** Ese "no
podemos" es el producto.

**3. Onboarding a mano.** NYC, LA y Charleston en ~3 años, curado e invite-only.
SELLO: **permissionless**. Wallet + nombre + QR + 5 minutos. Sin comercial. La red
crece sin nosotros.

**4. App cerrada, no protocolo.** Su data vive adentro. El consumption graph de SELLO
es legible on-chain: un tercero construye su app de barrio, su marketplace o su wallet
sin pedirnos permiso.

**5. Restaurantes = frecuencia baja. Cafés = frecuencia diaria.** Cena: 1-4 veces al
mes. Café: todos los días. Con los mismos usuarios el grafo se densifica ~20x más
rápido. Y rachas, hábitos y tiers **solo funcionan con frecuencia diaria**. Ellos
eligieron el ticket alto; nosotros la frecuencia — y la frecuencia es lo que construye
grafo.

**Línea de pitch:**

> Blackbird necesita ser el medio de pago. Acá el medio de pago es efectivo y Yape.
> Nuestro proof no depende de cómo pagas — depende del tap.
> Y quién emite, cuánto, y con qué respaldo, está en el contrato. No en nuestro panel
> de admin.

---

## 8. Modelo de negocio

| Fuente | Cuánto | Por qué |
|---|---|---|
| **Campaign fee** | 10-15% del presupuesto | Donde está el valor. El café mide ROI directo. |
| **SaaS** | mensual por café | Dashboard, CRM, segmentación, analytics |
| Redemption fee | **0%** | A propósito. El canje limpio es lo que hace que el usuario confíe en los puntos. |
| API / infra | v2 | Terceros integran el consumption graph |

Arbitrum es infraestructura, **no es el modelo de negocio**. Sin token especulativo.

---

## 9. Entrada al mercado

Densidad antes que cobertura.

```text
AREQUIPA — Centro + Yanahuara + Cayma

  25 cafeterías
        ↓
  radio caminable de 15 min
        ↓
  el usuario SIEMPRE tiene dónde ganar y dónde gastar
```

El umbral no es número de cafés: es que el usuario nunca esté a más de 5 minutos de un
local de la red. Sin eso, los puntos portables no valen nada y volvemos al cartón.

---

## 10. Alcance del hackathon

### 10.1 Sí entra

- 5 contratos desplegados y verificados en Arbitrum Sepolia, con tests Foundry
- Flujo completo tap → proof on-chain → puntos
- Canje en un café distinto al que emitió
- Campaña: crear, fondear, segmentar, notificar, convertir, pagar
- PWA consumidor + panel de cobro + dashboard café
- Red simulada sembrada: ~8 cafés, ~50 consumidores, ~3 meses de historial

### 10.2 No entra (declarado)

Pagos y rail de cobro · integración con POS · on-ramp fiat · mainnet · NFC nativo ·
app nativa · **expiración de puntos (breakage)** · multi-ciudad · marketplace ·
wallet no-custodial · token especulativo.

### 10.3 Plan de 6 días

| Día | Fecha | Entregable |
|---|---|---|
| 1 | 6 ago | Contratos `CafeRegistry` + `ConsumptionLog` + `RewardVault` + `MockPEN`, tests, deploy a Sepolia. Schema Postgres. |
| 2 | 7 ago | `CampaignEscrow`. Relayer. Flujo tap end-to-end: QR firmado → escaneo → proof on-chain. |
| 3 | 8 ago | PWA consumidor: escanear, saldo, racha, score, canje. |
| 4 | 9 ago | Dashboard café: registro, fondeo, reglas, panel de cobro, crear campaña. |
| 5 | 10 ago | Matching de campañas, seed de red simulada, CRM, pulido visual. |
| 6 | 11 ago | Guion, video, deck, README final, ensayo. |
| — | 12 ago | Entrega. |

---

## 11. Guion del demo (3 minutos)

```text
0:00  "Todos tienen seis cartones de sellos a medio llenar. Ninguno completo."

0:20  PANTALLA CAFÉ QUINTA — barista marca S/12 → QR en pantalla
      PANTALLA CELULAR     — escaneo → "+120 puntos · racha día 7 🔥"
      → link a Arbiscan: el proof, con las dos firmas
      "Eso acaba de pasar en Arbitrum. Costó una fracción de céntimo.
       Yo no vi una wallet ni pagué gas."

1:00  CAMINO A CAFÉ TOSTADO — pago un cortado 100% con puntos ganados en Quinta
      "Tostado cobró S/12 al instante. No le reclama nada a Quinta:
       Quinta ya había depositado. No hay deuda entre cafés."

1:30  ── CLÍMAX ──
      DASHBOARD TOSTADO — café nuevo, cero clientes
      Campaña: Coffee Score > 500 · nunca vino acá · 2 km · S/5 · budget S/500
      → deposita en el contrato
      CELULAR: llega la oferta. Camino. Tap.
      → el contrato me paga solo. Presupuesto baja, saldo sube.
      "Tostado no aprobó nada. Nosotros tampoco. Y pagó S/5 por una persona
       que verificablemente toma 15 cafés al mes. Instagram le cobra S/30
       por un click."

2:30  "Blackbird hace esto en Nueva York, pero necesita ser el medio de pago.
       Acá se paga con Yape y efectivo. Nuestro proof es el tap.
       Y el respaldo de los puntos está en el contrato, no en nuestro admin.
       No podemos devaluarlos aunque quisiéramos."

2:50  SELLO. El sello de tu cafetería, pero vale en toda la ciudad.
```

---

## 12. Riesgos y huecos abiertos

**Breakage.** Los programas de loyalty ganan con los puntos que nadie canjea. Acá esa
plata queda bloqueada y el café no la recupera. Solución diseñada: **expiración a 12
meses**, colateral devuelto al emisor, anunciada de antemano y escrita en el contrato
—no un cambio sorpresa como hacen las aerolíneas. **No se implementa en el hackathon.**

**Cold start.** Segmentar "toma 15 cafés/mes" requiere red densa. En el demo es data
sembrada y se declara como *"simulación de 3 meses de red en Arequipa"*. Mentir en
esto es la forma más rápida de perder en preguntas.

**Colusión café-usuario.** Un café podría firmar consumos falsos para farmear campañas
ajenas. Defensas: la campaña la fondea el café que **recibe** al cliente (falsear es
pagarse a sí mismo); el proof necesita la firma del consumidor; tope por usuario por
campaña; Coffee Score exige historial en **cafés distintos**, no volumen en uno solo.

**Custodia de claves.** El MVP es custodial. Riesgo real declarado en §5.4, con ruta de
migración que no toca los contratos.

**Peg fiat.** `mPEN` en testnet no resuelve cómo entra y sale plata real. Es el
problema #1 post-hackathon y no se finge resuelto.

**Privacidad.** El consumption graph es público. Un tercero puede perfilar hábitos de
consumo por dirección. Mitigación v2: proofs con compromiso y revelación selectiva. En
el MVP, direcciones seudónimas y sin PII on-chain.

---

## 13. Stack

Next 16 · React 19 · Elysia (`/api/v1`) · Better Auth · Drizzle ORM + Postgres ·
Eden + TanStack Query · zod · shadcn/ui + Tailwind v4 · LogTape · viem ·
Solidity + Foundry · Vitest · Biome.

Base: [`S-kkipie/hackaton-starter`](https://github.com/S-kkipie/hackaton-starter),
starter propio. Todo el MVP evaluable —contratos, proofs, vault, campañas, PWA— se
desarrolla durante la hackathon.

---

## 14. Registro de decisiones

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 1 | Solo cafeterías | Multi-vertical (restaurantes, cines, gimnasios) | Frecuencia diaria densifica el grafo ~20x más rápido; rachas y hábitos solo funcionan con frecuencia alta |
| 2 | Emisión prefondeada, sin deuda entre cafés | Settlement layer que registra obligaciones | Elimina riesgo de contraparte y cobranza. Más simple y más fuerte |
| 3 | Lealtad en la emisión, portabilidad en el canje | Canje asimétrico (más caro fuera del emisor) | Preserva el incentivo del café sin ensuciar la promesa al usuario |
| 4 | 1 punto = S/0.01 fijo, colateral 100% | Token con valor flotante | El peg fijo respaldado **es** el diferencial contra Blackbird |
| 5 | 0% fee en canje | Comisión por redención | El canje limpio es lo que hace creíbles los puntos; el ingreso sale de campañas |
| 6 | QR dinámico firmado | NFC | iOS no permite Web NFC en PWA. NFC es upgrade post-hackathon |
| 7 | Wallet custodial en el MVP | Privy / AA desde el día 1 | 6 días. Los contratos no cambian al migrar |
| 8 | Campañas como clímax del demo | Canje cruzado como clímax | El canje cruzado es el core de Blackbird; la campaña es lo que nadie hace y además es el modelo de negocio |
| 9 | Escrow como primitivo único | Contratos separados para rewards y campañas | Campaña y colateral son el mismo patrón: bloquear plata, liberar por condición |
| 10 | Arbitrum Sepolia, no Orbit propio | L3 propio tipo Flynet | Fuera de alcance en 6 días. Orbit es la ruta post-hackathon |
