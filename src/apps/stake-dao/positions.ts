import {
  AppTokenPosition,
  ContractPositionDefinition,
  PositionDefinition,
  PositionsHook,
  UnknownAppTokenError,
} from '../../types/positions'
import { NetworkId } from '../../types/networkId'
import { getClient } from '../../runtime/client'
import { stakeDaoVaultAbi } from './abis/stakeDaoVault'
import { Address, zeroAddress } from 'viem'
import { stakeDaoGaugeAbi } from './abis/stakeDaoGauge'
import { toDecimalNumber } from '../../types/numbers'
import { getTokenId } from '../../runtime/getTokenId'

// Each vault has a corresponding gauge contract
// Unfortunately there's no API yet or public list consumable programmatically
// So we have to hardcode the addresses for now
// Though I asked on their discord (2024-06-19) and an SDK/API is in the works.
const SD_VAULT_ADDRESSES_BY_NETWORK_ID: Record<NetworkId, Address[]> = {
  [NetworkId['celo-mainnet']]: [],
  [NetworkId['celo-alfajores']]: [],
  [NetworkId['ethereum-mainnet']]: [],
  [NetworkId['ethereum-sepolia']]: [],
  [NetworkId['arbitrum-one']]: [
    '0xf82dc74d73bd2e4274fbd087fecb7720f02c3abc',
    '0x37264bfe5cdbac34177d5a4833f07a7cf81d0543',
    '0x68ef2cf45cfc155ca5431956f25d7b8c496127bb',
    '0x0dbd661c988f9a28095ca200a683a082505f441e',
    '0x9bc3c06eb36cf8b942da1b619969759a277631e0',
    '0xe331847f990fe68fee41fdb06da307ba67198a83',
    '0x0f958528718b625c3aebd305dd2917a37570c56a',
    '0xd9f0d304c45df6f61e45e20481c8d50b9844d8fc',
    '0xd11f22a5e25462a43efaa6faaee9e620fa420f49',
    '0x897ab1f979ad31e49dbc9ef8df517b2945a53705',
    '0x61b7986dd9f1c41747b494680be1d7ef54265d6c',
    '0xea13469e4d44246bb84ee8765ba5bd70d9f87729',
    '0x3690d81b426ab51e31265f366b668849652aac45',
    '0x1d0333263c4837900d1bd7ab9b27cf652ffeb3b4',
  ],
  [NetworkId['arbitrum-sepolia']]: [],
  [NetworkId['op-mainnet']]: [],
  [NetworkId['op-sepolia']]: [],
  [NetworkId['polygon-pos-mainnet']]: [],
  [NetworkId['polygon-pos-amoy']]: [],
  [NetworkId['base-mainnet']]: [],
  [NetworkId['base-sepolia']]: [],
}

async function getVaultPositionDefinitions(
  networkId: NetworkId,
  address: Address | undefined,
): Promise<PositionDefinition[]> {
  const client = getClient(networkId, 'stake-dao')

  const vaultAddresses = SD_VAULT_ADDRESSES_BY_NETWORK_ID[networkId]
  const vaultsData = await client.multicall({
    contracts: vaultAddresses.flatMap((vaultAddress) => [
      {
        address: vaultAddress,
        abi: stakeDaoVaultAbi,
        functionName: 'token',
      },
      {
        address: vaultAddress,
        abi: stakeDaoVaultAbi,
        functionName: 'sdGauge',
      },
    ]),
    allowFailure: false,
  })

  const vaults = vaultAddresses.map((address, i) => ({
    address,
    lpTokenAddress: (vaultsData[2 * i] as Address).toLowerCase() as Address,
    sdGaugeAddress: (vaultsData[2 * i + 1] as Address).toLowerCase() as Address,
  }))

  // Call balanceOf and totalSupply for each gauge
  const gaugesData = await client.multicall({
    contracts: vaults.flatMap((vault) => [
      {
        address: vault.sdGaugeAddress,
        abi: stakeDaoGaugeAbi,
        functionName: 'balanceOf',
        args: [address ?? zeroAddress],
      },
      {
        address: vault.sdGaugeAddress,
        abi: stakeDaoGaugeAbi,
        functionName: 'totalSupply',
      },
      {
        address: vault.sdGaugeAddress,
        abi: stakeDaoGaugeAbi,
        functionName: 'decimals',
      },
    ]),
    allowFailure: false,
  })

  const consideredVaults = vaults
    .map((vault, i) => ({
      ...vault,
      sdGauge: {
        // When no address is provided, use 0n (in case zeroAddress has a balance)
        balance: address ? (gaugesData[3 * i] as bigint) : 0n,
        totalSupply: gaugesData[3 * i + 1] as bigint,
        decimals: gaugesData[3 * i + 2] as bigint,
      },
    }))
    .filter((vault) => (address ? vault.sdGauge.balance > 0 : true))

  const positions = await Promise.all(
    consideredVaults.map(async (vault) => {
      const position: ContractPositionDefinition = {
        type: 'contract-position-definition',
        networkId,
        address: vault.sdGaugeAddress,
        tokens: [
          { address: vault.lpTokenAddress, networkId },
          // TODO: Add reward tokens
        ],
        displayProps: ({ resolvedTokensByTokenId }) => {
          const poolToken = resolvedTokensByTokenId[
            getTokenId({
              networkId,
              address: vault.lpTokenAddress,
              isNative: false,
            })
          ] as AppTokenPosition
          return {
            // Fallback until we have proper inter-app dependencies working
            title: poolToken.displayProps?.title || poolToken.symbol,
            description: 'Strategy',
            imageUrl:
              'https://raw.githubusercontent.com/valora-inc/dapp-list/main/assets/stake-dao.png',
            manageUrl: 'https://www.stakedao.org/yield',
          }
        },
        balances: async () => {
          return [
            toDecimalNumber(
              vault.sdGauge.balance,
              Number(vault.sdGauge.decimals),
            ),
          ]
        },
      }

      return position
    }),
  )

  return positions
}

const hook: PositionsHook = {
  getInfo() {
    return {
      name: 'Stake DAO',
    }
  },
  async getPositionDefinitions({ networkId, address }) {
    return await getVaultPositionDefinitions(
      networkId,
      address ? (address as Address) : undefined,
    )
  },
  async getAppTokenDefinition({ networkId, address }) {
    throw new UnknownAppTokenError({ networkId, address })
  },
}

export default hook
