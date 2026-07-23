// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice Minimal interface to Megapot's JackpotRandomTicketBuyer on Base.
 * @dev Quick-pick purchases: the buyer picks the numbers and mints Jackpot ticket NFTs
 *      to `_recipient`. The main Jackpot contract does NOT support quick-pick directly
 *      (its buyTickets requires an explicit 5-number pick), so PennyPot buys through here.
 *      Source of truth: https://llms.megapot.io/tasks/buy-random
 *      Deployed at 0xb9560b43b91dE2c1DaF5dfbb76b2CFcDaFc13aBd (Base mainnet).
 */
interface IRandomTicketBuyer {
    /// @param _count            Tickets to buy in one call (1..10).
    /// @param _recipient        Address that receives the minted ticket NFTs.
    /// @param _referrers        Up to `maxReferrers` addresses earning the referral fee.
    /// @param _referralSplitBps Weights matching `_referrers`, in 1e18 scale, summing to 1e18.
    /// @param _source           Analytics tag; Megapot convention is keccak256 of the app name.
    /// @return ticketIds        The minted Jackpot ticket ids (usable with the Jackpot's
    ///                          getTicketTierIds / claimWinnings).
    function buyTickets(
        uint256 _count,
        address _recipient,
        address[] calldata _referrers,
        uint256[] calldata _referralSplitBps,
        bytes32 _source
    ) external returns (uint256[] memory ticketIds);
}
