// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PennyPot} from "../src/PennyPot.sol";

/// @notice Deploys PennyPot. Defaults target Base mainnet (chain ID 8453); override any
///         value via environment variables:
///   USDC_ADDRESS         - USDC token                  (default: Base USDC)
///   JACKPOT_ADDRESS      - Megapot Jackpot             (default: Base Jackpot)
///   RANDOM_BUYER_ADDRESS - Megapot RandomTicketBuyer   (default: Base buyer)
///   OWNER_ADDRESS        - initial owner               (default: INITIAL_OWNER below)
///
/// PennyPot refers its own tickets (it is both recipient and referrer), so Megapot accrues
/// referral fees to PennyPot itself — no separate referrer wallet/contract to wire. After
/// deploy, seed the reserve (depositReserve) before cranking buyTicket.
///
/// Usage:
///   forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --broadcast --verify
contract Deploy is Script {
    // Base mainnet (chain ID 8453). Source: https://llms.megapot.io/
    address internal constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant BASE_JACKPOT = 0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2;
    address internal constant BASE_RANDOM_BUYER = 0xb9560b43b91dE2c1DaF5dfbb76b2CFcDaFc13aBd;

    /// @notice Initial contract owner (reserve management + pause).
    address internal constant INITIAL_OWNER = 0x1d671d1B191323A38490972D58354971E5c1cd2A;

    function run() external returns (PennyPot pennyPot) {
        address usdc = vm.envOr("USDC_ADDRESS", BASE_USDC);
        address jackpot = vm.envOr("JACKPOT_ADDRESS", BASE_JACKPOT);
        address randomBuyer = vm.envOr("RANDOM_BUYER_ADDRESS", BASE_RANDOM_BUYER);
        address owner = vm.envOr("OWNER_ADDRESS", INITIAL_OWNER);

        vm.startBroadcast();
        pennyPot = new PennyPot(usdc, jackpot, randomBuyer, owner);
        vm.stopBroadcast();

        console.log("PennyPot deployed at:", address(pennyPot));
        console.log("  USDC:        ", usdc);
        console.log("  Jackpot:     ", jackpot);
        console.log("  randomBuyer: ", randomBuyer);
        console.log("  owner:       ", owner);
        console.log("Next: depositReserve to seed the reserve before cranking buyTicket.");
    }
}
