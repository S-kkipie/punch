# PUNCH — Spec maestra

**Estado:** Diseño aprobado; pendiente plan de implementación  
**Fecha:** 2026-08-07  
**Mercado inicial MVP:** Cafeterías independientes, Lima, Perú
**Red MVP:** Arbitrum Sepolia  
**Autoridad documental:** Este archivo es la única fuente canónica de producto, economía y arquitectura.

---

## 00. Cómo leer esta spec

Este documento reemplaza toda spec económica o de producto anterior. Si código, README, pitch, landing, base de datos o comentario contradicen esta spec, esta spec gana hasta que una decisión aprobada la modifique.

Términos normativos:

- **DEBE / NO DEBE:** requisito obligatorio.
- **PUEDE:** comportamiento permitido.
- **Hipótesis:** número o política que requiere validación en piloto; se implementa en MVP para medirla, no se presenta como evidencia.
- **Post-MVP:** fuera de primera implementación.

Lectura rápida para agentes:

1. Leer invariantes de §02.
2. Leer alcance de §23.
3. Leer sección específica de tarea.
4. No reconstruir economía desde README, pitch o UI.

---

## 01. Resumen ejecutivo

PUNCH es una coalición de lealtad y demanda para cafeterías independientes. Permite que negocios separados operen frente al consumidor como una red sin convertirse en cadena ni entregar el pago a PUNCH.

El consumidor sigue pagando directamente al café mediante Yape. Una compra de producto elegible emite un PUNCH no transferible. Al reunir doce, puede canjear un producto reward elegible de precio retail máximo S/12 en cualquier café activo de la red. El contrato quema doce PUNCH y paga S/3.60 fijos al café anfitrión.

PUNCH no vende descuentos. Su valor principal es producir visitas pagadas incrementales y retornos pagados. Upsell ayuda, pero es secundario. El margen directo del reward protege fulfillment; no sostiene por sí solo la suscripción.

Arbitrum es constitución económica: controla membresías, reserva, créditos de emisión, balances, burns, payouts, fondo común y campañas. Postgres guarda experiencia, PII, analytics y proyecciones. Si discrepan, Arbitrum gana.

---

## 02. Invariantes

1. Usuario paga café directamente; PUNCH no es wallet ni rail de pago.
2. Una compra válida de producto elegible emite exactamente un PUNCH.
3. PUNCH no equivale a S/1 ni a cantidad de dinero.
4. PUNCH no se transfiere, vende, retira ni usa como pago parcial.
5. Doce PUNCH se queman para un canje.
6. Canje entrega un producto reward elegible con retail máximo S/12.
7. Payout al anfitrión es S/3.60 fijo en MVP.
8. Burn y payout son atómicos.
9. Cada PUNCH vivo exige S/0.30 en reserva.
10. Emisión revierte si rompe cobertura.
11. Reserva de rewards y fondo común son contabilidades separadas.
12. Créditos de origen son transferencias internas, no riqueza nueva.
13. Arbitrum manda; Postgres proyecta.
14. Arbitrum no puede comprobar por sí solo que Yape ocurrió.
15. Firmas son atestación, no prueba bancaria.
16. PUNCH no expira en MVP.
17. Campañas entregan vouchers separados de PUNCH.
18. Simulación de cuatro cafés es ilustrativa, no tracción.
19. PUNCH crea valor solo cuando produce ventas incrementales, retención o eficiencias reales.
20. Si solo mueve ventas existentes entre cafés pequeños, destruye valor.

---

## 03. Glosario

| Término | Definición |
|---|---|
| Compra válida | Pago Yape por un producto de emisión elegible, atestado por café y usuario. |
| Producto de emisión | SKU aprobado cuya compra permite emitir un PUNCH. |
| Producto reward | SKU que puede entregarse en canje; retail ≤ S/12 y COGS compatible con payout. |
| PUNCH | Unidad de lealtad no monetaria, no transferible y emitida una por compra válida. |
| Crédito de emisión | Permiso prepagado para emitir un PUNCH; cada crédito conserva S/0.30 sin asignar, que pasa a reserva asignada al emitir. |
| Café emisor | Café donde ocurre compra que emite PUNCH. |
| Café anfitrión | Café que entrega producto reward y recibe payout. Puede ser igual al emisor. |
| Burn | Destrucción definitiva de PUNCH usados en canje. |
| Payout | Transferencia de S/3.60 al anfitrión por fulfillment. |
| Reserva | Fondos bloqueados para payouts de PUNCH vivos. |
| Fondo común | Presupuesto separado para origen, adquisición colectiva, crawls y contingencia. |
| Referencia verificable | Evidencia de que Café A originó visita pagada en Café B mediante app, campaña o ruta. |
| Crédito de origen | Parte prorrateada del pool mensual pagada por referencias verificables. |
| Voucher de campaña | Entitlement no transferible, separado de PUNCH, desbloqueado por condición. |
| Venta incremental | Compra pagada que no habría ocurrido sin PUNCH. |
| Venta desplazada | Compra que habría ocurrido de todas maneras o migra desde otro café pequeño. |
| COGS | Costo variable del producto servido. |
| Retorno neto | Valor generado menos suscripción, COGS y oportunidad desplazada. |
| ROI | Retorno neto dividido por costo de suscripción. |

---

## 04. Problema y tesis

### Problema

Cadenas operan múltiples locales bajo una relación, un programa de loyalty y una visión del cliente. Cafeterías independientes operan como islas: cada una adquiere y retiene clientes sola. Una visita a otro café elimina continuidad y hace que pequeños negocios compitan entre sí mientras cadenas capturan ventaja de red.

### Tesis

```text
Más cafés cercanos
→ reward más útil
→ más visitas cruzadas pagadas
→ más retención
→ más valor por café
```

Cantidad de miembros por sí sola no aumenta ROI promedio. Densidad genera valor solo si mejora ventas incrementales, retorno, eficiencia de campañas, capital externo o compras colectivas.

### Propuesta

> El enemigo de un café independiente no es el café pequeño de la esquina. Juntos pueden competir contra cadenas con una relación de red que ninguno podría construir solo.

---

## 05. Roles

### Consumidor

- Paga por Yape.
- Firma compra válida.
- Acumula PUNCH.
- Descubre cafés y productos.
- Canjea rewards.
- Participa en campañas y coffee crawls.
- Nunca ve ETH, gas, wallet ni tx hash en flujo normal.

### Café miembro

- Paga plan.
- Configura productos elegibles sujetos a aprobación.
- Firma consumos.
- Emite PUNCH usando créditos.
- Acepta canjes mientras está activo.
- Recibe payouts.
- Financia adquisición privada.
- Participa en fondo común.

### Café anfitrión

- Valida canje.
- Sirve producto reward aprobado.
- Recibe S/3.60.
- Asume COGS del producto.

### Operación PUNCH

- Aprueba y suspende cafés.
- Revisa productos.
- Opera relayer, indexer, riesgo y soporte.
- Publica campañas comprometidas.
- No puede alterar balances o retirar reserva contra reglas del contrato.

### Sponsor futuro

- Aporta capital a campañas o fondo.
- No entra al MVP.

---

## 06. Producto consumidor

### Navegación mínima

1. Registro/inicio de sesión.
2. Home con balance y progreso `n / 12`.
3. Cafés cercanos y productos elegibles.
4. Confirmación de compra/firma.
5. Historial de emisiones, canjes y vouchers.
6. Flujo de canje.
7. Campañas disponibles.
8. Progreso de coffee crawl.

### Compra

1. Barista selecciona producto de emisión.
2. Panel genera QR firmado y efímero.
3. Usuario escanea y confirma comercio/producto.
4. Cuenta embebida firma prueba.
5. Relayer envía transacción.
6. UI muestra estado pendiente.
7. Tras confirmación, balance aumenta en uno.

### Canje

1. Usuario elige café y producto reward.
2. UI confirma costo: 12 PUNCH.
3. Café valida solicitud.
4. Contrato quema doce y paga anfitrión.
5. UI muestra canje confirmado.

### Restricciones UX

- Nunca mostrar valor monetario por PUNCH.
- Nunca permitir ingresar cantidad libre de PUNCH.
- Nunca mostrar transferencia entre usuarios.
- Diferenciar visualmente PUNCH y voucher de campaña.
- Estados on-chain deben ser claros: pendiente, confirmado, rechazado.

---

## 07. Producto cafetería

### Onboarding

1. Crear cuenta.
2. Registrar negocio y cuenta on-chain.
3. Enviar información de verificación.
4. Configurar productos de emisión y reward.
5. Activar plan.
6. Recibir cien créditos.

### Panel

Debe mostrar:

- Estado de membresía.
- Créditos disponibles.
- Reserva no asignada.
- PUNCH emitidos.
- Canjes atendidos.
- Payouts recibidos.
- Visitas pagadas entrantes.
- Referencias verificables originadas.
- Crédito de origen estimado/confirmado.
- Aporte y uso del fondo común.
- Campañas privadas.

### Productos elegibles

Producto de emisión:

- Debe existir en catálogo del café.
- Debe tener precio real y razonable.
- No puede ser SKU simbólico creado para farming.
- Puede suspenderse por riesgo.

Producto reward:

- Retail máximo S/12.
- Payout fijo S/3.60.
- Café debe seleccionar COGS compatible.
- Objetivo económico: COGS ≤ S/3 para margen directo ≥ S/0.60.
- PUNCH puede rechazar producto cuyo costo o disponibilidad hagan insostenible fulfillment.

---

## 08. Unidad PUNCH

PUNCH es ledger de loyalty no monetario.

```text
1 compra válida = 1 PUNCH
12 PUNCH = 1 canje de producto
```

Propiedades:

- No transferible.
- No retirable.
- No fraccionable en UI.
- No canjeable por efectivo.
- No aplicable a cualquier factura.
- No especulativo.
- No expira en MVP.
- Balance permanece válido si café emisor abandona red.

La reserva de S/0.30 por unidad es cobertura de payout futuro, no precio de PUNCH ni derecho de retiro del usuario.

---

## 09. Economía del plan

### Plan mensual — hipótesis MVP

```text
S/49
├─ S/30 → PunchVault.rewardReserve
├─ S/5  → NetworkFund
├─ S/14 → PUNCH Treasury
└─ +100 créditos de emisión
```

### Pack adicional — hipótesis MVP

```text
S/40
├─ S/30 → PunchVault.rewardReserve
├─ S/5  → NetworkFund
├─ S/5  → PUNCH Treasury
└─ +100 créditos de emisión
```

### Rollover

- Créditos no usados y reserva asociada hacen rollover completo.
- Cada crédito conserva S/0.30 de reserva no asignada.
- Al emitir, crédito se consume y S/0.30 pasa a respaldar pasivo vivo.

### Cancelación

- Café inactivo no puede emitir ni comprar packs.
- Créditos no emitidos dejan de estar utilizables.
- Reserva de PUNCH no emitidos puede retirarse tras cancelación.
- Reserva asignada a PUNCH vivos permanece bloqueada.
- Usuarios conservan balance y canjean en cafés activos.
- Retiro nunca puede violar invariante de reserva.

### Ingreso PUNCH

MVP obtiene presupuesto bruto operativo:

- S/14 por plan.
- S/5 por pack.

No equivale a utilidad neta. Paga relayer, gas, infraestructura, soporte, riesgo, ventas y desarrollo.

Campaign fee no es ingreso principal del MVP. Una comisión futura requiere piloto y decisión nueva.

---

## 10. Reward y canje

### Supuesto unitario

```text
Precio retail                  S/12.00
COGS                           S/3.00
Payout                         S/3.60
Margen directo reward          S/0.60
Margen de venta pagada normal  S/9.00
```

S/3.60 es fijo aunque producto reward tenga precio menor, siempre que retail no exceda S/12.

### Oportunidad desplazada

Si reward reemplaza venta pagada normal:

```text
margen reward S/0.60 − margen normal S/9.00 = −S/8.40
```

Al modelar contabilidad:

- Sumar S/0.60 por reward.
- Restar S/9 por canje desplazado.
- No restar S/8.40 después de sumar S/0.60; duplicaría S/0.60.

### Jerarquía de valor

1. Venta pagada incremental: ≈ S/9.
2. Retorno pagado: ≈ S/9.
3. Upsell: ≈ S/3.60.
4. Margen directo reward: ≈ S/0.60.
5. Crédito de origen: transferencia variable.

---

## 11. Fondo común

### Separación

`NetworkFund` no paga canjes PUNCH normales. `PunchVault.rewardReserve` no financia marketing, origen ni operación.

### Fuentes MVP

- S/5 por plan.
- S/5 por pack.
- Aportes externos futuros.

### Distribución por epoch mensual

```text
40% créditos de origen
30% adquisición colectiva
20% coffee crawls
10% seguridad y contingencia
```

Distribución es visible on-chain. Cambios aplican a epoch futuro y deben registrarse; no se reescribe epoch cerrado.

### Créditos de origen

Solo una referencia verificable califica. No basta con que usuario haya visitado antes otro café.

Fuentes válidas:

- Recomendación en app atribuida a Café A.
- Campaña con source café A.
- Ruta/coffee crawl cuya transición A → B fue cumplida.

Fórmula mensual:

```text
creditoCafe = originPool × referenciasCafe / referenciasTotales
```

Consecuencias:

- Pool nunca paga más que saldo.
- Tarifa por referencia no es fija.
- S/0.20 en simulación es resultado, no promesa.
- Café con más referencias verificables recibe mayor parte.
- Crédito redistribuye dinero de miembros; no crea valor de coalición.

### Seguridad y contingencia

Puede cubrir incidentes definidos, auditorías o protección operativa. No es ganancia inmediata ni fondo discrecional de PUNCH.

---

## 12. Campañas

Campañas usan vouchers separados de PUNCH para preservar `1 compra = 1 PUNCH`.

Voucher:

- No transferible.
- No monetario.
- No suma al balance PUNCH.
- Tiene condición, expiry propia y presupuesto prefondeado.
- Solo puede reclamarse una vez.

### 12.1 Adquisición verificada — MVP

Financiada por café interesado.

Condición mínima:

- Usuario no tiene compra pagada previa en café destino.
- Usuario realiza compra válida durante ventana.
- `ConsumptionLog` confirma proof.

Resultado:

- Desbloquea voucher de campaña.
- Voucher incentiva retorno y fulfillment.
- `CampaignEscrow` mantiene presupuesto antes de publicación.

### 12.2 Coffee crawl — MVP

Financiado por pool de crawls del fondo común.

Ejemplo:

```text
Compra pagada en A
+ compra pagada en B
+ compra pagada en C
antes de expiry
→ voucher colectivo
```

Cada paso debe ser consumo distinto y verificable.

### 12.3 Post-MVP

- Win-back.
- Subasta visible.
- Bidding dinámico.
- Segmentación avanzada.
- Sponsors.

---

## 13. Modelo de negocio

### Cliente pagador

Cafetería independiente.

### Producto vendido

- Acceso a red.
- Cien emisiones cubiertas.
- Portabilidad de reward.
- Tráfico pagado atribuible.
- Retención compartida.
- Campañas verificables.
- Participación en fondo común.
- Dashboard y operación.

### Fuentes MVP

- Plan S/49.
- Packs S/40.

### Futuras, no aprobadas

- Fee de campaña.
- Sponsors.
- Contratos corporativos.
- Compras colectivas.
- Servicios avanzados.

No incluirlas en proyección base sin decisión y evidencia.

---

## 14. Mercado y competencia

### Categorías

| Categoría | Ejemplos | Qué resuelve | Límite frente a PUNCH |
|---|---|---|---|
| Sellos digitales | Seillo, Morita | Retención dentro de negocio | Programa aislado |
| Promos de pago | Yape Promos | Distribución desde rail masivo | Banco controla canal; no hay coalición |
| Loyalty de cadena | Starbucks Rewards | Relación compartida entre locales | Un solo dueño |
| Redes/restaurantes | Blackbird | Loyalty y pagos de red | Depende más del rail de pago |
| Card-linked offers | Cardlytics | Adquisición atribuida a tarjeta | Acceso limitado para pequeño comercio |
| Coalition loyalty SMB | Fivestars/SumUp | Red de comercios | Operador central controla ledger |
| PUNCH | — | Loyalty portable + demanda verificable | Requiere densidad local y control de fraude |

Cifras externas deben validarse nuevamente antes de pitch público; esta spec conserva comparación estructural, no métricas de terceros.

### Moat

No es código ni token. Es:

- Densidad caminable.
- Relaciones con comercios.
- Integración operativa.
- Historial de cumplimiento.
- Reserva y campañas activas.
- Confianza en reglas compartidas.

---

## 15. Arbitrum como fuente de verdad

### Principio

```text
Arbitrum manda.
Postgres proyecta.
```

Arbitrum controla:

- Estado de café.
- Estado de plan.
- Créditos.
- Reserva asignada/no asignada.
- Balance PUNCH.
- Emisión y burn.
- Payout.
- Fondo y epochs.
- Campañas y vouchers.

Postgres puede indexar estos datos para UX, pero no reemplazarlos.

### Por qué core

- Impide emisión sin cobertura.
- Hace splits verificables.
- Reduce discreción de operador.
- Permite reconstrucción desde eventos.
- Ejecuta compromisos multi-comercio sin deuda bilateral.

Usuario final no necesita conocer Arbitrum.

---

## 16. Contratos

### `CafeRegistry`

Responsabilidad:

- Identidad on-chain de café.
- Estado `pending | active | suspended | exited`, con transiciones validadas y `exited` terminal.
- Cuentas autorizadas; el owner queda autorizado implícitamente.
- Productos de emisión/reward: solo el bit de aprobación. Precio, COGS y el tope de retail S/12 se verifican fuera de cadena (§07); ningún contrato lee un precio para liquidar.
- Traspaso de titularidad en dos pasos.

No mueve valor: ni PUNCH, ni reserva, ni PEN.

Roles:

- `DEFAULT_ADMIN_ROLE` — multisig PUNCH; otorga y revoca roles.
- `REGISTRAR_ROLE` — backend de operación PUNCH; `registerCafe` y `setCafeStatus`.
- Escrituras del café (`authorizeOperator`, `setEligibleProduct`, `proposeOwner`) no usan rol: se validan contra la titularidad del `cafeId`.

Sin `Pausable`: el freno granular es `setCafeStatus(id, Suspended)` y una llave de registrar comprometida se responde con `revokeRole`. La pausa vive en los contratos que mueven valor.

Operaciones:

- `registerCafe`
- `setCafeStatus`
- `authorizeOperator`
- `setEligibleProduct`
- `proposeOwner`
- `acceptOwnership`

Lecturas:

- `getCafe`
- `isAuthorized`
- `isEligible`
- `isOperational`
- `cafeCount`

Eventos:

- `CafeRegistered`
- `CafeStatusChanged`
- `ProductEligibilityChanged`
- `OperatorAuthorized`
- `CafeOwnerProposed`
- `CafeOwnerTransferred`

`setCafeStatus(id, exited)` no toca reserva ni balances; esas obligaciones (§02.8, §21) son de `PunchVault` y `PlanManager`.

### `PlanManager`

Responsabilidad:

- Plan, packs, splits, créditos y rollover.
- Reserva no asignada por café.
- Consumo de crédito autorizado.

Operaciones:

- `subscribe`
- `buyPack`
- `consumeCredit`
- `cancel`
- `withdrawUnusedReserve`

Eventos:

- `PlanActivated`
- `PackPurchased`
- `EmissionCreditConsumed`
- `PlanCancelled`
- `UnusedReserveWithdrawn`

### `ConsumptionLog`

Responsabilidad:

- EIP-712.
- Nonce/expiry.
- Receipt hash único.
- Registro de consumo.

Operación:

- `recordConsumption`

Evento:

- `ConsumptionRecorded`

### `PunchVault`

Responsabilidad:

- Ledger no transferible.
- Reserva de rewards.
- Emisión, burn y payout.
- Invariante de cobertura.

Operaciones:

- `issue`
- `redeem`
- `balanceOf`

Transferencias entre usuarios deben revertir/no existir.

Eventos:

- `PunchIssued`
- `PunchBurned`
- `RewardRedeemed`
- `HostPaid`

### `NetworkFund`

Responsabilidad:

- Aportes.
- Presupuestos por epoch.
- Referencias.
- Claims prorrateados.
- Coffee crawl.

Operaciones:

- `fundEpoch`
- `recordReferral`
- `finalizeOriginEpoch`
- `claimOriginCredit`
- `allocateCampaignBudget`

### `CampaignEscrow`

Responsabilidad:

- Presupuesto prefondeado.
- Condiciones.
- Progreso.
- Voucher.
- Payout.

Operaciones:

- `createCampaign`
- `fundCampaign`
- `recordProgress`
- `unlockVoucher`
- `redeemVoucher`
- `cancelUnpublishedCampaign`

Campaña publicada no puede retirar presupuesto comprometido contra vouchers válidos.

### `MockPEN`

ERC-20 de prueba con faucet en Sepolia. No implica solución fiat productiva.

### `PUNCH Treasury`

En MVP es cuenta multisig receptora, no contrato del protocolo. Recibe presupuesto operativo de planes y packs. No tiene permisos sobre reserva, balances ni fondo común. Un treasury contract con políticas de gasto queda post-MVP.

---

## 17. Flujos y firmas

### Pago de plan

```text
Café paga 49 mPEN
→ PlanManager
   ├─ 30 → PunchVault
   ├─ 5  → NetworkFund
   ├─ 14 → Treasury
   └─ 100 créditos
```

Split y créditos deben ocurrir en una transacción.

### Compra Yape

```text
Usuario → Yape → Café
Café + usuario firman proof
Relayer → ConsumptionLog
ConsumptionLog valida
PlanManager consume crédito
PunchVault emite 1 PUNCH
```

Payload EIP-712:

```text
cafeId
user
productId
amount
receiptHash
nonce
expiry
chainId
verifyingContract
```

### Canje

```text
usuario + anfitrión confirman
→ verificar café/producto/balance
→ burn 12
→ payout S/3.60
```

### Límite Yape

Arbitrum no observa pago Yape. Proof es atestación dual. Mitigaciones:

- Nonce.
- Expiry.
- Receipt hash.
- Producto y monto firmados.
- Límites diarios.
- Detección de colusión.
- Suspensión.
- Integración POS/Yape futura.

---

## 18. Postgres y backend

### Postgres sí guarda

- PII.
- Auth/sesiones.
- Perfil enriquecido de café.
- Imágenes/catálogo UX.
- Geo y búsqueda.
- Notificaciones.
- CRM.
- Analytics.
- Riesgo y alertas.
- Cola relayer.
- Eventos indexados/proyecciones.

### Postgres no decide

- Balance.
- Reserva.
- Créditos.
- Canje válido.
- Payout confirmado.
- Fondo disponible.
- Voucher reclamado.

### Servicios

- `auth`: identidad y sesión.
- `relayer`: envío, reintentos e idempotencia.
- `indexer`: eventos → proyecciones.
- `risk`: señales y suspensión propuesta.
- `notifications`: estados y campañas.
- `analytics`: métricas sin autoridad económica.

### Reconciliación

Ante discrepancia:

1. Pausar proyección afectada.
2. Leer estado/eventos Arbitrum.
3. Reindexar desde bloque conocido.
4. Comparar invariantes.
5. Reanudar UI.

---

## 19. Frontend

### Consumidor

- Home/balance.
- Escáner/confirmación.
- Cafés/productos.
- Canje.
- Historial.
- Campañas/vouchers.
- Coffee crawl.

### Cafetería

- Onboarding.
- Plan/packs.
- Emisión.
- Canje anfitrión.
- Catálogo.
- Payouts.
- Tráfico/referencias.
- Fondo.
- Campañas.

### Operaciones

- Aprobaciones.
- Riesgo/suspensión.
- Relayer/indexer.
- Reserva/fondo.
- Campañas colectivas.
- Reconciliación.

### Estados obligatorios

- Cargando.
- Esperando firma.
- Pendiente on-chain.
- Confirmado.
- Reintento disponible.
- Rechazado con razón accionable.

---

## 20. Seguridad y fraude

### Amenazas

- Café fabrica compras.
- Usuario y café coluden.
- Replay.
- Receipt duplicado.
- División artificial de tickets.
- Producto barato para farming.
- Canje doble.
- Voucher doble.
- Relayer manipulado.
- Admin comprometido.
- Retiro de reserva viva.
- Proyección Postgres falsa.

### Controles MVP

- Dos firmas.
- Nonce monotónico.
- Expiry corto.
- Receipt hash único.
- Catálogo aprobado.
- Límites por usuario/café/producto.
- Atomicidad.
- Checks-effects-interactions.
- Pausable por contrato específico.
- Roles mínimos.
- Treasury/admin separados.
- Eventos completos.
- Invariant/fuzz tests.

MVP custodial debe declararse: clave de usuario cifrada y servidor firma en su nombre. Esto reduce garantía de firma del usuario. Post-MVP migra a passkey/account abstraction sin cambiar reglas económicas.

---

## 21. Errores y recuperación

| Condición | Respuesta |
|---|---|
| Plan inactivo | Bloquear emisión/pack |
| Crédito insuficiente | Revertir emisión |
| Reserva insuficiente | Revertir emisión |
| Producto inválido | Rechazar proof |
| Nonce usado | Rechazar proof |
| Proof expirado | Pedir QR nuevo |
| Receipt duplicado | Rechazar como idempotente/duplicado |
| Relayer falla antes de tx | Reintentar misma intención |
| Tx revierte | Mostrar razón; no cambiar proyección final |
| Menos de 12 PUNCH | Bloquear canje |
| Anfitrión suspendido | Bloquear canje |
| Escrow insuficiente | No publicar campaña |
| Voucher reclamado | Rechazar segundo claim |
| Postgres desfasado | Reindexar |
| Café cancela con PUNCH vivos | Mantener reserva asignada |

No usar actualizaciones optimistas como confirmación económica final.

---

## 22. Stack y convenciones

Stack actual objetivo:

- Next.js 16 / React 19.
- Elysia `/api/v1`.
- Better Auth.
- Drizzle + Postgres.
- Eden + TanStack Query.
- zod.
- Tailwind v4 / shadcn.
- viem.
- Solidity + Foundry.
- Vitest / Biome.

Dominios esperados:

```text
src/core/cafe
src/core/plan
src/core/consumption
src/core/punch
src/core/fund
src/core/campaign
src/core/chain
```

Seguir `docs/code-review/*` para schemas, hooks, tablas y formularios.

---

## 23. Alcance MVP

### Incluye

- Cuatro cafés ficticios.
- Usuarios sembrados.
- `MockPEN` Sepolia.
- Registro/aprobación café.
- Plan S/49.
- Pack S/40.
- Rollover.
- Productos elegibles.
- Compra simulada Yape.
- Proof dual.
- Emisión 1 PUNCH.
- Balance no transferible.
- Canje 12 PUNCH.
- Payout S/3.60.
- Fondo común.
- Referencias verificables y pool prorrateado.
- Adquisición verificada.
- Coffee crawl.
- PWA consumidor.
- Panel café.
- Consola operaciones mínima.
- Indexer, relayer y analytics.

### No incluye

- API Yape/POS.
- Mainnet.
- Solución fiat regulada.
- Token transferible/especulativo.
- Expiración.
- Payout dinámico.
- NFT/DAO.
- App nativa/NFC.
- Multi-ciudad.
- Sponsors.
- Win-back.
- Subasta/bidding.
- Compras colectivas.
- Account abstraction final.

---

## 24. Pruebas y criterios de aceptación

### Contratos

- Split S/49 exacto.
- Split S/40 exacto.
- Rollover exacto.
- Emisión consume un crédito.
- Emisión genera un PUNCH.
- Transferencia no existe/revierte.
- Doce burn por canje.
- Payout S/3.60.
- Burn+payout atómico.
- Reserva nunca bajo `livePunch × 0.30`.
- Cancelación no libera reserva viva.
- Origin epoch no excede pool.
- Voucher no tiene doble claim.
- Campaña no promete más que escrow.

### Seguridad

- Replay falla.
- Nonce duplicado falla.
- Expiry falla.
- Firma café incorrecta falla.
- Firma usuario incorrecta falla.
- Producto/café suspendido falla.
- Reentrancy/roles/pausas probados.

### Integración

- Plan → compra → proof → emisión.
- Doce compras → canje → payout.
- Referencia A → compra B → epoch → claim.
- Adquisición → condición → voucher → fulfillment.
- Crawl multi-café → voucher.
- Reindexación desde cero produce misma proyección.

### UX

- Usuario completa flujo sin ver blockchain.
- Estados pendientes no aparecen como confirmados.
- Error explica siguiente acción.
- Mobile y desktop sin overflow.
- Accesibilidad de teclado y contraste.

---

## 25. Métricas

### Técnicas

- Tx exitosa/fallida.
- Tiempo de confirmación.
- Reintentos relayer.
- Diferencias de indexación.
- Violaciones de invariant: cero.
- Fraude por 1,000 emisiones.

### Económicas de piloto

- Visitas incrementales.
- Desplazamiento de ventas.
- Retorno pagado.
- Upsell.
- Margen incremental por café.
- Cafés que cubren S/49.
- CAC por campaña.
- Referencias verificables.
- Valor atribuido al fondo.
- Emisión/canje.
- Tiempo a canje.

No presentar métricas sembradas como reales.

---

## 26. Riesgos

| Riesgo | Por qué importa | Mitigación MVP |
|---|---|---|
| Desplazamiento alto | Destruye margen de pequeños | Medir cohortes, guardrails, adquisición enfocada |
| Cold start | Red sin densidad tiene poco valor | Cuatro cafés cercanos, crawl |
| Fraude Yape | Cadena no verifica banco | Dos firmas, límites, riesgo |
| COGS mayor al payout | Anfitrión pierde | Producto reward aprobado |
| Fondo percibido como impuesto | Baja adopción | Ledger visible y atribución |
| Reserva inmovilizada | Fricción para café | Plan pequeño, rollover/retiro no asignado |
| Custodia de claves | Operador puede firmar | Declarar límite; migrar a passkeys |
| Activo PEN productivo | Regulación/onramp no resueltos | MockPEN; no fingir solución |
| Café abandona red | Pasivo debe sobrevivir | Reserva viva bloqueada, canje en otros cafés |
| Admin malicioso | Puede suspender/alterar catálogo | Roles, eventos, timelock post-MVP |
| Simulación optimista | Falsa confianza | Etiqueta explícita, piloto/holdout |

---

## 27. Post-MVP

Prioridad condicionada por piloto:

1. Integración verificable POS/Yape.
2. Passkeys/account abstraction.
3. Mainnet y activo de liquidación regulado.
4. Win-back.
5. Sponsors/capital externo.
6. Compras colectivas.
7. Contratos corporativos.
8. Multi-zona/multi-ciudad.
9. Subasta solo si existe demanda suficiente.

Ningún ítem es promesa hasta decisión nueva.

---

## 28. Decision log

### Aprobado

| Decisión | Razón |
|---|---|
| 1 compra elegible = 1 PUNCH | Mecánica comprensible |
| 12 PUNCH = producto ≤ S/12 | Voucher específico, no dinero |
| Payout S/3.60 fijo | Cubre COGS objetivo con margen pequeño |
| Plan S/49 | Entrada viable para MVP |
| Pack S/40 con split 30/5/5 | Mantiene cobertura y aporta a coalición |
| Rollover completo | Café conserva valor no usado |
| Fondo separado | Evita mezclar reward y marketing |
| Origen prorrata por referencia verificable | No quiebra pool ni crea regalía perpetua |
| PUNCH no expira en MVP | Confianza y simplicidad |
| Arbitrum core | Constitución económica verificable |
| Postgres proyección | UX rápida sin autoridad monetaria |
| Campañas con voucher separado | Preserva regla de emisión |
| MVP con adquisición + crawl | Valida demanda y coalición |
| Demo de 4 cafés | Explicabilidad y simulación auditada |

### Descartado

| Modelo descartado | Motivo |
|---|---|
| 1 punto = S/0.01 | Exige colateral retail y convierte loyalty en dinero |
| 1 PUNCH = S/1 | Imposible fondear MVP de forma realista |
| Payout S/12 | Suscripción no cubre exposición |
| Split 50/50 emisor/anfitrión | No corresponde al costo de fulfillment aprobado |
| Depósito inicial S/500 | Fricción excesiva para piloto |
| Loyalty gratis para siempre | No financia reserva/operación |
| Campaign fee como único ingreso | Valor principal ahora es red + plan |
| Postgres-first | Permite discreción sobre economía |
| PUNCH como wallet | Usuario sigue pagando por Yape |
| Origin credits = ganancia nueva | Son transferencia interna |
| Upsell como valor principal | Incrementalidad y retorno valen más |
| Más miembros = ROI automático | Densidad sin comportamiento no aumenta promedio |

---

## 29. Fórmulas canónicas

### Reserva

```text
requiredReserve = livePunch × 0.30
availableToIssue = unallocatedReserve / 0.30
```

### Canje

```text
rewardCount = floor(userPunch / 12)
payout = rewardCount × 3.60
```

### Margen anfitrión y reward

```text
directRewardMargin = redemptions × (3.60 − COGS)
upsellMargin = redemptions × upsellRate × upsellMarginPerSale
paidReturnMargin = redemptions × paidReturnRate × paidSaleMargin
rewardDisplacementLoss = redemptions × rewardDisplacementRate × paidSaleMargin
rewardNet = directRewardMargin
          + upsellMargin
          + paidReturnMargin
          − rewardDisplacementLoss
hostValue = rewardNet
```

`rewardDisplacementLoss` mide canjes que reemplazan una compra normal en el café anfitrión.

### Retorno café

```text
inboundPaidMargin = inboundPaidVisits × paidSaleMargin
ownRetentionMargin = ownRetentionSales × paidSaleMargin
exportedDisplacementLoss = displacedOutboundPaidVisits × paidSaleMargin

netReturn = inboundPaidMargin
          + ownRetentionMargin
          + rewardNet
          + originCredit
          − exportedDisplacementLoss
          − subscription

ROI = netReturn / subscription × 100
```

`exportedDisplacementLoss` es distinto de `rewardDisplacementLoss`: mide una compra pagada que salió del café de origen hacia otro miembro.

### Crédito de origen

```text
originCreditCafe = originPool × verifiedReferralsCafe / verifiedReferralsNetwork
```

---

## 30. Simulación de cuatro cafés

**Seed:** `F4–LIMA–2408`  
**Ventana:** 30 días  
**Naturaleza:** ficticia, sembrada y congelada para auditoría. No es evidencia de mercado.

### Cafés

| Café | Clientes iniciales | Compras base | Margen base |
|---|---:|---:|---:|
| Brújula Café | 180 | 220 | S/1,980 |
| Patio 9 | 120 | 150 | S/1,350 |
| Nube Tostada | 75 | 95 | S/855 |
| Esquina Sur | 45 | 55 | S/495 |

### Suscripciones

```text
4 × S/49 = S/196
├─ Reserva S/120
├─ Fondo S/20
└─ Operación PUNCH S/56
```

### Tráfico cruzado pagado

| Origen | A | B | C | D | Total enviado |
|---|---:|---:|---:|---:|---:|
| A | — | 4 | 5 | 7 | 16 |
| B | 2 | — | 3 | 6 | 11 |
| C | 2 | 3 | — | 3 | 8 |
| D | 2 | 2 | 1 | — | 5 |
| **Recibido** | **6** | **9** | **9** | **16** | **40** |

Mayor café origina más referencias; menor café recibe más tráfico pagado. Es supuesto sembrado, no garantía.

### Emisión y reserva

```text
A emite 100
B emite 95
C emite 90
D emite 85
Total 370

30 canjes × 12 = 360 PUNCH quemados
10 PUNCH vivos
30 × S/3.60 = S/108 payouts
Reserva inicial S/120
Reserva restante S/12
Pasivo 10 × S/0.30 = S/3
Reserva no asignada S/9
```

S/9 es capacidad no usada, no utilidad creada.

### Cohortes separadas

- `X01–X40`: primeras visitas cruzadas pagadas.
- `R01–R16`: retención propia pagada.
- `P01–P08`: retornos pagados posteriores al reward.
- `U01–U09`: upsells.

Ninguna transacción pertenece a dos cohortes.

### Retornos netos

| Café | Retorno neto | ROI sobre S/49 |
|---|---:|---:|
| Brújula Café | +S/23.20 | 47.3% |
| Patio 9 | +S/63.60 | 129.8% |
| Nube Tostada | +S/72.60 | 148.2% |
| Esquina Sur | +S/153.00 | 312.2% |
| **Coalición** | **+S/312.40** | **159.4%** |

Supuestos de stress base:

- 25% de viajes pagados desplazan compra de origen.
- 12.5% de canjes desplazan compra normal.
- COGS S/3.
- Margen pagado S/9.

Worst case 100%/100%:

| Café | Retorno neto |
|---|---:|
| Brújula Café | −S/111.80 |
| Patio 9 | −S/62.40 |
| Nube Tostada | −S/44.40 |
| Esquina Sur | +S/27.00 |
| **Coalición** | **−S/191.60** |

Solo 1/4 cubre plan.

Conclusión:

> PUNCH no puede limitarse a mover consumo existente. Debe producir visitas incrementales, retornos y demanda medible.

---

## 31. Preguntas que solo piloto puede responder

- ¿Qué porcentaje de visitas es incremental?
- ¿Cuánto desplazamiento tolera cada café?
- ¿S/49 se percibe razonable?
- ¿S/3.60 cubre COGS real de productos elegidos?
- ¿Cien créditos son suficientes?
- ¿Cuántos packs compra café activo?
- ¿Qué porcentaje vuelve después de reward?
- ¿Fondo produce ventas causales o solo atribuidas?
- ¿Qué fraude aparece con atestación Yape?
- ¿Qué densidad mínima genera utilidad?

Estas preguntas no son placeholders técnicos. Son hipótesis explícitas que requieren piloto controlado.
