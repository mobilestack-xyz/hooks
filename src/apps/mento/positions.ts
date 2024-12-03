import {
  PositionsHook,
  ContractPositionDefinition,
} from '../../types/positions'
import { Address } from 'viem'
import { toDecimalNumber } from '../../types/numbers'
import { NetworkId } from '../../types/networkId'
import { getClient } from '../../runtime/client'
import { getTokenId } from '../../runtime/getTokenId'
import { lockingAbi } from './abis/locking'

const VE_MENTO_ADDRESS_BY_NETWORK_ID: {
  [networkId: string]: Address | undefined
} = {
  [NetworkId['celo-mainnet']]: '0x001bb66636dcd149a1a2ba8c50e408bddd80279c',
  [NetworkId['celo-alfajores']]: '0x537cae97c588c6da64a385817f3d3563ddcf0591',
}

async function getVeMentoPositionDefinition(
  networkId: NetworkId,
  address: Address,
): Promise<ContractPositionDefinition | undefined> {
  const veMentoAddress = VE_MENTO_ADDRESS_BY_NETWORK_ID[networkId]
  if (!veMentoAddress) {
    return undefined
  }

  const client = getClient(networkId)
  const [mentoTokenAddress, decimals, locked, balance] = await client.multicall(
    {
      contracts: [
        {
          address: veMentoAddress,
          abi: lockingAbi,
          functionName: 'token',
          args: [],
        },
        {
          address: veMentoAddress,
          abi: lockingAbi,
          functionName: 'decimals',
          args: [],
        },
        {
          address: veMentoAddress,
          abi: lockingAbi,
          functionName: 'locked',
          args: [address],
        },
        {
          address: veMentoAddress,
          abi: lockingAbi,
          functionName: 'balanceOf',
          args: [address],
        },
      ],
      allowFailure: false,
    },
  )

  if (locked === 0n) {
    return undefined
  }

  const position: ContractPositionDefinition = {
    type: 'contract-position-definition',
    networkId,
    address: veMentoAddress,
    tokens: [{ address: mentoTokenAddress, networkId }],
    displayProps: {
      title: 'veMENTO',
      description: `Voting power: ${toDecimalNumber(balance, decimals).toFormat(
        2,
      )}`,
      imageUrl:
        'https://raw.githubusercontent.com/mobilestack-xyz/hooks/main/src/apps/mento/assets/veMENTO.png',
      manageUrl: undefined,
    },
    balances: async ({ resolvedTokensByTokenId }) => {
      const token =
        resolvedTokensByTokenId[
          getTokenId({
            address: mentoTokenAddress,
            networkId,
          })
        ]

      return [toDecimalNumber(locked, token.decimals)]
    },
  }

  return position
}

const hook: PositionsHook = {
  getInfo() {
    return {
      id: 'mento',
      name: 'Mento',
      description: '',
    }
  },
  async getPositionDefinitions({ networkId, address }) {
    if (!address) {
      return []
    }

    const positions = await Promise.all([
      getVeMentoPositionDefinition(networkId, address as Address),
    ])
    return positions.filter(
      (p): p is Exclude<typeof p, null | undefined> => p != null,
    )
  },
}

export default hook
