// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IJackpot} from "../../src/interfaces/IJackpot.sol";

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/**
 * @notice Minimal Megapot stand-in for unit tests. Only models the behaviors
 *         PennyPot actually uses: mintTicket (via the random buyer), claimWinnings,
 *         getDrawingState, getTicketTierIds, getDrawingTierPayouts, currentDrawingId.
 *
 *         Per-ticket payouts are set by the test via `setTicketTier()` before
 *         calling `settleDrawing()`. Tier payouts default to 0 except whatever
 *         the test seeds with `setTierPayout()`.
 */
contract MockJackpot {
    uint256 public ticketPrice;
    uint256 public drawingDuration;
    uint256 public currentDrawingId;
    IERC20 public usdc;

    struct DrawingData {
        uint256 drawingTime;
        uint256 winningTicket; // 0 until settled
        uint256[12] tierPayouts;
        mapping(uint256 => uint256) ticketTier; // megaTicketId => tier (0-11)
        mapping(uint256 => address) ticketOwner;
        mapping(uint256 => bool) claimed;
    }

    mapping(uint256 => DrawingData) internal drawingsData;
    uint256 internal nextTicketId = 1;

    // Track referral fees accrued per address (mirrors Megapot's public `referralFees`).
    mapping(address => uint256) public referralFees;

    constructor(address _usdc, uint256 _ticketPrice, uint256 _drawingDuration) {
        usdc = IERC20(_usdc);
        ticketPrice = _ticketPrice;
        drawingDuration = _drawingDuration;
        currentDrawingId = 1;
        drawingsData[1].drawingTime = block.timestamp + _drawingDuration;
    }

    // ---- IJackpot surface --------------------------------------------------

    /// @notice Mint a ticket to `recipient` under the current drawing. Called by the
    ///         MockRandomTicketBuyer, mirroring Megapot minting a quick-pick ticket NFT.
    function mintTicket(address recipient) external returns (uint256 id) {
        id = nextTicketId++;
        drawingsData[currentDrawingId].ticketOwner[id] = recipient;
    }

    function claimWinnings(uint256[] calldata _userTicketIds) external {
        // Mock claims from the most recently settled drawing.
        uint256 did = currentDrawingId - 1;
        DrawingData storage dd = drawingsData[did];
        require(dd.winningTicket != 0, "not settled");

        uint256 total;
        for (uint256 i = 0; i < _userTicketIds.length; i++) {
            uint256 id = _userTicketIds[i];
            require(dd.ticketOwner[id] == msg.sender, "not owner");
            require(!dd.claimed[id], "already claimed");
            // Megapot reverts when asked to claim a non-winning ticket (tier 0 = no
            // match, tier 2 = 1 normal/no bonusball). Models NoTicketsToClaim().
            uint256 tier = dd.ticketTier[id];
            require(tier != 0 && tier != 2, "NoTicketsToClaim");
            dd.claimed[id] = true;
            total += dd.tierPayouts[tier];
        }
        if (total > 0) {
            require(usdc.transfer(msg.sender, total), "USDC send failed");
        }
    }

    function claimReferralFees() external {
        // Megapot reverts (NoReferralFeesToClaim) on a zero balance; mirror that so the
        // sweepReferralFees zero-guard is actually exercised.
        uint256 amount = referralFees[msg.sender];
        require(amount > 0, "NoReferralFeesToClaim");
        referralFees[msg.sender] = 0;
        require(usdc.transfer(msg.sender, amount), "USDC send failed");
    }

    /// @notice Test helper: simulate Megapot accruing referral fees (purchase fee +/or
    ///         win share) to `referrer`. The contract must be funded with USDC to cover
    ///         what `claimReferralFees` will later pay out (as tests already do for wins).
    function accrueReferral(address referrer, uint256 amount) external {
        referralFees[referrer] += amount;
    }

    function getDrawingState(uint256 _drawingId) external view returns (IJackpot.DrawingState memory) {
        DrawingData storage dd = drawingsData[_drawingId];
        return IJackpot.DrawingState({
            prizePool: 0,
            ticketPrice: ticketPrice,
            edgePerTicket: 0,
            referralWinShare: 0,
            referralFee: 0,
            globalTicketsBought: 0,
            lpEarnings: 0,
            drawingTime: dd.drawingTime,
            winningTicket: dd.winningTicket,
            ballMax: 49,
            bonusballMax: 26,
            payoutCalculator: address(0),
            jackpotLock: false
        });
    }

    function getTicketTierIds(uint256[] calldata _ticketIds) external view returns (uint256[] memory tierIds) {
        // Look up by checking previous drawing (claim phase).
        uint256 did = currentDrawingId - 1;
        DrawingData storage dd = drawingsData[did];
        tierIds = new uint256[](_ticketIds.length);
        for (uint256 i = 0; i < _ticketIds.length; i++) {
            tierIds[i] = dd.ticketTier[_ticketIds[i]];
        }
    }

    function getDrawingTierPayouts(uint256 _drawingId) external view returns (uint256[12] memory) {
        return drawingsData[_drawingId].tierPayouts;
    }

    // ---- Test helpers ------------------------------------------------------

    /// @notice Mark a ticket as landing in a specific prize tier (0-11) BEFORE settlement.
    function setTicketTier(uint256 drawingId, uint256 ticketId, uint256 tier) external {
        drawingsData[drawingId].ticketTier[ticketId] = tier;
    }

    /// @notice Set the per-ticket USDC payout for a tier in a given drawing.
    function setTierPayout(uint256 drawingId, uint256 tier, uint256 payout) external {
        drawingsData[drawingId].tierPayouts[tier] = payout;
    }

    /// @notice Settle the current drawing, advance to the next one. Caller must have
    ///         transferred enough USDC into this contract beforehand to fund any
    ///         winnings that will be claimed.
    function settleDrawing() external {
        DrawingData storage dd = drawingsData[currentDrawingId];
        require(block.timestamp >= dd.drawingTime, "too early");
        dd.winningTicket = 12345; // sentinel non-zero
        // Advance.
        currentDrawingId += 1;
        drawingsData[currentDrawingId].drawingTime = block.timestamp + drawingDuration;
    }
}
