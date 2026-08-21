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
 *         Each share's payout is `ticketWinnings / sharesActuallySold`.
 *         All referral fees from Megapot accrue to the PennyPot contract and can 
 *         be claimed exclusively by the contract owner.
 */
contract PennyPot is Ownable2Step, Pausable {
    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    uint256 public constant TICKET_PRICE = 1_000_000; // 1 USDC
    uint256 public constant SHARE_PRICE = 10_000; // 0.01 USDC
    uint8 public constant SHARES_PER_TICKET = 100;
    uint256 public constant MIN_SELLING_WINDOW = 1 hours;
    uint256 internal constant REFERRAL_SPLIT_FULL = 1e18;
    bytes32 public constant SOURCE = keccak256("pennypot");

    // -----------------------------------------------------------------------
    // Immutables
    // -----------------------------------------------------------------------

    IERC20 public immutable USDC;
    IJackpot public immutable JACKPOT;
    IRandomTicketBuyer public immutable RANDOM_BUYER;

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    uint256 public activeTicketId;
    uint64 public activeDeadline;

    mapping(uint256 => uint8) public soldOf;
    mapping(uint256 => uint256) public winningsPerShareOf;
    mapping(uint256 => bool) public claimedOf;
    mapping(address => uint256) public claimable;
    mapping(uint256 => mapping(address => uint8)) internal sharesOf;
    mapping(uint256 => address[]) internal ticketHolders;
    mapping(uint256 => uint256[]) internal drawingTickets;
    mapping(uint256 => uint256) public ticketDrawingId;
    
    uint256 public reservePool;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event TicketBought(uint256 indexed drawingId, uint256 indexed ticketId, address caller);
    event SharesBought(uint256 indexed ticketId, address indexed holder, address payer, uint8 count, uint8 newSold);
    event TicketFilled(uint256 indexed ticketId);
    event TicketSettled(uint256 indexed ticketId, uint256 totalWin, uint256 winningsPerShare);
    event WinningsWithdrawn(address indexed user, uint256 amount);
    event ReserveDeposited(address indexed from, uint256 amount, uint256 newReserve);
    event ReserveWithdrawn(address indexed to, uint256 amount, uint256 newReserve);
    event OwnerFeesClaimed(uint256 amount);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error ZeroAddress();
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

    constructor(address _usdc, address _jackpot, address _randomBuyer, address _owner) Ownable(_owner) {
        if (_usdc == address(0) || _jackpot == address(0) || _randomBuyer == address(0)) {
            revert ZeroAddress();
        }

        USDC = IERC20(_usdc);
        JACKPOT = IJackpot(_jackpot);
        RANDOM_BUYER = IRandomTicketBuyer(_randomBuyer);

        if (!IERC20(_usdc).approve(_randomBuyer, type(uint256).max)) revert ApprovalFailed();
    }

    // -----------------------------------------------------------------------
    // User-facing writes
    // -----------------------------------------------------------------------

    function buyTicketShares(uint256 expectedTicketId, uint8 count) external whenNotPaused {
        _buyShares(expectedTicketId, count, msg.sender);
    }

    function buyTicketSharesFor(uint256 expectedTicketId, uint8 count, address recipient)
        external
        whenNotPaused
    {
        if (recipient == address(0)) revert ZeroAddress();
        _buyShares(expectedTicketId, count, recipient);
    }

    function _buyShares(uint256 expectedTicketId, uint8 count, address holder) internal {
        if (count == 0) revert InvalidCount();

        uint256 active = activeTicketId;
        if (active == 0) revert NoActiveTicket();
        if (active != expectedTicketId) revert UnexpectedTicket(active, expectedTicketId);
        if (block.timestamp >= activeDeadline) revert PastSellingWindow();

        uint16 newSold = uint16(soldOf[active]) + count;
        if (newSold > SHARES_PER_TICKET) revert InvalidCount();

        uint256 cost = uint256(count) * SHARE_PRICE;
        if (!USDC.transferFrom(msg.sender, address(this), cost)) revert ApprovalFailed();
        reservePool += cost;

        soldOf[active] = uint8(newSold);
        if (sharesOf[active][holder] == 0) ticketHolders[active].push(holder);
        sharesOf[active][holder] += count;

        emit SharesBought(active, holder, msg.sender, count, uint8(newSold));
        if (newSold == SHARES_PER_TICKET) emit TicketFilled(active);
    }

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

    function buyTicket() external whenNotPaused {
        uint256 active = activeTicketId;
        bool activeClosed = active == 0 || soldOf[active] == SHARES_PER_TICKET || block.timestamp >= activeDeadline;
        if (!activeClosed) revert TicketStillSelling();

        uint256 drawingId = JACKPOT.currentDrawingId();
        IJackpot.DrawingState memory ms = JACKPOT.getDrawingState(drawingId);
        if (ms.ticketPrice != TICKET_PRICE) revert MegapotTicketPriceMismatch(TICKET_PRICE, ms.ticketPrice);
        if (block.timestamp + MIN_SELLING_WINDOW > ms.drawingTime) revert PastSellingWindow();

        if (reservePool < TICKET_PRICE) revert ReserveTooLowForTicket(reservePool, TICKET_PRICE);
        reservePool -= TICKET_PRICE;

        address[] memory referrers = new address[](1);
        referrers[0] = address(this);
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

    function claimWinnings(uint256[] calldata ticketIds) external {
        for (uint256 i = 0; i < ticketIds.length; i++) {
            uint256 id = ticketIds[i];
            if (claimedOf[id]) continue;

            if (JACKPOT.getDrawingState(ticketDrawingId[id]).winningTicket == 0) revert DrawingNotSettled();

            claimedOf[id] = true;

            uint256[] memory single = new uint256[](1);
            single[0] = id;

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
                address[] storage holders = ticketHolders[id];
                for (uint256 h = 0; h < holders.length; h++) {
                    address holder = holders[h];
                    claimable[holder] += uint256(sharesOf[id][holder]) * wps;
                }
            }
            
            reservePool += ticketWin - wps * sold;
            emit TicketSettled(id, ticketWin, wps);
        }
    }

    // -----------------------------------------------------------------------
    // Owner Referral Claiming
    // -----------------------------------------------------------------------

    /// @notice Sweeps all accrued referral fees from Megapot directly to the owner's wallet.
    function claimOwnerReferralFees() external onlyOwner {
        if (JACKPOT.referralFees(address(this)) == 0) revert NothingToWithdraw();
        
        uint256 beforeBal = USDC.balanceOf(address(this));
        JACKPOT.claimReferralFees();
        uint256 swept = USDC.balanceOf(address(this)) - beforeBal;
        
        if (!USDC.transfer(msg.sender, swept)) revert ApprovalFailed();
        emit OwnerFeesClaimed(swept);
    }

    // -----------------------------------------------------------------------
    // Reserve management
    // -----------------------------------------------------------------------

    function depositReserve(uint256 amount) external onlyOwner {
        if (amount == 0) revert InvalidCount();
        if (!USDC.transferFrom(msg.sender, address(this), amount)) revert ApprovalFailed();
        reservePool += amount;
        emit ReserveDeposited(msg.sender, amount, reservePool);
    }

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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // -----------------------------------------------------------------------
    // Reads (UI helpers)
    // -----------------------------------------------------------------------

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

    function getDrawingTicketIds(uint256 drawingId) external view returns (uint256[] memory) {
        return drawingTickets[drawingId];
    }

    function getDrawingTicketCount(uint256 drawingId) external view returns (uint256) {
        return drawingTickets[drawingId].length;
    }

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

    function balance(address user) external view returns (uint256) {
        return claimable[user];
    }

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