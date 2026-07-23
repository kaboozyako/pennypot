// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockJackpot} from "./MockJackpot.sol";

interface IERC20 {
    function transferFrom(address, address, uint256) external returns (bool);
}

/**
 * @notice Minimal stand-in for Megapot's JackpotRandomTicketBuyer. Pulls USDC from the
 *         caller (PennyPot) and mints quick-pick Jackpot tickets to the recipient via
 *         MockJackpot. Models the real flow where buying goes through this contract, not
 *         the Jackpot directly.
 */
contract MockRandomTicketBuyer {
    IERC20 public usdc;
    MockJackpot public jackpot;

    constructor(address _usdc, address _jackpot) {
        usdc = IERC20(_usdc);
        jackpot = MockJackpot(_jackpot);
    }

    function buyTickets(
        uint256 _count,
        address _recipient,
        address[] calldata, /* _referrers */
        uint256[] calldata, /* _referralSplitBps */
        bytes32 /* _source */
    ) external returns (uint256[] memory ids) {
        require(_recipient != address(0), "bad recipient");
        // NOTE: Megapot does NOT enforce recipient != referrer (verified on-chain against
        // both the Jackpot and the JackpotRandomTicketBuyer), so PennyPot referring its own
        // ticket — recipient == referrer == PennyPot — is allowed.

        uint256 total = jackpot.ticketPrice() * _count;
        require(usdc.transferFrom(msg.sender, address(jackpot), total), "USDC pull failed");

        ids = new uint256[](_count);
        for (uint256 i = 0; i < _count; i++) {
            ids[i] = jackpot.mintTicket(_recipient);
        }
    }
}
