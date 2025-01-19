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
import { getTokenId } from '../../runtime/getTokenId'
import { getAllbridgeTokenInfo } from './api'
import { poolAbi } from './abis/pool'
import {
  ALLBRIDGE_LOGO,
  ALLBRIDGE_POOLS_BASE_URL,
  ALLBRIDGE_TERMS_URL,
  ALLBRIGE_CONTRACT_CREATED_AT,
  NETWORK_ID_TO_ALLBRIDGE_CHAIN,
} from './constants'
import { getPositionId } from '../../runtime/getPositionId'

const hook: PositionsHook = {
  getInfo() {
    return {
      name: 'Allbridge',
    }
  },
  async getPositionDefinitions({ networkId, address, t }) {
    const allbridgeTokenInfo = (await getAllbridgeTokenInfo({ networkId }))
      ?.tokens
    if (!allbridgeTokenInfo) {
      return []
    }

    const client = getClient(networkId, 'allbridge')

    const [balances, rewards, totalSupplies, lpTokenDecimals] =
      await Promise.all([
        Promise.all(
          allbridgeTokenInfo.map((tokenInfo) => {
            return address
              ? client.readContract({
                  address: tokenInfo.poolAddress,
                  abi: poolAbi,
                  functionName: 'balanceOf',
                  args: [address as Address],
                })
              : undefined
          }),
        ),
        Promise.all(
          allbridgeTokenInfo.map((tokenInfo) => {
            return address
              ? client.readContract({
                  address: tokenInfo.poolAddress,
                  abi: poolAbi,
                  functionName: 'pendingReward',
                  args: [address as Address],
                })
              : undefined
          }),
        ),
        Promise.all(
          allbridgeTokenInfo.map((tokenInfo) => {
            return client.readContract({
              address: tokenInfo.poolAddress,
              abi: poolAbi,
              functionName: 'totalSupply',
              args: [],
            })
          }),
        ),
        Promise.all(
          allbridgeTokenInfo.map((tokenInfo) => {
            return client.readContract({
              address: tokenInfo.poolAddress,
              abi: poolAbi,
              functionName: 'decimals',
              args: [],
            })
          }),
        ),
      ])

    return allbridgeTokenInfo.flatMap((tokenInfo, i) => {
      const apr = new BigNumber(tokenInfo.apr7d).toNumber() * 100
      const manageUrl = `${ALLBRIDGE_POOLS_BASE_URL}?chain=${NETWORK_ID_TO_ALLBRIDGE_CHAIN[networkId]}`

      const balanceOf = balances[i]
      const pendingReward = rewards[i]

      const showLpToken = !address || (!!balanceOf && balanceOf > 0)
      const showReward = !!pendingReward && pendingReward > 0

      const rewardPositionDefinition =
        showReward &&
        ({
          type: 'contract-position-definition',
          networkId,
          address: tokenInfo.poolAddress.toLowerCase(),
          extraId: 'supply-incentives',
          tokens: [
            {
              address: tokenInfo.tokenAddress.toLowerCase(),
              networkId,
              category: 'claimable',
            },
          ],
          availableShortcutIds: ['claim-rewards'],
          shortcutTriggerArgs: {
            'claim-rewards': {
              positionAddress: tokenInfo.poolAddress.toLowerCase(),
            },
          },
          balances: [toDecimalNumber(pendingReward, tokenInfo.decimals)],
          displayProps: {
            title: `${tokenInfo.symbol} supply incentives`,
            description: 'Rewards for supplying',
            imageUrl: ALLBRIDGE_LOGO,
            manageUrl,
          },
        } satisfies ContractPositionDefinition)

      return [
        showLpToken &&
          ({
            type: 'app-token-definition',
            networkId,
            address: tokenInfo.poolAddress.toLowerCase(),
            tokens: [
              { address: tokenInfo.tokenAddress.toLowerCase(), networkId },
            ],
            availableShortcutIds: ['deposit', 'withdraw'],
            shortcutTriggerArgs: {
              deposit: {
                tokenAddress: tokenInfo.tokenAddress.toLowerCase(),
                tokenDecimals: tokenInfo.decimals,
                positionAddress: tokenInfo.poolAddress.toLowerCase(),
              },
              withdraw: {
                tokenDecimals: lpTokenDecimals[i],
                positionAddress: tokenInfo.poolAddress.toLowerCase(),
              },
              'swap-deposit': {
                tokenAddress: tokenInfo.tokenAddress.toLowerCase(),
                positionAddress: tokenInfo.poolAddress.toLowerCase(),
              },
            },
            displayProps: {
              title: tokenInfo.symbol,
              description: `Supplied (APR: ${apr.toFixed(2)}%)`,
              imageUrl: ALLBRIDGE_LOGO,
              manageUrl,
            },
            dataProps: {
              manageUrl,
              claimType: ClaimType.Earnings,
              withdrawalIncludesClaim: true,
              termsUrl: ALLBRIDGE_TERMS_URL,
              contractCreatedAt:
                ALLBRIGE_CONTRACT_CREATED_AT[
                  getTokenId({
                    networkId,
                    address: tokenInfo.poolAddress.toLowerCase(),
                  })
                ],
              tvl: toSerializedDecimalNumber(
                toDecimalNumber(totalSupplies[i], lpTokenDecimals[i]),
              ),
              yieldRates: [
                {
                  percentage: apr,
                  label: t('yieldRates.earningsApr'),
                  tokenId: getTokenId({
                    networkId,
                    address: tokenInfo.tokenAddress.toLowerCase(),
                  }),
                },
              ],
              earningItems: pendingReward
                ? [
                    {
                      amount: toDecimalNumber(
                        pendingReward,
                        tokenInfo.decimals,
                      ),
                      label: t('earningItems.earnings'),
                      tokenId: getTokenId({
                        networkId,
                        address: tokenInfo.tokenAddress.toLowerCase(),
                      }),
                    },
                  ]
                : [],
              depositTokenId: getTokenId({
                networkId,
                address: tokenInfo.tokenAddress.toLowerCase(),
              }),
              withdrawTokenId: getTokenId({
                networkId,
                address: tokenInfo.poolAddress.toLowerCase(),
              }),
              rewardsPositionIds: rewardPositionDefinition
                ? [getPositionId(rewardPositionDefinition)]
                : [],
            },
            pricePerShare: [new BigNumber(1) as DecimalNumber],
          } satisfies AppTokenPositionDefinition),
        rewardPositionDefinition,
      ].filter((x) => !!x)
    })
  },
  async getAppTokenDefinition({ networkId, address }: TokenDefinition) {
    throw new UnknownAppTokenError({ networkId, address })
  },
}

export default hook
