import {
  Address,
  encodeFunctionData,
  parseUnits,
  erc20Abi,
  maxUint256,
} from 'viem'
import {
  createShortcut,
  ShortcutsHook,
  tokenAmounts,
  tokenAmountWithMetadata,
  ZodEnableAppFee,
  Transaction,
} from '../../types/shortcuts'
import { NetworkId } from '../../types/networkId'
import { ZodAddressLowerCased } from '../../types/address'
import { z } from 'zod'
import { getClient } from '../../runtime/client'
import { poolV3Abi } from './abis/pool-v3'
import { aTokenAbi } from './abis/atoken'
import { AAVE_V3_ADDRESSES_BY_NETWORK_ID } from './constants'
import { incentivesControllerV3Abi } from './abis/incentives-controller-v3'
import { simulateTransactions } from '../../runtime/simulateTransactions'
import { uiIncentiveDataProviderV3Abi } from './abis/ui-incentive-data-provider'
import { getAaveTokensWithIncentives } from './getAaveTokensWithIncentives'
import { ChainType, SquidCallType } from '@0xsquid/squid-types'
import { prepareSwapTransactions } from '../../utils/prepareSwapTransactions'

// Hardcoded fallback if simulation isn't enabled
const DEFAULT_DEPOSIT_GAS = 1_000_000n
const DEFAULT_APPROVE_GAS = 200_000n

const hook: ShortcutsHook = {
  async getShortcutDefinitions(networkId: NetworkId, _address?: string) {
    const aaveAddresses = AAVE_V3_ADDRESSES_BY_NETWORK_ID[networkId]
    if (!aaveAddresses) {
      return []
    }

    const poolContractAddress = aaveAddresses.pool
    const incentivesContractAddress = aaveAddresses.incentivesController

    return [
      createShortcut({
        id: 'deposit',
        name: 'Deposit',
        description: 'Lend your assets to earn interest',
        networkIds: [networkId],
        category: 'deposit',
        triggerInputShape: {
          tokens: tokenAmounts.length(1),
          // these two will be passed in the shortcutTriggerArgs. It's a temporary workaround before we can directly extract these info from the tokenId
          tokenAddress: ZodAddressLowerCased,
          tokenDecimals: z.coerce.number(),
        },
        async onTrigger({
          networkId,
          address,
          tokens,
          tokenAddress,
          tokenDecimals,
        }) {
          const walletAddress = address as Address
          const transactions: Transaction[] = []

          // amount in smallest unit
          const amountToSupply = parseUnits(tokens[0].amount, tokenDecimals)

          const client = getClient(networkId, 'aave')

          const approvedAllowanceForSpender = await client.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [walletAddress, poolContractAddress],
          })

          if (approvedAllowanceForSpender < amountToSupply) {
            const data = encodeFunctionData({
              abi: erc20Abi,
              functionName: 'approve',
              args: [poolContractAddress, amountToSupply],
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
            to: poolContractAddress,
            data: encodeFunctionData({
              abi: poolV3Abi,
              functionName: 'supply',
              args: [tokenAddress, amountToSupply, walletAddress, 0],
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

            // 15% buffer on the estimation from the simulation
            supplyTx.gas = (BigInt(supplySimulatedTx.gasNeeded) * 115n) / 100n
            supplyTx.estimatedGasUse = BigInt(supplySimulatedTx.gasUsed)
          } catch (error) {
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
          // token must be the A token
          tokens: tokenAmounts.length(1),
          // these two will be passed in the shortcutTriggerArgs. It's a temporary workaround before we can directly extract these info from the tokenId
          tokenAddress: ZodAddressLowerCased,
          tokenDecimals: z.coerce.number(),
        },
        async onTrigger({
          networkId,
          address,
          tokens,
          tokenAddress,
          tokenDecimals,
        }) {
          const walletAddress = address as Address
          const transactions: Transaction[] = []

          // amount in smallest unit
          // useMax Withdraws entire balance https://docs.aave.com/developers/core-contracts/pool#withdraw
          const amountToWithdraw = tokens[0].useMax
            ? maxUint256
            : parseUnits(tokens[0].amount, tokenDecimals)

          const client = getClient(networkId, 'aave')

          const underlyingAssetAddress = await client.readContract({
            address: tokenAddress,
            abi: aTokenAbi,
            functionName: 'UNDERLYING_ASSET_ADDRESS',
          })

          const withdrawTx: Transaction = {
            networkId,
            from: walletAddress,
            to: poolContractAddress,
            data: encodeFunctionData({
              abi: poolV3Abi,
              functionName: 'withdraw',
              args: [underlyingAssetAddress, amountToWithdraw, walletAddress],
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
        async onTrigger({ networkId, address }) {
          const walletAddress = address as Address

          const client = getClient(networkId, 'aave')

          // Get a/v/sToken for which we can claim rewards
          const reserveIncentiveData = await client.readContract({
            address: aaveAddresses.uiIncentiveDataProvider,
            abi: uiIncentiveDataProviderV3Abi,
            functionName: 'getReservesIncentivesData',
            args: [aaveAddresses.poolAddressesProvider],
          })

          // This builds the list of a/v/sToken address with incentives
          const assetsWithIncentives =
            getAaveTokensWithIncentives(reserveIncentiveData)

          return {
            transactions: [
              {
                networkId,
                from: walletAddress,
                to: incentivesContractAddress,
                data: encodeFunctionData({
                  abi: incentivesControllerV3Abi,
                  functionName: 'claimAllRewardsToSelf',
                  args: [assetsWithIncentives],
                }),
              },
            ],
          }
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
        },
        async onTrigger({
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
            args: [poolContractAddress, amount],
          })
          const supplyData = encodeFunctionData({
            abi: poolV3Abi,
            functionName: 'supply',
            args: [tokenAddress, amount, walletAddress, 0],
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
                  target: poolContractAddress,
                  callData: supplyData,
                  payload: {
                    tokenAddress,
                    inputPos: 1,
                  },
                  // no native token transfer. this is optional per types, but squid request fails without it
                  value: '0',
                  estimatedGas: DEFAULT_DEPOSIT_GAS.toString(),
                },
              ],
              description: 'Deposit into aave pool',
            },
          })
        },
      }),
    ]
  },
}

export default hook
