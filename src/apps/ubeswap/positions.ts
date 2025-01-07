import BigNumberJs from 'bignumber.js'
import got from '../../utils/got'
import { Address, createPublicClient, http } from 'viem'
import { celo } from 'viem/chains'
import { getTokenId } from '../../runtime/getTokenId'
import { NetworkId } from '../../types/networkId'
import { DecimalNumber, toDecimalNumber } from '../../types/numbers'
import {
  AppTokenPosition,
  AppTokenPositionDefinition,
  ContractPositionDefinition,
  PositionDefinition,
  PositionsHook,
  TokenDefinition,
} from '../../types/positions'
import { getUniswapV3PositionDefinitions } from '../uniswap/positions'
import { stakingRewardsAbi } from './abis/staking-rewards'
import { uniswapV2PairAbi } from './abis/uniswap-v2-pair'
import farms from './data/farms.json'
import { logger } from '../../log'
import * as dotenv from 'dotenv'
import { BigNumber } from '@ethersproject/bignumber'
import CID from 'cids'
import { toB58String } from 'multihashes'
import { FarmAbi } from './abis/farm-registry'
import {
  getIncentiveIdsByPool,
  IncentiveContractInfo,
  IncentiveDataItem,
  StakeInfo,
  TokenData,
} from './interface'
import { hexToUint8Array } from '../../utils/numbers'
import { erc20Abi } from '../../abis/erc-20'

dotenv.config()

const client = createPublicClient({
  chain: celo,
  transport: http(),
})

const UBESWAP_LOGO =
  'https://raw.githubusercontent.com/valora-inc/dapp-list/ab12ab234b4a6e01eff599c6bd0b7d5b44d6f39d/assets/ubeswap.png'

const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/'

const PAIRS_QUERY = `
  query getPairs($address: ID!) {
    user(id: $address) {
      liquidityPositions {
        pair {
          id
        }
        liquidityTokenBalance
      }
    }
  }
`

const UBE_DECIMALS = 18

const FARM_POOLS = [
  // CELO/UBE pool
  '0x3efc8d831b754d3ed58a2b4c37818f2e69dadd19',
]
const FARM_ADDRESS = '0xA6E9069CB055a425Eb41D185b740B22Ec8f51853'

async function getPoolPositionDefinition(
  networkId: NetworkId,
  poolAddress: Address,
): Promise<AppTokenPositionDefinition> {
  const poolTokenContract = {
    address: poolAddress,
    abi: uniswapV2PairAbi,
  } as const
  const [token0Address, token1Address] = await client.multicall({
    contracts: [
      {
        ...poolTokenContract,
        functionName: 'token0',
      },
      {
        ...poolTokenContract,
        functionName: 'token1',
      },
    ],
    allowFailure: false,
  })
  const position: AppTokenPositionDefinition = {
    type: 'app-token-definition',
    networkId,
    address: poolAddress.toLowerCase(),
    tokens: [token0Address, token1Address].map((token) => ({
      address: token.toLowerCase(),
      networkId,
    })),
    displayProps: ({ resolvedTokensByTokenId }) => {
      const token0 =
        resolvedTokensByTokenId[
          getTokenId({
            networkId,
            address: token0Address,
          })
        ]
      const token1 =
        resolvedTokensByTokenId[
          getTokenId({
            networkId,
            address: token1Address,
          })
        ]
      return {
        title: `${token0.symbol} / ${token1.symbol}`,
        description: 'Pool',
        imageUrl: UBESWAP_LOGO,
        manageUrl: 'https://app.ubeswap.org/#/pool',
      }
    },
    pricePerShare: async ({ tokensByTokenId }) => {
      const [[reserve0, reserve1], totalSupply] = await client.multicall({
        contracts: [
          {
            ...poolTokenContract,
            functionName: 'getReserves',
          },
          {
            ...poolTokenContract,
            functionName: 'totalSupply',
          },
        ],
        allowFailure: false,
      })
      const poolToken =
        tokensByTokenId[
          getTokenId({ networkId, isNative: false, address: poolAddress })
        ]
      const token0 =
        tokensByTokenId[
          getTokenId({
            networkId,
            address: token0Address,
          })
        ]
      const token1 =
        tokensByTokenId[
          getTokenId({
            networkId,
            address: token1Address,
          })
        ]
      const reserves = [
        toDecimalNumber(reserve0, token0.decimals),
        toDecimalNumber(reserve1, token1.decimals),
      ]
      const supply = toDecimalNumber(totalSupply, poolToken.decimals)
      const pricePerShare = reserves.map((r) => r.div(supply) as DecimalNumber)
      return pricePerShare
    },
  }

  return position
}

async function getPoolPositionDefinitions(
  networkId: NetworkId,
  address: string,
): Promise<PositionDefinition[]> {
  // Get the pairs from Ubeswap via The Graph
  const response = await got
    .post(
      `https://gateway-arbitrum.network.thegraph.com/api/${process.env.THE_GRAPH_API_KEY}/subgraphs/id/JWDRLCwj4H945xEkbB6eocBSZcYnibqcJPJ8h9davFi`,
      {
        json: {
          query: PAIRS_QUERY,
          variables: {
            address: address.toLowerCase(),
          },
        },
      },
    )
    .json<any>()

  const data = response.data

  if (!response.data) {
    logger.warn({ response }, 'Got an invalid response from thegraph endpoint')
    throw new Error('Failed to get pairs from Ubeswap')
  }

  const pairs: Address[] = (data.user?.liquidityPositions ?? [])
    .filter((position: any) => Number(position.liquidityTokenBalance) > 0)
    .map((position: any) => position.pair.id)

  // Get all positions
  const positions = await Promise.all(
    pairs.map(async (pair) => {
      return getPoolPositionDefinition(networkId, pair)
    }),
  )

  return positions
}

async function fetchIncentiveFullData(
  incentiveId: string,
): Promise<IncentiveDataItem[] | undefined> {
  const resp = (await client.readContract({
    address: FARM_ADDRESS,
    abi: FarmAbi,
    functionName: 'incentives',
    args: [incentiveId],
  })) as (number | string | BigNumber)[]
  const incentiveInfo = {
    currentPeriodId: resp[0],
    lastUpdateTime: resp[1],
    endTime: resp[2],
    numberOfStakes: resp[3],
    distributedRewards: resp[4],
    merkleRoot: resp[5],
    ipfsHash: resp[6],
    excessRewards: resp[7],
    externalRewards: resp[8],
  } as IncentiveContractInfo
  let ipfsHash = incentiveInfo?.ipfsHash
  if (!ipfsHash) {
    return
  }

  let result: IncentiveDataItem[] = []
  if (
    ipfsHash !=
    '0x0000000000000000000000000000000000000000000000000000000000000000'
  ) {
    ipfsHash = ipfsHash.replace(/^0x/, '')
    const cidV0 = new CID(toB58String(hexToUint8Array('1220' + ipfsHash)))
    const cidV1Str = cidV0.toV1().toString()

    const data = await got(IPFS_GATEWAY + cidV1Str + '/data.json').json<any>()
    data.forEach((d: any) => {
      d.tokenId = BigNumber.from(d.tokenId)
      d.accumulatedRewards = BigNumber.from(d.accumulatedRewards)
      d.tvlNative = BigNumber.from(d.tvlNative)
      d.shares = BigNumber.from(d.shares)
    })
    result = data as IncentiveDataItem[]
  }
  return result
}

const fetchStakedTokenIds = async (address: string, incentiveIds: string[]) => {
  const data = (await got('https://interface-gateway.ubeswap.org/v1/graphql', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operationName: 'FarmV3AccountStakes',
      variables: {
        address,
        incentiveIds,
      },
      query: '',
    }),
  }).json()) as { data: { stakes: { tokenId: string }[] } }

  return [
    ...new Set(data.data.stakes.map((s: { tokenId: string }) => s.tokenId)),
  ].map((t) => BigNumber.from(t))
}

// Calculate unclamed rewards for each pool (currently 1, UBE/CELO)
async function getV3FarmPositionDefinitions(
  networkId: NetworkId,
  address: string,
): Promise<PositionDefinition[]> {
  return (
    await Promise.all(
      FARM_POOLS.map(async (pool) => {
        // Get incentive ids for pool
        const incentiveIds = getIncentiveIdsByPool(pool)

        // Get staked tokenIds
        const stakedTokenIds = await fetchStakedTokenIds(address, incentiveIds)

        const inputs = stakedTokenIds.map((tokenId) => [
          incentiveIds[0],
          BigNumber.from(tokenId),
        ])

        if (!inputs.length) {
          return
        }

        // Fetch stakes from Farm contract
        const stakes = (await client.readContract({
          address: FARM_ADDRESS,
          abi: FarmAbi,
          functionName: 'stakes',
          args: inputs[0],
        })) as number[]

        // Cast to StakeInfo type
        const stakeInfos = [
          {
            claimedReward: BigNumber.from(stakes[0]),
            stakeTime: +stakes[1],
            initialSecondsInside: +stakes[2],
          },
        ] as StakeInfo[]

        // Fetch incentive data for UBE
        const fullData = await fetchIncentiveFullData(incentiveIds[0])

        // Get incentive and stake info for each token
        const tokenDatas: TokenData[] = []
        for (let i = 0; i < stakedTokenIds.length; i++) {
          const tokenId = BigNumber.from(stakedTokenIds[i])
          const incentiveData = fullData
            ? fullData.find((d) => tokenId.eq(d.tokenId))
            : undefined
          let stakeInfo
          if (stakeInfos.length === stakedTokenIds.length && stakeInfos[i]) {
            stakeInfo = {
              claimedReward: stakeInfos[i]!.claimedReward,
              stakeTime: stakeInfos[i]!.stakeTime,
              initialSecondsInside: stakeInfos[i]!.initialSecondsInside,
            }
          }
          tokenDatas.push({
            tokenId,
            incentiveData,
            stakeInfo,
          })
        }

        // Calculate unclamed rewards (=accumulated-claimed)
        const unclaimedRewards = tokenDatas
          .filter((d) => d.incentiveData && d.stakeInfo)
          .reduce((acc, curr) => {
            return acc
              .add(curr.incentiveData?.accumulatedRewards || 0)
              .sub(curr.stakeInfo?.claimedReward || 0)
          }, BigNumber.from(0))

        const poolTokenContract = {
          address: pool as `0x{string}`,
          abi: uniswapV2PairAbi,
        } as const
        const [token0Address, token1Address] = await client.multicall({
          contracts: [
            {
              ...poolTokenContract,
              functionName: 'token0',
            },
            {
              ...poolTokenContract,
              functionName: 'token1',
            },
          ],
          allowFailure: false,
        })

        return {
          type: 'contract-position-definition',
          networkId,
          address: FARM_ADDRESS,
          tokens: [token0Address, token1Address].map((token) => ({
            address: token.toLowerCase(),
            networkId,
          })),
          balances: [toDecimalNumber(BigInt(+unclaimedRewards), UBE_DECIMALS)],
          displayProps: ({ resolvedTokensByTokenId }) => {
            const token0 =
              resolvedTokensByTokenId[
                getTokenId({
                  networkId,
                  address: token0Address,
                })
              ]
            const token1 =
              resolvedTokensByTokenId[
                getTokenId({
                  networkId,
                  address: token1Address,
                })
              ]
            return {
              title: `${token0.symbol} / ${token1.symbol} 0.01% Farm`,
              description: 'Staked position',
              imageUrl: UBESWAP_LOGO,
              manageUrl: `https://app.ubeswap.org/#/farmv3/${pool}`,
            }
          },
        } as PositionDefinition
      }),
    )
  ).filter((pd) => !!pd)
}

async function getFarmPositionDefinitions(
  networkId: NetworkId,
  address: string,
): Promise<PositionDefinition[]> {
  // Call balanceOf and totalSupply for each farm stakingAddress
  const data = await client.multicall({
    contracts: farms.flatMap((farm) => [
      {
        address: farm.stakingAddress as Address,
        abi: stakingRewardsAbi,
        functionName: 'balanceOf',
        args: [address as Address],
      },
      {
        address: farm.stakingAddress as Address,
        abi: stakingRewardsAbi,
        functionName: 'totalSupply',
      },
      {
        address: farm.stakingAddress as Address,
        abi: stakingRewardsAbi,
        functionName: 'rewardsToken',
      },
      {
        address: farm.stakingAddress as Address,
        abi: stakingRewardsAbi,
        functionName: 'earned',
        args: [address as Address],
      },
    ]),
    allowFailure: false,
  })

  // Farms for which the user has a balance
  // Note: this captures "single reward" farms,
  // but there are dual and triple reward farms as well
  // which I haven't wrapped my head around yet
  // See https://github.com/Ubeswap/ubeswap-interface/blob/48049267f7160441070ff21ea6c9fedc3a55cfef/src/state/stake/hooks.ts#L144-L171
  const userFarms = farms
    .map((farm, i) => ({
      ...farm,
      balance: data[4 * i] as bigint,
      totalSupply: data[4 * i + 1] as bigint,
      rewardsTokenAddress: data[4 * i + 2] as Address,
      rewardsEarned: data[4 * i + 3] as bigint,
    }))
    .filter((farm) => farm.balance > 0)

  const positions = await Promise.all(
    userFarms.map(async (farm) => {
      const position: ContractPositionDefinition = {
        type: 'contract-position-definition',
        networkId,
        address: farm.stakingAddress.toLowerCase(),
        tokens: [
          { address: farm.lpAddress.toLowerCase(), networkId },
          {
            address: farm.rewardsTokenAddress.toLowerCase(),
            networkId,
            category: 'claimable',
          },
        ],
        displayProps: ({ resolvedTokensByTokenId }) => {
          const poolToken = resolvedTokensByTokenId[
            getTokenId({
              networkId,
              address: farm.lpAddress,
              isNative: false,
            })
          ] as AppTokenPosition
          return {
            title: poolToken.displayProps.title,
            description: 'Farm',
            imageUrl: poolToken.displayProps.imageUrl,
            manageUrl: 'https://app.ubeswap.org/#/earn',
          }
        },
        availableShortcutIds: ['claim-reward'],
        balances: async ({ resolvedTokensByTokenId }) => {
          const poolToken =
            resolvedTokensByTokenId[
              getTokenId({
                address: farm.lpAddress,
                networkId,
                isNative: false,
              })
            ]
          const share = new BigNumberJs(farm.balance.toString()).div(
            farm.totalSupply.toString(),
          )

          const poolContract = {
            address: farm.lpAddress as Address,
            abi: erc20Abi,
          } as const
          const [poolBalance] = await client.multicall({
            contracts: [
              {
                ...poolContract,
                functionName: 'balanceOf',
                args: [farm.stakingAddress as Address],
              },
            ],
            allowFailure: false,
          })

          const balance = share.times(
            toDecimalNumber(poolBalance, poolToken.decimals),
          ) as DecimalNumber

          const rewardsTokenId = getTokenId({
            address: farm.rewardsTokenAddress,
            networkId,
          })
          const rewardsToken = resolvedTokensByTokenId[rewardsTokenId]
          const rewardsBalance = toDecimalNumber(
            farm.rewardsEarned,
            rewardsToken.decimals,
          )

          return [balance, rewardsBalance]
        },
      }

      return position
    }),
  )

  return positions
}

const UBESWAP_V3_NFT_MANAGER = '0x897387c7b996485c3aaa85c94272cd6c506f8c8f'
const UBESWAP_V3_FACTORY = '0x67FEa58D5a5a4162cED847E13c2c81c73bf8aeC4'
const UNI_V3_MULTICALL = '0xDD1dC48fEA48B3DE667dD3595624d5af4Fb04694'

async function getV3Positions(networkId: NetworkId, address: Address) {
  return getUniswapV3PositionDefinitions(
    networkId,
    address as Address,
    UNI_V3_MULTICALL,
    UBESWAP_V3_NFT_MANAGER,
    UBESWAP_V3_FACTORY,
    UBESWAP_LOGO,
  )
}

const hook: PositionsHook = {
  getInfo() {
    return {
      name: 'Ubeswap',
    }
  },
  async getPositionDefinitions({ networkId, address }) {
    if (networkId !== NetworkId['celo-mainnet'] || !address) {
      // dapp is only on Celo, and implementation is hardcoded to Celo mainnet (contract addresses in particular)
      return []
    }
    const [poolDefinitions, farmDefinitions, v3FarmDefinitions, v3Definitions] =
      await Promise.all([
        getPoolPositionDefinitions(networkId, address),
        getFarmPositionDefinitions(networkId, address),
        getV3FarmPositionDefinitions(networkId, address),
        getV3Positions(networkId, address as Address),
      ])

    return [
      ...poolDefinitions,
      ...farmDefinitions,
      ...v3FarmDefinitions,
      ...v3Definitions,
    ]
  },
  getAppTokenDefinition({ networkId, address }: TokenDefinition) {
    // Assume that the address is a pool address
    return getPoolPositionDefinition(networkId, address as Address)
  },
}

export default hook
