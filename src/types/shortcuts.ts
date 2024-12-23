import { z, ZodObject, ZodRawShape } from 'zod'
import { NetworkId } from './networkId'
import { ZodAddressLowerCased } from './address'
import { SwapTransaction } from './swaps'

export type ShortcutCategory = 'claim' | 'deposit' | 'withdraw' | 'swap-deposit'

export interface ShortcutsHook {
  getShortcutDefinitions(
    networkId: NetworkId,
    address?: string,
  ): Promise<ShortcutDefinition<ShortcutCategory, any>[]>
}

export const tokenAmounts = z
  .array(
    z.object({
      tokenId: z.string(),
      amount: z.string(),
      useMax: z.boolean().optional(),
    }),
  )
  .nonempty()

export const tokenAmountWithMetadata = z.object({
  tokenId: z.string(),
  amount: z.string(),
  // these can be inferred from the tokenId, but we need to pass them for now
  decimals: z.number(),
  address: ZodAddressLowerCased.optional(),
  isNative: z.boolean(),
  // this can be different for cross chain swaps, keeping it optional to be backwards compatible
  networkId: z.nativeEnum(NetworkId).optional(),
})

export const ZodEnableAppFee = z.boolean().optional()

// enforces the tokens field to be an array of objects with tokenId and amount
// for all deposit and withdraw shortcuts
type TriggerInputShape<Category> = Category extends 'deposit' | 'withdraw'
  ? ZodRawShape & { tokens: typeof tokenAmounts }
  : Category extends 'swap-deposit'
  ? ZodRawShape & {
      swapFromToken: typeof tokenAmountWithMetadata
      enableAppFee: typeof ZodEnableAppFee
    }
  : ZodRawShape

type TriggerOutputTransactions = {
  transactions: Transaction[] // 0, 1 or more transactions to sign by the user
}

export type TriggerOutputShape<Category extends ShortcutCategory> =
  Category extends 'swap-deposit'
    ? TriggerOutputTransactions & {
        dataProps: { swapTransaction: SwapTransaction }
      }
    : TriggerOutputTransactions

export interface ShortcutDefinition<
  Category extends ShortcutCategory,
  InputShape extends TriggerInputShape<Category>,
> {
  id: string // Example: claim-reward
  name: string // Example: Claim
  description: string // Example: Claim your reward
  networkIds: NetworkId[] // Example: ['celo-mainnet']
  category: Category
  triggerInputShape: InputShape
  onTrigger: (
    args: {
      networkId: NetworkId
      address: string
    } & z.infer<ZodObject<InputShape>>,
  ) => Promise<TriggerOutputShape<Category>>
}

export type Transaction = {
  networkId: NetworkId
  from: string
  to: string
  data: string
  value?: BigInt
  // These are needed when returning more than one transaction
  gas?: BigInt // in wei
  estimatedGasUse?: BigInt // in wei
}

// This is to help TS infer the type of the triggerInputShape
// so the onTrigger args can be properly typed
export function createShortcut<
  Category extends ShortcutCategory,
  InputShape extends TriggerInputShape<Category>,
>(definition: ShortcutDefinition<Category, InputShape>) {
  return definition
}
