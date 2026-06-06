// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PennyPot} from "../src/PennyPot.sol";
import {MockJackpot} from "./mocks/MockJackpot.sol";
import {MockRandomTicketBuyer} from "./mocks/MockRandomTicketBuyer.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract PennyPotTest is Test {
    MockUSDC usdc;
    MockJackpot jackpot;
    MockRandomTicketBuyer buyer;
    PennyPot pot;

    address owner = address(0xA11CE);
    address feeReceiver = address(0xFEE);
    address alice = address(0xA);
    address bob = address(0xB);
    address carol = address(0xC);

    uint256 constant SEED_RESERVE = 365_000_000; // 365 USDC
    uint256 constant DRAWING_DURATION = 24 hours;

    function setUp() public {
        usdc = new MockUSDC();
        jackpot = new MockJackpot(address(usdc), 1_000_000, DRAWING_DURATION);
        buyer = new MockRandomTicketBuyer(address(usdc), address(jackpot));
        pot = new PennyPot(address(usdc), address(jackpot), address(buyer), owner);

        // Seed the reserve (owner-only). depositReserve pulls USDC from the owner.
        usdc.mint(owner, SEED_RESERVE);
        vm.startPrank(owner);
        usdc.approve(address(pot), SEED_RESERVE);
        pot.depositReserve(SEED_RESERVE);
        vm.stopPrank();
        assertEq(pot.reservePool(), SEED_RESERVE);

        // Give test users some USDC + approvals.
        _fund(alice, 1_000_000); // $1
        _fund(bob, 1_000_000);
        _fund(carol, 1_000_000);
    }

    // ----- helpers -------------------------------------------------------

    function _fund(address user, uint256 amount) internal {
        usdc.mint(user, amount);
        vm.prank(user);
        usdc.approve(address(pot), type(uint256).max);
    }

    /// @dev Crank a fresh ticket and return its Megapot ticket id.
    function _buyTicket() internal returns (uint256 id) {
        pot.buyTicket();
        id = pot.activeTicketId();
    }

    function _ids(uint256 a) internal pure returns (uint256[] memory arr) {
        arr = new uint256[](1);
        arr[0] = a;
    }

    function _ids(uint256 a, uint256 b) internal pure returns (uint256[] memory arr) {
        arr = new uint256[](2);
        arr[0] = a;
        arr[1] = b;
    }

    // ----- Construction --------------------------------------------------

    function test_constructor_reverts_on_zero_addresses() public {
        vm.expectRevert(PennyPot.ZeroAddress.selector);
        new PennyPot(address(0), address(jackpot), address(buyer), owner);
        vm.expectRevert(PennyPot.ZeroAddress.selector);
        new PennyPot(address(usdc), address(0), address(buyer), owner);
        vm.expectRevert(PennyPot.ZeroAddress.selector);
        new PennyPot(address(usdc), address(jackpot), address(0), owner);
        // Zero owner is rejected by OZ Ownable, not our ZeroAddress check.
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new PennyPot(address(usdc), address(jackpot), address(buyer), address(0));
    }

    function test_selfReferrer_accruesToPennyPot() public {
        // PennyPot refers its own ticket (recipient == referrer == PennyPot). Megapot allows
        // this (verified on-chain), so buyTicket succeeds and referral fees accrue to PennyPot.
        uint256 id1 = _buyTicket();
        assertTrue(id1 != 0);
        // Simulate Megapot accruing PennyPot's referral fee, then PennyPot sweeps it in.
        jackpot.accrueReferral(address(pot), 80_000);
        usdc.mint(address(jackpot), 80_000);
        uint256 swept = pot.sweepReferralFees();
        assertEq(swept, 80_000);
        assertEq(pot.feePool(), 80_000);
    }

    // ----- Happy path: full ticket, no winnings --------------------------

    function test_happyPath_ticketFillsLosesNoWinnings() public {
        uint256 drawingId = jackpot.currentDrawingId();

        // Buy first ticket from reserve; 100 shares sold by alice+bob (50 each).
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 50);
        vm.prank(bob);
        pot.buyTicketShares(id1, 50);

        // Ticket filled; reserve fully replenished.
        (uint8 sold,,,) = pot.getTicket(id1);
        assertEq(sold, 100);
        assertEq(pot.reservePool(), SEED_RESERVE);

        // Roll to a second ticket; carol takes 100 shares.
        uint256 id2 = _buyTicket();
        assertTrue(id2 != id1);
        vm.prank(carol);
        pot.buyTicketShares(id2, 100);

        // Reserve still at seed; both tickets recorded under the drawing.
        assertEq(pot.reservePool(), SEED_RESERVE);
        assertEq(pot.getDrawingTicketCount(drawingId), 2);

        // Time-travel past drawingTime; settle on Megapot; claim on our side.
        vm.warp(block.timestamp + DRAWING_DURATION + 1);
        jackpot.settleDrawing();
        pot.claimWinnings(_ids(id1, id2));

        // All tickets in tier 0 (lose) by default => no winnings.
        assertEq(pot.claimable(alice), 0);
        assertEq(pot.claimable(bob), 0);
        assertEq(pot.claimable(carol), 0);

        // Withdraw reverts since nothing owed.
        vm.expectRevert(PennyPot.NothingToWithdraw.selector);
        vm.prank(alice);
        pot.withdraw();
    }

    // ----- Happy path: winning ticket, pro-rata payout -------------------

    function test_happyPath_winningTicket_proRataAcrossShareholders() public {
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 25); // alice owns 25%
        vm.prank(bob);
        pot.buyTicketShares(id1, 75); // bob owns 75%; ticket now full.

        // Ticket lands in tier 11 (jackpot tier), payout = 1000 USDC.
        jackpot.setTicketTier(jackpot.currentDrawingId(), id1, 11);
        jackpot.setTierPayout(jackpot.currentDrawingId(), 11, 1000_000_000);

        // Settle + fund + claim.
        vm.warp(block.timestamp + DRAWING_DURATION + 1);
        usdc.mint(address(jackpot), 1000_000_000);
        jackpot.settleDrawing();
        pot.claimWinnings(_ids(id1));

        // winningsPerShare = 1000_000_000 / 100 = 10_000_000.
        assertEq(pot.claimable(alice), 250_000_000);
        assertEq(pot.claimable(bob), 750_000_000);

        // Withdraw both; each balance rises by exactly the winnings owed.
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        pot.withdraw();
        assertEq(usdc.balanceOf(alice) - aliceBefore, 250_000_000);

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        pot.withdraw();
        assertEq(usdc.balanceOf(bob) - bobBefore, 750_000_000);

        // Double-withdraw reverts (claimable balance zeroed).
        vm.expectRevert(PennyPot.NothingToWithdraw.selector);
        vm.prank(alice);
        pot.withdraw();
    }

    // ----- Undersubscription amplifies payout per share -------------------

    function test_undersubscription_amplifiesPayoutPerShare() public {
        uint256 id1 = _buyTicket();
        // Only 10 shares sold (10%).
        vm.prank(alice);
        pot.buyTicketShares(id1, 10);

        jackpot.setTicketTier(jackpot.currentDrawingId(), id1, 11);
        jackpot.setTierPayout(jackpot.currentDrawingId(), 11, 1000_000_000);

        vm.warp(block.timestamp + DRAWING_DURATION + 1);
        usdc.mint(address(jackpot), 1000_000_000);
        jackpot.settleDrawing();
        pot.claimWinnings(_ids(id1));

        // winningsPerShare = 1000_000_000 / 10 = 100_000_000 (100 USDC per share!)
        // Alice owns 10 shares -> 1000 USDC owed; her 0.10 USDC bought all of it.
        assertEq(pot.claimable(alice), 1000_000_000);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        pot.withdraw();
        assertEq(usdc.balanceOf(alice) - aliceBefore, 1000_000_000);
    }

    // ----- Frontrun protection: MIN_SELLING_WINDOW ------------------------

    function test_buyTicket_revertsIfTooCloseToDrawingTime() public {
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 100); // Fill ticket.

        uint64 drawingTime = pot.activeDeadline();

        // Warp to 30 minutes before drawingTime (inside the 1-hour buffer).
        vm.warp(uint256(drawingTime) - 30 minutes);
        vm.expectRevert(PennyPot.PastSellingWindow.selector);
        pot.buyTicket();

        // Works at exactly 1h + 1s before drawing close.
        vm.warp(uint256(drawingTime) - (1 hours + 1));
        pot.buyTicket();
    }

    // ----- buyTicketShares: state guards ---------------------------------------

    function test_buyTicketShares_revertsBeforeTicketBought() public {
        // No buyTicket yet => no active ticket.
        vm.expectRevert(PennyPot.NoActiveTicket.selector);
        vm.prank(alice);
        pot.buyTicketShares(1, 1);
    }

    function test_buyTicketShares_revertsWhenFullAndOnRollover() public {
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 100); // Fills ticket.

        // Buying more of a full ticket exceeds capacity.
        vm.expectRevert(PennyPot.InvalidCount.selector);
        vm.prank(bob);
        pot.buyTicketShares(id1, 1);

        // Roll to the next ticket; the old id is no longer the active one.
        uint256 id2 = _buyTicket();
        vm.expectRevert(abi.encodeWithSelector(PennyPot.UnexpectedTicket.selector, id2, id1));
        vm.prank(bob);
        pot.buyTicketShares(id1, 1);

        // Buying the new active ticket works.
        vm.prank(bob);
        pot.buyTicketShares(id2, 1);
    }

    function test_buyTicketShares_revertsIfOversold() public {
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 99);

        // 99 + 2 > 100.
        vm.expectRevert(PennyPot.InvalidCount.selector);
        vm.prank(bob);
        pot.buyTicketShares(id1, 2);

        // 99 + 1 == 100 works.
        vm.prank(bob);
        pot.buyTicketShares(id1, 1);
    }

    function test_buyTicketShares_revertsAfterDrawingTime() public {
        uint256 id1 = _buyTicket();
        vm.warp(block.timestamp + DRAWING_DURATION + 1);
        vm.expectRevert(PennyPot.PastSellingWindow.selector);
        vm.prank(alice);
        pot.buyTicketShares(id1, 1);
    }

    // ----- buyTicketSharesFor: gifting -----------------------------------------

    function test_buyTicketSharesFor_creditsRecipientNotPayer() public {
        uint256 id1 = _buyTicket();

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 reserveBefore = pot.reservePool();

        // Alice (payer) gifts 30 shares to bob (recipient).
        vm.prank(alice);
        pot.buyTicketSharesFor(id1, 30, bob);

        // Shares credited to bob, not alice.
        assertEq(pot.getTicketShares(id1, bob), 30);
        assertEq(pot.getTicketShares(id1, alice), 0);

        // Bob is the sole holder; sold reflects the gift.
        (uint8 sold, uint8 holders,,) = pot.getTicket(id1);
        assertEq(sold, 30);
        assertEq(holders, 1);
        (address[] memory hs,) = pot.getTicketHolders(id1);
        assertEq(hs[0], bob);

        // USDC was pulled from the payer (alice); reserve replenished by the cost.
        uint256 cost = 30 * pot.SHARE_PRICE();
        assertEq(aliceBefore - usdc.balanceOf(alice), cost);
        assertEq(usdc.balanceOf(bob), 1_000_000); // bob's balance untouched
        assertEq(pot.reservePool(), reserveBefore + cost);
    }

    function test_buyTicketSharesFor_recipientCanClaimPayerCannot() public {
        uint256 d = jackpot.currentDrawingId();
        uint256 id1 = _buyTicket();

        // Alice gifts a full ticket's worth of shares to bob.
        vm.prank(alice);
        pot.buyTicketSharesFor(id1, 100, bob);

        // Jackpot-tier win, 100 USDC payout.
        jackpot.setTicketTier(d, id1, 11);
        jackpot.setTierPayout(d, 11, 100_000_000);

        vm.warp(block.timestamp + DRAWING_DURATION + 1);
        usdc.mint(address(jackpot), 100_000_000);
        jackpot.settleDrawing();
        pot.claimWinnings(_ids(id1));

        // The recipient (bob) is owed the winnings; the payer (alice) gets nothing.
        assertEq(pot.claimable(bob), 100_000_000);
        assertEq(pot.claimable(alice), 0);

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        pot.withdraw();
        assertEq(usdc.balanceOf(bob) - bobBefore, 100_000_000);

        // Alice has nothing to withdraw.
        vm.expectRevert(PennyPot.NothingToWithdraw.selector);
        vm.prank(alice);
        pot.withdraw();
    }

    function test_buyTicketSharesFor_revertsZeroRecipient() public {
        uint256 id1 = _buyTicket();
        vm.expectRevert(PennyPot.ZeroAddress.selector);
        vm.prank(alice);
        pot.buyTicketSharesFor(id1, 1, address(0));
    }

    function test_buyTicketSharesFor_mixesWithSelfBuyAndFills() public {
        uint256 id1 = _buyTicket();

        // Alice self-buys 40, then gifts 60 to bob => ticket fills with two holders.
        vm.prank(alice);
        pot.buyTicketShares(id1, 40);
        vm.prank(alice);
        pot.buyTicketSharesFor(id1, 60, bob);

        (uint8 sold, uint8 holders,,) = pot.getTicket(id1);
        assertEq(sold, 100);
        assertEq(holders, 2);
        assertEq(pot.getTicketShares(id1, alice), 40);
        assertEq(pot.getTicketShares(id1, bob), 60);

        // Active ticket is now full => the next crank is allowed.
        (,,,, bool canBuy,,) = pot.getState();
        assertTrue(canBuy);
    }

    function test_buyTicketSharesFor_appliesSameGuards() public {
        uint256 id1 = _buyTicket();

        // Oversold: 99 + 2 > 100.
        vm.prank(alice);
        pot.buyTicketSharesFor(id1, 99, bob);
        vm.expectRevert(PennyPot.InvalidCount.selector);
        vm.prank(alice);
        pot.buyTicketSharesFor(id1, 2, bob);

        // Wrong expectedTicketId after rollover.
        vm.prank(alice);
        pot.buyTicketSharesFor(id1, 1, bob); // fills to 100
        uint256 id2 = _buyTicket();
        vm.expectRevert(abi.encodeWithSelector(PennyPot.UnexpectedTicket.selector, id2, id1));
        vm.prank(alice);
        pot.buyTicketSharesFor(id1, 1, bob);

        // Paused: blocked by whenNotPaused.
        vm.prank(owner);
        pot.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(alice);
        pot.buyTicketSharesFor(id2, 1, bob);
    }

    // ----- buyTicket: cranking guards --------------------------------

    function test_buyTicket_revertsIfActiveStillSelling() public {
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 50); // not full, drawing still open

        vm.expectRevert(PennyPot.TicketStillSelling.selector);
        pot.buyTicket();
    }

    function test_buyTicket_revertsIfReserveTooLow() public {
        // Drain the reserve via owner withdrawal.
        vm.prank(owner);
        pot.withdrawReserve(SEED_RESERVE, owner);
        assertEq(pot.reservePool(), 0);

        vm.expectRevert(abi.encodeWithSelector(PennyPot.ReserveTooLowForTicket.selector, 0, 1_000_000));
        pot.buyTicket();
    }

    // ----- Rolling across drawing boundaries -----------------------------

    function test_rollover_acrossDrawings() public {
        uint256 d1 = jackpot.currentDrawingId();
        uint256 id1 = _buyTicket(); // drawing 1
        vm.prank(alice);
        pot.buyTicketShares(id1, 40); // undersold

        // Drawing 1 closes and settles; Megapot advances to drawing 2.
        vm.warp(block.timestamp + DRAWING_DURATION + 1);
        jackpot.settleDrawing();
        uint256 d2 = jackpot.currentDrawingId();
        assertTrue(d2 != d1);

        // The undersold ticket is closed (deadline passed) => buyTicket rolls into
        // the new drawing. d1's referral fees must be snapshotted before opening d2
        // (per-round attribution); the round is settled, so this is straightforward.
        pot.claimWinnings(_ids(id1));
        pot.snapshotRoundFees(d1);
        uint256 id2 = _buyTicket(); // drawing 2
        assertTrue(id2 != id1);
        vm.prank(bob);
        pot.buyTicketShares(id2, 10);

        // Each drawing tracks only its own tickets.
        assertEq(pot.getDrawingTicketCount(d1), 1);
        assertEq(pot.getDrawingTicketCount(d2), 1);
        assertEq(pot.getDrawingTicketIds(d1)[0], id1);
        assertEq(pot.getDrawingTicketIds(d2)[0], id2);
    }

    // ----- claim ---------------------------------------------------------

    function test_claimWinnings_revertsIfMegapotNotSettled() public {
        uint256 id1 = _buyTicket();
        vm.warp(block.timestamp + DRAWING_DURATION + 1);

        // The ticket's drawing is not settled => reverts.
        vm.expectRevert(PennyPot.DrawingNotSettled.selector);
        pot.claimWinnings(_ids(id1));
    }

    function test_claimWinnings_skipsLosersInBatch() public {
        uint256 d = jackpot.currentDrawingId();
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 100); // winner
        uint256 id2 = _buyTicket();
        vm.prank(bob);
        pot.buyTicketShares(id2, 100); // loser (tier 0)

        jackpot.setTicketTier(d, id1, 11);
        jackpot.setTierPayout(d, 11, 100_000_000); // 100 USDC

        vm.warp(block.timestamp + DRAWING_DURATION + 1);
        usdc.mint(address(jackpot), 100_000_000);
        jackpot.settleDrawing();

        // Batch includes a loser; must NOT revert (the core #1 fix), winner still settled.
        pot.claimWinnings(_ids(id1, id2));

        assertEq(pot.claimable(alice), 100_000_000);
        (,,, bool claimed2) = pot.getTicket(id2);
        assertTrue(claimed2); // loser marked settled
        assertEq(pot.claimable(bob), 0);
    }

    function test_claimWinnings_zeroShareWinner_creditsReserve() public {
        uint256 d = jackpot.currentDrawingId();
        uint256 id1 = _buyTicket(); // nobody buys shares -> sold 0
        uint256 reserveAfterBuy = pot.reservePool(); // SEED - 1 USDC

        jackpot.setTicketTier(d, id1, 11);
        jackpot.setTierPayout(d, 11, 50_000_000); // 50 USDC

        vm.warp(block.timestamp + DRAWING_DURATION + 1);
        usdc.mint(address(jackpot), 50_000_000);
        jackpot.settleDrawing();
        pot.claimWinnings(_ids(id1));

        // 0-share win is not stranded: the whole payout goes to the reserve.
        assertEq(pot.reservePool(), reserveAfterBuy + 50_000_000);
        (,, uint256 wps,) = pot.getTicket(id1);
        assertEq(wps, 0);
    }

    function test_claimWinnings_roundingDust_creditsReserve() public {
        uint256 d = jackpot.currentDrawingId();
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 3); // 3 shares
        uint256 reserveBefore = pot.reservePool();

        jackpot.setTicketTier(d, id1, 11);
        jackpot.setTierPayout(d, 11, 1_000_000); // 1 USDC / 3 shares -> wps 333_333, dust 1

        vm.warp(block.timestamp + DRAWING_DURATION + 1);
        usdc.mint(address(jackpot), 1_000_000);
        jackpot.settleDrawing();
        pot.claimWinnings(_ids(id1));

        (,, uint256 wps,) = pot.getTicket(id1);
        assertEq(wps, 333_333);
        // dust = 1_000_000 - 333_333*3 = 1, credited to the reserve.
        assertEq(pot.reservePool(), reserveBefore + 1);
    }

    function test_claimWinnings_emptyArray_isNoop() public {
        pot.claimWinnings(new uint256[](0)); // no revert, no state change
    }

    function test_claimWinnings_isIdempotent() public {
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 100);

        jackpot.setTicketTier(jackpot.currentDrawingId(), id1, 11);
        jackpot.setTierPayout(jackpot.currentDrawingId(), 11, 100_000_000);

        vm.warp(block.timestamp + DRAWING_DURATION + 1);
        usdc.mint(address(jackpot), 100_000_000);
        jackpot.settleDrawing();

        pot.claimWinnings(_ids(id1));
        // Second claim is a no-op (already claimed); would otherwise revert on Megapot.
        pot.claimWinnings(_ids(id1));

        (,, uint256 wps, bool claimed) = pot.getTicket(id1);
        assertTrue(claimed);
        assertEq(wps, 1_000_000); // 100 USDC / 100 shares
    }

    // ----- Reserve management --------------------------------------------

    function test_depositReserve_onlyOwner() public {
        // Non-owner cannot deposit.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        pot.depositReserve(100_000_000);

        // Owner can.
        usdc.mint(owner, 100_000_000);
        vm.startPrank(owner);
        usdc.approve(address(pot), 100_000_000);
        pot.depositReserve(100_000_000);
        vm.stopPrank();
        assertEq(pot.reservePool(), SEED_RESERVE + 100_000_000);
    }

    function test_withdrawReserve_onlyOwner_cappedAtReserve() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        pot.withdrawReserve(1, owner);

        vm.expectRevert(PennyPot.InsufficientReserve.selector);
        vm.prank(owner);
        pot.withdrawReserve(SEED_RESERVE + 1, owner);

        vm.prank(owner);
        pot.withdrawReserve(100_000_000, owner);
        assertEq(pot.reservePool(), SEED_RESERVE - 100_000_000);
        assertEq(usdc.balanceOf(owner), 100_000_000);
    }

    // ----- Pause ---------------------------------------------------------

    function test_pause_blocksUserAndCrank_writes() public {
        vm.prank(owner);
        pot.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        pot.buyTicket();

        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pot.buyTicketShares(1, 1);
    }

    // ----- Ownership transfer (two-step) ---------------------------------

    function test_ownership_twoStepHandoff() public {
        vm.prank(owner);
        pot.transferOwnership(alice);
        assertEq(pot.owner(), owner); // not yet
        assertEq(pot.pendingOwner(), alice);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        vm.prank(bob);
        pot.acceptOwnership();

        vm.prank(alice);
        pot.acceptOwnership();
        assertEq(pot.owner(), alice);
        assertEq(pot.pendingOwner(), address(0));
    }

    // ----- Solvency invariant -------------------------------------------

    /// @notice The contract's USDC balance must always cover the reserve + outstanding
    ///         pending winnings.
    function test_solvency_afterWin_balanceCoversReserveAndOwed() public {
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 100);

        jackpot.setTicketTier(jackpot.currentDrawingId(), id1, 11);
        jackpot.setTierPayout(jackpot.currentDrawingId(), 11, 500_000_000); // 500 USDC

        vm.warp(block.timestamp + DRAWING_DURATION + 1);
        usdc.mint(address(jackpot), 500_000_000);
        jackpot.settleDrawing();
        pot.claimWinnings(_ids(id1));

        uint256 reserve = pot.reservePool();
        uint256 aliceOwed = pot.claimable(alice);
        uint256 contractBalance = usdc.balanceOf(address(pot));

        assertEq(reserve, SEED_RESERVE, "reserve should be back to seed");
        assertEq(aliceOwed, 500_000_000);
        assertEq(contractBalance, reserve + aliceOwed);
    }

    // ----- getState snapshot --------------------------------------------

    function test_getState_reflectsLifecycle() public {
        // Fresh: no active ticket, but a buy is possible.
        (uint256 drawingId, uint256 ticketId, uint8 sold, uint64 deadline, bool canBuy, uint256 reserve, bool isPaused)
        = pot.getState();
        assertEq(drawingId, jackpot.currentDrawingId());
        assertEq(ticketId, 0);
        assertEq(sold, 0);
        assertEq(deadline, 0);
        assertTrue(canBuy);
        assertEq(reserve, SEED_RESERVE);
        assertFalse(isPaused);

        // Buy a ticket + sell some shares: active ticket still selling => cannot buy next.
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 40);
        (, ticketId, sold, deadline, canBuy,,) = pot.getState();
        assertEq(ticketId, id1);
        assertEq(sold, 40);
        assertEq(deadline, pot.activeDeadline());
        assertFalse(canBuy);

        // Fill it: active ticket closed => can buy next.
        vm.prank(bob);
        pot.buyTicketShares(id1, 60);
        (,, sold,, canBuy,,) = pot.getState();
        assertEq(sold, 100);
        assertTrue(canBuy);

        // Pause: cannot buy next.
        vm.prank(owner);
        pot.pause();
        (,,,, canBuy,, isPaused) = pot.getState();
        assertTrue(isPaused);
        assertFalse(canBuy);
    }

    function test_getState_canBuyFalseWhenReserveLow() public {
        vm.prank(owner);
        pot.withdrawReserve(SEED_RESERVE, owner);
        (,,,, bool canBuy,,) = pot.getState();
        assertFalse(canBuy);
    }

    // getState must reflect the per-round snapshot gate, so the keeper/UI don't advertise a
    // buyable state that buyTicket would revert with PriorRoundNotSnapshotted.
    function test_getState_canBuyFalseUntilPriorRoundSnapshotted() public {
        uint256 d1 = jackpot.currentDrawingId();
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 50);

        // Close d1 and advance Megapot to d2. Active ticket is closed and reserve is fine,
        // but d1 isn't snapshotted yet -> canBuyNextTicket must be false.
        vm.warp(block.timestamp + DRAWING_DURATION + 1);
        jackpot.settleDrawing();
        (,,,, bool canBuy,,) = pot.getState();
        assertFalse(canBuy);

        // Snapshotting d1 unblocks it (and buyTicket then succeeds).
        pot.claimWinnings(_ids(id1));
        pot.snapshotRoundFees(d1);
        (,,,, canBuy,,) = pot.getState();
        assertTrue(canBuy);
        pot.buyTicket();
    }

    // ----- getTicketHolders (cap table) ----------------------------------

    function test_getTicketHolders_listsOwnersAndShares() public {
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 30);
        vm.prank(bob);
        pot.buyTicketShares(id1, 20);
        vm.prank(alice);
        pot.buyTicketShares(id1, 10); // alice again: no duplicate entry, total 40

        (, uint8 holderCount,,) = pot.getTicket(id1);
        assertEq(holderCount, 2);

        (address[] memory holders, uint8[] memory shareCounts) = pot.getTicketHolders(id1);
        assertEq(holders.length, 2);
        assertEq(holders[0], alice);
        assertEq(shareCounts[0], 40);
        assertEq(holders[1], bob);
        assertEq(shareCounts[1], 20);
    }

    // ----- Referral fees: pool ÷ total shares ----------------------------------

    /// @dev Simulate Megapot accruing referral fees to PennyPot (its own referrer), fund the
    ///      jackpot to cover the payout, then sweep them into PennyPot's feePool.
    function _accrueAndSweep(uint256 amount) internal {
        jackpot.accrueReferral(address(pot), amount);
        usdc.mint(address(jackpot), amount);
        pot.sweepReferralFees();
    }

    /// @dev Warp past the active deadline, settle the current drawing on Megapot (advancing
    ///      currentDrawingId), and settle the round's tickets via claimWinnings — which
    ///      snapshotRoundFees now requires (so all win shares have accrued first).
    function _closeRound(uint256[] memory ids) internal {
        vm.warp(block.timestamp + DRAWING_DURATION + 1);
        jackpot.settleDrawing();
        pot.claimWinnings(ids);
    }

    function test_referral_sweepRoutesUsdcIntoFeePool() public {
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 50);

        assertEq(pot.feePool(), 0);
        _accrueAndSweep(1_000_000); // 1 USDC of referral
        assertEq(pot.feePool(), 1_000_000);
        assertEq(jackpot.referralFees(address(pot)), 0); // drained from Megapot
    }

    function test_referral_poolDividedByTotalShares() public {
        uint256 d = jackpot.currentDrawingId();
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 25);
        vm.prank(bob);
        pot.buyTicketShares(id1, 75);

        _accrueAndSweep(1_000_000); // 1 USDC over 100 shares -> 10_000 / share
        _closeRound(_ids(id1));

        pot.snapshotRoundFees(d);
        assertEq(pot.roundFeePerShare(d), 10_000);
        pot.creditRoundFees(_ids(id1));

        assertEq(pot.pendingFees(alice), 250_000);
        assertEq(pot.pendingFees(bob), 750_000);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        pot.withdrawFees();
        assertEq(usdc.balanceOf(alice) - aliceBefore, 250_000);

        // Double-withdraw reverts.
        vm.expectRevert(PennyPot.NothingToWithdraw.selector);
        vm.prank(alice);
        pot.withdrawFees();
    }

    function test_referral_undersoldConcentratesPerShare() public {
        uint256 d = jackpot.currentDrawingId();
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 10); // only 10 of 100 shares sold

        _accrueAndSweep(1_000_000);
        _closeRound(_ids(id1));

        pot.snapshotRoundFees(d);
        assertEq(pot.roundFeePerShare(d), 100_000); // 1_000_000 / 10
        pot.creditRoundFees(_ids(id1));
        assertEq(pot.pendingFees(alice), 1_000_000);
    }

    function test_referral_nonParticipantGetsNothing() public {
        uint256 d = jackpot.currentDrawingId();
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 50);
        _accrueAndSweep(1_000_000);
        _closeRound(_ids(id1));
        pot.snapshotRoundFees(d);
        pot.creditRoundFees(_ids(id1));

        assertEq(pot.pendingFees(carol), 0);
        vm.expectRevert(PennyPot.NothingToWithdraw.selector);
        vm.prank(carol);
        pot.withdrawFees();
    }

    function test_referral_giftedHolderEarnsFees_notGifter() public {
        uint256 d = jackpot.currentDrawingId();
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketSharesFor(id1, 40, bob); // alice pays, bob holds

        _accrueAndSweep(1_000_000); // 40 shares -> 25_000 / share
        _closeRound(_ids(id1));
        pot.snapshotRoundFees(d);
        pot.creditRoundFees(_ids(id1));

        assertEq(pot.pendingFees(bob), 1_000_000);
        assertEq(pot.pendingFees(alice), 0);
    }

    function test_referral_snapshotRevertsWhileRoundOpen() public {
        uint256 d = jackpot.currentDrawingId();
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 50);
        _accrueAndSweep(1_000_000);
        // Round still open (== currentDrawingId).
        vm.expectRevert(PennyPot.RoundNotClosed.selector);
        pot.snapshotRoundFees(d);
    }

    function test_referral_snapshotAndCredit_idempotent() public {
        uint256 d = jackpot.currentDrawingId();
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 50);
        vm.prank(bob);
        pot.buyTicketShares(id1, 50);
        _accrueAndSweep(1_000_000); // 100 shares -> 10_000 / share
        _closeRound(_ids(id1));

        pot.snapshotRoundFees(d);
        vm.expectRevert(PennyPot.AlreadySnapshotted.selector);
        pot.snapshotRoundFees(d);

        pot.creditRoundFees(_ids(id1));
        assertEq(pot.pendingFees(alice), 500_000);
        // Crediting the same ticket again is a no-op (no double credit).
        pot.creditRoundFees(_ids(id1));
        assertEq(pot.pendingFees(alice), 500_000);
    }

    function test_referral_creditRevertsIfNotSnapshotted() public {
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 50);
        vm.expectRevert(PennyPot.NotSnapshotted.selector);
        pot.creditRoundFees(_ids(id1));
    }

    function test_referral_sweep_zeroBalanceIsNoop() public {
        // No referral accrued -> sweepReferralFees must NOT revert, even though Megapot's
        // claimReferralFees reverts on a zero balance (PennyPot guards it).
        uint256 swept = pot.sweepReferralFees();
        assertEq(swept, 0);
        assertEq(pot.feePool(), 0);
    }

    function test_referral_solvency_feesNeverExceedSwept() public {
        uint256 d = jackpot.currentDrawingId();
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 30);
        vm.prank(bob);
        pot.buyTicketShares(id1, 20);

        _accrueAndSweep(777_777); // odd amount -> per-share dust
        _closeRound(_ids(id1));
        pot.snapshotRoundFees(d);
        pot.creditRoundFees(_ids(id1));

        uint256 sumFees = pot.pendingFees(alice) + pot.pendingFees(bob);
        // perShare = 777_777 / 50 = 15_555; distributed = 777_750; dust 27 stays in feePool.
        assertEq(pot.roundFeePerShare(d), 15_555);
        assertEq(pot.feePool(), 27);
        assertLe(sumFees, 777_777);
        // Solvency: contract USDC covers reserve + winnings + fees (dust is surplus).
        assertGe(
            usdc.balanceOf(address(pot)),
            pot.reservePool() + pot.claimable(alice) + pot.claimable(bob) + sumFees
        );
    }

    function test_referral_pauseDoesNotBlockFeeFlow() public {
        uint256 d = jackpot.currentDrawingId();
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 50);
        vm.prank(bob);
        pot.buyTicketShares(id1, 50);
        _accrueAndSweep(1_000_000); // 100 shares -> 10_000 / share
        _closeRound(_ids(id1));

        vm.prank(owner);
        pot.pause();

        // Fee snapshot / credit / withdraw all work while paused.
        pot.snapshotRoundFees(d);
        pot.creditRoundFees(_ids(id1));
        assertEq(pot.pendingFees(alice), 500_000);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        pot.withdrawFees();
        assertEq(usdc.balanceOf(alice) - before, 500_000);
    }

    function test_referral_ownerWithdrawReserveCannotTouchFeePool() public {
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 50);
        _accrueAndSweep(1_000_000);

        // Reserve is back to seed (share purchase replenished it); feePool holds the fees.
        assertEq(pot.feePool(), 1_000_000);
        // Owner can only pull up to reservePool, never the fee USDC on top of it.
        uint256 r = pot.reservePool();
        vm.prank(owner);
        vm.expectRevert(PennyPot.InsufficientReserve.selector);
        pot.withdrawReserve(r + 1, owner);
    }

    // A premature/front-run snapshot (round closed but tickets not yet settled) must revert,
    // so it can't lock the round's fee-per-share at a stale (zero) feePool and strand holders.
    function test_referral_snapshotRevertsIfRoundNotSettled() public {
        uint256 d = jackpot.currentDrawingId();
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 50);
        _accrueAndSweep(1_000_000);

        // Close the drawing on Megapot but do NOT settle the ticket (no claimWinnings yet).
        vm.warp(block.timestamp + DRAWING_DURATION + 1);
        jackpot.settleDrawing();

        vm.expectRevert(PennyPot.RoundNotSettled.selector);
        pot.snapshotRoundFees(d);

        // Once the ticket is settled, the snapshot works and credits the holder correctly.
        pot.claimWinnings(_ids(id1));
        pot.snapshotRoundFees(d);
        pot.creditRoundFees(_ids(id1));
        assertEq(pot.pendingFees(alice), 1_000_000); // sole holder of 50 shares -> whole pool
    }

    // Opening a NEW drawing is blocked until the previous drawing's referral fees are
    // snapshotted — so a later round's fees can't commingle into an older round's snapshot.
    function test_referral_buyTicketRequiresPriorRoundSnapshotted() public {
        uint256 d1 = jackpot.currentDrawingId();
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 50);

        // Close d1 and advance Megapot to d2.
        vm.warp(block.timestamp + DRAWING_DURATION + 1);
        jackpot.settleDrawing();

        // Opening d2 reverts until d1 is snapshotted.
        vm.expectRevert(abi.encodeWithSelector(PennyPot.PriorRoundNotSnapshotted.selector, d1));
        pot.buyTicket();

        // Settle + snapshot d1, then opening d2 works.
        pot.claimWinnings(_ids(id1));
        pot.snapshotRoundFees(d1);
        uint256 id2 = _buyTicket();
        assertTrue(id2 != id1);
    }

    // snapshotRoundFees pulls accrued referral in itself, so it works even when nobody called
    // sweepReferralFees first (feePool starts at 0).
    function test_referral_snapshotSelfSweeps() public {
        uint256 d = jackpot.currentDrawingId();
        uint256 id1 = _buyTicket();
        vm.prank(alice);
        pot.buyTicketShares(id1, 50);
        vm.prank(bob);
        pot.buyTicketShares(id1, 50);

        // Accrue referral in Megapot but never sweep it into feePool.
        jackpot.accrueReferral(address(pot), 1_000_000);
        usdc.mint(address(jackpot), 1_000_000);
        assertEq(pot.feePool(), 0);

        vm.warp(block.timestamp + DRAWING_DURATION + 1);
        jackpot.settleDrawing();
        pot.claimWinnings(_ids(id1));
        pot.snapshotRoundFees(d); // self-sweeps the 1 USDC in
        assertEq(pot.roundFeePerShare(d), 10_000); // 1_000_000 / 100
        pot.creditRoundFees(_ids(id1));
        assertEq(pot.pendingFees(alice), 500_000);
    }
}
