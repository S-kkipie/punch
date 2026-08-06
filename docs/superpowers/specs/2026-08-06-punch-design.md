# PUNCH — Spec maestra

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

> **PUNCH**
> Tu tarjeta de sellos, pero vale en toda la ciudad.
> *Your punch card, everywhere.*

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
portabilidad, que es lo único que hace a PUNCH distinto de un cartón de sellos.

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
   DISEÑO ORIGINAL (deuda)        PUNCH (prefondeado)

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

### 4.7 Flujo D — Campañas

Tres tipos, un solo contrato. Solo cambia la condición de liberación.

#### 4.7.1 Adquisición

Café Tostado abre. Cero clientes. Deposita **S/500**.

```text
CAMPAÑA — Tostado · Adquisición

Segmento:
  Coffee Score > 500          (≈15+ cafés/mes verificados)
  Nunca hizo tap en Tostado
  Radio 2 km
  Ventana: L-V, 14:00-17:00   ← ver 4.8

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
| **PUNCH** | **S/5 verificado** | Una persona que **entró y consumió**, con historial de 15 cafés/mes |

> **Pagas por consumo. No por impresión, no por click.**

Si el 30% vuelve solo: CAC real ≈ S/17 por cliente recurrente.

#### 4.7.2 Win-back — la campaña que solo una red puede construir

Seillo ve que un cliente frecuente **dejó de venir**. PUNCH ve que **se fue al café de
la esquina, hace tres semanas, y ya lleva seis visitas allá**.

```text
CAMPAÑA — Quinta · Recuperar

Segmento:
  Era cliente mío: >8 visitas en 90d
  No viene hace 21 días
  SIGUE consumiendo café en la red     ← esto es lo imposible de replicar

Reward:
  S/8
```

Ninguna herramienta single-merchant puede construir esto ni con presupuesto infinito,
porque la evidencia de deserción vive fuera de las paredes del café. Y convierte mejor
que la adquisición: recuperar a alguien que ya te conocía es más barato que conseguir a
un desconocido.

#### 4.7.3 Café crawl — campaña multi-café

```text
CAMPAÑA — Crawl Centro (financiada entre 3 cafés)

Condición:
  Tap en Quinta + Tostado + Barranco
  dentro de 7 días

Reward:
  S/15 al completar

Presupuesto:
  S/1,500, aportado en tercios
```

Es el único tipo de campaña que **exige** que la red exista: tráfico cruzado que ningún
producto single-merchant puede generar. Y hace tangible el argumento de §12: los cafés
cooperando para hacer crecer la categoría en vez de repartirse la misma torta.

Es también la única de las mejoras que toca contratos de verdad: `CampaignEscrow`
necesita condiciones multi-merchant y aportes de varios financiadores.

### 4.8 Ventana horaria: por qué no es opcional

Una campaña sin restricción horaria puede pagar S/5 por alguien que llega **a las 9am**,
cuando la cafetería ya está llena. Ese asiento se iba a ocupar igual.

Cortado S/12 · COGS ~S/3 · alquiler y barista son **costo hundido**:

```text
  9am (lleno)      el asiento se llenaba igual
                   12 − 3 − 5 = +4  ... pero desplazó a un cliente
                                        que dejaba 12 − 3 = 9
                   →  DESTRUYE VALOR

  3pm (muerto)     ese asiento no se llenaba
                   12 − 3 − 5 = +4  que no existía
                   →  CREA VALOR
```

**El café no regala margen: vende inventario que se le vencía.** Es yield management de
aerolínea aplicado a mesas vacías, y reencuadra la conversación entera — deja de ser
*"cuánto me cuesta la lealtad"* y pasa a ser *"cuánto recupero de mis horas muertas"*.

Por eso la ventana horaria es un campo de primera clase en la condición de campaña, no
un filtro opcional. El default sugerido al café es su propia franja de menor ocupación,
calculada con sus propios proofs.

### 4.9 Subasta: los cafés compiten por el consumidor, en abierto

Cuando varias campañas califican para la misma persona, no se resuelve por orden de
llegada. Se ordenan por lo que cada café está dispuesto a pagar.

```text
    HOY TE QUIEREN INVITAR

    La Quinta      S/7   ← 2-5pm
    Tostado        S/5
    Barranco       S/4
```

Tres consecuencias:

1. **El mercado descubre cuánto vale un cliente.** No lo fijamos nosotros.
2. Es el mecanismo de Google Ads — la razón por la que Google Ads es una máquina de
   plata y el volanteo no.
3. Del lado del consumidor: Fetch te da 25 puntos por tu recibo y le vende tu data a las
   marcas; Cardlytics segmenta tu consumo dentro del app del banco sin que lo sepas.
   **Acá ves las tres ofertas que compiten por ti y eliges.** Ninguno de los dos puede
   ofrecer eso sin admitir que vende tu data.

En el MVP la subasta es un orden por monto sobre los matches. Subasta sellada y bidding
dinámico son v2.

### 4.10 Coffee Score

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
| Condición y progreso del crawl | Orden de la subasta, detección de deserción |

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
| `CampaignEscrow` | Presupuesto retenido + condición de liberación + payout automático por proof calificado. Soporta **varios financiadores** por campaña y **condiciones multi-merchant** (café crawl). |
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
contrato. Si PUNCH desaparece mañana, los cafés recuperan su colateral y los usuarios
canjean sus puntos. Eso en Postgres no se puede prometer.

---

## 7. Panorama competitivo

### 7.1 Mapa

| | Qué es | Escala | Relación con PUNCH |
|---|---|---|---|
| **Blackbird** | Puck NFC, `$FLY` de red, Blackbird Pay 2%, Flynet (L3 Arbitrum Orbit → Base) | NY / SF / Charleston · 500+ restaurantes · $85M (a16z, Coinbase, Spark, **Amex**) · 70% retención · +100k wallets | Referencia del sector. No puede entrar a Perú. |
| **Seillo** | Sellos digitales, QR, rachas, tiers Regular→VIP. *"Haz que los clientes de tu cafetería vuelvan"* | Lima · Malvatech S.A.C. · S/0 / 152 / 319 al mes | **Competencia local directa.** Single-merchant. |
| **Morita** | Tarjetas digitales, QR, 11 plantillas (café incluido) | Perú · *"gratis para siempre"* | Presión de precio sobre el SaaS. |
| **Cardlytics** | Ofertas card-linked en la app del banco; segmenta "quien gastó en tu competencia" | US, empresa pública | **Nuestra tesis de campañas, ya a escala.** |
| **Fivestars / SumUp** | Red de loyalty para SMBs, dos lados | 70M usuarios · 12k comercios · $3B/año · vendida en $317M | Coalición SMB que **sí funcionó**, sin cripto. |
| **Fetch Rewards** | Escaneas el recibo → puntos; las marcas pagan por la prueba de compra | US | Proof of consumption **sin tocar al comercio**. |
| **Hang** | Membresías NFT (Ulta, Budweiser, Cinemark, Boba Guys) | $16M Serie A (Paradigm) | Infra web3 loyalty. |
| **Yape Promos** | Promos de comercios dentro de Yape | Perú · 15.9M usuarios activos (2025) | **El riesgo estratégico real.** |
| **Loyverse · Loopy · letstamp · Loyapp** | SaaS de sellos digitales | Global | Commodity. |

### 7.2 Blackbird

Ben Leventhal (ex-Resy/Eater). Puck NFC en el mostrador, `$FLY` como moneda de red,
Blackbird Pay al 2% vs 3.5-4% de tarjeta, Flynet como L3 de Arbitrum Orbit que asienta
en Base.

Cinco grietas reales:

**1. Su modelo depende de ser el rail de pago — y por eso no puede entrar a Perú.**
Su 2% requiere que el comensal pague con la app. Acá se paga con efectivo, Yape y
Plin. Nuestro proof depende del **tap**, no del pago. No es una limitación nuestra:
es la razón por la que existimos donde ellos no pueden.

**2. Política monetaria discrecional.** Blackbird Labs fija el valor de `$FLY` desde un
panel interno — el mismo problema de las millas que dicen resolver. PUNCH: colateral
obligatorio, peg en el contrato. **No podemos devaluar aunque queramos.** Ese "no
podemos" es el producto.

**3. Onboarding a mano.** NY, SF y Charleston en ~3 años, 500 restaurantes, curado e
invite-only. PUNCH: **permissionless**. Wallet + nombre + QR + 5 minutos. Sin
comercial. La red crece sin nosotros.

**4. App cerrada, no protocolo.** Su data vive adentro. El consumption graph de PUNCH
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

### 7.3 Seillo y Morita — la competencia local

**Seillo** (Lima, Malvatech S.A.C.) es el competidor más cercano que existe hoy en
Perú. Su headline literal: *"Haz que los clientes de tu cafetería vuelvan"*.
Cafeterías, QR en el mostrador, sellos, rachas diarias, niveles Regular→VIP. S/0 /
S/152 / S/319 al mes.

Lo que **no** tiene: es **single-merchant**. Su plan Growth ofrece *"hasta 3 locales"*
— tres sucursales del mismo dueño, no tres negocios distintos. Sin portabilidad, sin
red, sin campañas, sin colateral.

**Morita** (Perú) es lo mismo en versión gratuita: tarjetas digitales con QR, 11
plantillas incluida café, sin funciones de adquisición.

La línea que nos separa de ambos:

> **Ellos digitalizan el cartón. Nosotros lo hacemos valer en toda la ciudad, y encima
> el café puede comprar clientes verificados de la competencia.**

Consecuencia de precio: **Morita es gratis**. Nuestro plan SaaS no puede competir por
precio contra gratis — compite por lo que el cartón digitalizado no puede dar: red y
adquisición. Si el SaaS es la principal fuente de ingreso, el modelo está mal armado.
Por eso el ingreso principal es el campaign fee.

### 7.4 Los no-cripto que sí funcionan

**Cardlytics** valida la tesis de campañas y a la vez la ataca: ya existe segmentar
*"quien gastó en tu competidor, clientes perdidos, compradores de la categoría"*, a
escala, con data transaccional real, dentro de la app del banco.

Diferencias a nuestro favor: corre sobre rieles de tarjeta (en Perú el consumo de café
es efectivo y Yape), el comercio pequeño no accede, la data la controla el banco, y el
consumidor no participa voluntariamente ni cobra directo.

**Fivestars / SumUp** es la prueba de que una coalición de loyalty para comercios
pequeños puede funcionar: 70M usuarios, 12k comercios, $3B en ventas locales anuales,
vendida en $317M. También es la prueba de que se puede hacer sin blockchain — con el
costo de que el operador central es dueño de todo.

**Fetch Rewards** demuestra que el proof of consumption no necesita al comercio: basta
el recibo. Es la ruta alternativa si el onboarding de cafés resulta más lento de lo
previsto, y vale tenerla en el bolsillo.

### 7.5 Yape — el riesgo estratégico real

No es Blackbird. Es Yape: 15.9M usuarios activos en Perú y **ya tiene promociones de
comercios dentro de la app**. Si decide hacer loyalty transversal, tiene una
distribución que nosotros no vamos a tener nunca.

Contra-argumento, y es el mismo argumento del producto: Yape es un rail cerrado de
Credicorp. Reproduce exactamente el problema de neutralidad —una empresa dueña del
balance, las reglas y la relación con el cliente— y un café no le entrega su relación
con el cliente al banco que además le cobra la comisión.

### 7.6 Los dos cementerios

**Starbucks Odyssey.** Lanzado dic 2022, cerrado **marzo 2024**. Causa citada de forma
consistente: **complejidad**. Videos, quizzes, comprar NFT stamps — contra un core
(Starbucks Rewards) que es "$1 = 1 estrella".

→ Valida la decisión #4 del registro por una razón distinta a la original: **10 cafés =
uno gratis, la misma matemática del cartón**. Cero conceptos nuevos para el usuario.
Este es el argumento para rechazar cualquier mecánica adicional que se proponga.

**Plenti (American Express).** Coalición lanzada 2015, muerta abril 2018. 30M
inscritos, **menos de la mitad canjeó alguna vez**. *Nunca ha triunfado una coalición
de loyalty a gran escala en EE.UU.* (Nectar UK sí: 19M miembros).

Causas documentadas: **control central rígido**, **intercambio de valor asimétrico
entre socios**, confusión por mezclar categorías inconexas, y efecto dominó cuando
Macy's se fue a construir su programa propio.

→ Este es el hallazgo más útil del research. **Plenti murió de control centralizado y
de socios subsidiándose entre sí sin quererlo. Es exactamente lo que elimina el escrow
prefondeado:** ningún café subsidia a otro, porque depositó por adelantado lo que
emitió; y las reglas están en el contrato, no en el panel de Amex.

El argumento on-chain deja de ser filosófico y pasa a ser el diagnóstico de una muerte
documentada. Segunda lección aplicada: Plenti mezcló grifos, supermercados y tiendas
por departamento. PUNCH es **una sola categoría**.

### 7.7 Dónde está el foso (y dónde no)

Hay que ser honestos: **abrir el consumption graph destruye el moat de data.** Un
copycat lee nuestro grafo y arranca con la red ya sembrada. Blackbird tiene la data
cerrada y por eso a ellos sí les sirve de foso.

No se arregla — se asume, y se sabe dónde está el foso de verdad:

```text
   NO es el código       ~400 líneas de Solidity, se copian en un fin de semana
   NO es la data         es pública a propósito

   SÍ es la densidad     25 cafés caminables en Arequipa; el copycat tiene que
                         volver a firmarlos uno por uno, a pie

   SÍ es el colateral    un café con S/1,000 trabados y 60 clientes cargando
                         puntos suyos no se muda. Y ese costo de mudanza
                         CRECE SOLO con cada emisión.
```

Moat tipo Uniswap: código abierto, foso en la liquidez y el enrutamiento. Es la postura
correcta y hay que sostenerla explícitamente en vez de fingir que la data nos protege.

Mitigación v2 si hiciera falta: proofs con compromiso y revelación selectiva —el grafo
sigue verificable pero no legible en claro por cualquiera. Rompe parte de la promesa de
composabilidad, así que solo se activaría bajo presión competitiva real.

### 7.8 El enemigo no es el café de al lado

La objeción de Plenti —*"los socios compiten entre sí"*— no se contesta con teoría de
coaliciones. Se contesta cambiando quién es el enemigo:

> El enemigo de una cafetería independiente **no es la cafetería de la esquina**.
> Es Starbucks, es Juan Valdez, y es que la gente se quede tomando café en su casa.
>
> Solo, ningún independiente puede tener el programa de lealtad de Starbucks.
> Juntos, todos lo tienen.

Esta es la frase con la que se firma un café, y es la respuesta al riesgo de §12.

---

## 8. Modelo de negocio

| Fuente | Cuánto | Por qué |
|---|---|---|
| **Campaign fee** | 10-15% del presupuesto | **Única fuente principal.** Donde está el valor; el café mide ROI directo. |
| Loyalty, red, CRM, analytics | **S/0, para siempre** | Es un arma, no una concesión — ver abajo |
| Redemption fee | **0%** | A propósito. El canje limpio es lo que hace que el usuario confíe en los puntos. |
| API / infra | v2 | Terceros integran el consumption graph |

### 8.1 Por qué la capa de loyalty es gratis

Seillo cobra **S/152-319 al mes** por digitalizar el cartón de sellos. Eso **es** su
ingreso.

PUNCH da gratis más de lo que Seillo vende —red, portabilidad, CRM, rachas, tiers,
analytics— y cobra únicamente cuando el café **compra clientes**.

```text
   Seillo    cobra por la herramienta   → no puede regalarla sin morirse
   Morita    ya es gratis               → no tiene nada que cobrar después,
                                          así que no puede financiar crecimiento
   PUNCH     regala la herramienta      → cobra el mercado que la herramienta crea
```

No se compite por precio contra gratis. Se compite dando gratis lo que el otro vende, y
cobrando en una capa que el otro no tiene.

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
- **Tres tipos de campaña**: adquisición, win-back, café crawl multi-merchant
- Ventana horaria como condición de primera clase
- Subasta: varias ofertas compitiendo, ordenadas por monto, visibles al consumidor
- PWA consumidor + panel de cobro + dashboard café
- Red simulada sembrada: ~8 cafés, ~50 consumidores, ~3 meses de historial

### 10.2 No entra (declarado)

Pagos y rail de cobro · integración con POS · on-ramp fiat · mainnet · NFC nativo ·
app nativa · **expiración de puntos (breakage)** · multi-ciudad · marketplace ·
wallet no-custodial · token especulativo · subasta sellada y bidding dinámico (el MVP
ordena por monto) · revelación selectiva de proofs.

### 10.3 Plan de 6 días

| Día | Fecha | Entregable |
|---|---|---|
| 1 | 6 ago | Contratos `CafeRegistry` + `ConsumptionLog` + `RewardVault` + `MockPEN`, tests, deploy a Sepolia. Schema Postgres. |
| 2 | 7 ago | `CampaignEscrow` con multi-financiador y condición multi-merchant. Relayer. Flujo tap end-to-end: QR firmado → escaneo → proof on-chain. |
| 3 | 8 ago | PWA consumidor: escanear, saldo, racha, score, canje. |
| 4 | 9 ago | Dashboard café: registro, fondeo, reglas, panel de cobro, crear las 3 campañas. |
| 5 | 10 ago | Matching + subasta, detección de deserción, progreso del crawl, seed de red simulada, CRM. |
| 6 | 11 ago | Pulido visual, guion, video, deck, README final, ensayo. |
| — | 12 ago | Entrega. |

El crawl es la única mejora que toca contratos, y por eso está en el día 2 junto al
resto de `CampaignEscrow` — no al final, donde se cae si algo se atrasa.

---

## 11. Guion del demo (3 minutos)

```text
0:00  "Todos tienen seis cartones de sellos a medio llenar. Ninguno completo."

0:15  PANTALLA CAFÉ QUINTA — barista marca S/12 → QR en pantalla
      PANTALLA CELULAR     — escaneo → "+120 puntos · racha día 7 🔥"
      → link a Arbiscan: el proof, con las dos firmas
      "Eso acaba de pasar en Arbitrum. Costó una fracción de céntimo.
       Yo no vi una wallet ni pagué gas."

0:45  CAMINO A CAFÉ TOSTADO — pago un cortado 100% con puntos ganados en Quinta
      "Tostado cobró S/12 al instante y no le reclama nada a Quinta:
       Quinta ya había depositado. No hay deuda entre cafés.
       Plenti, la coalición de American Express, murió justamente de eso."

1:15  CELULAR — pantalla 'HOY TE QUIEREN INVITAR'
         La Quinta   S/7   2-5pm
         Tostado     S/5
         Barranco    S/4
      "Tres cafeterías compitiendo por mí, en abierto. Yo veo lo que valgo.
       Fetch te da 25 puntos por tu recibo y le vende tu data a las marcas."

1:35  ── CLÍMAX ──
      DASHBOARD TOSTADO — café nuevo, cero clientes
      Campaña: Coffee Score > 500 · nunca vino acá · 2 km · L-V 14-17h
               S/5 · budget S/500  →  deposita en el contrato
      CELULAR: acepto la oferta. Camino. Tap.
      → el contrato me paga solo. Presupuesto baja, saldo sube.
      "Tostado no aprobó nada. Nosotros tampoco. Pagó S/5 por alguien que
       verificablemente toma 15 cafés al mes — Instagram le cobra S/30 por
       un click. Y fíjense en la franja horaria: a las 3pm ese asiento
       estaba vacío. No está regalando margen, está vendiendo inventario
       que se le vencía."

2:15  DASHBOARD QUINTA — dos campañas más, 10 segundos cada una
      · Win-back: "mi cliente de 8 visitas no viene hace 21 días
                   Y SIGUE tomando café en la red" — se fue a la competencia.
                   Ninguna app de sellos puede ver eso.
      · Café crawl: Quinta + Tostado + Barranco financian S/1,500 en tercios.
                   "El enemigo de una cafetería independiente no es la de la
                    esquina. Es Starbucks y quedarse tomando café en casa.
                    Solos, ninguno puede tener el programa de Starbucks.
                    Juntos, todos lo tienen."

2:40  "Blackbird hace esto en Nueva York con $85 millones, pero necesita ser
       el medio de pago. Acá se paga con Yape y efectivo. Nuestro proof es
       el tap. Y el respaldo de los puntos está en el contrato, no en nuestro
       panel de admin: no podemos devaluarlos aunque quisiéramos."

2:55  PUNCH. Tu tarjeta de sellos, pero vale en toda la ciudad.
```

Si hay que recortar: sacar el bloque 2:15 —win-back y crawl quedan como capturas en el
deck—. Lo que **no** se recorta es la pantalla de subasta ni la franja horaria: son las
dos cosas que separan a PUNCH de un cartón digitalizado.

---

## 12. Riesgos y huecos abiertos

**Breakage.** Los programas de loyalty ganan con los puntos que nadie canjea. Acá esa
plata queda bloqueada y el café no la recupera. Solución diseñada: **expiración a 12
meses**, colateral devuelto al emisor, anunciada de antemano y escrita en el contrato
—no un cambio sorpresa como hacen las aerolíneas. **No se implementa en el hackathon.**

**Cold start.** Segmentar "toma 15 cafés/mes" requiere red densa. En el demo es data
sembrada y se declara como *"simulación de 3 meses de red en Arequipa"*. Mentir en
esto es la forma más rápida de perder en preguntas.

**Los socios son competidores directos.** La literatura de coalición dice que funciona
mejor cuando los socios ofrecen servicios similares **pero no compiten entre sí**.
Nuestros socios son todos cafés: compiten de frente. Respuesta: el split
lealtad-en-la-emisión / portabilidad-en-el-canje hace que competir **dentro** de la red
salga más barato que competir fuera —hoy la guerra es a punta de descuentos ciegos; acá
se paga solo por el cliente que efectivamente entró—. La competencia no desaparece: se
vuelve explícita, medible y pagada.

Dos piezas más atacan el mismo riesgo: el **café crawl** (§4.7.3) da un caso donde
cooperar paga más que competir, y el reencuadre del enemigo (§7.8) mueve la pelea de
"el café de la esquina" a "Starbucks y quedarse en casa".

Riesgo real y no resuelto del todo; sigue siendo la pregunta más difícil que nos pueden
hacer.

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
| 11 | Nombre PUNCH | SELLO | Existe **Seillo** en Lima, cafeterías, sellos digitales. Colisión fonética en el mismo mercado y vertical |
| 12 | Una sola categoría (café), nunca multi-vertical | Coalición multi-categoría | Plenti murió en parte por mezclar grifos, supermercados y tiendas por departamento |
| 13 | Ingreso principal = campaign fee, no SaaS | SaaS como ingreso principal | Morita es gratis en Perú. No se compite por precio contra gratis; se compite con lo que el cartón digitalizado no puede dar |
| 14 | Loyalty, red, CRM y analytics **gratis para siempre** | Plan pago como Seillo (S/152-319/mes) | Regalar lo que el competidor vende es un arma: Seillo no puede igualarlo sin matar su única fuente de ingreso |
| 15 | Ventana horaria como condición de primera clase | Campañas sin restricción horaria | Sin ella, una campaña en hora pico **destruye valor**: paga por un asiento que se llenaba igual. Con ella es yield management |
| 16 | Subasta: varias ofertas compitiendo, visibles al consumidor | Primera campaña que califica gana | El mercado descubre el valor del cliente, no nosotros. Y es la única postura que Fetch y Cardlytics no pueden copiar sin admitir que venden data |
| 17 | Win-back con evidencia de deserción | Solo campañas de adquisición | Es la campaña que **exige** la red: ver que tu cliente se fue a la competencia es imposible desde un solo local |
| 18 | Café crawl dentro del alcance, no stretch | Dejarlo para v2 | Es la prueba viva de que cooperar paga más que competir — la respuesta al riesgo de coalición de §12. Va el día 2 con el resto de `CampaignEscrow` |
| 19 | El moat es densidad + colateral trabado, no la data | Grafo cerrado para proteger la data | Abrir el grafo mata el moat de data y hay que asumirlo. Foso tipo Uniswap: código abierto, valor en la liquidez |
