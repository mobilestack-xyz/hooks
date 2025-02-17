import { Address } from 'viem'
import { NetworkId } from '../../types/networkId'
import { toDecimalNumber, toSerializedDecimalNumber } from '../../types/numbers'
import {
  AppTokenPositionDefinition,
  ClaimType,
  PositionsHook,
  TokenDefinition,
  UnknownAppTokenError,
} from '../../types/positions'
import { getTokenId } from '../../runtime/getTokenId'
import { getClient } from '../../runtime/client'
import { stCeloAbi } from './abis/stcelo'
import { logger } from '../../log'

// stCELO contract addresses
const STCELO_ADDRESS: {
  [networkId in NetworkId]: Address | undefined
} = {
  [NetworkId['celo-mainnet']]: '0x4aAD04D41FD7fd495503731C5a2579e19054C432',
  [NetworkId['ethereum-mainnet']]: undefined,
  [NetworkId['arbitrum-one']]: undefined,
  [NetworkId['op-mainnet']]: undefined,
  [NetworkId['polygon-pos-mainnet']]: undefined,
  [NetworkId['base-mainnet']]: undefined,
  [NetworkId['ethereum-sepolia']]: undefined,
  [NetworkId['arbitrum-sepolia']]: undefined,
  [NetworkId['op-sepolia']]: undefined,
  [NetworkId['celo-alfajores']]: '0xd11CC172D802c1a94e81c5F432471bD34d1828A1',
  [NetworkId['polygon-pos-amoy']]: undefined,
  [NetworkId['base-sepolia']]: undefined,
}

const CELO_ADDRESS: {
  [networkId in NetworkId]: Address | undefined
} = {
  [NetworkId['celo-mainnet']]: '0x471EcE3750Da237f93B8E339c536989b8978a438',
  [NetworkId['ethereum-mainnet']]: undefined,
  [NetworkId['arbitrum-one']]: undefined,
  [NetworkId['op-mainnet']]: undefined,
  [NetworkId['polygon-pos-mainnet']]: undefined,
  [NetworkId['base-mainnet']]: undefined,
  [NetworkId['ethereum-sepolia']]: undefined,
  [NetworkId['arbitrum-sepolia']]: undefined,
  [NetworkId['op-sepolia']]: undefined,
  [NetworkId['celo-alfajores']]: '0xF194afDf50B03e69Bd7D057c1Aa9e10c9954E4C9',
  [NetworkId['polygon-pos-amoy']]: undefined,
  [NetworkId['base-sepolia']]: undefined,
}

const stCeloAppTokenDefinition = async ({
  networkId,
}: {
  networkId: NetworkId
  address: Address
}): Promise<AppTokenPositionDefinition> => {
  const client = getClient(networkId)
  const stCeloAddress = STCELO_ADDRESS[networkId]
  const celoAddress = CELO_ADDRESS[networkId]

  if (!stCeloAddress || !celoAddress) {
    throw new Error(`Network ${networkId} not supported`)
  }

  // Get exchange rate and total assets
  let exchangeRate = 1000000000000000000n // Default 1:1 ratio
  let totalAssets = 0n

  try {
    [exchangeRate, totalAssets] = await Promise.all([
      client.readContract({
        address: stCeloAddress,
        abi: stCeloAbi,
        functionName: 'exchangeRate',
      }),
      client.readContract({
        address: stCeloAddress,
        abi: stCeloAbi,
        functionName: 'totalAssets',
      }),
    ])
  } catch (error) {
    // Log error but continue with default values
    logger.error({ err: error }, 'Failed to fetch stCELO contract data')
  }

  return {
    type: 'app-token-definition',
    networkId,
    address: stCeloAddress,
    tokens: [
      {
        address: celoAddress,
        networkId,
        fallbackPriceUsd: toSerializedDecimalNumber(1), // Default to 1 USD if price not available
      },
    ],
    displayProps: {
      title: 'stCELO',
      description: 'Liquid Staked CELO - Earn staking rewards while keeping your CELO liquid. Note: 3-day unstaking period applies.',
      imageUrl: 'https://app.stcelo.xyz/_next/static/media/token-stcelo.5935f866.svg',
      manageUrl: 'https://app.stcelo.xyz',
    },
    pricePerShare: [toDecimalNumber(exchangeRate, 18)],
    dataProps: {
      depositTokenId: getTokenId({
        address: celoAddress,
        networkId,
      }),
      withdrawTokenId: getTokenId({
        address: stCeloAddress,
        networkId,
      }),
      yieldRates: [
        {
          percentage: 0, // Rewards are reflected in increasing stCELO:CELO exchange rate
          label: 'Variable rate from Celo epoch rewards (no protocol fees)',
          tokenId: getTokenId({
            address: celoAddress,
            networkId,
          }),
        },
      ],
      earningItems: [],
      tvl: toSerializedDecimalNumber(toDecimalNumber(totalAssets, 18)),
      manageUrl: 'https://app.stcelo.xyz',
      claimType: ClaimType.Earnings,
      cantSeparateCompoundedInterest: true,
      safety: {
        level: 'low',
        risks: [
          {
            isPositive: true,
            title: 'Non-custodial protocol',
            category: 'security',
          },
          {
            isPositive: true,
            title: 'No principal slashing risk',
            category: 'security',
          },
          {
            isPositive: false,
            title: '3-day withdrawal period',
            category: 'liquidity',
          },
        ],
      },
      termsUrl: 'https://docs.stcelo.xyz/disclaimer',
    },
    availableShortcutIds: ['deposit', 'withdraw', 'swap-deposit'],
    shortcutTriggerArgs: {
      deposit: {
        tokenAddress: celoAddress,
        tokenDecimals: 18,
        positionAddress: stCeloAddress,
      },
      withdraw: {
        tokenDecimals: 18,
        positionAddress: stCeloAddress,
      },
      'swap-deposit': {
        tokenAddress: celoAddress,
        positionAddress: stCeloAddress,
      },
    },
  }
}

const hook: PositionsHook = {
  getInfo() {
    return {
      name: 'stCELO',
    }
  },

  async getPositionDefinitions({ networkId, address }) {
    const stCeloAddress = STCELO_ADDRESS[networkId]
    if (!stCeloAddress || !address) {
      return []
    }

    return [await stCeloAppTokenDefinition({ networkId, address: address as Address })]
  },

  async getAppTokenDefinition({ networkId, address }: TokenDefinition) {
    const stCeloAddress = STCELO_ADDRESS[networkId]
    if (!stCeloAddress || address.toLowerCase() !== stCeloAddress.toLowerCase()) {
      throw new UnknownAppTokenError({ networkId, address })
    }

    return await stCeloAppTokenDefinition({ networkId, address: address as Address })
  },
}

export default hook 