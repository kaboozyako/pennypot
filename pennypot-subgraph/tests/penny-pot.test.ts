import {
  assert,
  describe,
  test,
  clearStore,
  beforeAll,
  afterAll
} from "matchstick-as/assembly/index"
import { BigInt, Address } from "@graphprotocol/graph-ts"
import { OwnerFeesClaimed } from "../generated/schema"
import { OwnerFeesClaimed as OwnerFeesClaimedEvent } from "../generated/PennyPot/PennyPot"
import { handleOwnerFeesClaimed } from "../src/penny-pot"
import { createOwnerFeesClaimedEvent } from "./penny-pot-utils"

// Tests structure (matchstick-as >=0.5.0)
// https://thegraph.com/docs/en/subgraphs/developing/creating/unit-testing-framework/#tests-structure

describe("Describe entity assertions", () => {
  beforeAll(() => {
    let amount = BigInt.fromI32(234)
    let newOwnerFeesClaimedEvent = createOwnerFeesClaimedEvent(amount)
    handleOwnerFeesClaimed(newOwnerFeesClaimedEvent)
  })

  afterAll(() => {
    clearStore()
  })

  // For more test scenarios, see:
  // https://thegraph.com/docs/en/subgraphs/developing/creating/unit-testing-framework/#write-a-unit-test

  test("OwnerFeesClaimed created and stored", () => {
    assert.entityCount("OwnerFeesClaimed", 1)

    // 0xa16081f360e3847006db660bae1c6d1b2e17ec2a is the default address used in newMockEvent() function
    assert.fieldEquals(
      "OwnerFeesClaimed",
      "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1",
      "amount",
      "234"
    )

    // More assert options:
    // https://thegraph.com/docs/en/subgraphs/developing/creating/unit-testing-framework/#asserts
  })
})
