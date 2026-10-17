import { BigInt } from "@graphprotocol/graph-ts"
import { UserPosition, TicketPurchase } from "../generated/schema"
import {
  SharesBought as SharesBoughtEvent,
  WinningsWithdrawn as WinningsWithdrawnEvent
} from "../generated/PennyPot/PennyPot"

export function handleSharesBought(event: SharesBoughtEvent): void {
  let userId = event.params.holder.toHexString()
  let position = UserPosition.load(userId)

  if (!position) {
    position = new UserPosition(userId)
    position.totalTicketsBought = BigInt.fromI32(0)
    position.totalShares = BigInt.fromI32(0)
    position.totalClaimed = BigInt.fromI32(0)
  }

  position.totalTicketsBought = position.totalTicketsBought.plus(BigInt.fromI32(1))
  position.totalShares = position.totalShares.plus(BigInt.fromI32(event.params.count))
  
  position.save()

  // === Зберігаємо конкретний квиток для списку історії ===
  let ticketId = event.params.ticketId
  // Формуємо унікальний ID: адреса-ticketId
  let purchaseId = userId + "-" + ticketId.toString()
  
  let purchase = TicketPurchase.load(purchaseId)
  if (!purchase) {
    purchase = new TicketPurchase(purchaseId)
    purchase.user = userId
    purchase.ticketId = ticketId
    purchase.shares = 0
    purchase.block = event.block.number
  }
  
  purchase.shares = purchase.shares + event.params.count
  purchase.save()
}

export function handleWinningsWithdrawn(event: WinningsWithdrawnEvent): void {
  let userId = event.params.user.toHexString()
  let position = UserPosition.load(userId)

  if (!position) {
    position = new UserPosition(userId)
    position.totalTicketsBought = BigInt.fromI32(0)
    position.totalShares = BigInt.fromI32(0)
    position.totalClaimed = BigInt.fromI32(0)
  }

  position.totalClaimed = position.totalClaimed.plus(event.params.amount)
  
  position.save()
}