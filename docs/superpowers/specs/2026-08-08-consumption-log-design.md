# ConsumptionLog — diseño

Fecha: 2026-08-08
Sub-proyecto 4 de PUNCH. Spec madre: `docs/superpowers/specs/2026-08-07-punch-master-spec.md` (§02 invariantes, §16 contratos, §17 flujos y firmas, §20 seguridad y fraude, §21 errores).

## Propósito

`ConsumptionLog` es el único punto de entrada de emisión de PUNCH. Valida un proof EIP-712 firmado por el café y por el usuario, garantiza que ese proof no se pueda reusar, y orquesta la emisión llamando a `PlanManager.consumeCredit(cafeId)` y luego a `PunchVault.issue(user, cafeId)`.

No custodia mPEN. No emite PUNCH. No conoce precios ni reservas: delega.

Invariante 2 de la spec madre — "una compra válida de producto elegible emite exactamente un PUNCH" — se cumple aquí o no se cumple en ningún lado.

## Interface congelado

`src/interfaces/IConsumptionLog.sol` no se modifica:

```solidity
struct ConsumptionProof {
    uint256 cafeId;
    address user;
    uint256 productId;
    uint256 amount;
    bytes32 receiptHash;
    uint256 nonce;
    uint256 expiry;
}

event ConsumptionRecorded(uint256 indexed cafeId, address indexed user, bytes32 indexed receiptHash);

function recordConsumption(
    ConsumptionProof calldata proof,
    bytes calldata cafeSignature,
    bytes calldata userSignature
) external;
```

`productId` y `amount` no caben en el evento congelado. Ambos quedan reconstruibles desde el calldata de la transacción, y el backend ya los tiene del proof que firmó, así que la proyección Postgres no pierde información.

## Arquitectura

```
recordConsumption(proof, cafeSignature, userSignature)
  ├─ checks        (todo revierte antes de mutar estado)
  ├─ effects       (nonce, receiptHash, contador diario)
  ├─ emit ConsumptionRecorded
  └─ interactions  planManager.consumeCredit(cafeId)
                   punchVault.issue(user, cafeId)
```

Checks-effects-interactions estricto (§20). Si el vault revierte, la transacción entera revierte y el crédito no se consume: emisión atómica.

`PlanManager.consumeCredit` ya valida plan activo, café operacional y crédito disponible, y mueve S/0.30 de reserva al vault. `ConsumptionLog` no duplica esas comprobaciones — delega y deja que sus errores propaguen (§21: plan inactivo, crédito insuficiente, reserva insuficiente).

### Dependencias

`ICafeRegistry`, `IPlanManager`, `IPunchVault`, las tres **immutable**, seteadas en el constructor. Ninguna palanca de admin sobre la ruta de emisión: un owner comprometido (§20) no puede redirigir la emisión a un vault falso. Redeployar cuesta un `setConsumptionLog` en PlanManager; el único estado que se perdería son nonces y receipts gastados, que el backend puede re-sembrar mediante nonces nuevos.

Herencia: `Ownable` (config de ops) y `Pausable` (freno de emergencia, §20 "pausable por contrato específico").

### Orden de deploy

1. `CafeRegistry`, `MockPEN`, `NetworkFund`, `PunchVault` ya desplegados
2. `PlanManager`
3. `ConsumptionLog(registry, planManager, punchVault)`
4. `planManager.setConsumptionLog(address(consumptionLog))` — paso manual del owner, no lo hace el script

## Decisiones de diseño

### Nonce: único por café, sin orden

`mapping(uint256 cafeId => mapping(uint256 nonce => bool)) nonceUsed`.

Cada nonce se gasta una sola vez, en cualquier orden. §20 dice "nonce monotónico", pero un contador estricto obliga a orden de transacciones: un café con dos cajas o varios QR en vuelo se bloquea en cuanto el relayer manda las tx desordenadas, y hay que re-firmar. La unicidad sin orden da la misma protección de replay sin ese fallo operativo.

### Relayer permissionless

Cualquiera puede enviar `recordConsumption`. Las dos firmas son la autorización; quien manda la tx solo paga gas. Esto neutraliza por diseño la amenaza §20 "relayer manipulado": una key de relayer comprometida no puede fabricar emisiones, solo dejar de enviarlas — y en ese caso cualquier otro puede enviarlas.

### Firmante del café: cualquier operador autorizado

`registry.isAuthorized(cafeId, signer)`, igual que hace `PlanManager`. El barista firma con su propia key desde el POS; la key del dueño no vive en cada caja. Revocar a un barista es un tx en `CafeRegistry`, sin tocar este contrato.

### Verificación: ECDSA + EIP-1271

`SignatureChecker.isValidSignatureNow` de OpenZeppelin para ambas firmas. El MVP es custodial (el servidor firma por el usuario con su key cifrada, §20) y eso es una EOA, así que funciona igual; cuando el usuario migre a passkey / account abstraction no hace falta redeploy ni tocar el interface congelado.

### EIP-712

`EIP712("PUNCH ConsumptionLog", "1")` de OpenZeppelin. `chainId` y `verifyingContract` entran por el domain separator, cubriendo el payload completo de §17. El typehash cubre los 7 campos del struct en su orden declarado:

```
ConsumptionProof(uint256 cafeId,address user,uint256 productId,uint256 amount,bytes32 receiptHash,uint256 nonce,uint256 expiry)
```

El contrato expone `hashProof(ConsumptionProof calldata) external view returns (bytes32)` para que backend y tests firmen contra la misma fuente de verdad en vez de duplicar el typehash a mano.

### Expiry: vencimiento más techo de ventana

Revierte si `block.timestamp > proof.expiry`, y también si `proof.expiry > block.timestamp + MAX_PROOF_TTL`, con `MAX_PROOF_TTL` constante de 15 minutos.

Sin el techo, "expiry corto" (§20) no es un control del protocolo: el firmante elige el valor y puede poner diez años. Constante y no variable de admin, siguiendo "roles mínimos" (§20).

### Amount: mínimo configurable

Revierte si `proof.amount < minTicketAmount`, valor inicial `8e6` (S/8, 6 decimales como mPEN), seteable por owner.

Ataja dos amenazas de §20 a la vez — "división artificial de tickets" y "producto barato para farming" — sin depender de que cada café cure bien su catálogo. Configurable porque el piso correcto es una hipótesis económica que va a moverse, no una constante del protocolo.

### Cap diario por (usuario, café)

`dailyCount[cafeId][user][block.timestamp / 1 days] < maxDailyPerUserCafe`, valor inicial 3, seteable por owner.

Ataja el fraude más directo de §20 — café y usuario coludidos farmeando en loop — con un contador barato. El resto de la detección (patrones, colusión entre varias cuentas) vive en el backend, que es donde se puede razonar sobre ella. Se descartó un cap adicional por café: los 100 créditos por compra de `PlanManager` ya limitan el volumen absoluto, y un tope diario por café castigaría un día pico legítimo.

El día es UTC por división entera de `block.timestamp`. Ventana fija, no deslizante: un usuario puede emitir 3 a las 23:59 y 3 a las 00:01. Aceptado — el objetivo es cortar el loop sostenido, no el borde.

### ReceiptHash único por café

`mapping(uint256 cafeId => mapping(bytes32 receiptHash => bool)) receiptUsed`.

Con unicidad global, un café malicioso puede quemar por adelantado hashes que otro café va a usar, y dos cafés que derivan el hash de un correlativo local de boleta colisionan sin querer. El scoping por café elimina ambos casos.

## Validaciones, en orden

Barato antes que caro; todo antes de mutar.

1. `whenNotPaused`
2. `proof.user != address(0)` → `InvalidUser`
3. `block.timestamp <= proof.expiry` → `ProofExpired(expiry)`
4. `proof.expiry <= block.timestamp + MAX_PROOF_TTL` → `ExpiryTooFar(expiry)`
5. `proof.amount >= minTicketAmount` → `TicketTooSmall(amount)`
6. `registry.isEligible(cafeId, productId, ProductKind.Emission)` → `ProductNotEligible(cafeId, productId)`
7. `!nonceUsed[cafeId][nonce]` → `NonceUsed(cafeId, nonce)`
8. `!receiptUsed[cafeId][receiptHash]` → `ReceiptUsed(cafeId, receiptHash)`
9. `dailyCount[...] < maxDailyPerUserCafe` → `DailyLimitReached(cafeId, user)`
10. firma café válida y `registry.isAuthorized(cafeId, signer)` → `InvalidCafeSignature()`
11. firma usuario válida y `signer == proof.user` → `InvalidUserSignature()`

## Estado

```solidity
uint256 public constant MAX_PROOF_TTL = 15 minutes;

ICafeRegistry public immutable registry;
IPlanManager public immutable planManager;
IPunchVault public immutable punchVault;

uint256 public minTicketAmount;      // inicial 8e6
uint256 public maxDailyPerUserCafe;  // inicial 3

mapping(uint256 cafeId => mapping(uint256 nonce => bool)) public nonceUsed;
mapping(uint256 cafeId => mapping(bytes32 receiptHash => bool)) public receiptUsed;
mapping(uint256 cafeId => mapping(address user => mapping(uint256 day => uint256))) public dailyCount;
```

## Errores

Custom errors free-standing a nivel de archivo (convención del repo), todos con contexto:

```solidity
error ZeroAddress();
error InvalidUser();
error ProofExpired(uint256 expiry);
error ExpiryTooFar(uint256 expiry);
error TicketTooSmall(uint256 amount);
error ProductNotEligible(uint256 cafeId, uint256 productId);
error NonceUsed(uint256 cafeId, uint256 nonce);
error ReceiptUsed(uint256 cafeId, bytes32 receiptHash);
error DailyLimitReached(uint256 cafeId, address user);
error InvalidCafeSignature();
error InvalidUserSignature();
error InvalidLimit();
```

`PlanManager.sol` también declara un `ZeroAddress()` free-standing. Son declaraciones a nivel de archivo distintas, así que no colisionan mientras ningún archivo importe ambas por nombre. En `ConsumptionLog.t.sol`, que usa el `PlanManager` real, importar `{PlanManager}` sin traer su `ZeroAddress` evita el choque.

`InvalidLimit` cubre `setMaxDailyPerUserCafe(0)` y `setMinTicketAmount(0)`: ambos serían un apagado silencioso de un control de fraude. Para apagar la emisión existe `pause()`.

## Operación

Fuera del interface congelado (patrón `setConsumptionLog` / `mint`), todas `onlyOwner`:

- `setMinTicketAmount(uint256)` → evento `MinTicketAmountSet(uint256)`
- `setMaxDailyPerUserCafe(uint256)` → evento `MaxDailyPerUserCafeSet(uint256)`
- `pause()` / `unpause()`

Vista pública auxiliar: `hashProof(ConsumptionProof calldata) view returns (bytes32)`.

## Testing

### Mock

`PunchVault` real no existe todavía (otro frente lo implementa en paralelo). `MockPunchVault` se define dentro de `test/ConsumptionLog.t.sol`: implementa `IPunchVault` congelado, cuenta llamadas a `issue(user, cafeId)`, y expone un flag para forzar revert. `src/PunchVault.sol` no se toca.

Contra `PlanManager`, `CafeRegistry` y `MockPEN` se usan los contratos **reales** ya en main. Solo el vault es mock, así que los tests ejercen el wiring de verdad: `setConsumptionLog`, consumo de crédito, y los S/0.30 de reserva que se mueven al vault por emisión.

### `test/ConsumptionLog.t.sol`

- happy path: emite `ConsumptionRecorded`, `credits` baja 1, `issue` llamado exactamente 1 vez, S/0.30 movidos al vault
- un revert-test por cada custom error
- replay: mismo proof dos veces → `NonceUsed`
- receiptHash repetido con nonce distinto → `ReceiptUsed`
- mismo nonce y mismo receiptHash en otro café → pasa (scoping por café)
- operador revocado tras firmar → `InvalidCafeSignature`
- firma de usuario ajeno → `InvalidUserSignature`
- proof mutado después de firmar (cambiar `amount`) → revierte
- EIP-1271: cuenta-contrato como usuario, caso acepta y caso rechaza
- cap diario: 3 pasan, la 4ª revierte; `vm.warp` al día siguiente resetea; el café B no se ve afectado
- vault revierte → crédito no consumido (rollback completo)
- plan inactivo / sin créditos → propaga el error de `PlanManager`
- pausable; ops `onlyOwner`; constructor con `address(0)` → `ZeroAddress`
- fuzz de `amount` alrededor de `minTicketAmount` y de `expiry` alrededor de `MAX_PROOF_TTL`

### `test/ConsumptionLogInvariant.t.sol`

Handler que dispara proofs válidos e inválidos aleatorios, siguiendo el patrón de `PlanManagerInvariant.t.sol`. Invariantes:

- PUNCH emitidos == créditos consumidos
- ningún `(cafeId, nonce)` emite dos veces
- `dailyCount[cafeId][user][day] <= maxDailyPerUserCafe`
- balance mPEN del vault == `RESERVE_PER_CREDIT × emisiones`

Footgun Foundry a respetar: una llamada view después de `vm.prank` consume el prank. Cachear views antes de prankear.

## Deploy

`script/DeployConsumptionLog.s.sol`, mismo patrón que `DeployPlanManager.s.sol`: lee `CAFE_REGISTRY_ADDRESS`, `PLAN_MANAGER_ADDRESS` y `PUNCH_VAULT_ADDRESS` de env y despliega. El `setConsumptionLog` posterior queda documentado en el header del script como paso de wiring del owner; el script no lo ejecuta.

`script/Deploy.s.sol` compartido no se toca.

## Limpieza de scaffold

De `test/Scaffold.t.sol` se elimina únicamente: `test_consumptionLog_reverts_notImplemented`, el campo `consumptionLog`, su línea en `setUp`, y los imports de `ConsumptionLog` e `IConsumptionLog`. Los stubs de `PunchVault`, `NetworkFund` y `CampaignEscrow` quedan intactos.

## Archivos

Exclusivos de este sub-proyecto:

- `src/ConsumptionLog.sol` (reemplaza el stub)
- `test/ConsumptionLog.t.sol` (nuevo)
- `test/ConsumptionLogInvariant.t.sol` (nuevo)
- `script/DeployConsumptionLog.s.sol` (nuevo)
- `test/Scaffold.t.sol` (solo la eliminación descrita arriba)

## Fuera de alcance

- `PunchVault` real — otro frente
- Detección de colusión por patrones, suspensión automática, integración POS/Yape (§17 los marca como futuros)
- Cualquier cambio a `IConsumptionLog`, `IPunchVault` o `Deploy.s.sol`
