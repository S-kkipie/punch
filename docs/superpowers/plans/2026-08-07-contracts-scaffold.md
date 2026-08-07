# Contracts Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `packages/contracts` Foundry workspace with one interface + empty implementation per PUNCH contract, plus viem chain glue in `src/core/chain`, so later sub-projects build on a compiling, tested foundation.

**Architecture:** pnpm workspace where the existing Next.js app stays at the repo root and `packages/contracts` is a Foundry package. Solidity interfaces mirror master spec §16 operations/events exactly; implementations revert `NotImplemented()`. The TS side gets an Arbitrum Sepolia viem client factory and a zero-address contract map.

**Tech Stack:** Foundry (forge 1.7.x), Solidity ^0.8.30, forge-std, OpenZeppelin (installed, unused), viem, Vitest, pnpm workspaces.

## Global Constraints

- Solidity pragma: `^0.8.30`; `solc_version = "0.8.30"` in foundry.toml.
- Interface operation and event names copied verbatim from master spec §16 (`docs/superpowers/specs/2026-08-07-punch-master-spec.md`).
- No economic logic anywhere — every implementation function reverts `NotImplemented()`.
- Existing Next.js app files must not move; only additions at root (`pnpm-workspace.yaml`, package.json edits, `src/core/chain/`).
- Vitest tests live in `src/**/__tests__/*.test.ts` (existing include pattern); import alias `@` → `src`.
- Arbitrum Sepolia chain id: 421614.
- Run `pnpm check:fix` before each commit that touches TS files (Biome formats with 4-space indent).

---

### Task 1: pnpm workspace + Foundry package skeleton

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/foundry.toml`
- Create: `packages/contracts/remappings.txt`
- Create: `packages/contracts/.gitignore`
- Modify: `package.json` (root — add scripts + viem)

**Interfaces:**
- Consumes: nothing.
- Produces: `packages/contracts` buildable via `forge build`; root scripts `contracts:build`, `contracts:test`; `viem` available to `src/core/chain` (Task 5).

- [ ] **Step 1: Create workspace file**

`pnpm-workspace.yaml`:

```yaml
packages:
    - "packages/*"
```

- [ ] **Step 2: Create contracts package manifest**

`packages/contracts/package.json`:

```json
{
    "name": "@punch/contracts",
    "version": "0.1.0",
    "private": true,
    "scripts": {
        "build": "forge build",
        "test": "forge test"
    }
}
```

- [ ] **Step 3: Create foundry.toml**

`packages/contracts/foundry.toml`:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
test = "test"
script = "script"
solc_version = "0.8.30"
```

- [ ] **Step 4: Create remappings and .gitignore**

`packages/contracts/remappings.txt`:

```text
forge-std/=lib/forge-std/src/
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
```

`packages/contracts/.gitignore`:

```text
out/
cache/
```

- [ ] **Step 5: Install forge-std and OpenZeppelin**

Run from repo root:

```bash
cd packages/contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts
```

Note: repo git root is the project root, so forge adds submodules at `packages/contracts/lib/*`. If `forge install` complains about a dirty working tree, commit pending changes first.

- [ ] **Step 6: Add root scripts + viem**

In root `package.json` `"scripts"`, add:

```json
"contracts:build": "pnpm --dir packages/contracts build",
"contracts:test": "pnpm --dir packages/contracts test"
```

Then run: `pnpm add viem`

- [ ] **Step 7: Verify empty build works**

Run: `pnpm contracts:build`
Expected: `forge build` succeeds (no sources yet — "Nothing to compile" or success with 0 files).

Run: `pnpm install`
Expected: succeeds; workspace recognized.

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml packages/contracts .gitmodules
git commit -m "chore: add pnpm workspace and Foundry contracts package"
```

---

### Task 2: Solidity interfaces (spec §16)

**Files:**
- Create: `packages/contracts/src/interfaces/ICafeRegistry.sol`
- Create: `packages/contracts/src/interfaces/IPlanManager.sol`
- Create: `packages/contracts/src/interfaces/IConsumptionLog.sol`
- Create: `packages/contracts/src/interfaces/IPunchVault.sol`
- Create: `packages/contracts/src/interfaces/INetworkFund.sol`
- Create: `packages/contracts/src/interfaces/ICampaignEscrow.sol`
- Create: `packages/contracts/src/interfaces/IMockPEN.sol`

**Interfaces:**
- Consumes: Task 1 package skeleton.
- Produces: the seven interfaces below, exactly as written — Task 3 implementations and all later sub-projects implement these.

- [ ] **Step 1: Write ICafeRegistry.sol**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface ICafeRegistry {
    enum CafeStatus {
        Pending,
        Active,
        Suspended,
        Exited
    }

    enum ProductKind {
        Emission,
        Reward
    }

    event CafeRegistered(uint256 indexed cafeId, address indexed owner);
    event CafeStatusChanged(uint256 indexed cafeId, CafeStatus status);
    event ProductEligibilityChanged(
        uint256 indexed cafeId, uint256 indexed productId, ProductKind kind, bool eligible
    );

    function registerCafe(address owner) external returns (uint256 cafeId);
    function setCafeStatus(uint256 cafeId, CafeStatus status) external;
    function authorizeOperator(uint256 cafeId, address operator, bool authorized) external;
    function setEligibleProduct(uint256 cafeId, uint256 productId, ProductKind kind, bool eligible)
        external;
}
```

- [ ] **Step 2: Write IPlanManager.sol**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IPlanManager {
    event PlanActivated(uint256 indexed cafeId);
    event PackPurchased(uint256 indexed cafeId);
    event EmissionCreditConsumed(uint256 indexed cafeId);
    event PlanCancelled(uint256 indexed cafeId);
    event UnusedReserveWithdrawn(uint256 indexed cafeId, uint256 amount);

    function subscribe(uint256 cafeId) external;
    function buyPack(uint256 cafeId) external;
    function consumeCredit(uint256 cafeId) external;
    function cancel(uint256 cafeId) external;
    function withdrawUnusedReserve(uint256 cafeId) external;
}
```

- [ ] **Step 3: Write IConsumptionLog.sol**

Proof struct fields come from master spec §17 EIP-712 payload (chainId and verifyingContract are supplied by the EIP-712 domain, not the struct).

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IConsumptionLog {
    struct ConsumptionProof {
        uint256 cafeId;
        address user;
        uint256 productId;
        uint256 amount;
        bytes32 receiptHash;
        uint256 nonce;
        uint256 expiry;
    }

    event ConsumptionRecorded(
        uint256 indexed cafeId, address indexed user, bytes32 indexed receiptHash
    );

    function recordConsumption(
        ConsumptionProof calldata proof,
        bytes calldata cafeSignature,
        bytes calldata userSignature
    ) external;
}
```

- [ ] **Step 4: Write IPunchVault.sol**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IPunchVault {
    event PunchIssued(address indexed user, uint256 indexed cafeId);
    event PunchBurned(address indexed user, uint256 amount);
    event RewardRedeemed(address indexed user, uint256 indexed hostCafeId, uint256 indexed productId);
    event HostPaid(uint256 indexed hostCafeId, uint256 amount);

    function issue(address user, uint256 cafeId) external;
    function redeem(address user, uint256 hostCafeId, uint256 productId) external;
    function balanceOf(address user) external view returns (uint256);
}
```

- [ ] **Step 5: Write INetworkFund.sol**

Spec §16 lists operations but no event names for NetworkFund; these event names are scaffold-chosen and may be refined in sub-project 6.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface INetworkFund {
    event EpochFunded(uint256 indexed epoch, uint256 amount);
    event ReferralRecorded(uint256 indexed epoch, uint256 indexed originCafeId);
    event OriginEpochFinalized(uint256 indexed epoch);
    event OriginCreditClaimed(uint256 indexed epoch, uint256 indexed cafeId, uint256 amount);
    event CampaignBudgetAllocated(uint256 indexed epoch, uint256 amount);

    function fundEpoch(uint256 epoch, uint256 amount) external;
    function recordReferral(uint256 epoch, uint256 originCafeId) external;
    function finalizeOriginEpoch(uint256 epoch) external;
    function claimOriginCredit(uint256 epoch, uint256 cafeId) external;
    function allocateCampaignBudget(uint256 epoch, uint256 amount) external;
}
```

- [ ] **Step 6: Write ICampaignEscrow.sol**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface ICampaignEscrow {
    event CampaignCreated(uint256 indexed campaignId, uint256 indexed sourceCafeId);
    event CampaignFunded(uint256 indexed campaignId, uint256 amount);
    event ProgressRecorded(uint256 indexed campaignId, address indexed user);
    event VoucherUnlocked(uint256 indexed campaignId, address indexed user);
    event VoucherRedeemed(uint256 indexed campaignId, address indexed user);
    event CampaignCancelled(uint256 indexed campaignId);

    function createCampaign(uint256 sourceCafeId) external returns (uint256 campaignId);
    function fundCampaign(uint256 campaignId, uint256 amount) external;
    function recordProgress(uint256 campaignId, address user) external;
    function unlockVoucher(uint256 campaignId, address user) external;
    function redeemVoucher(uint256 campaignId, address user) external;
    function cancelUnpublishedCampaign(uint256 campaignId) external;
}
```

- [ ] **Step 7: Write IMockPEN.sol**

The full ERC-20 surface arrives in sub-project 2 (impl will extend OpenZeppelin ERC20). Scaffold only fixes the faucet operation.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IMockPEN {
    event FaucetDripped(address indexed to, uint256 amount);

    function faucet(uint256 amount) external;
}
```

- [ ] **Step 8: Verify compile**

Run: `pnpm contracts:build`
Expected: compiles clean, 7 interface artifacts in `packages/contracts/out`.

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/src/interfaces
git commit -m "feat(contracts): add spec §16 interfaces"
```

---

### Task 3: Empty implementations + scaffold tests

**Files:**
- Create: `packages/contracts/src/NotImplemented.sol`
- Create: `packages/contracts/src/CafeRegistry.sol`
- Create: `packages/contracts/src/PlanManager.sol`
- Create: `packages/contracts/src/ConsumptionLog.sol`
- Create: `packages/contracts/src/PunchVault.sol`
- Create: `packages/contracts/src/NetworkFund.sol`
- Create: `packages/contracts/src/CampaignEscrow.sol`
- Create: `packages/contracts/src/MockPEN.sol`
- Test: `packages/contracts/test/Scaffold.t.sol`

**Interfaces:**
- Consumes: Task 2 interfaces (exact names above).
- Produces: deployable contracts `CafeRegistry`, `PlanManager`, `ConsumptionLog`, `PunchVault`, `NetworkFund`, `CampaignEscrow`, `MockPEN`, each implementing its interface; shared free-standing error `NotImplemented()` in `src/NotImplemented.sol`.

- [ ] **Step 1: Write the failing test**

`packages/contracts/test/Scaffold.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {NotImplemented} from "../src/NotImplemented.sol";
import {CafeRegistry} from "../src/CafeRegistry.sol";
import {PlanManager} from "../src/PlanManager.sol";
import {ConsumptionLog} from "../src/ConsumptionLog.sol";
import {PunchVault} from "../src/PunchVault.sol";
import {NetworkFund} from "../src/NetworkFund.sol";
import {CampaignEscrow} from "../src/CampaignEscrow.sol";
import {MockPEN} from "../src/MockPEN.sol";
import {IConsumptionLog} from "../src/interfaces/IConsumptionLog.sol";
import {ICafeRegistry} from "../src/interfaces/ICafeRegistry.sol";

contract ScaffoldTest is Test {
    CafeRegistry internal cafeRegistry;
    PlanManager internal planManager;
    ConsumptionLog internal consumptionLog;
    PunchVault internal punchVault;
    NetworkFund internal networkFund;
    CampaignEscrow internal campaignEscrow;
    MockPEN internal mockPEN;

    function setUp() public {
        cafeRegistry = new CafeRegistry();
        planManager = new PlanManager();
        consumptionLog = new ConsumptionLog();
        punchVault = new PunchVault();
        networkFund = new NetworkFund();
        campaignEscrow = new CampaignEscrow();
        mockPEN = new MockPEN();
    }

    function test_cafeRegistry_reverts_notImplemented() public {
        vm.expectRevert(NotImplemented.selector);
        cafeRegistry.registerCafe(address(this));
        vm.expectRevert(NotImplemented.selector);
        cafeRegistry.setCafeStatus(1, ICafeRegistry.CafeStatus.Active);
        vm.expectRevert(NotImplemented.selector);
        cafeRegistry.authorizeOperator(1, address(this), true);
        vm.expectRevert(NotImplemented.selector);
        cafeRegistry.setEligibleProduct(1, 1, ICafeRegistry.ProductKind.Emission, true);
    }

    function test_planManager_reverts_notImplemented() public {
        vm.expectRevert(NotImplemented.selector);
        planManager.subscribe(1);
        vm.expectRevert(NotImplemented.selector);
        planManager.buyPack(1);
        vm.expectRevert(NotImplemented.selector);
        planManager.consumeCredit(1);
        vm.expectRevert(NotImplemented.selector);
        planManager.cancel(1);
        vm.expectRevert(NotImplemented.selector);
        planManager.withdrawUnusedReserve(1);
    }

    function test_consumptionLog_reverts_notImplemented() public {
        IConsumptionLog.ConsumptionProof memory proof;
        vm.expectRevert(NotImplemented.selector);
        consumptionLog.recordConsumption(proof, "", "");
    }

    function test_punchVault_reverts_notImplemented() public {
        vm.expectRevert(NotImplemented.selector);
        punchVault.issue(address(this), 1);
        vm.expectRevert(NotImplemented.selector);
        punchVault.redeem(address(this), 1, 1);
        vm.expectRevert(NotImplemented.selector);
        punchVault.balanceOf(address(this));
    }

    function test_networkFund_reverts_notImplemented() public {
        vm.expectRevert(NotImplemented.selector);
        networkFund.fundEpoch(1, 1);
        vm.expectRevert(NotImplemented.selector);
        networkFund.recordReferral(1, 1);
        vm.expectRevert(NotImplemented.selector);
        networkFund.finalizeOriginEpoch(1);
        vm.expectRevert(NotImplemented.selector);
        networkFund.claimOriginCredit(1, 1);
        vm.expectRevert(NotImplemented.selector);
        networkFund.allocateCampaignBudget(1, 1);
    }

    function test_campaignEscrow_reverts_notImplemented() public {
        vm.expectRevert(NotImplemented.selector);
        campaignEscrow.createCampaign(1);
        vm.expectRevert(NotImplemented.selector);
        campaignEscrow.fundCampaign(1, 1);
        vm.expectRevert(NotImplemented.selector);
        campaignEscrow.recordProgress(1, address(this));
        vm.expectRevert(NotImplemented.selector);
        campaignEscrow.unlockVoucher(1, address(this));
        vm.expectRevert(NotImplemented.selector);
        campaignEscrow.redeemVoucher(1, address(this));
        vm.expectRevert(NotImplemented.selector);
        campaignEscrow.cancelUnpublishedCampaign(1);
    }

    function test_mockPEN_reverts_notImplemented() public {
        vm.expectRevert(NotImplemented.selector);
        mockPEN.faucet(1);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm contracts:test`
Expected: FAIL to compile — `CafeRegistry` etc. not found.

- [ ] **Step 3: Write shared error**

`packages/contracts/src/NotImplemented.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Scaffold-only revert. Every function loses this as its
/// contract's sub-project implements real behavior.
error NotImplemented();
```

- [ ] **Step 4: Write implementations**

`packages/contracts/src/CafeRegistry.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ICafeRegistry} from "./interfaces/ICafeRegistry.sol";
import {NotImplemented} from "./NotImplemented.sol";

contract CafeRegistry is ICafeRegistry {
    function registerCafe(address) external pure returns (uint256) {
        revert NotImplemented();
    }

    function setCafeStatus(uint256, CafeStatus) external pure {
        revert NotImplemented();
    }

    function authorizeOperator(uint256, address, bool) external pure {
        revert NotImplemented();
    }

    function setEligibleProduct(uint256, uint256, ProductKind, bool) external pure {
        revert NotImplemented();
    }
}
```

`packages/contracts/src/PlanManager.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPlanManager} from "./interfaces/IPlanManager.sol";
import {NotImplemented} from "./NotImplemented.sol";

contract PlanManager is IPlanManager {
    function subscribe(uint256) external pure {
        revert NotImplemented();
    }

    function buyPack(uint256) external pure {
        revert NotImplemented();
    }

    function consumeCredit(uint256) external pure {
        revert NotImplemented();
    }

    function cancel(uint256) external pure {
        revert NotImplemented();
    }

    function withdrawUnusedReserve(uint256) external pure {
        revert NotImplemented();
    }
}
```

`packages/contracts/src/ConsumptionLog.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IConsumptionLog} from "./interfaces/IConsumptionLog.sol";
import {NotImplemented} from "./NotImplemented.sol";

contract ConsumptionLog is IConsumptionLog {
    function recordConsumption(ConsumptionProof calldata, bytes calldata, bytes calldata)
        external
        pure
    {
        revert NotImplemented();
    }
}
```

`packages/contracts/src/PunchVault.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPunchVault} from "./interfaces/IPunchVault.sol";
import {NotImplemented} from "./NotImplemented.sol";

contract PunchVault is IPunchVault {
    function issue(address, uint256) external pure {
        revert NotImplemented();
    }

    function redeem(address, uint256, uint256) external pure {
        revert NotImplemented();
    }

    function balanceOf(address) external pure returns (uint256) {
        revert NotImplemented();
    }
}
```

`packages/contracts/src/NetworkFund.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {INetworkFund} from "./interfaces/INetworkFund.sol";
import {NotImplemented} from "./NotImplemented.sol";

contract NetworkFund is INetworkFund {
    function fundEpoch(uint256, uint256) external pure {
        revert NotImplemented();
    }

    function recordReferral(uint256, uint256) external pure {
        revert NotImplemented();
    }

    function finalizeOriginEpoch(uint256) external pure {
        revert NotImplemented();
    }

    function claimOriginCredit(uint256, uint256) external pure {
        revert NotImplemented();
    }

    function allocateCampaignBudget(uint256, uint256) external pure {
        revert NotImplemented();
    }
}
```

`packages/contracts/src/CampaignEscrow.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ICampaignEscrow} from "./interfaces/ICampaignEscrow.sol";
import {NotImplemented} from "./NotImplemented.sol";

contract CampaignEscrow is ICampaignEscrow {
    function createCampaign(uint256) external pure returns (uint256) {
        revert NotImplemented();
    }

    function fundCampaign(uint256, uint256) external pure {
        revert NotImplemented();
    }

    function recordProgress(uint256, address) external pure {
        revert NotImplemented();
    }

    function unlockVoucher(uint256, address) external pure {
        revert NotImplemented();
    }

    function redeemVoucher(uint256, address) external pure {
        revert NotImplemented();
    }

    function cancelUnpublishedCampaign(uint256) external pure {
        revert NotImplemented();
    }
}
```

`packages/contracts/src/MockPEN.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IMockPEN} from "./interfaces/IMockPEN.sol";
import {NotImplemented} from "./NotImplemented.sol";

contract MockPEN is IMockPEN {
    function faucet(uint256) external pure {
        revert NotImplemented();
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm contracts:test`
Expected: PASS — 7 tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src packages/contracts/test
git commit -m "feat(contracts): add empty implementations with scaffold tests"
```

---

### Task 4: Deploy script stub

**Files:**
- Create: `packages/contracts/script/Deploy.s.sol`

**Interfaces:**
- Consumes: Task 3 contracts.
- Produces: `Deploy` forge script; wiring/broadcast lands with sub-project 2.

- [ ] **Step 1: Write stub**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";

/// @notice Deploy wiring lands once contracts have real implementations
/// (sub-project 2 onward). Kept as a stub so the script path is fixed.
contract Deploy is Script {
    function run() external {}
}
```

- [ ] **Step 2: Verify compile**

Run: `pnpm contracts:build`
Expected: compiles clean.

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/script
git commit -m "feat(contracts): add deploy script stub"
```

---

### Task 5: TS chain glue (`src/core/chain`)

**Files:**
- Create: `src/core/chain/chain.ts`
- Create: `src/core/chain/addresses.ts`
- Create: `src/core/chain/abis.ts`
- Test: `src/core/chain/__tests__/chain.test.ts`

**Interfaces:**
- Consumes: `viem` (added in Task 1).
- Produces:
  - `chain: Chain` (viem's `arbitrumSepolia`, id 421614)
  - `createChainPublicClient(rpcUrl?: string): PublicClient`
  - `contractNames: readonly ["cafeRegistry", "planManager", "consumptionLog", "punchVault", "networkFund", "campaignEscrow", "mockPEN"]`
  - `type ContractName`, `type AddressMap = Record<ContractName, Address>`
  - `addresses: Record<"arbitrumSepolia", AddressMap>` (all zero addresses)
  - `abis` placeholder const

- [ ] **Step 1: Write the failing test**

`src/core/chain/__tests__/chain.test.ts`:

```ts
import { isAddress } from "viem";
import { describe, expect, it } from "vitest";
import { addresses, contractNames } from "@/core/chain/addresses";
import { chain, createChainPublicClient } from "@/core/chain/chain";

describe("chain config", () => {
    it("targets Arbitrum Sepolia", () => {
        expect(chain.id).toBe(421614);
    });

    it("creates a public client bound to the chain", () => {
        const client = createChainPublicClient();
        expect(client.chain?.id).toBe(421614);
    });

    it("has a valid address entry per contract", () => {
        for (const name of contractNames) {
            const address = addresses.arbitrumSepolia[name];
            expect(isAddress(address)).toBe(true);
        }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/core/chain`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write implementation**

`src/core/chain/chain.ts`:

```ts
import { createPublicClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";

export const chain = arbitrumSepolia;

export function createChainPublicClient(rpcUrl?: string) {
    return createPublicClient({ chain, transport: http(rpcUrl) });
}
```

`src/core/chain/addresses.ts`:

```ts
import type { Address } from "viem";

export const contractNames = [
    "cafeRegistry",
    "planManager",
    "consumptionLog",
    "punchVault",
    "networkFund",
    "campaignEscrow",
    "mockPEN",
] as const;

export type ContractName = (typeof contractNames)[number];
export type AddressMap = Record<ContractName, Address>;

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

// Zero until the first deployment (sub-project 2 onward).
export const addresses: Record<"arbitrumSepolia", AddressMap> = {
    arbitrumSepolia: {
        cafeRegistry: ZERO_ADDRESS,
        planManager: ZERO_ADDRESS,
        consumptionLog: ZERO_ADDRESS,
        punchVault: ZERO_ADDRESS,
        networkFund: ZERO_ADDRESS,
        campaignEscrow: ZERO_ADDRESS,
        mockPEN: ZERO_ADDRESS,
    },
};
```

`src/core/chain/abis.ts`:

```ts
// ABIs re-exported from @punch/contracts artifacts. Codegen lands with the
// first implemented contract (sub-project 2); this module fixes the import
// path the rest of the app will use.
export const abis = {} as const;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/core/chain`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
pnpm check:fix
pnpm typecheck
git add src/core/chain
git commit -m "feat(chain): add Arbitrum Sepolia viem config and address map"
```

---

### Task 6: Full verification pass

**Files:**
- None created; verification only.

**Interfaces:**
- Consumes: everything above.
- Produces: green scaffold baseline.

- [ ] **Step 1: Run everything**

```bash
pnpm contracts:build
pnpm contracts:test
pnpm test
pnpm typecheck
pnpm check
```

Expected: all pass. If Biome flags `packages/contracts` JSON/toml files, add `packages/contracts/lib` and `packages/contracts/out` to biome ignore in `biome.json` (`"files": { "ignore": [...] }` style per existing config) and re-run.

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "chore: green scaffold verification baseline"
```

Only commit if Step 1 required changes; otherwise skip.
