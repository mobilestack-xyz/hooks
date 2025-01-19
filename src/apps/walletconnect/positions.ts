import {
  PositionsHook,
  ContractPositionDefinition,
} from '../../types/positions'
import { Address } from 'viem'
import { toDecimalNumber } from '../../types/numbers'
import { NetworkId } from '../../types/networkId'
import { getClient } from '../../runtime/client'
import { getTokenId } from '../../runtime/getTokenId'
import { stakingAbi } from './abis/staking'
import { TFunction } from 'i18next'

const WCT_STAKING_CONFIG_BY_NETWORK_ID: {
  [networkId: string]:
    | {
        stakingAddress: Address
        tokenAddress: Address
      }
    | undefined
} = {
  [NetworkId['op-mainnet']]: {
    stakingAddress: '0x521b4c065bbdbe3e20b3727340730936912dfa46',
    tokenAddress: '0xef4461891dfb3ac8572ccf7c794664a8dd927945',
  },
}

async function getStakedWctPositionDefinition(
  networkId: NetworkId,
  address: Address,
  t: TFunction<'translation', undefined>,
): Promise<ContractPositionDefinition | undefined> {
  const wctStakingConfig = WCT_STAKING_CONFIG_BY_NETWORK_ID[networkId]
  if (!wctStakingConfig) {
    return undefined
  }

  const client = getClient(networkId, 'walletconnect')
  const locks = await client.readContract({
    address: wctStakingConfig.stakingAddress,
    abi: stakingAbi,
    functionName: 'locks',
    args: [address],
  })

  if (locks.amount === 0n) {
    return undefined
  }

  const position: ContractPositionDefinition = {
    type: 'contract-position-definition',
    networkId,
    address: wctStakingConfig.stakingAddress,
    tokens: [{ address: wctStakingConfig.tokenAddress, networkId }],
    displayProps: ({ resolvedTokensByTokenId }) => {
      const token =
        resolvedTokensByTokenId[
          getTokenId({
            address: wctStakingConfig.tokenAddress,
            networkId,
          })
        ]
      return {
        title: t('walletconnect.stakedWct.title'),
        description: t('walletconnect.stakedWct.description', {
          amount: toDecimalNumber(locks.amount, token.decimals).toFormat(2),
          date: new Date(Number(locks.end * 1000n)).toLocaleDateString(
            undefined,
            {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            },
          ),
        }),
        imageUrl:
          'https://raw.githubusercontent.com/valora-inc/address-metadata/main/assets/tokens/WCT.png',
        manageUrl: 'https://profile.walletconnect.network',
      }
    },
    balances: async ({ resolvedTokensByTokenId }) => {
      const token =
        resolvedTokensByTokenId[
          getTokenId({
            address: wctStakingConfig.tokenAddress,
            networkId,
          })
        ]

      return [toDecimalNumber(locks.amount, token.decimals)]
    },
  }

  return position
}

const hook: PositionsHook = {
  getInfo() {
    return {
      name: 'WalletConnect',
    }
  },
  async getPositionDefinitions({ networkId, address, t }) {
    if (!address) {
      return []
    }

    const position = await getStakedWctPositionDefinition(
      networkId,
      address as Address,
      t,
    )
    return position ? [position] : []
  },
}

export default hook
