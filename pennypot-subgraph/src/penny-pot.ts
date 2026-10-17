import {
  OwnerFeesClaimed as OwnerFeesClaimedEvent,
  OwnershipTransferStarted as OwnershipTransferStartedEvent,
  OwnershipTransferred as OwnershipTransferredEvent,
  Paused as PausedEvent,
  ReserveDeposited as ReserveDepositedEvent,
  ReserveWithdrawn as ReserveWithdrawnEvent,
  SharesBought as SharesBoughtEvent,
  TicketBought as TicketBoughtEvent,
  TicketFilled as TicketFilledEvent,
  TicketSettled as TicketSettledEvent,
  Unpaused as UnpausedEvent,
  WinningsWithdrawn as WinningsWithdrawnEvent
} from "../generated/PennyPot/PennyPot"
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
} from "../generated/schema"

export function handleOwnerFeesClaimed(event: OwnerFeesClaimedEvent): void {
  let entity = new OwnerFeesClaimed(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.amount = event.params.amount

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleOwnershipTransferStarted(
  event: OwnershipTransferStartedEvent
): void {
  let entity = new OwnershipTransferStarted(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.previousOwner = event.params.previousOwner
  entity.newOwner = event.params.newOwner

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleOwnershipTransferred(
  event: OwnershipTransferredEvent
): void {
  let entity = new OwnershipTransferred(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.previousOwner = event.params.previousOwner
  entity.newOwner = event.params.newOwner

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handlePaused(event: PausedEvent): void {
  let entity = new Paused(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.account = event.params.account

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleReserveDeposited(event: ReserveDepositedEvent): void {
  let entity = new ReserveDeposited(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.from = event.params.from
  entity.amount = event.params.amount
  entity.newReserve = event.params.newReserve

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleReserveWithdrawn(event: ReserveWithdrawnEvent): void {
  let entity = new ReserveWithdrawn(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.to = event.params.to
  entity.amount = event.params.amount
  entity.newReserve = event.params.newReserve

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleSharesBought(event: SharesBoughtEvent): void {
  let entity = new SharesBought(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.ticketId = event.params.ticketId
  entity.holder = event.params.holder
  entity.payer = event.params.payer
  entity.count = event.params.count
  entity.newSold = event.params.newSold

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleTicketBought(event: TicketBoughtEvent): void {
  let entity = new TicketBought(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.drawingId = event.params.drawingId
  entity.ticketId = event.params.ticketId
  entity.caller = event.params.caller

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleTicketFilled(event: TicketFilledEvent): void {
  let entity = new TicketFilled(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.ticketId = event.params.ticketId

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleTicketSettled(event: TicketSettledEvent): void {
  let entity = new TicketSettled(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.ticketId = event.params.ticketId
  entity.totalWin = event.params.totalWin
  entity.winningsPerShare = event.params.winningsPerShare

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleUnpaused(event: UnpausedEvent): void {
  let entity = new Unpaused(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.account = event.params.account

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleWinningsWithdrawn(event: WinningsWithdrawnEvent): void {
  let entity = new WinningsWithdrawn(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.user = event.params.user
  entity.amount = event.params.amount

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}
