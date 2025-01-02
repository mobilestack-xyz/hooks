import { Address } from 'viem'
import { logger } from '../../log'
import { getClient } from '../../runtime/client'
import { getTokenId } from '../../runtime/getTokenId'
import { NetworkId } from '../../types/networkId'
import { toDecimalNumber, toSerializedDecimalNumber } from '../../types/numbers'
import {
  AppTokenPositionDefinition,
  ClaimType,
  ContractPositionDefinition,
  PositionsHook,
  TokenDefinition,
  UnknownAppTokenError,
} from '../../types/positions'
import { createBatches } from '../../utils/batcher'
import {
  beefyClmVaultsMulticallAbi,
  beefyClmVaultsMulticallBytecode,
} from './abis/beefy-clm-vaults-multicall'
import { beefyV2AppMulticallAbi } from './abis/beefy-v2-app-multicall'
import {
  BaseBeefyVault,
  GovVault,
  getApyBreakdown,
  getBeefyPrices,
  getBeefyVaults,
  getTvls,
} from './api'
import { TFunction } from 'i18next'
import { networkIdToNativeAssetAddress } from '../../runtime/isNative'
import { getSafety } from './safety'

type BeefyPrices = Awaited<ReturnType<typeof getBeefyPrices>>
type BeefyApyBreakdown = Awaited<ReturnType<typeof getApyBreakdown>>
type BeefyTvls = Awaited<ReturnType<typeof getTvls>>

// Fetched addresses from https://github.com/beefyfinance/beefy-v2/blob/main/src/config/config.tsx
const BEEFY_MULTICALL_ADDRESS: {
  [networkId in NetworkId]: Address | undefined
} = {
  [NetworkId['ethereum-mainnet']]: '0x00d3e26d17aEA6f5c7d2f442aAc68E679E454517',
  [NetworkId['arbitrum-one']]: '0x47bec05dC291e61cd4360322eA44882cA468dD54',
  [NetworkId['op-mainnet']]: '0xB089f6c9C99238FC6df256cc66d53Aed198584D9',
  [NetworkId['celo-mainnet']]: '0x0bF5F48d8F761efAe0f187eCce60784e5d3E87E6',
  [NetworkId['polygon-pos-mainnet']]:
    '0x244908D9A21B143911D531cD1D37575D63da4D87',
  [NetworkId['base-mainnet']]: '0x57B01298DfDdeA1c6CaB01793396af5fbFc213CE',
  [NetworkId['ethereum-sepolia']]: undefined,
  [NetworkId['arbitrum-sepolia']]: undefined,
  [NetworkId['op-sepolia']]: undefined,
  [NetworkId['celo-alfajores']]: undefined,
  [NetworkId['polygon-pos-amoy']]: undefined,
  [NetworkId['base-sepolia']]: undefined,
}

const BEEFY_VAULT_BASE_URL = 'https://app.beefy.com/vault/'

const beefyAppTokenDefinition = ({
  networkId,
  vault,
  prices,
  apyBreakdown,
  tvls,
  t,
}: {
  networkId: NetworkId
  vault: BaseBeefyVault
  prices: BeefyPrices
  apyBreakdown: BeefyApyBreakdown
  tvls: BeefyTvls
  t: TFunction
}): AppTokenPositionDefinition => {
  const priceUsd = prices[vault.id]
  const vaultTokenAddress =
    vault.tokenAddress?.toLowerCase() ??
    networkIdToNativeAssetAddress[networkId]
  const tvl = tvls[vault.id]
  const apy = apyBreakdown[vault.id]?.totalApy ?? 0
  return {
    type: 'app-token-definition',
    networkId,
    address: vault.earnedTokenAddress.toLowerCase(),
    tokens: [
      {
        address: vaultTokenAddress,
        networkId,
        fallbackPriceUsd: priceUsd
          ? toSerializedDecimalNumber(priceUsd)
          : undefined,
      },
    ],
    displayProps: () => {
      return {
        title: vault.name + (vault.status === 'eol' ? ' (Retired)' : ''),
        description: 'Vault',
        imageUrl:
          'https://raw.githubusercontent.com/valora-inc/dapp-list/main/assets/beefy.png',
        manageUrl: BEEFY_VAULT_BASE_URL + vault.id,
      }
    },
    pricePerShare: async ({ tokensByTokenId }) => {
      const tokenId = getTokenId({
        address: vaultTokenAddress,
        networkId,
      })
      const { decimals } = tokensByTokenId[tokenId]
      return [
        toDecimalNumber(
          // pricePerShare can potentially be a string in scientific notation, so convert to Number, round and then to BigInt
          BigInt(Math.round(Number(vault.pricePerFullShare))),
          decimals,
        ),
      ]
    },
    dataProps: {
      depositTokenId: getTokenId({
        address: vault.tokenAddress,
        networkId,
      }),
      withdrawTokenId: getTokenId({
        address: vault.earnedTokenAddress,
        networkId,
      }),
      yieldRates: apy
        ? [
            {
              percentage: apy * 100,
              label: t('yieldRates.earningsApy'),
              tokenId: getTokenId({
                networkId,
                address: vault.tokenAddress,
              }),
            },
          ]
        : [],
      earningItems: [],
      cantSeparateCompoundedInterest: true,
      tvl: tvl ? toSerializedDecimalNumber(tvl) : undefined,
      manageUrl: `${BEEFY_VAULT_BASE_URL}${vault.id}`,
      contractCreatedAt: new Date(vault.createdAt * 1000).toISOString(),
      claimType: ClaimType.Rewards,
      dailyYieldRatePercentage: getDailyYieldRatePercentage(
        apyBreakdown[vault.id],
        vault,
      ),
      safety: getSafety(vault, t),
    },
    availableShortcutIds: ['deposit', 'withdraw', 'swap-deposit'],
    shortcutTriggerArgs: ({ tokensByTokenId }) => {
      return {
        deposit: {
          tokenAddress: vault.tokenAddress?.toLowerCase(),
          tokenDecimals: vault.tokenDecimals,
          positionAddress: vault.earnedTokenAddress.toLowerCase(),
        },
        withdraw: {
          tokenDecimals:
            tokensByTokenId[
              getTokenId({
                address: vault.earnedTokenAddress,
                networkId,
              })
            ].decimals,
          positionAddress: vault.earnedTokenAddress.toLowerCase(),
        },
        'swap-deposit': {
          tokenAddress: vault.tokenAddress?.toLowerCase(),
          positionAddress: vault.earnedTokenAddress.toLowerCase(),
        },
      }
    },
  }
}

// Based on https://github.com/beefyfinance/beefy-v2/blob/4413697f3d3cb5e090d8bb6958b621a673f0d739/src/features/data/actions/apy.ts#L46
export function getDailyYieldRatePercentage(
  apyBreakdown: BeefyApyBreakdown[string],
  vault: BaseBeefyVault,
) {
  if (!apyBreakdown) {
    return 0
  }

  // https://github.com/beefyfinance/beefy-v2/blob/4413697f3d3cb5e090d8bb6958b621a673f0d739/src/helpers/apy.ts#L103
  const components = [
    'vaultApr',
    'clmApr',
    'tradingApr',
    'merklApr',
    'stellaSwapApr',
    'liquidStakingApr',
    'composablePoolApr',
    'rewardPoolApr',
    'rewardPoolTradingApr',
  ]

  let totalDaily = 0
  // Calculate the total daily apy from components
  if (Object.keys(apyBreakdown).some((key) => components.includes(key))) {
    for (const component of components) {
      const apr = apyBreakdown[component]
      if (apr && !isNaN(Number(apr))) {
        totalDaily += apr / 365
      }
    }
  } else {
    // "uncompound" apy to get daily apr
    totalDaily = _yearlyToDaily(apyBreakdown.totalApy)
  }

  // At some point the Beefy team decided to change this 'rewardPoolApr' on this specific vault type to be a soft-boost
  // instead of being calculated as regular APR, so to be backwards compatible they subtract it from the total daily APR
  if (vault.type === 'gov' && vault.subType === 'cowcentrated') {
    // anything in 'rewardPoolApr' (i.e. not in 'rewardPoolTradingApr') is considered a soft-boost on the pool
    // and is should not be counted towards the daily yield rate
    const additionalApr = apyBreakdown.rewardPoolApr ?? 0
    totalDaily -= additionalApr / 365
  }

  // TODO: handle merkl campaigns which are off-chain rewards
  // https://github.com/beefyfinance/beefy-v2/blob/4413697f3d3cb5e090d8bb6958b621a673f0d739/src/features/data/actions/apy.ts#L132

  return totalDaily * 100
}

const _yearlyToDaily = (apy: number) => {
  const dailyApy = Math.pow(10, Math.log10(apy + 1) / 365) - 1

  if (isNaN(dailyApy)) {
    return 0
  }

  return dailyApy
}

// CLM = Cowcentrated Liquidity Manager: https://docs.beefy.finance/beefy-products/clm
interface ClmVaultBalanceInfo {
  token0: Address
  token1: Address
  amount0: bigint
  amount1: bigint
}

const beefyConcentratedContractDefinition = (
  networkId: NetworkId,
  vault: BaseBeefyVault,
  balanceInfo: ClmVaultBalanceInfo | undefined,
  description: string,
  prices: BeefyPrices,
): ContractPositionDefinition | null => {
  if (!balanceInfo) {
    return null
  }

  return {
    type: 'contract-position-definition',
    networkId,
    address: vault.earnedTokenAddress.toLowerCase(),
    tokens: vault.depositTokenAddresses.map((address) => {
      const addressLower = address.toLowerCase()
      const priceUsd = prices[addressLower]
      return {
        address: addressLower,
        networkId,
        fallbackPriceUsd: priceUsd
          ? toSerializedDecimalNumber(priceUsd)
          : undefined,
      }
    }),
    displayProps: () => {
      return {
        title: vault.name + (vault.status === 'eol' ? ' (Retired)' : ''),
        description,
        imageUrl:
          'https://raw.githubusercontent.com/valora-inc/dapp-list/main/assets/beefy.png',
        manageUrl: BEEFY_VAULT_BASE_URL + vault.id,
      }
    },
    balances: async ({ resolvedTokensByTokenId }) => {
      const token0Decimals =
        resolvedTokensByTokenId[
          getTokenId({
            networkId,
            address: balanceInfo.token0,
          })
        ].decimals
      const token1Decimals =
        resolvedTokensByTokenId[
          getTokenId({
            networkId,
            address: balanceInfo.token1,
          })
        ].decimals
      return [
        toDecimalNumber(balanceInfo.amount0, token0Decimals),
        toDecimalNumber(balanceInfo.amount1, token1Decimals),
      ]
    },
  }
}

const beefyBaseVaultsPositions = async ({
  networkId,
  address,
  vaults,
  multicallAddress,
  prices,
  apyBreakdown,
  tvls,
  t,
}: {
  networkId: NetworkId
  address?: Address
  vaults: BaseBeefyVault[]
  multicallAddress: Address
  prices: BeefyPrices
  apyBreakdown: BeefyApyBreakdown
  tvls: BeefyPrices
  t: TFunction
}) => {
  const client = getClient(networkId)

  const userVaults: (BaseBeefyVault & { balance: bigint })[] = []

  if (address) {
    await Promise.all(
      createBatches(vaults).map(async (batch) => {
        if (batch.length === 0) {
          return
        }
        const balances = await client.readContract({
          abi: beefyV2AppMulticallAbi,
          address: multicallAddress,
          functionName: 'getTokenBalances',
          args: [batch.map((vault) => vault.earnContractAddress), address],
        })
        for (let i = 0; i < balances.length; i++) {
          if (balances[i] > 0) {
            userVaults.push({
              ...batch[i],
              balance: balances[i],
            })
          }
        }
      }),
    )
  } else {
    userVaults.push(
      ...vaults.map((vault) => ({ ...vault, balance: BigInt(0) })),
    )
  }

  if (!userVaults.length) {
    return []
  }

  const clmVaults = userVaults.filter((vault) => vault.type === 'cowcentrated')
  const info =
    clmVaults.length === 0 || !address // earn positions can't include clm vaults for now
      ? []
      : await client.readContract({
          code: beefyClmVaultsMulticallBytecode,
          abi: beefyClmVaultsMulticallAbi,
          functionName: 'getUserVaults',
          args: [address, clmVaults.map((vault) => vault.earnContractAddress)],
        })
  return userVaults
    .map((vault) => {
      try {
        return vault.type === 'cowcentrated'
          ? beefyConcentratedContractDefinition(
              networkId,
              vault,
              info.find(
                (i) =>
                  i.token0 === vault.depositTokenAddresses[0] &&
                  i.token1 === vault.depositTokenAddresses[1],
              ),
              'CLM Vault',
              prices,
            )
          : beefyAppTokenDefinition({
              networkId,
              vault,
              prices,
              apyBreakdown,
              tvls,
              t,
            })
      } catch (err) {
        logger.error({ err, vault }, 'Error processing vault')
        return null
      }
    })
    .filter((position): position is ContractPositionDefinition => !!position)
}

const beefyGovVaultsPositions = async (
  networkId: NetworkId,
  address: Address,
  vaults: BaseBeefyVault[],
  govVaults: GovVault[],
  multicallAddress: Address,
  prices: BeefyPrices,
) => {
  const client = getClient(networkId)

  const userVaults: (GovVault & { balance: bigint })[] = []

  await Promise.all(
    createBatches(govVaults).map(async (batch) => {
      if (batch.length === 0) {
        return
      }
      const balances = await client.readContract({
        abi: beefyV2AppMulticallAbi,
        address: multicallAddress,
        functionName: 'getTokenBalances',
        args: [batch.map((vault) => vault.earnContractAddress), address],
      })
      for (let i = 0; i < balances.length; i++) {
        if (balances[i] > 0) {
          userVaults.push({
            ...batch[i],
            balance: balances[i],
          })
        }
      }
    }),
  )

  if (!userVaults.length) {
    return []
  }

  const clmVaults = userVaults
    .map((vault) => ({
      userVault: vault,
      vault: vaults.find(
        (v) =>
          v.earnContractAddress === vault.tokenAddress &&
          v.type === 'cowcentrated',
      ),
    }))
    .filter((v) => v.vault !== undefined)
  if (clmVaults.length !== userVaults.length) {
    logger.error(
      'clmVaults.length !== userVaults.length some gov vaults are not being processed',
    )
  }
  if (clmVaults.length === 0) {
    return []
  }

  // Avoid a possible runtime error if the userVault.tokenAddress is undefined
  const filteredClmVaults = clmVaults.filter(
    ({ userVault }) => !!userVault.tokenAddress,
  )

  const info = await client.readContract({
    code: beefyClmVaultsMulticallBytecode,
    abi: beefyClmVaultsMulticallAbi,
    functionName: 'getUserClmPools',
    args: [
      address,
      // @ts-expect-error filteredVaults should have tokenAddress defined
      filteredClmVaults.map(({ userVault }) => userVault.tokenAddress),
      filteredClmVaults.map(({ userVault }) => userVault.earnContractAddress),
    ],
  })

  return clmVaults
    .map(({ vault }) =>
      beefyConcentratedContractDefinition(
        networkId,
        vault!,
        info.find(
          (i) =>
            i.token0 === vault!.depositTokenAddresses[0] &&
            i.token1 === vault!.depositTokenAddresses[1],
        ),
        'CLM Pool',
        prices,
      ),
    )
    .filter((position): position is ContractPositionDefinition => !!position)
}

const hook: PositionsHook = {
  getInfo() {
    return {
      name: 'Beefy',
    }
  },
  async getPositionDefinitions({ networkId, address, t }) {
    const multicallAddress = BEEFY_MULTICALL_ADDRESS[networkId]
    if (!multicallAddress) {
      return []
    }

    const [{ vaults, govVaults }, prices, apyBreakdown, tvls] =
      await Promise.all([
        getBeefyVaults(networkId),
        getBeefyPrices(networkId),
        getApyBreakdown(),
        getTvls(networkId),
      ])

    return [
      ...(await beefyBaseVaultsPositions({
        networkId,
        address: address as Address | undefined,
        vaults,
        multicallAddress,
        prices,
        apyBreakdown,
        tvls,
        t,
      })),
      // no gov vaults for earn positions, so no need to return 0 balances
      ...(address
        ? await beefyGovVaultsPositions(
            networkId,
            address as Address,
            vaults,
            govVaults,
            multicallAddress,
            prices,
          )
        : []),
    ]
  },
  async getAppTokenDefinition({ networkId, address }: TokenDefinition) {
    throw new UnknownAppTokenError({ networkId, address })
  },
}

export default hook
