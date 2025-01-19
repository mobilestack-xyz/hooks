import { Address, erc20Abi } from 'viem'
import got from '../../utils/got'
import {
  AppTokenPositionDefinition,
  PositionsHook,
  TokenDefinition,
  UnknownAppTokenError,
} from '../../types/positions'
import {
  DecimalNumber,
  toDecimalNumber,
  toSerializedDecimalNumber,
} from '../../types/numbers'
import { NetworkId } from '../../types/networkId'
import { getClient } from '../../runtime/client'
import { getTokenId } from '../../runtime/getTokenId'

// For now, when getting all positions, we only consider the top pools by USD total
// otherwise we have too many RPC calls, and get rate limited
// TODO: update the runtime so it can batch call them
const TOP_POOLS_COUNT = 20

interface CurveApiResponse {
  success: boolean
  data: {
    // this has more fields, but only including fields we use
    poolData: {
      address: Address
      lpTokenAddress: Address
      totalSupply: string
      implementation: string
      coins: {
        address: Address
        usdPrice: number | null
        poolBalance: string
        decimals: number
        symbol: symbol
        isBasePoolLpToken: boolean
      }[]
      poolUrls: {
        swap: string[]
        deposit: string[]
        withdraw: string[]
      }
      usdTotal: number
    }[]
  }
}

const NETWORK_ID_TO_CURVE_BLOCKCHAIN_ID: Record<NetworkId, string | null> = {
  [NetworkId['celo-mainnet']]: 'celo',
  [NetworkId['ethereum-mainnet']]: 'ethereum',
  [NetworkId['arbitrum-one']]: 'arbitrum',
  [NetworkId['op-mainnet']]: 'optimism',
  [NetworkId['polygon-pos-mainnet']]: 'polygon',
  [NetworkId['base-mainnet']]: 'base',
  [NetworkId['celo-alfajores']]: null,
  [NetworkId['ethereum-sepolia']]: null,
  [NetworkId['arbitrum-sepolia']]: null,
  [NetworkId['op-sepolia']]: null,
  [NetworkId['polygon-pos-amoy']]: null,
  [NetworkId['base-sepolia']]: null,
}

export async function getAllCurvePools(
  networkId: NetworkId,
): Promise<CurveApiResponse['data']['poolData']> {
  const blockchainId = NETWORK_ID_TO_CURVE_BLOCKCHAIN_ID[networkId]
  if (!blockchainId) {
    return []
  }
  const { data } = await got
    .get(`https://api.curve.fi/v1/getPools/all/${blockchainId}`)
    .json<CurveApiResponse>()

  // Deduplicate pools with the same lpTokenAddress
  // For some reason Curve API returns the same pool multiple times
  const lpTokenAddresses = new Set<Address>()
  return data.poolData.filter((pool) => {
    if (lpTokenAddresses.has(pool.lpTokenAddress)) {
      return false
    }
    lpTokenAddresses.add(pool.lpTokenAddress)
    return true
  })
}

export async function getPoolPositionDefinitions(
  networkId: NetworkId,
  address: Address | undefined,
) {
  const pools = await getAllCurvePools(networkId)

  let consideredPools = pools
  if (address) {
    // call balanceOf to check if user has balance on a pool
    const client = getClient(networkId, 'curve')
    const result = await client.multicall({
      contracts: pools.map(
        (pool) =>
          ({
            address: pool.lpTokenAddress,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address],
          }) as const,
      ),
      allowFailure: false,
    })

    consideredPools = pools
      .map((pool, i) => ({ ...pool, balance: result[i] }))
      .filter((pool) => pool.balance > 0)
  } else {
    consideredPools = consideredPools
      .sort((a, b) => b.usdTotal - a.usdTotal)
      .slice(0, TOP_POOLS_COUNT)
  }

  return await Promise.all(
    consideredPools.map((pool) => getPoolPositionDefinition(networkId, pool)),
  )
}

async function getPoolPositionDefinition(
  networkId: NetworkId,
  pool: CurveApiResponse['data']['poolData'][0],
) {
  const tokens = pool.coins.map((coin) => ({
    address: coin.address.toLowerCase(),
    networkId,
    fallbackPriceUsd: coin.usdPrice
      ? toSerializedDecimalNumber(coin.usdPrice)
      : undefined,
  }))

  const position: AppTokenPositionDefinition = {
    type: 'app-token-definition',
    networkId,
    address: pool.lpTokenAddress.toLowerCase(),
    tokens,
    displayProps: ({ resolvedTokensByTokenId }) => {
      const tokenSymbols = tokens.map(
        (token) =>
          resolvedTokensByTokenId[
            getTokenId({
              networkId,
              address: token.address,
            })
          ].symbol,
      )
      return {
        title: tokenSymbols.join(' / '),
        description: 'Pool',
        imageUrl:
          'https://raw.githubusercontent.com/valora-inc/dapp-list/main/assets/curve.png',
        manageUrl: pool.poolUrls.withdraw[0],
      }
    },
    pricePerShare: async ({ tokensByTokenId }) => {
      const totalSupply = BigInt(pool.totalSupply)
      const balances = pool.coins.map((coin) => BigInt(coin.poolBalance))
      const poolTokenId = getTokenId({
        address: pool.lpTokenAddress,
        isNative: false,
        networkId,
      })
      const poolToken = tokensByTokenId[poolTokenId]
      const underlyingTokens = tokens.map(
        (token) =>
          tokensByTokenId[
            getTokenId({
              address: token.address,
              networkId,
            })
          ],
      )
      const reserves = balances.map((balance, index) =>
        toDecimalNumber(balance, underlyingTokens[index].decimals),
      )
      const supply = toDecimalNumber(totalSupply, poolToken.decimals)
      const pricePerShare = reserves.map((r) => r.div(supply) as DecimalNumber)
      return pricePerShare
    },
  }

  return position
}

const hook: PositionsHook = {
  getInfo() {
    return {
      name: 'Curve',
    }
  },
  async getPositionDefinitions({ networkId, address }) {
    return getPoolPositionDefinitions(
      networkId,
      address ? (address as Address) : undefined,
    )
  },
  async getAppTokenDefinition({ networkId, address }: TokenDefinition) {
    // Assume that the address is a pool address
    const pools = await getAllCurvePools(networkId)
    const pool = pools.find((pool) => pool.lpTokenAddress === address)
    if (!pool) {
      throw new UnknownAppTokenError({ networkId, address })
    }
    return await getPoolPositionDefinition(networkId, pool)
  },
}

export default hook
