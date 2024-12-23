import BigNumber from 'bignumber.js'
import { Address } from 'viem'
import { logger } from '../../log'
import { NetworkId } from '../../types/networkId'
import got from '../../utils/got'

const NETWORK_ID_TO_SOMM_CHAIN: Record<NetworkId, string | null> = {
  [NetworkId['celo-mainnet']]: null,
  [NetworkId['ethereum-mainnet']]: 'ethereum',
  [NetworkId['arbitrum-one']]: 'arbitrum',
  [NetworkId['op-mainnet']]: 'optimism',
  [NetworkId['polygon-pos-mainnet']]: null,
  [NetworkId['base-mainnet']]: null,
  [NetworkId['celo-alfajores']]: null,
  [NetworkId['ethereum-sepolia']]: null,
  [NetworkId['arbitrum-sepolia']]: null,
  [NetworkId['op-sepolia']]: null,
  [NetworkId['polygon-pos-amoy']]: null,
  [NetworkId['base-sepolia']]: null,
}

// The logic for calculating APY values per cellar on the Somm website can be found here:
// https://github.com/PeggyJV/sommelier-strangelove/blob/ca7bd6605bc868a1393d820f13b341ae5a5f1ead/src/data/actions/common/getStrategyData.ts#L22C14-L22C29
//
// The function below is a simplified version of that logic, optimized to calculate
// only the specific value we require.
export function calculateApy({
  data,
  estimatedApy,
  apyEnabled,
  windowSize,
}: {
  data?: { date: number; shareValue: string }[]
  estimatedApy?: number
  apyEnabled: boolean
  windowSize: number
}) {
  if (!apyEnabled) return undefined

  if (!data || data.length < windowSize) return estimatedApy

  // Sort data by date (ascending)
  const sortedData = [...data].sort((a, b) => a.date - b.date)

  // Calculate daily APY values
  const dailyApyValues = sortedData.map((item, index) => {
    if (index === 0) return 0 // No comparison for the first day
    const current = new BigNumber(item.shareValue)
    const previous = new BigNumber(sortedData[index - 1].shareValue)
    return current
      .div(previous)
      .minus(1)
      .multipliedBy(365)
      .multipliedBy(100)
      .toNumber()
  })

  // Smooth APY values with rolling average over the window size
  const smoothedApyValues = []
  for (let i = 0; i < dailyApyValues.length - windowSize + 1; i++) {
    const window = dailyApyValues.slice(i, i + windowSize)
    const average = window.reduce((a, b) => a + b, 0) / windowSize
    smoothedApyValues.push(average)
  }

  // Get the last smoothed APY value
  const lastApy = smoothedApyValues[smoothedApyValues.length - 1]
  return lastApy !== 0 ? lastApy : estimatedApy ?? 0
}

export async function getSommStrategiesData(networkId: NetworkId) {
  const { result } = await got
    .get(`https://app.somm.finance/api/sommelier-api-all-strategies-data`)
    .json<{
      result: {
        data: {
          cellars: {
            id: Address
            shareValue: string
            tvlTotal: number
            chain: string
            dayDatas: { date: number; shareValue: string }[]
          }[]
        }
      }
    }>()

  return result.data.cellars
    .filter((cellar) => {
      // We can only return information for known cellars. If a cellar is
      // encountered without a corresponding configuration, its likely indicates
      // that a new cellar has been added. Log a warning to notify ourselves to
      // add the new cellar.
      const address = cellar.id.split('-')[0].toLowerCase()
      const config = cellarConfig[address]
      if (cellar.chain === NETWORK_ID_TO_SOMM_CHAIN[networkId] && !config) {
        logger.warn(
          `No config found for cellar address ${address}, this is likely a new cellar that we should add support for`,
        )
      }

      return cellar.chain === NETWORK_ID_TO_SOMM_CHAIN[networkId] && !!config
    })
    .map((cellar) => {
      const address = cellar.id.split('-')[0].toLowerCase() as Address // some cellars have a suffix to the address (e.g. `-arbitrum`), which we do not need
      const {
        slug: strategySlug,
        estimatedApy,
        deprecated,
        apyEnabled,
      } = cellarConfig[address]
      if (!strategySlug) {
        logger.warn(`No strategy slug found for cellar address ${address}`)
      }

      return {
        ...cellar,
        address,
        strategySlug, // used to generate the manageUrl
        apy: calculateApy({
          data: cellar.dayDatas,
          estimatedApy,
          apyEnabled,
          windowSize: 30, // 30 day MA APY
        }),
        deprecated,
      }
    })
}

// This configuration is derived from the hardcoded values in the Somm website source code:
// - Config file containing the slug: https://github.com/PeggyJV/sommelier-strangelove/blob/ca7bd6605bc868a1393d820f13b341ae5a5f1ead/src/utils/config.ts
// - UI configuration for estimated apy: https://github.com/PeggyJV/sommelier-strangelove/blob/ca7bd6605bc868a1393d820f13b341ae5a5f1ead/src/data/uiConfig.ts#L518-L599
// - UI configuration for apy enabled: https://github.com/PeggyJV/sommelier-strangelove/blob/ca7bd6605bc868a1393d820f13b341ae5a5f1ead/src/data/uiConfig.ts#L68-L99
//
// The cellars included are filtered based on the response from the API endpoint:
// https://app.somm.finance/api/sommelier-api-all-strategies-data
//
// Note on deprecated cellars:
// - Some cellars are marked as deprecated in their individual strategy configuration files (via the `deprecated` field) in the Somm website source code.
// - For deprecated cellars, the following behavior should be applied:
//   - Allow users to view position data if they already hold a position in the cellar.
//   - Do NOT allow shortcuts or options to acquire new positions in the deprecated cellars.
// Deprecated cellars are included in the configuration below to enable detection of new cellars
// in the Strategies API response. By maintaining a copy of all known cellars, we can compare
// and identify newly added cellars more effectively.
//
// Strategy configuration reference:
// https://github.com/PeggyJV/sommelier-strangelove/tree/ca7bd6605bc868a1393d820f13b341ae5a5f1ead/src/data/strategies
const cellarConfig: Record<
  string,
  {
    slug: string | undefined
    estimatedApy?: number
    deprecated: boolean
    apyEnabled: boolean
  }
> = {
  '0x0274a704a6d9129f90a62ddc6f6024b33ecdad36': {
    slug: 'Real-Yield-BTC',
    deprecated: false,
    apyEnabled: true,
  },
  '0x03df2a53cbed19b824347d6a45d09016c2d1676a': {
    slug: 'DeFi-Stars',
    deprecated: false,
    apyEnabled: false,
  },
  '0x05641a27c82799aaf22b436f20a3110410f29652': {
    slug: 'Steady-MATIC',
    deprecated: true,
    apyEnabled: false,
  },
  '0x0c190ded9be5f512bd72827bdad4003e9cc7975c': {
    slug: 'Turbo-GHO',
    deprecated: true,
    apyEnabled: true,
  },
  '0x18ea937aba6053bc232d9ae2c42abe7a8a2be440': {
    slug: 'Real-Yield-ENS',
    estimatedApy: 1.9,
    deprecated: false,
    apyEnabled: true,
  },
  '0x19b8d8fc682fc56fbb42653f68c7d48dd3fe597e': {
    slug: 'Turbo-ETHx',
    estimatedApy: 6,
    deprecated: true,
    apyEnabled: true,
  },
  '0x1dffb366b5c5a37a12af2c127f31e8e0ed86bdbe': {
    slug: 'Turbo-rsETH',
    estimatedApy: 8,
    deprecated: true,
    apyEnabled: true,
  },
  '0x27500de405a3212d57177a789e30bb88b0adbec5': {
    slug: 'Turbo-ezETH',
    estimatedApy: 6,
    deprecated: true,
    apyEnabled: true,
  },
  '0x3f07a84ecdf494310d397d24c1c78b041d2fa622': {
    slug: 'Steady-ETH',
    deprecated: true,
    apyEnabled: false,
  },
  '0x4068bdd217a45f8f668ef19f1e3a1f043e4c4934': {
    slug: 'Real-Yield-LINK',
    deprecated: false,
    apyEnabled: true,
  },
  '0x4986fd36b6b16f49b43282ee2e24c5cf90ed166d': {
    slug: 'Steady-BTC',
    deprecated: true,
    apyEnabled: false,
  },
  '0x6a6af5393dc23d7e3db28d28ef422db7c40932b6': {
    slug: 'Real-Yield-UNI',
    estimatedApy: 2.6,
    deprecated: false,
    apyEnabled: true,
  },
  '0x6e2dac3b9e9adc0cbbae2d0b9fd81952a8d33872': {
    slug: 'ETH-BTC-Momentum',
    deprecated: true,
    apyEnabled: false,
  },
  '0x6f069f711281618467dae7873541ecc082761b33': {
    slug: 'Steady-UNI',
    deprecated: true,
    apyEnabled: false,
  },
  '0x6b7f87279982d919bbf85182ddeab179b366d8f2': {
    slug: 'ETH-BTC-Trend',
    deprecated: true,
    apyEnabled: false,
  },
  '0x6c1edce139291af5b84fb1e496c9747f83e876c9': {
    slug: 'Turbo-divETH',
    estimatedApy: 4,
    deprecated: true,
    apyEnabled: true,
  },
  '0x6c51041a91c91c86f3f08a72cb4d3f67f1208897': {
    slug: 'ETH-Trend-Growth',
    deprecated: false,
    apyEnabled: false,
  },
  '0x7bad5df5e11151dc5ee1a648800057c5c934c0d5': {
    slug: 'AAVE',
    deprecated: true,
    apyEnabled: false,
  },
  '0x97e6e0a40a3d02f12d1cec30ebfbae04e37c119e': {
    slug: 'Real-Yield-USD',
    deprecated: false,
    apyEnabled: true,
  },
  '0x9a7b4980c6f0fcaa50cd5f288ad7038f434c692e': {
    slug: 'Turbo-eETH',
    estimatedApy: 6,
    deprecated: true,
    apyEnabled: true,
  },
  '0xc7b69e15d86c5c1581dacce3cacaf5b68cd6596f': {
    slug: 'Real-Yield-1Inch',
    estimatedApy: 1.6,
    deprecated: false,
    apyEnabled: true,
  },
  '0xdbe19d1c3f21b1bb250ca7bdae0687a97b5f77e6': {
    slug: 'Fraximal',
    deprecated: false,
    apyEnabled: true,
  },
  '0xb5b29320d2dde5ba5bafa1ebcd270052070483ec': {
    slug: 'Real-Yield-ETH',
    deprecated: false,
    apyEnabled: true,
  },
  '0xc7372ab5dd315606db799246e8aa112405abaeff': {
    slug: 'Turbo-STETH-(steth-deposit)',
    deprecated: false,
    apyEnabled: true,
  },
  '0xcbf2250f33c4161e18d4a2fa47464520af5216b5': {
    slug: 'Real-Yield-SNX',
    estimatedApy: 3.7,
    deprecated: false,
    apyEnabled: true,
  },
  '0xcf4b531b4cde95bd35d71926e09b2b54c564f5b6': {
    slug: 'Morpho-ETH',
    deprecated: false,
    apyEnabled: true,
  },
  '0xd33dad974b938744dac81fe00ac67cb5aa13958e': {
    slug: 'Turbo-SWETH',
    deprecated: true,
    apyEnabled: true,
  },
  '0xdadc82e26b3739750e036dfd9defd3ed459b877a': {
    slug: 'Turbo-eETHV2',
    estimatedApy: 6,
    deprecated: true,
    apyEnabled: true,
  },
  '0xfd6db5011b171b05e1ea3b92f9eacaeeb055e971': {
    slug: 'Turbo-STETH',
    deprecated: false,
    apyEnabled: true,
  },
  '0x392b1e6905bb8449d26af701cdea6ff47bf6e5a8': {
    slug: 'real-yield-usd-arb',
    deprecated: false,
    apyEnabled: true,
  },
  '0xa73b0b48e26e4b8b24cead149252cc275dee99a6': {
    slug: 'Real-Yield-USD-Arbitrum',
    deprecated: false,
    apyEnabled: true,
  },
  '0xc47bb288178ea40bf520a91826a3dee9e0dbfa4c': {
    slug: 'real-yield-eth-opt',
    estimatedApy: 15,
    deprecated: false,
    apyEnabled: true,
  },
  '0xd3bb04423b0c98abc9d62f201212f44dc2611200': {
    slug: 'real-yield-eth-scroll',
    estimatedApy: 15,
    deprecated: false,
    apyEnabled: true,
  },
}
