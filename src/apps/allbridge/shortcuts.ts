import { Address, encodeFunctionData, erc20Abi, parseUnits } from 'viem'
import { z } from 'zod'
import { getClient } from '../../runtime/client'
import { ZodAddressLowerCased } from '../../types/address'
import { NetworkId } from '../../types/networkId'
import {
  createShortcut,
  ShortcutsHook,
  tokenAmounts,
  tokenAmountWithMetadata,
  ZodEnableAppFee,
  Transaction,
} from '../../types/shortcuts'
import { poolAbi } from './abis/pool'
import {
  UnsupportedSimulateRequest,
  simulateTransactions,
} from '../../runtime/simulateTransactions'
import { logger } from '../../log'
import { prepareSwapTransactions } from '../../utils/prepareSwapTransactions'
import { ChainType, SquidCallType } from '@0xsquid/squid-types'

// Hardcoded fallback if simulation isn't enabled
const DEFAULT_DEPOSIT_GAS = 500_000n
// Padding we add to simulation gas to ensure we specify enough
const SIMULATED_DEPOSIT_GAS_PADDING = 250_000n

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
          positionAddress: ZodAddressLowerCased,
          // these two will be passed in the shortcutTriggerArgs. It's a temporary workaround before we can directly extract these info from the tokenId
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

          const client = getClient(networkId, 'allbridge')

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

          const supplyTx: Transaction = {
            networkId,
            from: walletAddress,
            to: positionAddress,
            data: encodeFunctionData({
              abi: poolAbi,
              functionName: 'deposit',
              args: [amountToSupply],
            }),
          }

          transactions.push(supplyTx)

          // TODO: consider moving this concern to the runtime
          try {
            const simulatedTransactions = await simulateTransactions({
              transactions,
              networkId,
            })
            const supplySimulatedTx =
              simulatedTransactions[simulatedTransactions.length - 1]

            supplyTx.gas =
              BigInt(supplySimulatedTx.gasNeeded) +
              SIMULATED_DEPOSIT_GAS_PADDING
            supplyTx.estimatedGasUse = BigInt(supplySimulatedTx.gasUsed)
          } catch (error) {
            if (!(error instanceof UnsupportedSimulateRequest)) {
              logger.warn(error, 'Unexpected error during simulateTransactions')
            }
            supplyTx.gas = DEFAULT_DEPOSIT_GAS
            supplyTx.estimatedGasUse = DEFAULT_DEPOSIT_GAS / 3n
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
          positionAddress: ZodAddressLowerCased,
          // this will be passed in the shortcutTriggerArgs. It's a temporary workaround before we can directly extract these info from the tokenId
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
          const transactions: Transaction[] = []

          const amountToWithdraw = parseUnits(tokens[0].amount, tokenDecimals)

          const withdrawTx: Transaction = {
            networkId,
            from: walletAddress,
            to: positionAddress,
            data: encodeFunctionData({
              abi: poolAbi,
              functionName: 'withdraw',
              args: [amountToWithdraw],
            }),
          }

          transactions.push(withdrawTx)

          return { transactions }
        },
      }),
      createShortcut({
        id: 'claim-rewards',
        name: 'Claim',
        description: 'Claim rewards',
        networkIds: [networkId],
        category: 'claim',
        triggerInputShape: {
          positionAddress: ZodAddressLowerCased,
        },
        async onTrigger({ networkId, address, positionAddress }) {
          const walletAddress = address as Address

          const claimTx: Transaction = {
            networkId,
            from: walletAddress,
            to: positionAddress,
            data: encodeFunctionData({
              abi: poolAbi,
              functionName: 'claimRewards',
              args: [],
            }),
          }

          return { transactions: [claimTx] }
        },
      }),
      createShortcut({
        id: 'swap-deposit',
        name: 'Swap & Deposit',
        description: 'Swap assets and lend them to earn interest',
        networkIds: [networkId],
        category: 'swap-deposit',
        triggerInputShape: {
          swapFromToken: tokenAmountWithMetadata,
          enableAppFee: ZodEnableAppFee,
          // set via shortcutTriggerArgs, the deposit token and position addresses
          tokenAddress: ZodAddressLowerCased,
          positionAddress: ZodAddressLowerCased,
        },
        async onTrigger({
          swapFromToken,
          tokenAddress,
          address,
          positionAddress,
          networkId,
          enableAppFee,
        }) {
          const walletAddress = address as Address
          // use a placeholder non zero amount so tx simulation can succeed.
          // squid postHook will replace this with the actual amount after swap.
          const amount = 1n
          const approveData = encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [positionAddress, amount],
          })
          const supplyData = encodeFunctionData({
            abi: poolAbi,
            functionName: 'deposit',
            args: [amount],
          })

          return await prepareSwapTransactions({
            networkId,
            swapFromToken,
            swapToTokenAddress: tokenAddress,
            walletAddress,
            enableAppFee,
            // based off of https://docs.squidrouter.com/building-with-squid-v2/key-concepts/hooks/build-a-posthook
            postHook: {
              chainType: ChainType.EVM,
              calls: [
                {
                  chainType: ChainType.EVM,
                  callType: SquidCallType.FULL_TOKEN_BALANCE,
                  target: tokenAddress,
                  callData: approveData,
                  payload: {
                    tokenAddress,
                    inputPos: 1,
                  },
                  // no native token transfer. this is optional per types, but squid request fails without it
                  value: '0',
                  estimatedGas: DEFAULT_DEPOSIT_GAS.toString(),
                },
                {
                  chainType: ChainType.EVM,
                  callType: SquidCallType.FULL_TOKEN_BALANCE,
                  target: positionAddress,
                  callData: supplyData,
                  payload: {
                    tokenAddress,
                    inputPos: 0,
                  },
                  // no native token transfer. this is optional per types, but squid request fails without it
                  value: '0',
                  estimatedGas: DEFAULT_DEPOSIT_GAS.toString(),
                },
              ],
              description: 'Deposit into allbridge pool',
            },
          })
        },
      }),
    ]
  },
}

export default hook
