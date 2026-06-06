// Minimal ABIs for the functions/events the webapp actually calls. Hand-extracted
// from the verified contract at 0xdCc075040Cf5888dBa26E9871427949BAb7591ba.

export const pennypotAbi = [
  // ---- reads --------------------------------------------------------------
  {
    type: "function",
    name: "getState",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "currentDrawingId", type: "uint256" },
      { name: "currentTicketId", type: "uint256" },
      { name: "sold", type: "uint8" },
      { name: "deadline", type: "uint64" },
      { name: "canBuyNextTicket", type: "bool" },
      { name: "reserve", type: "uint256" },
      { name: "isPaused", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "balance",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getTicket",
    stateMutability: "view",
    inputs: [{ name: "ticketId", type: "uint256" }],
    outputs: [
      { name: "shares", type: "uint8" },
      { name: "holders", type: "uint8" },
      { name: "winningsPerShare", type: "uint256" },
      { name: "claimed", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getTicketShares",
    stateMutability: "view",
    inputs: [
      { name: "ticketId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "getDrawingTicketIds",
    stateMutability: "view",
    inputs: [{ name: "drawingId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "getDrawingTicketCount",
    stateMutability: "view",
    inputs: [{ name: "drawingId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ticketDrawingId",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "activeTicketId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "activeDeadline",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "reservePool",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "SHARE_PRICE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "TICKET_PRICE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "SHARES_PER_TICKET",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "MIN_SELLING_WINDOW",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },

  // ---- writes -------------------------------------------------------------
  {
    type: "function",
    name: "buyTicket",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "buyTicketShares",
    stateMutability: "nonpayable",
    inputs: [
      { name: "expectedTicketId", type: "uint256" },
      { name: "count", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimWinnings",
    stateMutability: "nonpayable",
    inputs: [{ name: "ticketIds", type: "uint256[]" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawFees",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "pendingFees",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },

  // ---- events -------------------------------------------------------------
  {
    type: "event",
    name: "SharesBought",
    inputs: [
      { name: "ticketId", type: "uint256", indexed: true },
      { name: "holder", type: "address", indexed: true },
      { name: "payer", type: "address", indexed: false },
      { name: "count", type: "uint8", indexed: false },
      { name: "newSold", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TicketBought",
    inputs: [
      { name: "drawingId", type: "uint256", indexed: true },
      { name: "ticketId", type: "uint256", indexed: true },
      { name: "caller", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TicketFilled",
    inputs: [{ name: "ticketId", type: "uint256", indexed: true }],
  },
  {
    type: "event",
    name: "TicketSettled",
    inputs: [
      { name: "ticketId", type: "uint256", indexed: true },
      { name: "totalWin", type: "uint256", indexed: false },
      { name: "winningsPerShare", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WinningsWithdrawn",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

// Minimal ERC-20 surface (USDC on Base).
export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "", type: "address" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// Megapot PayoutCalculator (GuaranteedMinimumPayoutCalculator on Base mainnet) —
// computes per-tier per-ticket payouts. Index 11 is the jackpot tier (5 normals
// + bonusball).
export const payoutCalculatorAbi = [
  {
    type: "function",
    name: "getExpectedDrawingTierPayouts",
    stateMutability: "view",
    inputs: [
      { name: "_drawingId", type: "uint256" },
      { name: "_prizePool", type: "uint256" },
      { name: "_normalMax", type: "uint8" },
      { name: "_bonusballMax", type: "uint8" },
    ],
    outputs: [{ name: "drawingTierPayouts", type: "uint256[12]" }],
  },
] as const;

// Minimal Megapot Jackpot surface — we need currentDrawingId + getDrawingState for
// the hero countdown (covers the rollover edge case where the active ticket's
// drawing has closed but Megapot has advanced).
export const jackpotAbi = [
  {
    type: "function",
    name: "currentDrawingId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getDrawingState",
    stateMutability: "view",
    inputs: [{ name: "_drawingId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "prizePool", type: "uint256" },
          { name: "ticketPrice", type: "uint256" },
          { name: "edgePerTicket", type: "uint256" },
          { name: "referralWinShare", type: "uint256" },
          { name: "referralFee", type: "uint256" },
          { name: "globalTicketsBought", type: "uint256" },
          { name: "lpEarnings", type: "uint256" },
          { name: "drawingTime", type: "uint256" },
          { name: "winningTicket", type: "uint256" },
          { name: "ballMax", type: "uint8" },
          { name: "bonusballMax", type: "uint8" },
          { name: "payoutCalculator", type: "address" },
          { name: "jackpotLock", type: "bool" },
        ],
      },
    ],
  },
] as const;
