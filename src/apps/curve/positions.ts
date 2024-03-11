import { Address, createPublicClient, http } from 'viem'
import { celo } from 'viem/chains'
import got from 'got'
import {
  AppTokenPositionDefinition,
  PositionsHook,
  TokenDefinition,
} from '../../types/positions'
import { curveTripoolAbi } from './abis/curve-tripool'
import { curvePoolAbi } from './abis/curve-pool'
import { DecimalNumber, toDecimalNumber } from '../../types/numbers'
import { NetworkId } from '../../api/networkId'

const client = createPublicClient({
  chain: celo,
  transport: http(),
})

interface CurveApiResponse {
  success: boolean
  data: {
    // this has more fields, but only including fields we use
    poolData: {
      address: Address
      implementation: string
    }[]
  }
}

type PoolSize = 2 | 3

const NETWORK_ID_TO_CURVE_BLOCKCHAIN_ID: Record<NetworkId, string | null> = {
  [NetworkId['celo-mainnet']]: 'celo',
  [NetworkId['ethereum-mainnet']]: 'ethereum',
  [NetworkId['arbitrum-one']]: 'arbitrum',
  [NetworkId['op-mainnet']]: 'optimism',
  [NetworkId['ethereum-sepolia']]: null,
  [NetworkId['arbitrum-sepolia']]: null,
  [NetworkId['op-sepolia']]: null,
  [NetworkId['celo-alfajores']]: null,
}

async function getAllCurvePools(networkId: NetworkId) {
  const blockchainId = NETWORK_ID_TO_CURVE_BLOCKCHAIN_ID[networkId]
  if (blockchainId === null) {
    return []
  }
  const { data } = await got
    .get(`https://api.curve.fi/api/getPools/${blockchainId}/factory`)
    .json<CurveApiResponse>()

  const pools: { address: Address; size: PoolSize }[] = data.poolData.map(
    (poolInfo) => ({
      address: poolInfo.address,
      size: poolInfo.implementation === 'plain3basic' ? 3 : 2,
    }),
  )

  return pools
}

export async function getPoolPositionDefinitions(
  networkId: NetworkId,
  address: Address,
) {
  const pools = await getAllCurvePools(networkId)

  // call balanceOf to check if user has balance on a pool
  const result = await client.multicall({
    contracts: pools.map(
      (pool) =>
        ({
          address: pool.address,
          abi: pool.size === 3 ? curveTripoolAbi : curvePoolAbi,
          functionName: 'balanceOf',
          args: [address],
        }) as const,
    ),
    allowFailure: false,
  })

  const userPools = pools
    .map((pool, i) => ({ ...pool, balance: result[i] }))
    .filter((pool) => pool.balance > 0)

  return await Promise.all(
    userPools.map((pool) =>
      getPoolPositionDefinition(networkId, pool.address, pool.size),
    ),
  )
}

async function getPoolPositionDefinition(
  networkId: NetworkId,
  poolAddress: Address,
  poolSize: PoolSize,
) {
  const poolTokenContract = {
    address: poolAddress,
    abi: poolSize === 3 ? curveTripoolAbi : curvePoolAbi,
  }

  const tokenAddresses = (await client.multicall({
    contracts: Array.from({ length: poolSize }, (_, index) =>
      BigInt(index),
    ).map((n) => ({
      ...poolTokenContract,
      functionName: 'coins',
      args: [n],
    })),
    allowFailure: false,
  })) as Address[]

  const position: AppTokenPositionDefinition = {
    type: 'app-token-definition',
    networkId,
    address: poolAddress.toLowerCase(),
    tokens: tokenAddresses.map((token) => ({
      address: token.toLowerCase(),
      networkId,
    })),
    displayProps: ({ resolvedTokens }) => {
      const tokenSymbols = tokenAddresses.map(
        (tokenAddress) => resolvedTokens[tokenAddress.toLowerCase()].symbol,
      )
      return {
        title: tokenSymbols.join(' / '),
        description: 'Pool',
        imageUrl:
          'https://raw.githubusercontent.com/valora-inc/dapp-list/main/assets/curve.png',
      }
    },
    pricePerShare: async ({ tokensByAddress }) => {
      const [balances, totalSupply] = await client.multicall({
        contracts: [
          { ...poolTokenContract, functionName: 'get_balances' },
          { ...poolTokenContract, functionName: 'totalSupply' },
        ],
        allowFailure: false,
      })
      const poolToken = tokensByAddress[poolAddress.toLowerCase()]
      const tokens = tokenAddresses.map(
        (tokenAddress) => tokensByAddress[tokenAddress.toLowerCase()],
      )
      const reserves = balances.map((balance, index) =>
        toDecimalNumber(balance, tokens[index].decimals),
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
      id: 'curve',
      name: 'Curve',
      description: 'Curve pools',
    }
  },
  getPositionDefinitions(networkId, address) {
    return getPoolPositionDefinitions(networkId, address as Address)
  },
  async getAppTokenDefinition({ networkId, address }: TokenDefinition) {
    // Assume that the address is a pool address
    const pools = await getAllCurvePools(networkId)
    const poolSize = pools.find((pool) => pool.address === address)?.size
    return await getPoolPositionDefinition(
      networkId,
      address as Address,
      poolSize!,
    )
  },
}

export default hook
