import { newMockEvent } from "matchstick-as"
import { ethereum, BigInt, Address } from "@graphprotocol/graph-ts"
import {
  OwnerFeesClaimed,
  OwnershipTransferStarted,
  OwnershipTransferred,
  Paused,
  ReserveDeposited,
  ReserveWithdrawn,
  SharesBought,
  TicketBought,
  TicketFilled,
  TicketSettled,
  Unpaused,
  WinningsWithdrawn
} from "../generated/PennyPot/PennyPot"

export function createOwnerFeesClaimedEvent(amount: BigInt): OwnerFeesClaimed {
  let ownerFeesClaimedEvent = changetype<OwnerFeesClaimed>(newMockEvent())

  ownerFeesClaimedEvent.parameters = new Array()

  ownerFeesClaimedEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )

  return ownerFeesClaimedEvent
}

export function createOwnershipTransferStartedEvent(
  previousOwner: Address,
  newOwner: Address
): OwnershipTransferStarted {
  let ownershipTransferStartedEvent =
    changetype<OwnershipTransferStarted>(newMockEvent())

  ownershipTransferStartedEvent.parameters = new Array()

  ownershipTransferStartedEvent.parameters.push(
    new ethereum.EventParam(
      "previousOwner",
      ethereum.Value.fromAddress(previousOwner)
    )
  )
  ownershipTransferStartedEvent.parameters.push(
    new ethereum.EventParam("newOwner", ethereum.Value.fromAddress(newOwner))
  )

  return ownershipTransferStartedEvent
}

export function createOwnershipTransferredEvent(
  previousOwner: Address,
  newOwner: Address
): OwnershipTransferred {
  let ownershipTransferredEvent =
    changetype<OwnershipTransferred>(newMockEvent())

  ownershipTransferredEvent.parameters = new Array()

  ownershipTransferredEvent.parameters.push(
    new ethereum.EventParam(
      "previousOwner",
      ethereum.Value.fromAddress(previousOwner)
    )
  )
  ownershipTransferredEvent.parameters.push(
    new ethereum.EventParam("newOwner", ethereum.Value.fromAddress(newOwner))
  )

  return ownershipTransferredEvent
}

export function createPausedEvent(account: Address): Paused {
  let pausedEvent = changetype<Paused>(newMockEvent())

  pausedEvent.parameters = new Array()

  pausedEvent.parameters.push(
    new ethereum.EventParam("account", ethereum.Value.fromAddress(account))
  )

  return pausedEvent
}

export function createReserveDepositedEvent(
  from: Address,
  amount: BigInt,
  newReserve: BigInt
): ReserveDeposited {
  let reserveDepositedEvent = changetype<ReserveDeposited>(newMockEvent())

  reserveDepositedEvent.parameters = new Array()

  reserveDepositedEvent.parameters.push(
    new ethereum.EventParam("from", ethereum.Value.fromAddress(from))
  )
  reserveDepositedEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )
  reserveDepositedEvent.parameters.push(
    new ethereum.EventParam(
      "newReserve",
      ethereum.Value.fromUnsignedBigInt(newReserve)
    )
  )

  return reserveDepositedEvent
}

export function createReserveWithdrawnEvent(
  to: Address,
  amount: BigInt,
  newReserve: BigInt
): ReserveWithdrawn {
  let reserveWithdrawnEvent = changetype<ReserveWithdrawn>(newMockEvent())

  reserveWithdrawnEvent.parameters = new Array()

  reserveWithdrawnEvent.parameters.push(
    new ethereum.EventParam("to", ethereum.Value.fromAddress(to))
  )
  reserveWithdrawnEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )
  reserveWithdrawnEvent.parameters.push(
    new ethereum.EventParam(
      "newReserve",
      ethereum.Value.fromUnsignedBigInt(newReserve)
    )
  )

  return reserveWithdrawnEvent
}

export function createSharesBoughtEvent(
  ticketId: BigInt,
  holder: Address,
  payer: Address,
  count: i32,
  newSold: i32
): SharesBought {
  let sharesBoughtEvent = changetype<SharesBought>(newMockEvent())

  sharesBoughtEvent.parameters = new Array()

  sharesBoughtEvent.parameters.push(
    new ethereum.EventParam(
      "ticketId",
      ethereum.Value.fromUnsignedBigInt(ticketId)
    )
  )
  sharesBoughtEvent.parameters.push(
    new ethereum.EventParam("holder", ethereum.Value.fromAddress(holder))
  )
  sharesBoughtEvent.parameters.push(
    new ethereum.EventParam("payer", ethereum.Value.fromAddress(payer))
  )
  sharesBoughtEvent.parameters.push(
    new ethereum.EventParam(
      "count",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(count))
    )
  )
  sharesBoughtEvent.parameters.push(
    new ethereum.EventParam(
      "newSold",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(newSold))
    )
  )

  return sharesBoughtEvent
}

export function createTicketBoughtEvent(
  drawingId: BigInt,
  ticketId: BigInt,
  caller: Address
): TicketBought {
  let ticketBoughtEvent = changetype<TicketBought>(newMockEvent())

  ticketBoughtEvent.parameters = new Array()

  ticketBoughtEvent.parameters.push(
    new ethereum.EventParam(
      "drawingId",
      ethereum.Value.fromUnsignedBigInt(drawingId)
    )
  )
  ticketBoughtEvent.parameters.push(
    new ethereum.EventParam(
      "ticketId",
      ethereum.Value.fromUnsignedBigInt(ticketId)
    )
  )
  ticketBoughtEvent.parameters.push(
    new ethereum.EventParam("caller", ethereum.Value.fromAddress(caller))
  )

  return ticketBoughtEvent
}

export function createTicketFilledEvent(ticketId: BigInt): TicketFilled {
  let ticketFilledEvent = changetype<TicketFilled>(newMockEvent())

  ticketFilledEvent.parameters = new Array()

  ticketFilledEvent.parameters.push(
    new ethereum.EventParam(
      "ticketId",
      ethereum.Value.fromUnsignedBigInt(ticketId)
    )
  )

  return ticketFilledEvent
}

export function createTicketSettledEvent(
  ticketId: BigInt,
  totalWin: BigInt,
  winningsPerShare: BigInt
): TicketSettled {
  let ticketSettledEvent = changetype<TicketSettled>(newMockEvent())

  ticketSettledEvent.parameters = new Array()

  ticketSettledEvent.parameters.push(
    new ethereum.EventParam(
      "ticketId",
      ethereum.Value.fromUnsignedBigInt(ticketId)
    )
  )
  ticketSettledEvent.parameters.push(
    new ethereum.EventParam(
      "totalWin",
      ethereum.Value.fromUnsignedBigInt(totalWin)
    )
  )
  ticketSettledEvent.parameters.push(
    new ethereum.EventParam(
      "winningsPerShare",
      ethereum.Value.fromUnsignedBigInt(winningsPerShare)
    )
  )

  return ticketSettledEvent
}

export function createUnpausedEvent(account: Address): Unpaused {
  let unpausedEvent = changetype<Unpaused>(newMockEvent())

  unpausedEvent.parameters = new Array()

  unpausedEvent.parameters.push(
    new ethereum.EventParam("account", ethereum.Value.fromAddress(account))
  )

  return unpausedEvent
}

export function createWinningsWithdrawnEvent(
  user: Address,
  amount: BigInt
): WinningsWithdrawn {
  let winningsWithdrawnEvent = changetype<WinningsWithdrawn>(newMockEvent())

  winningsWithdrawnEvent.parameters = new Array()

  winningsWithdrawnEvent.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  )
  winningsWithdrawnEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )

  return winningsWithdrawnEvent
}
