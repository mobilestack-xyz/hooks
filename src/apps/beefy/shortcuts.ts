import { Address, parseUnits, erc20Abi, encodeFunctionData } from 'viem'
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
  ShortcutsHook,
  createShortcut,
  tokenAmounts,
  Transaction,
  tokenAmountWithMetadata,
  ZodEnableAppFee,
} from '../../types/shortcuts'
import { vaultAbi } from './abis/vault'
import { ChainType, SquidCallType } from '@0xsquid/squid-types'
import { prepareSwapTransactions } from '../../utils/prepareSwapTransactions'

// Hardcoded fallback if simulation isn't enabled
const DEFAULT_DEPOSIT_GAS = 750_000n
const DEFAULT_APPROVE_GAS = 200_000n

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

          const client = getClient(networkId, 'beefy')

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
              abi: vaultAbi,
              functionName: 'deposit',
              args: [amountToSupply],
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
          const transactions: Transaction[] = []

          const amountToWithdraw = parseUnits(tokens[0].amount, tokenDecimals)

          const withdrawTx: Transaction = tokens[0].useMax
            ? {
                networkId,
                from: walletAddress,
                to: positionAddress,
                data: encodeFunctionData({
                  abi: vaultAbi,
                  functionName: 'withdrawAll',
                  args: [],
                }),
              }
            : {
                networkId,
                from: walletAddress,
                to: positionAddress,
                data: encodeFunctionData({
                  abi: vaultAbi,
                  functionName: 'withdraw',
                  args: [amountToWithdraw],
                }),
              }

          transactions.push(withdrawTx)

          return { transactions }
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
          // set via shortcutTriggerArgs, the deposit token's address
          tokenAddress: ZodAddressLowerCased,
          positionAddress: ZodAddressLowerCased,
        },
        async onTrigger({
          positionAddress,
          swapFromToken,
          tokenAddress,
          address,
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
            abi: vaultAbi,
            functionName: 'deposit',
            args: [amount],
          })
          const transferData = encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [walletAddress, amount],
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
                  estimatedGas: DEFAULT_APPROVE_GAS.toString(),
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
                {
                  chainType: ChainType.EVM,
                  callType: SquidCallType.FULL_TOKEN_BALANCE,
                  target: positionAddress,
                  callData: transferData,
                  payload: {
                    tokenAddress: positionAddress,
                    inputPos: 1,
                  },
                  // no native token transfer. this is optional per types, but squid request fails without it
                  value: '0',
                  estimatedGas: DEFAULT_DEPOSIT_GAS.toString(),
                },
              ],
              description: 'Deposit into beefy pool',
            },
          })
        },
      }),
    ]
  },
}

export default hook
