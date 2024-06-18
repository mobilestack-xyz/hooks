import { Address } from 'viem'
import { getClient } from '../../runtime/client'
import { getTokenId } from '../../runtime/getTokenId'
import { NetworkId } from '../../types/networkId'
import { toDecimalNumber } from '../../types/numbers'
import {
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
  [NetworkId['ethereum-sepolia']]: undefined,
  [NetworkId['arbitrum-sepolia']]: undefined,
  [NetworkId['op-sepolia']]: undefined,
  [NetworkId['celo-alfajores']]: undefined,
}

const hook: PositionsHook = {
  getInfo() {
    return {
      id: 'uniswap',
      name: 'Uniswap',
      description: 'Uniswap pools',
    }
  },
  async getPositionDefinitions(networkId, address) {
    const addresses = UNI_V3_ADDRESSES_BY_NETWORK_ID[networkId]
    if (!addresses || !address) {
      return []
    }
    const { factory, nftPositions, userPositionsMulticall } = addresses

    const client = getClient(networkId)
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
            imageUrl:
              'https://raw.githubusercontent.com/valora-inc/dapp-list/ab12ab234b4a6e01eff599c6bd0b7d5b44d6f39d/assets/uniswap.png',
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
  },
  async getAppTokenDefinition({ networkId, address }: TokenDefinition) {
    throw new UnknownAppTokenError({ networkId, address })
  },
}

export default hook
