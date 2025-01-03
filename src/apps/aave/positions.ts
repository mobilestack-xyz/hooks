import {
  PositionsHook,
  AppTokenPositionDefinition,
  UnknownAppTokenError,
  TokenDefinition,
  ContractPositionDefinition,
  ClaimType,
} from '../../types/positions'
import { Address } from 'viem'
import {
  DecimalNumber,
  toDecimalNumber,
  toSerializedDecimalNumber,
} from '../../types/numbers'
import BigNumber from 'bignumber.js'
import { getClient } from '../../runtime/client'
import { uiPoolDataProviderV3Abi } from './abis/ui-pool-data-provider-v3'
import { getTokenId } from '../../runtime/getTokenId'
import { uiIncentiveDataProviderV3Abi } from './abis/ui-incentive-data-provider'
import {
  AAVE_CONTRACT_CREATED_AT,
  AAVE_LOGO,
  AAVE_POOLS_BASE_URL,
  AAVE_TERMS_URL,
  AAVE_V3_ADDRESSES_BY_NETWORK_ID,
  NETWORK_ID_TO_AAVE_MARKET_NAME,
} from './constants'
import { aTokenAbi } from './abis/atoken'
import { incentivesControllerV3Abi } from './abis/incentives-controller-v3'
import { getAaveTokensWithIncentives } from './getAaveTokensWithIncentives'
import { getPositionId } from '../../runtime/getPositionId'

const COMPOUND_PERIOD = 365 * 24 * 60 * 60 // 1 year in seconds

// Get APY from APR, both in percentage (0-100)
function getApy(apr: number) {
  // Note: not using BigNumber here as it takes too long to calculate
  return ((1 + apr / 100 / COMPOUND_PERIOD) ** COMPOUND_PERIOD - 1) * 100
}

// The chain data is in RAY units (1e27) and non compounded
// https://docs.aave.com/developers/guides/rates-guide#formatting-rates
function getApyFromRayApr(apr: bigint) {
  return getApy(new BigNumber(apr.toString()).div(1e27).times(100).toNumber())
}

const hook: PositionsHook = {
  getInfo() {
    return {
      name: 'Aave',
    }
  },
  async getPositionDefinitions({ networkId, address, t }) {
    const aaveAddresses = AAVE_V3_ADDRESSES_BY_NETWORK_ID[networkId]
    if (!aaveAddresses) {
      return []
    }

    const client = getClient(networkId, 'aave')

    const [reservesData] = await client.readContract({
      address: aaveAddresses.uiPoolDataProvider,
      abi: uiPoolDataProviderV3Abi,
      functionName: 'getReservesData',
      args: [aaveAddresses.poolAddressesProvider],
    })

    const [userReserveData, [reserveIncentiveData, _userIncentivesData]] =
      address
        ? await client.multicall({
            contracts: [
              {
                address: aaveAddresses.uiPoolDataProvider,
                abi: uiPoolDataProviderV3Abi,
                functionName: 'getUserReservesData',
                args: [aaveAddresses.poolAddressesProvider, address as Address],
              },
              {
                address: aaveAddresses.uiIncentiveDataProvider,
                abi: uiIncentiveDataProviderV3Abi,
                functionName: 'getFullReservesIncentiveData',
                args: [aaveAddresses.poolAddressesProvider, address as Address],
              },
            ],
            allowFailure: false,
          })
        : [undefined, [undefined, undefined]]

    // Note: Instead of calling `getAllUserRewards`, we could use reserveIncentiveData and userIncentivesData to get all user rewards
    // but it requires some additional calculations to get the accrued rewards (linked to a/v/sToken held) on top of the unclaimedRewards to get total rewards.
    // This is for simplicity here.
    // See https://github.com/aave/aave-utilities/blob/446d9af6f14154771c0343538b59e2aeb7b38e47/packages/math-utils/src/formatters/incentive/calculate-all-user-incentives.ts#L31
    const allUserRewards = address
      ? await client.readContract({
          address: aaveAddresses.incentivesController,
          abi: incentivesControllerV3Abi,
          functionName: 'getAllUserRewards',
          args: [
            // This builds the list of a/v/sToken address with incentives
            // Because `getAllUserRewards` reverts if we pass an address with no incentives
            getAaveTokensWithIncentives(reserveIncentiveData ?? []),
            address as Address,
          ],
        })
      : [[], []]
    const [rewardTokenAddresses, rewardTokenAmounts] = allUserRewards
    const userRewards = rewardTokenAddresses
      .map((rewardTokenAddress, i) => ({
        rewardTokenAddress,
        rewardTokenAmount: rewardTokenAmounts[i],
      }))
      .filter(({ rewardTokenAmount }) => rewardTokenAmount > 0n)

    const [totalSupplies, lpTokenDecimals] = await Promise.all([
      Promise.all(
        reservesData.map(({ aTokenAddress }) => {
          return client.readContract({
            address: aTokenAddress,
            abi: aTokenAbi,
            functionName: 'totalSupply',
            args: [],
          })
        }),
      ),
      Promise.all(
        reservesData.map(({ aTokenAddress }) => {
          return client.readContract({
            address: aTokenAddress,
            abi: aTokenAbi,
            functionName: 'decimals',
            args: [],
          })
        }),
      ),
    ])

    const manageUrl =
      AAVE_POOLS_BASE_URL +
      (NETWORK_ID_TO_AAVE_MARKET_NAME[networkId]
        ? `?marketName=${NETWORK_ID_TO_AAVE_MARKET_NAME[networkId]}`
        : '')

    const rewardsPositionDefinition = userRewards.length
      ? ({
          type: 'contract-position-definition',
          networkId,
          address: aaveAddresses.incentivesController.toLowerCase(),
          tokens: userRewards.map((userReward) => ({
            address: userReward.rewardTokenAddress.toLowerCase(),
            networkId,
            category: 'claimable',
          })),
          shortcutTriggerArgs: {
            'claim-rewards': {
              positionAddress: aaveAddresses.incentivesController.toLowerCase(),
            },
          },
          availableShortcutIds: ['claim-rewards'],
          balances: async ({ resolvedTokensByTokenId }) =>
            userRewards.map((userRewards) => {
              const rewardsDecimals =
                resolvedTokensByTokenId[
                  getTokenId({
                    address: userRewards.rewardTokenAddress,
                    networkId,
                  })
                ].decimals
              return toDecimalNumber(
                userRewards.rewardTokenAmount,
                rewardsDecimals,
              )
            }),
          displayProps: {
            title: `Claimable rewards`,
            description: 'For supplying and borrowing',
            imageUrl: AAVE_LOGO,
            manageUrl,
          },
        } satisfies ContractPositionDefinition)
      : null

    return [
      reservesData.flatMap((reserveData, i) => {
        const supplyApy = getApyFromRayApr(reserveData.liquidityRate)
        const variableBorrowApy = getApyFromRayApr(
          reserveData.variableBorrowRate,
        )

        // Include a token if the user has a balance
        // or if no user data is available (when querying all positions)
        const useAToken =
          !userReserveData || userReserveData[i].scaledATokenBalance > 0n
        const useVariableDebt =
          !userReserveData || userReserveData[i].scaledVariableDebt > 0n

        return [
          // AToken
          useAToken &&
            ({
              type: 'app-token-definition',
              networkId,
              address: reserveData.aTokenAddress.toLowerCase(),
              tokens: [
                {
                  address: reserveData.underlyingAsset.toLowerCase(),
                  networkId,
                },
              ],
              availableShortcutIds: ['deposit', 'withdraw', 'swap-deposit'],
              shortcutTriggerArgs: {
                deposit: {
                  tokenAddress: reserveData.underlyingAsset.toLowerCase(),
                  tokenDecimals: Number(reserveData.decimals),
                },
                withdraw: {
                  tokenAddress: reserveData.aTokenAddress.toLowerCase(),
                  tokenDecimals: lpTokenDecimals[i],
                },
                'swap-deposit': {
                  tokenAddress: reserveData.underlyingAsset.toLowerCase(),
                },
              },
              displayProps: {
                title: reserveData.symbol,
                description: `Supplied (APY: ${supplyApy.toFixed(2)}%)`,
                imageUrl: AAVE_LOGO,
                manageUrl,
              },
              dataProps: {
                manageUrl,
                claimType: ClaimType.Rewards,
                termsUrl: AAVE_TERMS_URL,
                cantSeparateCompoundedInterest: true,
                contractCreatedAt:
                  AAVE_CONTRACT_CREATED_AT[
                    getTokenId({
                      networkId,
                      address: reserveData.aTokenAddress.toLowerCase(),
                    })
                  ],
                tvl: toSerializedDecimalNumber(
                  toDecimalNumber(totalSupplies[i], lpTokenDecimals[i]),
                ),
                yieldRates: [
                  {
                    percentage: supplyApy,
                    label: t('yieldRates.earningsApy'),
                    tokenId: getTokenId({
                      networkId,
                      address: reserveData.underlyingAsset.toLowerCase(),
                    }),
                  },
                ],
                earningItems: [],
                depositTokenId: getTokenId({
                  networkId,
                  address: reserveData.underlyingAsset.toLowerCase(),
                }),
                withdrawTokenId: getTokenId({
                  networkId,
                  address: reserveData.aTokenAddress.toLowerCase(),
                }),
                rewardsPositionIds: rewardsPositionDefinition
                  ? [getPositionId(rewardsPositionDefinition)]
                  : [],
              },
              pricePerShare: [new BigNumber(1) as DecimalNumber],
            } satisfies AppTokenPositionDefinition),
          // Variable debt token
          useVariableDebt &&
            ({
              type: 'app-token-definition',
              networkId,
              address: reserveData.variableDebtTokenAddress.toLowerCase(),
              tokens: [{ address: reserveData.underlyingAsset, networkId }],
              displayProps: {
                title: `${reserveData.symbol} debt`,
                description: `Borrowed variable (APY: ${variableBorrowApy.toFixed(
                  2,
                )}%)`,
                imageUrl: AAVE_LOGO,
                manageUrl,
              },
              // TODO: update runtime so we can specify a negative balance for debt
              // instead of using a negative pricePerShare
              pricePerShare: [new BigNumber(-1) as DecimalNumber],
            } satisfies AppTokenPositionDefinition),
        ].filter((x) => !!x)
      }),
      // User rewards
      rewardsPositionDefinition ? [rewardsPositionDefinition] : [],
    ].flat()
  },
  async getAppTokenDefinition({ networkId, address }: TokenDefinition) {
    throw new UnknownAppTokenError({ networkId, address })
  },
}

export default hook
