import { Address, encodeFunctionData, erc20Abi, parseUnits } from 'viem'
import { z } from 'zod'
import { logger } from '../../log'
import { getClient } from '../../runtime/client'
import {
  simulateTransactions,
  UnsupportedSimulateRequest,
} from '../../runtime/simulateTransactions'
import { ZodAddressLowerCased } from '../../types/address'
import { NetworkId } from '../../types/networkId'
import {
  createShortcut,
  ShortcutsHook,
  tokenAmounts,
  Transaction,
} from '../../types/shortcuts'
import { cellarV0821Abi } from './abis/cellar'

// Hardcoded fallback if simulation isn't enabled
const DEFAULT_DEPOSIT_GAS = 750_000n

const hook: ShortcutsHook = {
  async getShortcutDefinitions(networkId: NetworkId) {
    return [
      createShortcut({
        id: 'deposit',
        name: 'Deposit',
        description: 'Lend your assets to earn interest',
        networkIds: [networkId],
        category: 'deposit',
        triggerInputShape: {
          tokens: tokenAmounts.length(1),
          // these three will be passed in the shortcutTriggerArgs. It's a temporary workaround before we can directly extract these info from the tokenId
          positionAddress: ZodAddressLowerCased,
          tokenAddress: ZodAddressLowerCased,
          tokenDecimals: z.coerce.number(),
        },

        async onTrigger({
          networkId,
          address,
          tokens,
          positionAddress,
          tokenAddress,
          tokenDecimals,
        }) {
          const walletAddress = address as Address
          const transactions: Transaction[] = []

          // amount in smallest unit
          const amountToSupply = parseUnits(tokens[0].amount, tokenDecimals)

          const client = getClient(networkId)

          const approvedAllowanceForSpender = await client.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [walletAddress, positionAddress],
          })

          if (approvedAllowanceForSpender < amountToSupply) {
            const data = encodeFunctionData({
              abi: erc20Abi,
              functionName: 'approve',
              args: [positionAddress, amountToSupply],
            })

            const approveTx: Transaction = {
              networkId,
              from: walletAddress,
              to: tokenAddress,
              data,
            }
            transactions.push(approveTx)
          }

          const depositTx: Transaction = {
            networkId,
            from: walletAddress,
            to: positionAddress,
            data: encodeFunctionData({
              abi: cellarV0821Abi,
              functionName: 'deposit',
              args: [amountToSupply, walletAddress],
            }),
          }

          transactions.push(depositTx)

          // TODO: consider moving this concern to the runtime
          try {
            const simulatedTransactions = await simulateTransactions({
              transactions,
              networkId,
            })
            const supplySimulatedTx =
              simulatedTransactions[simulatedTransactions.length - 1]

            // 15% buffer on the estimation from the simulation
            depositTx.gas = (BigInt(supplySimulatedTx.gasNeeded) * 115n) / 100n
            depositTx.estimatedGasUse = BigInt(supplySimulatedTx.gasUsed)
          } catch (error) {
            if (!(error instanceof UnsupportedSimulateRequest)) {
              logger.warn(error, 'Unexpected error during simulateTransactions')
            }
            depositTx.gas = DEFAULT_DEPOSIT_GAS
            depositTx.estimatedGasUse = DEFAULT_DEPOSIT_GAS / 3n
          }

          return { transactions }
        },
      }),
      createShortcut({
        id: 'withdraw',
        name: 'Withdraw',
        description: 'Withdraw your assets',
        networkIds: [networkId],
        category: 'withdraw',
        triggerInputShape: {
          tokens: tokenAmounts.length(1),
          // these two will be passed in the shortcutTriggerArgs.
          positionAddress: ZodAddressLowerCased,
          tokenDecimals: z.coerce.number(),
        },
        async onTrigger({
          networkId,
          address,
          tokens,
          positionAddress,
          tokenDecimals,
        }) {
          const walletAddress = address as Address
          const amountToWithdraw = parseUnits(tokens[0].amount, tokenDecimals)

          // We rely on the client to pass the correct token amount, especially
          // for liquidation withdrawals. The `maxRedeem` method on the cellar
          // contract doesn't seem to work as expected (see example:
          // https://arbiscan.io/tx/0xd4528444960526ca93874ed86c6637b4ca17df079d71f44267f1b6e6ef56868d).
          // It's also not used in the Somm front-end code.
          const withdrawTx: Transaction = {
            networkId,
            from: walletAddress,
            to: positionAddress,
            data: encodeFunctionData({
              abi: cellarV0821Abi,
              functionName: 'redeem',
              args: [amountToWithdraw, walletAddress, walletAddress],
            }),
          }

          return { transactions: [withdrawTx] }
        },
      }),
    ]
  },
}

export default hook
