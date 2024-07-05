import { Address } from 'viem'
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
import {
  compoundMulticallAbi,
  compoundMulticallBytecode,
} from './abis/compound-multicall'

// Data from https://docs.compound.finance/
const MARKETS: { networkId: NetworkId; address: Address }[] = [
  {
    // USDC
    networkId: NetworkId['op-mainnet'],
    address: '0x2e44e174f7D53F0212823acC11C01A11d58c5bCB',
  },
  {
    // USDT
    networkId: NetworkId['op-mainnet'],
    address: '0x995E394b8B2437aC8Ce61Ee0bC610D617962B214',
  },
  {
    // USDC
    networkId: NetworkId['ethereum-mainnet'],
    address: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
  },
  {
    // WETH
    networkId: NetworkId['ethereum-mainnet'],
    address: '0xA17581A9E3356d9A858b789D68B4d866e593aE94',
  },
  {
    // USDC
    networkId: NetworkId['arbitrum-one'],
    address: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
  },
  {
    // WETH
    networkId: NetworkId['arbitrum-one'],
    address: '0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486',
  },
  {
    // USDT
    networkId: NetworkId['arbitrum-one'],
    address: '0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07',
  },
]

const hook: PositionsHook = {
  getInfo() {
    return {
      id: 'compound',
      name: 'Compound',
      description: 'Compound markets',
    }
  },
  async getPositionDefinitions(
    networkId: NetworkId,
    address: Address | undefined,
  ) {
    const markets = MARKETS.filter((market) => market.networkId === networkId)
    if (!markets.length || !address) {
      return []
    }

    const client = getClient(networkId)

    const results = await Promise.all(
      markets.map((market) =>
        client.readContract({
          code: compoundMulticallBytecode,
          abi: compoundMulticallAbi,
          functionName: 'getUserPositions',
          args: [address, market.address],
        }),
      ),
    )

    return results.flatMap(
      ([baseToken, baseTokenBalance, borrowBalance, collaterals], index) => {
        const balances: {
          token: Address
          market: Address
          balance: bigint
          type: string
        }[] = []

        if (baseTokenBalance > 0n) {
          balances.push({
            token: baseToken,
            market: markets[index].address,
            balance: baseTokenBalance,
            type: 'Supply',
          })
        }
        if (borrowBalance > 0n) {
          balances.push({
            token: baseToken,
            market: markets[index].address,
            balance: -borrowBalance,
            type: 'Debt',
          })
        }
        for (const collateral of collaterals) {
          balances.push({
            token: collateral.asset,
            market: markets[index].address,
            balance: collateral.balance,
            type: 'Collateral',
          })
        }

        const positions: ContractPositionDefinition[] = []

        for (const { token, balance, market, type } of balances) {
          if (balance === 0n) {
            continue
          }
          positions.push({
            type: 'contract-position-definition',
            networkId,
            address: `${market.toLowerCase()}-${token.toLowerCase()}-${type}`,
            tokens: [
              {
                address: token.toLowerCase(),
                networkId,
              },
            ],
            displayProps: ({ resolvedTokensByTokenId }) => {
              const baseTokenDescription =
                resolvedTokensByTokenId[
                  getTokenId({
                    networkId,
                    address: baseToken,
                  })
                ]
              const tokenDescription =
                resolvedTokensByTokenId[
                  getTokenId({
                    networkId,
                    address: token,
                  })
                ]
              return {
                title: `${tokenDescription.symbol} ${type}`,
                description: `${baseTokenDescription.symbol} Market`,
                imageUrl:
                  // TODO: Update the image url once PR is merged.
                  'https://raw.githubusercontent.com/valora-inc/dapp-list/27afcdc8779d2e9eb6897372e18c88e41b2e6df1/assets/compound.png',
              }
            },
            balances: async ({ resolvedTokensByTokenId }) => {
              const decimals =
                resolvedTokensByTokenId[
                  getTokenId({
                    networkId,
                    address: token,
                  })
                ].decimals
              return [toDecimalNumber(balance, decimals)]
            },
          })
        }

        return positions
      },
    )
  },
  async getAppTokenDefinition({ networkId, address }: TokenDefinition) {
    throw new UnknownAppTokenError({ networkId, address })
  },
}

export default hook
