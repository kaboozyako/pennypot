// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IJackpot} from "./interfaces/IJackpot.sol";
import {IRandomTicketBuyer} from "./interfaces/IRandomTicketBuyer.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/**
 * @title PennyPot
 * @notice Buy 1¢ shares of Megapot lottery tickets.
 *
 *         Each Megapot ticket costs $1 (1 USDC). PennyPot fronts every ticket from a
 *         reserve, then sells it as 100 shares at 1¢ each. Share proceeds replenish
 *         the reserve. While a Megapot drawing is open, tickets roll: when the active
 *         ticket fills, anyone can crank `buyTicket` to buy the next, until the
 *         drawing's `drawingTime` (minus a selling-window buffer).
 *
 *         Each share's payout is `ticketWinnings / sharesActuallySold` — so when a
 *         ticket is undersubscribed, every shareholder's slice grows. The pool keeps
 *         zero winnings. Revenue comes from Megapot's referral fees, accrued at an
 *         operator-owned `feeReceiver` address (set in the constructor; PennyPot
 *         lists it as the referrer on every ticket purchase).
 *
 * @dev    Drawing *lifecycle* state is intentionally NOT tracked on-chain — drawings
 *         are indexed off-chain, and Megapot itself is the source of truth for whether
 *         a ticket's drawing has settled (`claimWinnings` reverts otherwise). The
 *         contract is a thin ledger keyed by the Megapot ticket ID:
 *
 *           - buyTicket()                     : front + buy the next Megapot ticket
 *           - buyTicketShares(ticketId, count): buy 1..N shares of the active ticket
 *           - claimWinnings(ticketIds[])      : settle tickets; credit each holder's balance
 *           - withdraw()                      : pull the caller's credited winnings
 *
 *         A drawingId -> ticketIds[] index is kept only as a read convenience
 *         (`getDrawingTicketIds`); it never gates contract logic.
 *
 *         Tightly scoped, non-upgradeable. Pause + reserve withdrawal are the only
 *         owner knobs. See README for the full spec and reasoning.
 *
 *         Ownership and pause use OpenZeppelin's Ownable2Step + Pausable.
 */
contract PennyPot is Ownable2Step, Pausable {
    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    /// @notice Price of a Megapot ticket, in 6-decimal USDC. Hardcoded; reverts in
    ///         buyTicket if Megapot's live ticketPrice differs.
    uint256 public constant TICKET_PRICE = 1_000_000; // 1 USDC

    /// @notice Price of a single PennyPot share. TICKET_PRICE / SHARES_PER_TICKET.
    uint256 public constant SHARE_PRICE = 10_000; // 0.01 USDC

    /// @notice Number of shares each ticket is split into.
    uint8 public constant SHARES_PER_TICKET = 100;

    /// @notice Minimum seconds before drawingTime that buyTicket will still buy
    ///         a fresh ticket. Prevents an attacker from filling a ticket near close,
    ///         cranking buyTicket, and forcing the reserve to subsidize a ticket
    ///         that has no time to resell its shares.
    uint256 public constant MIN_SELLING_WINDOW = 1 hours;

    /// @notice Single-element referrer-split weight passed to the random ticket buyer.
    ///         Megapot's referral split is in 1e18 scale and must sum to exactly 1e18,
    ///         so a single 100% referrer uses the full 1e18 weight.
    uint256 internal constant REFERRAL_SPLIT_FULL = 1e18;

    /// @notice Integration source tag passed to Megapot for on-chain analytics.
    ///         Megapot convention: keccak256 of the app name.
    bytes32 public constant SOURCE = keccak256("pennypot");

    // -----------------------------------------------------------------------
    // Immutables
    // -----------------------------------------------------------------------

    IERC20 public immutable USDC;
    IJackpot public immutable JACKPOT;

    /// @notice Megapot's quick-pick buyer. PennyPot buys 1 random ticket per crank
    ///         through here (the Jackpot itself has no working quick-pick).
    IRandomTicketBuyer public immutable RANDOM_BUYER;

    /// @notice Operator-owned address listed as the referrer on every ticket buy.
    ///         Earns Megapot's per-ticket referral fee and per-claim win share. Must
    ///         differ from address(this) — Megapot's buyTickets reverts otherwise.
    address public immutable feeReceiver;

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    /// @notice The Megapot ticket currently selling shares. 0 = none active.
    uint256 public activeTicketId;

    /// @notice drawingTime of the active ticket's drawing; share sales close at it.
    uint64 public activeDeadline;

    /// @notice Shares sold per Megapot ticket (0..100).
    mapping(uint256 => uint8) public soldOf;

    /// @notice Per-share winnings for a ticket, set by `claimWinnings`. 0 = losing or unclaimed.
    mapping(uint256 => uint256) public winningsPerShareOf;

    /// @notice Whether `claimWinnings` has already settled a ticket against Megapot. Needed to
    ///         distinguish a claimed-losing ticket (wps 0) from an unclaimed one.
    mapping(uint256 => bool) public claimedOf;

    /// @notice Per-user withdrawable USDC, credited when their winning tickets are claimed.
    ///         Players read `claimable(addr)` and pull it all with `withdraw()`.
    mapping(address => uint256) public claimable;

    /// @notice sharesOf[ticketId][user] => count of shares this user owns on that ticket.
    ///         A permanent record of purchases (winnings are credited to `claimable` at
    ///         claim time, so this is never zeroed).
    mapping(uint256 => mapping(address => uint8)) internal sharesOf;

    /// @notice ticketId => holder addresses, in first-purchase order. Bounded to 100
    ///         per ticket (100 shares, ≥1 each). One entry per holder. Read convenience
    ///         for the per-ticket cap table.
    mapping(uint256 => address[]) internal ticketHolders;

    /// @notice drawingId => Megapot ticket ids bought under it. Read convenience only;
    ///         lets a caller enumerate a drawing's tickets without an off-chain index.
    mapping(uint256 => uint256[]) internal drawingTickets;

    /// @notice ticketId => the Megapot drawing it was bought into. Used by claimWinnings
    ///         to gate each ticket on its OWN drawing's settlement.
    mapping(uint256 => uint256) public ticketDrawingId;

    /// @notice USDC owned by the reserve. Fronts every ticket; replenished by share
    ///         purchases. Decreases only on buyTicket and owner withdrawals.
    uint256 public reservePool;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event TicketBought(uint256 indexed drawingId, uint256 indexed ticketId, address caller);
    event SharesBought(
        uint256 indexed ticketId, address indexed holder, address payer, uint8 count, uint8 newSold
    );
    event TicketFilled(uint256 indexed ticketId);
    event TicketSettled(uint256 indexed ticketId, uint256 totalWin, uint256 winningsPerShare);
    event WinningsWithdrawn(address indexed user, uint256 amount);
    event ReserveDeposited(address indexed from, uint256 amount, uint256 newReserve);
    event ReserveWithdrawn(address indexed to, uint256 amount, uint256 newReserve);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error ZeroAddress();
    error FeeReceiverEqualsContract();
    error InvalidCount();
    error NoActiveTicket();
    error UnexpectedTicket(uint256 active, uint256 expected);
    error TicketStillSelling();
    error PastSellingWindow();
    error MegapotTicketPriceMismatch(uint256 expected, uint256 actual);
    error ReserveTooLowForTicket(uint256 reserve, uint256 needed);
    error DrawingNotSettled();
    error NothingToWithdraw();
    error InsufficientReserve();
    error ApprovalFailed();

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /// @param _usdc        Base mainnet USDC address.
    /// @param _jackpot     Megapot Jackpot contract (reads + claims).
    /// @param _randomBuyer Megapot JackpotRandomTicketBuyer (quick-pick purchases).
    /// @param _feeReceiver Address listed as the referrer on every ticket buy.
    ///                     MUST be different from address(this).
    /// @param _owner       Operator address with admin powers (reserve mgmt, pause).
    ///                     Zero reverts via OZ Ownable's OwnableInvalidOwner.
    constructor(address _usdc, address _jackpot, address _randomBuyer, address _feeReceiver, address _owner)
        Ownable(_owner)
    {
        if (_usdc == address(0) || _jackpot == address(0) || _randomBuyer == address(0) || _feeReceiver == address(0)) {
            revert ZeroAddress();
        }
        if (_feeReceiver == address(this)) revert FeeReceiverEqualsContract();

        USDC = IERC20(_usdc);
        JACKPOT = IJackpot(_jackpot);
        RANDOM_BUYER = IRandomTicketBuyer(_randomBuyer);
        feeReceiver = _feeReceiver;

        // One-time max approval to the random-ticket buyer, which pulls USDC on each buy.
        // (Claims go through the Jackpot and don't pull, so no approval needed there.)
        if (!IERC20(_usdc).approve(_randomBuyer, type(uint256).max)) revert ApprovalFailed();
    }

    // -----------------------------------------------------------------------
    // User-facing writes
    // -----------------------------------------------------------------------

    /// @notice Buy `count` shares of the active ticket for yourself. Each share costs
    ///         10_000 USDC (0.01 USDC); USDC must be pre-approved.
    ///
    /// @param  expectedTicketId The Megapot ticket the caller intends to buy into.
    ///         Reverts if the active ticket has rolled over (filled / drawing closed
    ///         and a new one was cranked) so a buyer never lands on the wrong ticket.
    /// @param  count            Shares to buy; reverts if it would push the ticket
    ///         past 100 shares.
    function buyTicketShares(uint256 expectedTicketId, uint8 count) external whenNotPaused {
        _buyShares(expectedTicketId, count, msg.sender);
    }

    /// @notice Gift `count` shares of the active ticket to `recipient`. Identical to
    ///         {buyTicketShares}, except the shares are credited to — and become
    ///         claimable only by — `recipient`, while USDC is still pulled from the
    ///         caller (the gifter).
    ///
    /// @param  expectedTicketId Same rollover guard as {buyTicketShares}.
    /// @param  count            Shares to buy; reverts if it would push the ticket
    ///         past 100 shares.
    /// @param  recipient        Address that will own the shares. Must be non-zero.
    function buyTicketSharesFor(uint256 expectedTicketId, uint8 count, address recipient)
        external
        whenNotPaused
    {
        if (recipient == address(0)) revert ZeroAddress();
        _buyShares(expectedTicketId, count, recipient);
    }

    /// @dev Shared share-purchase logic. `holder` is credited the shares; USDC is
    ///      always pulled from `msg.sender` (the payer), so a gifter funds a friend's
    ///      shares. All selling-window / capacity guards live here.
    function _buyShares(uint256 expectedTicketId, uint8 count, address holder) internal {
        if (count == 0) revert InvalidCount();

        uint256 active = activeTicketId;
        if (active == 0) revert NoActiveTicket();
        if (active != expectedTicketId) revert UnexpectedTicket(active, expectedTicketId);
        if (block.timestamp >= activeDeadline) revert PastSellingWindow();

        uint16 newSold = uint16(soldOf[active]) + count;
        if (newSold > SHARES_PER_TICKET) revert InvalidCount();

        uint256 cost = uint256(count) * SHARE_PRICE;
        // Pull USDC from the payer (msg.sender) to this contract; proceeds replenish
        // the reserve. `holder` — which differs from the payer when gifting — is the
        // address credited the shares.
        if (!USDC.transferFrom(msg.sender, address(this), cost)) revert ApprovalFailed();
        reservePool += cost;

        soldOf[active] = uint8(newSold);
        // Record a new holder on their first share of this ticket (bounded to 100).
        if (sharesOf[active][holder] == 0) ticketHolders[active].push(holder);
        sharesOf[active][holder] += count;

        emit SharesBought(active, holder, msg.sender, count, uint8(newSold));
        if (newSold == SHARES_PER_TICKET) emit TicketFilled(active);
    }

    /// @notice Withdraw all of the caller's credited winnings. Balances are credited by
    ///         `claimWinnings` when a winning ticket the caller holds is settled, so this
    ///         needs no ticket ids — just read `claimable(addr)` and pull.
    function withdraw() external {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        claimable[msg.sender] = 0;
        if (!USDC.transfer(msg.sender, amount)) revert ApprovalFailed();

        emit WinningsWithdrawn(msg.sender, amount);
    }

    // -----------------------------------------------------------------------
    // Permissionless cranks
    // -----------------------------------------------------------------------

    /// @notice Front and buy the next Megapot ticket, making it the active ticket.
    ///         Anyone can call. Buys into Megapot's *current* drawing.
    ///
    /// @dev    Allowed only when the active ticket is "closed": none yet, full, or its
    ///         drawing's selling window has ended. Reverts if the reserve can't cover
    ///         the ticket price or if we're within MIN_SELLING_WINDOW of drawingTime.
    function buyTicket() external whenNotPaused {
        uint256 active = activeTicketId;
        bool activeClosed = active == 0 || soldOf[active] == SHARES_PER_TICKET || block.timestamp >= activeDeadline;
        if (!activeClosed) revert TicketStillSelling();

        uint256 drawingId = JACKPOT.currentDrawingId();
        IJackpot.DrawingState memory ms = JACKPOT.getDrawingState(drawingId);
        if (ms.ticketPrice != TICKET_PRICE) revert MegapotTicketPriceMismatch(TICKET_PRICE, ms.ticketPrice);
        if (block.timestamp + MIN_SELLING_WINDOW > ms.drawingTime) revert PastSellingWindow();

        // Reserve fronts the ticket cost.
        if (reservePool < TICKET_PRICE) revert ReserveTooLowForTicket(reservePool, TICKET_PRICE);
        reservePool -= TICKET_PRICE;

        // Buy 1 quick-pick via Megapot's random ticket buyer. recipient = this;
        // referrer = feeReceiver. The buyer picks the numbers and mints the ticket NFT.
        address[] memory referrers = new address[](1);
        referrers[0] = feeReceiver;
        uint256[] memory split = new uint256[](1);
        split[0] = REFERRAL_SPLIT_FULL;

        uint256[] memory ids = RANDOM_BUYER.buyTickets(1, address(this), referrers, split, SOURCE);
        uint256 newId = ids[0];

        activeTicketId = newId;
        activeDeadline = uint64(ms.drawingTime);
        drawingTickets[drawingId].push(newId);
        ticketDrawingId[newId] = drawingId;

        emit TicketBought(drawingId, newId, msg.sender);
    }

    /// @notice Settle the given tickets: claim winners from Megapot and record each
    ///         winningsPerShare. Permissionless. Already-claimed tickets are skipped.
    ///
    /// @dev    Megapot's claimWinnings REVERTS on a non-winning ticket, so we check the
    ///         tier first (winner == tier > 0 && tier != 2) and only claim winners;
    ///         losers are marked settled with 0. Each ticket is gated on its OWN
    ///         drawing's settlement (via ticketDrawingId) so a live ticket can't be
    ///         marked claimed by passing a stale/foreign drawing.
    ///
    ///         Winnings are attributed per ticket via the USDC balance delta. Anything
    ///         not distributable to shareholders — a 0-share win, or per-share rounding
    ///         dust — is credited to the reserve rather than stranded.
    function claimWinnings(uint256[] calldata ticketIds) external {
        for (uint256 i = 0; i < ticketIds.length; i++) {
            uint256 id = ticketIds[i];
            if (claimedOf[id]) continue;

            // Ticket's own drawing must be settled. Unknown tickets map to drawing 0,
            // which is never settled, so they revert here.
            if (JACKPOT.getDrawingState(ticketDrawingId[id]).winningTicket == 0) revert DrawingNotSettled();

            claimedOf[id] = true;

            uint256[] memory single = new uint256[](1);
            single[0] = id;

            // tier 0 (no match) and tier 2 (1 normal, no bonusball) pay nothing.
            uint256 tier = JACKPOT.getTicketTierIds(single)[0];
            if (tier == 0 || tier == 2) {
                emit TicketSettled(id, 0, 0);
                continue;
            }

            uint256 balBefore = USDC.balanceOf(address(this));
            JACKPOT.claimWinnings(single);
            uint256 ticketWin = USDC.balanceOf(address(this)) - balBefore;

            uint8 sold = soldOf[id];
            uint256 wps = sold > 0 ? ticketWin / sold : 0;
            if (wps > 0) {
                winningsPerShareOf[id] = wps;
                // Credit each shareholder's withdrawable balance (<=100 holders).
                address[] storage holders = ticketHolders[id];
                for (uint256 h = 0; h < holders.length; h++) {
                    address holder = holders[h];
                    claimable[holder] += uint256(sharesOf[id][holder]) * wps;
                }
            }
            // Don't strand winnings: 0-share wins and rounding dust go to the reserve.
            reservePool += ticketWin - wps * sold;

            emit TicketSettled(id, ticketWin, wps);
        }
    }

    // -----------------------------------------------------------------------
    // Reserve management
    // -----------------------------------------------------------------------

    /// @notice Owner deposits USDC into the reserve (e.g. seeding or replenishing).
    function depositReserve(uint256 amount) external onlyOwner {
        if (amount == 0) revert InvalidCount();
        if (!USDC.transferFrom(msg.sender, address(this), amount)) revert ApprovalFailed();
        reservePool += amount;
        emit ReserveDeposited(msg.sender, amount, reservePool);
    }

    /// @notice Owner pulls from the reserve. Capped at `reservePool` so pending user
    ///         winnings (held outside the reserve accounting) can never be touched.
    function withdrawReserve(uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount > reservePool) revert InsufficientReserve();
        reservePool -= amount;
        if (!USDC.transfer(to, amount)) revert ApprovalFailed();
        emit ReserveWithdrawn(to, amount, reservePool);
    }

    // -----------------------------------------------------------------------
    // Owner functions
    // -----------------------------------------------------------------------
    //
    // Ownership (two-step) comes from OZ Ownable2Step: owner(), pendingOwner(),
    // transferOwnership(newOwner), acceptOwnership(), renounceOwnership().

    /// @notice Emergency stop: blocks buyTicketShares and buyTicket.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume after a pause.
    function unpause() external onlyOwner {
        _unpause();
    }

    // -----------------------------------------------------------------------
    // Reads (UI helpers)
    // -----------------------------------------------------------------------

    /// @notice One-call snapshot for a UI/keeper. `canBuyNextTicket` mirrors
    ///         buyTicket()'s exact guards (pause, active-ticket-closed, ticket-price
    ///         match, selling window, reserve) — if it's true, buyTicket() will succeed.
    /// @return currentDrawingId  Megapot's live drawing id.
    /// @return currentTicketId   The ticket currently selling shares (0 if none).
    /// @return sold              Shares sold on the active ticket (0..100).
    /// @return deadline          The active ticket's selling cutoff (activeDeadline).
    /// @return canBuyNextTicket  Whether buyTicket() would succeed right now.
    /// @return reserve           reservePool.
    /// @return isPaused          Whether writes are paused.
    function getState()
        external
        view
        returns (
            uint256 currentDrawingId,
            uint256 currentTicketId,
            uint8 sold,
            uint64 deadline,
            bool canBuyNextTicket,
            uint256 reserve,
            bool isPaused
        )
    {
        currentDrawingId = JACKPOT.currentDrawingId();
        IJackpot.DrawingState memory ms = JACKPOT.getDrawingState(currentDrawingId);

        currentTicketId = activeTicketId;
        sold = soldOf[currentTicketId];
        deadline = activeDeadline;
        reserve = reservePool;
        isPaused = paused();

        bool activeClosed = currentTicketId == 0 || sold == SHARES_PER_TICKET || block.timestamp >= deadline;
        canBuyNextTicket = !isPaused && activeClosed && ms.ticketPrice == TICKET_PRICE
            && block.timestamp + MIN_SELLING_WINDOW <= ms.drawingTime && reserve >= TICKET_PRICE;
    }

    /// @notice Megapot ticket ids bought under a drawing, in purchase order.
    function getDrawingTicketIds(uint256 drawingId) external view returns (uint256[] memory) {
        return drawingTickets[drawingId];
    }

    /// @notice Number of tickets PennyPot bought under a drawing.
    function getDrawingTicketCount(uint256 drawingId) external view returns (uint256) {
        return drawingTickets[drawingId].length;
    }

    /// @notice Per-ticket detail in one call.
    /// @return shares           Shares sold (0..100), i.e. % subscribed.
    /// @return holders          Distinct owners so far (<= 100; includes any who withdrew).
    /// @return winningsPerShare USDC per share, set by claimWinnings; 0 if losing/unclaimed.
    /// @return claimed          Whether claimWinnings has settled this ticket.
    function getTicket(uint256 ticketId)
        external
        view
        returns (uint8 shares, uint8 holders, uint256 winningsPerShare, bool claimed)
    {
        return
            (soldOf[ticketId], uint8(ticketHolders[ticketId].length), winningsPerShareOf[ticketId], claimedOf[ticketId]);
    }

    function getTicketShares(uint256 ticketId, address user) external view returns (uint8) {
        return sharesOf[ticketId][user];
    }

    /// @notice A user's total withdrawable winnings (alias of the `claimable` getter).
    function balance(address user) external view returns (uint256) {
        return claimable[user];
    }

    /// @notice The per-ticket cap table: holder addresses and their share counts (which
    ///         equal their percentage, since a ticket is 100 shares). Bounded to 100
    ///         entries.
    function getTicketHolders(uint256 ticketId)
        external
        view
        returns (address[] memory holders, uint8[] memory shareCounts)
    {
        holders = ticketHolders[ticketId];
        shareCounts = new uint8[](holders.length);
        for (uint256 i = 0; i < holders.length; i++) {
            shareCounts[i] = sharesOf[ticketId][holders[i]];
        }
    }
}
