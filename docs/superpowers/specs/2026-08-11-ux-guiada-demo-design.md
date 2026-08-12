# UX guiada para navegación autónoma del jurado

**Fecha:** 2026-08-11
**Estado:** diseño aprobado, pendiente de plan de implementación
**Mocks:** `docs/ux-mocks/index.html`

## 1. Problema

PUNCH se presenta a un hackathon de Arbitrum. El jurado navega la aplicación **solo**,
sin narrador, posiblemente en su propio dispositivo. Hoy eso falla por cuatro razones:

1. **No hay guía.** Las pantallas nombran conceptos (`Campañas`, `Rutas de café`, `Fondo
   común`) sin explicarlos. El jurado lee un título y no sabe qué está viendo.
2. **El ciclo exige dos roles.** Un cliente con 0 sellos no puede canjear; un cliente con
   12 sellos no puede confirmar su propio canje. Si la UI no lo dice, el jurado toca un
   botón muerto y concluye que la aplicación está rota.
3. **Dos lenguajes visuales.** El mundo consumidor usa los tokens Hallmark
   (`consumer-shell.css`); el workspace usa defaults de shadcn (`border-b`,
   `text-muted-foreground`). Quien salta de rol siente que son dos productos.
4. **La cadena es invisible.** El argumento central para un jurado de Arbitrum —que las
   operaciones son verificables públicamente— no aparece en ninguna pantalla, aunque el
   backend ya entrega los hashes.

## 2. Objetivo

Que un jurado sin contexto previo recorra el ciclo completo —cobro, sello, recompensa,
canje, reembolso desde el fondo común— **por su cuenta**, entendiendo qué ve en cada paso,
y pudiendo verificar en `sepolia.arbiscan.io` cada operación que él mismo dispare.

## 3. Restricciones acordadas

- **Las 22 rutas se quedan donde están.** No se fusionan, dividen ni renombran páginas. La
  guía vive dentro del contenido de cada una.
- **Sin modo mock.** La demo corre con `CONSUMER_CHAIN_MODE=local` y
  `CHAIN_ENV=arbitrumSepolia`. Nunca contra mainnet.
- **Una sola pasada.** Sin fases opcionales ni palanca de emergencia a mock.
- **Ops queda fuera del recorrido.** La cuenta sigue accesible por `/auth`; `/ops` recibe
  solo consistencia visual, sin diseño hero.
- **Toda tarjeta de guía se declara como tal.** Lleva un marcador con popover: «Este
  mensaje no aparecerá en el producto final».

## 4. Arquitectura

### 4.1 Capa de guía — `src/frontend/components/guide/`

Seis componentes nuevos, todos sobre `tokens.css`. Ninguno consulta datos por su cuenta:
reciben props. Se pueden entender y probar en aislamiento.

| Componente | Responsabilidad | Reemplaza |
|---|---|---|
| `PageIntro` | Eyebrow + título + línea `explain` que traduce el concepto | El trío copiado a mano en `home`, `more`, `scan`, `history`, `campaigns`, `crawls` |
| `NextStep` | Uno o dos destinos con el porqué, al pie de pantalla | Nada; es nuevo |
| `EmptyState` | Vacío explicado por su causa, con salida | «Pronto habrá nuevas rutas», «Todavía no tienes cafés registrados» |
| `LoadingState` | Skeleton con la forma del contenido real | `<Spinner/>` centrado (`home/page.tsx:94`, `discover/page.tsx:57`, `cafe/page.tsx:37`) |
| `ErrorState` | Mensaje + reintento, tono unificado | `<p className="text-destructive">` sueltos |
| `StateStrip` | Avisos de cadena / offline / datos guardados | `<p>` con estilo inline (`home/page.tsx:135`, `history/page.tsx:120`) |

Más dos de presentación de datos:

- **`Stat`** — cifra grande con etiqueta y pista. El workspace hoy escribe cifras como
  párrafos (`cafe/[cafeId]/page.tsx:43`).
- **`ChainReceipt`** — ver §4.4.

`PageIntro.explain` es obligatorio en toda página que nombre un concepto propio del
dominio. Ejemplos acordados:

- `/campaigns`: «Una cafetería pone dinero del fondo común para invitarte algo. Si te la
  ganas, la red le devuelve el costo.»
- `/scan`: «El barista genera un código al cobrarte. Al escanearlo, tu sello queda escrito
  en la cadena — ni la cafetería ni PUNCH pueden borrarlo.»
- `/cafe/[cafeId]`: «Cada venta que sellas alimenta el fondo común. El fondo devuelve
  dinero a las cafeterías que traen clientes nuevos a la red.»

### 4.2 `useDemoJourney()` — la guía derivada del estado

Un hook en `src/frontend/components/guide/use-demo-journey.ts`. **No inventa datos**:
compone las consultas que las páginas ya hacen (`useDashboard`, `useMyCafes`, los pendientes
de canje y de proof) y deriva el paso actual.

Seis pasos, cada uno declarando el rol que lo ejecuta:

| Paso | Condición | Rol que actúa |
|---|---|---|
| 0 | Sin código de compra vivo | Cafetería |
| 1 | Código generado, sin escanear | Cliente |
| 2 | `balance < 12` | ciclo 0–1 |
| 3 | `balance >= 12` | Cliente |
| 4 | Canje pedido, sin entregar | Cafetería |
| 5 | Canje confirmado; fondo actualizado | Cafetería |

Se renderiza como `JourneyCard`: los pasos cumplidos tachados, el actual resaltado, los
futuros en gris, y **una sola acción**.

Cuando el paso actual pertenece al rol contrario, la tarjeta deja de proponer y pasa a
traspasar: «Este paso lo hace la cafetería · en la demo, ese barista eres tú», con botón que
cambia de cuenta.

`JourneyCard` aparece en `/home`, `/scan`, `/redeem/[productId]`, `/cafe/[cafeId]` y
`/cafe/[cafeId]/terminal`. En el resto de páginas la guía es `NextStep`, porque ahí la
elección es libre y no la determina el estado.

**Regla de acción imposible:** la acción se muestra siempre, deshabilitada, con el motivo en
su propia etiqueta y el atajo al rol que la desbloquea. Nunca se oculta —el jurado no
descubriría que existe— y nunca falla en silencio. Ejemplos: `Canjear · te faltan 12 sellos`;
`Generar código · te quedan 0 créditos`.

### 4.3 `DemoBar` y cambio de rol

Franja fija superior, montada solo con `ClientConfig.demoMode`. Sin esa bandera el
componente no se monta —no es un `display:none`. Muestra el rol activo y permite saltar
entre Cliente y Cafetería. Reusa la lógica de `demo-login.tsx:23`, extraída a
`useDemoSignIn()`.

El cambio de rol no es mudo: pasa por una pantalla de traspaso que dice qué dejas, qué vas a
encontrar y los pasos que te tocan al llegar.

**Entrada por `/auth`:** los botones de demo suben por encima del formulario, con marca y
una línea de qué encontrará cada rol. El formulario de email y contraseña baja a un
`<details>` cerrado —sigue accesible, deja de competir por la atención. Ops sale de la lista
visible y se alcanza por ese formulario.

**Barista que entra de primeras:** `postAuthDestination()` (`home/page.tsx:18`) lo lleva a
`/cafe/[id]/terminal`, la pantalla más opaca del producto para quien no sabe qué es un
sello. Ahí aparece una tarjeta que ofrece empezar por el lado cliente, con botón para
quedarse. No bloquea.

El redirect forzado de `/home` al workspace (`home/page.tsx:87`) se elimina: con el rol
elegido explícitamente en la entrada, cada botón va a su destino.

### 4.4 Visibilidad on-chain — `ChainReceipt`

**Requisito duro: toda escritura on-chain disparada por el jurado muestra su transacción en
la pantalla donde la disparó.** No basta con el historial.

Operaciones cubiertas, ambos roles:

| Acción del jurado | Job del relayer | Contrato |
|---|---|---|
| Confirmar compra (cliente) | `consumption_record` | `ConsumptionLog` |
| Pedir canje (cliente) | canje | `PunchVault` |
| Entregar canje (cafetería) | canje | `PunchVault` |
| Crear campaña (cafetería) | `campaign_create` | `CampaignEscrow` |
| Financiar campaña (cafetería) | `campaign_fund` | `CampaignEscrow` |
| Publicar campaña (cafetería) | `campaign_publish` | `CampaignEscrow` |
| Registrar referencia | `referral_record` | `NetworkFund` |

El mapeo exacto de las acciones de canje a jobs (`voucher_redeem`, `voucher_unlock`) se
confirma contra `relayer/handlers/registry.ts` al implementar. El criterio de cobertura no
depende de esta tabla: **si el jurado dispara una escritura on-chain, la pantalla enseña su
transacción.** La verificación se hace recorriendo `registry.ts` entero.

`ChainReceipt` es un componente único que envuelve el `TxHashLink` existente y muestra el
ciclo de vida completo:

- **En cola** — «Preparando la operación»
- **Enviada** — hash visible, enlace a arbiscan activo, «Confirmando en la cadena»
- **Confirmada** — hash, enlace, número de bloque
- **Fallida** — motivo y reintento

Extiende `TransactionStatus` (`src/core/consumption/client/ui/transaction-status.tsx`), que
hoy recibe `status` pero no el hash: se le añade `txHash?: string | null`.

`TxHashLink` (`src/frontend/components/tx-hash-link.tsx`) gana la etiqueta de cadena
—«Arbitrum Sepolia»— y la tipografía mono de marca. El jurado tiene que leer la palabra
Arbitrum en la fila, no solo un hash suelto. `explorerTxUrl` ya resuelve
`https://sepolia.arbiscan.io/tx/…` con `NEXT_PUBLIC_CHAIN_ENV=arbitrumSepolia`.

**Historial.** `list-history-service.ts:98` **ya devuelve `transactionHash`** y la página lo
descarta. Cada fila confirmada pasa a mostrar su enlace; las pendientes muestran
«Esperando confirmación en la cadena…» en lugar de un enlace muerto.

**Donde falte el hash en la respuesta de una mutación**, se añade a la respuesta del
endpoint correspondiente. Es el único cambio de contrato de API que este diseño autoriza, y
solo para exponer un dato que el relayer ya persiste.

### 4.5 Pre-minteo de los 11 sellos

El saldo visible sale de `projectionPunchBalance` (`chain-schema`), que el indexer construye
desde eventos reales de la cadena. **`seedDemoState()` escribe `punchBalanceProjection`, que
es la tabla del modo mock y que en modo cadena nadie lee.** Cualquier reset por base de datos
es invisible o, peor, falsifica la proyección: la UI diría 11 y arbiscan mostraría 0,
delante de un jurado que va a hacer clic en el enlace.

Tampoco existe reset hacia abajo: mintear es un solo sentido y el contrato no expone un burn
de operador.

Solución: **un script de pre-minteo que ejecuta compras reales antes de la demo.**

- Crea K cuentas de consumidor demo (`demo-consumer-01…K`), deriva su wallet con
  `deriveUserAccount`.
- Por cada una, emite 11 proofs firmadas con `signProofAs` y las encola como jobs
  `consumption_record` — el mismo camino que usa la terminal en producción. Sin atajos.
- Espera confirmación y que el indexer alcance el bloque.
- Reparte las compras entre las 4 cafeterías del seed, para que el historial se vea real.

En la demo, «Entrar como cliente» **entrega la siguiente cuenta sin reclamar**, no resetea
nada. Cada jurado arranca en 11/12 con historial verificable, y la concurrencia entre
jurados simultáneos se resuelve sola.

**Guarda propia.** El script exige chain id `421614` y una bandera explícita de intención.
**No** se reutiliza ni se relaja `assertLocalChain31337`
(`historical-consumptions.ts:30`): esa guarda impide fabricar historial contra cadenas que
no sean Anvil, y sigue teniendo razón.

**Agotamiento del pool.** Si se acaban las cuentas, se recicla una con el saldo que tenga y
el jurado cae en el estado 0/12, que es un estado digno y guiado por diseño (§4.2), no un
error. **K por defecto: 10**, configurable por bandera del script.

### 4.6 Idiomas de layout

Un solo sistema de color, tipografía y espacio; dos idiomas de composición.

- **Cliente** — móvil, una columna, acción principal al alcance del pulgar, barra inferior.
- **Cafetería** — escritorio, dos columnas, densidad de datos, pestañas.

El shell del workspace (`(workspace)/layout.tsx`) se rebrandea a tokens Hallmark. Sus tres
enlaces planos pasan a pestañas de cafetería: Resumen · Terminal · Canjes · Campañas · Plan ·
Catálogo. **No son rutas nuevas** —todas existen ya—; dejan de estar escondidas detrás de
botones dentro del cuerpo de la página (`cafe/[cafeId]/page.tsx:243`).

## 5. Cambios por página

Todas conservan su ruta, sus hooks y sus consultas.

### Cliente

| Ruta | Cambio |
|---|---|
| `/home` | `PageIntro` con explicación del sello; punch meter con 12 puntos discretos junto a la barra; `JourneyCard` sustituye al bloque de enlaces sueltos |
| `/scan` | Tres pasos legibles; `JourneyCard` que resuelve el único callejón real —el jurado no tiene un barista al lado— llevándolo a la terminal existente |
| `/purchase/[proofId]` | Antes de confirmar, muestra la consecuencia («quedarás en 12/12»); tras confirmar, `ChainReceipt` con el hash del sello |
| `/redeem/[productId]` | Las 4 cafeterías juntas ordenadas por distancia (reusa `discovery-distance.ts`); con saldo insuficiente, acción bloqueada con motivo |
| `/discover`, `/discover/[cafeId]` | De `Card` shadcn a superficie de papel; línea de productos con precios reales |
| `/history` | Estados como `badge`; **enlace a arbiscan por fila** |
| `/campaigns`, `/campaigns/[id]` | Progreso de la campaña visible; `explain` del mecanismo de financiación |
| `/crawls`, `/crawls/[id]` | Pasos de la ruta con los visitados tachados |
| `/more` | Sección «Cómo funciona» —glosario de sello, fondo común y por qué blockchain—; salida hacia el otro rol |
| `/profile`, `/install` | Consistencia de tokens |

### Cafetería

| Ruta | Cambio |
|---|---|
| `/cafe` | `EmptyState` con salida; estado de revisión explicado |
| `/cafe/[cafeId]` | **El fondo común sube a lo primero**, con los cuatro buckets explicados en una línea cada uno y las cifras como `Stat`. Perfil y catálogo bajan a pestaña. `JourneyCard` |
| `/cafe/[cafeId]/terminal` | Tres pasos numerados; QR a la derecha, no debajo; explicación de qué es la referencia Yape; `ChainReceipt` al generar |
| `/cafe/[cafeId]/redemptions` | Cada fila dice cuánto reembolsa la red; el motivo de rechazo aparece al pulsar Rechazar, no permanentemente; `ChainReceipt` al confirmar |
| `/cafe/[cafeId]/campaigns` | `ChainReceipt` en crear, financiar y publicar |
| `/cafe/[cafeId]/plan` | Créditos traducidos a tiempo restante al ritmo actual |

### Públicas y bordes

| Ruta | Cambio |
|---|---|
| `/auth/[path]` | Entrada demo primero, formulario en `<details>` |
| `/offline` | Muestra el snapshot que `offline-snapshot.ts` ya guarda |
| `/ops` | Solo tokens; sin diseño hero |
| `/` (landing) | Sin cambios: ya es Hallmark |

## 6. Lo que este diseño no hace

- No cambia rutas, ni fusiona ni divide páginas.
- No toca hooks, servicios ni consultas existentes, salvo exponer hashes ya persistidos.
- No añade campos calculados en servidor. La única cifra derivada nueva —«≈ 6 semanas a tu
  ritmo» en Plan— se calcula en cliente desde el historial que ya llega.
- No escribe proyecciones a mano para simular saldo.
- No relaja `assertLocalChain31337`.
- No toca mainnet.

## 7. Pruebas

- **Unidad:** `useDemoJourney` — un caso por transición de estado, incluido 0/12 y el
  traspaso de rol en pasos 0 y 4.
- **Unidad:** `ChainReceipt` — los cuatro estados del ciclo, con y sin hash.
- **Componente:** `EmptyState`, `PageIntro`, acción bloqueada con motivo.
- **Regresión:** las suites existentes de `terminal`, `redemptions`, `campaigns`, `plan` y
  `fund-card` deben seguir verdes. Si un test se rompe por reorganización visual, se ajusta
  el test; si se rompe por lógica, el cambio está mal.
- **Manual, contra Arbitrum Sepolia:** recorrer el ciclo completo en los dos roles y abrir
  cada enlace de arbiscan generado. Es la única verificación que prueba el requisito
  central. Ninguna afirmación de «funciona» sin esos enlaces abiertos.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| El pre-minteo falla o se queda a medias el día previo | El script es idempotente y reejecutable por cuenta; verificación explícita de saldo por cuenta antes de dar la demo por lista |
| Latencia del indexer tras una acción del jurado | `ChainReceipt` muestra el estado intermedio con su hash: la espera se ve como progreso, no como cuelgue |
| El pool de cuentas se agota | Estado 0/12 guiado; K dimensionado con holgura |
| La reorganización del panel de cafetería rompe tests | Los tests de esas páginas se revisan como parte del cambio, no después |
