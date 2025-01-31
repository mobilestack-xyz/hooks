import { Address, PublicClient } from 'viem'
import { getClient } from '../../runtime/client'
import { getTokenId } from '../../runtime/getTokenId'
import { NetworkId } from '../../types/networkId'
import { toDecimalNumber } from '../../types/numbers'
import {
  ContractPositionDefinition,
  PositionsHook,
  TokenDefinition,
  UnknownAppTokenError,
} from '../../types/positions'
import { userPositionsAbi } from './abis/user-positions'

const UNI_V3_ADDRESSES_BY_NETWORK_ID: {
  [networkId in NetworkId]:
    | {
        factory: Address
        nftPositions: Address
        // Custom read-only contract. Code:
        // https://github.com/celo-tracker/celo-tracker-contracts/blob/main/contracts/multicall/UniV3UserPositionsMulticall.sol
        userPositionsMulticall: Address
      }
    | undefined
} = {
  // polygon not enabled yet
  // [NetworkId.polygon]: {
  //   factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  //   nftPositions: '0xc36442b4a4522e871399cd717abdd847ab11fe88',
  //   userPositionsMulticall: '',
  // },
  [NetworkId['celo-mainnet']]: {
    factory: '0xAfE208a311B21f13EF87E33A90049fC17A7acDEc',
    nftPositions: '0x3d79EdAaBC0EaB6F08ED885C05Fc0B014290D95A',
    userPositionsMulticall: '0xDD1dC48fEA48B3DE667dD3595624d5af4Fb04694',
  },
  [NetworkId['arbitrum-one']]: {
    factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    nftPositions: '0xc36442b4a4522e871399cd717abdd847ab11fe88',
    userPositionsMulticall: '0xd3E0fd14a7d2a2f0E89D99bfc004eAcccfbEB2C1',
  },
  [NetworkId['op-mainnet']]: {
    factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    nftPositions: '0xc36442b4a4522e871399cd717abdd847ab11fe88',
    userPositionsMulticall: '0xd3E0fd14a7d2a2f0E89D99bfc004eAcccfbEB2C1',
  },
  [NetworkId['ethereum-mainnet']]: {
    factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    nftPositions: '0xc36442b4a4522e871399cd717abdd847ab11fe88',
    userPositionsMulticall: '0xd983fe1235a4c9006ef65eceed7c33069ad35ad0',
  },
  [NetworkId['polygon-pos-mainnet']]: undefined, // TODO: ask Gonza to deploy the multicall
  [NetworkId['base-mainnet']]: undefined, // TODO: ask Gonza to deploy the multicall

  [NetworkId['ethereum-sepolia']]: undefined,
  [NetworkId['arbitrum-sepolia']]: undefined,
  [NetworkId['op-sepolia']]: undefined,
  [NetworkId['celo-alfajores']]: undefined,
  [NetworkId['polygon-pos-amoy']]: undefined,
  [NetworkId['base-sepolia']]: undefined,
}

const UNISWAP_NETWORK_NAME: Partial<Record<NetworkId, string>> = {
  [NetworkId['ethereum-mainnet']]: 'ethereum',
  [NetworkId['op-mainnet']]: 'optimism',
  [NetworkId['polygon-pos-mainnet']]: 'polygon',
  [NetworkId['base-mainnet']]: 'base',
  [NetworkId['arbitrum-one']]: 'arbitrum',
  [NetworkId['celo-mainnet']]: 'celo',
}

export async function getUniswapV3PositionDefinitions(
  networkId: NetworkId,
  address: Address,
  userPositionsMulticall: Address,
  nftPositions: Address,
  factory: Address,
  imageUrl: string = 'https://raw.githubusercontent.com/valora-inc/dapp-list/ab12ab234b4a6e01eff599c6bd0b7d5b44d6f39d/assets/uniswap.png',
  client?: PublicClient,
): Promise<ContractPositionDefinition[]> {
  if (!client) {
    client = getClient(networkId, 'uniswap')
  }
  const userPools = await client.readContract({
    abi: userPositionsAbi,
    address: userPositionsMulticall,
    functionName: 'getPositions',
    args: [nftPositions, factory, address as Address],
  })

  return userPools
    .map((pool) => ({
      ...pool,
      token0: pool.token0.toLowerCase(),
      token1: pool.token1.toLowerCase(),
    }))
    .filter((pool) => pool.liquidity > 0)
    .map((pool) => {
      return {
        type: 'contract-position-definition',
        networkId,
        address: pool.poolAddress,
        extraId: pool.tokenId.toString(),
        tokens: [
          { address: pool.token0, networkId },
          { address: pool.token1, networkId },
        ],
        displayProps: ({ resolvedTokensByTokenId }) => ({
          title: `${
            resolvedTokensByTokenId[
              getTokenId({
                address: pool.token0,
                networkId,
              })
            ].symbol
          } / ${
            resolvedTokensByTokenId[
              getTokenId({
                address: pool.token1,
                networkId,
              })
            ].symbol
          }`,
          description: 'Pool',
          imageUrl,
          manageUrl: UNISWAP_NETWORK_NAME[networkId]
            ? `https://app.uniswap.org/explore/pools/${UNISWAP_NETWORK_NAME[networkId]}/${pool.poolAddress}`
            : undefined,
        }),
        balances: async ({ resolvedTokensByTokenId }) => {
          const token0Decimals =
            resolvedTokensByTokenId[
              getTokenId({
                address: pool.token0,
                networkId,
              })
            ].decimals
          const token1Decimals =
            resolvedTokensByTokenId[
              getTokenId({
                address: pool.token1,
                networkId,
              })
            ].decimals
          return [
            toDecimalNumber(pool.amount0, token0Decimals),
            toDecimalNumber(pool.amount1, token1Decimals),
          ]
        },
      }
    })
}

const hook: PositionsHook = {
  getInfo() {
    return {
      name: 'Uniswap',
    }
  },
  async getPositionDefinitions({ networkId, address }) {
    const addresses = UNI_V3_ADDRESSES_BY_NETWORK_ID[networkId]
    if (!addresses || !address) {
      return []
    }
    const { factory, nftPositions, userPositionsMulticall } = addresses
    return getUniswapV3PositionDefinitions(
      networkId,
      address as Address,
      userPositionsMulticall,
      nftPositions,
      factory,
    )
  },
  async getAppTokenDefinition({ networkId, address }: TokenDefinition) {
    throw new UnknownAppTokenError({ networkId, address })
  },
}

export default hook
