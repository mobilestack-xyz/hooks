import got from '../../utils/got'
import { NetworkId } from '../../types/networkId'
import { Address } from 'viem'
import { LRUCache } from 'lru-cache'

type SupportedAllbridgeChainSymbols =
  | 'ETH'
  | 'CEL'
  | 'POL'
  | 'ARB'
  | 'OPT'
  | 'BAS'

const NETWORK_ID_TO_ALLBRIDGE_BLOCKCHAIN_SYMBOL: Record<
  NetworkId,
  SupportedAllbridgeChainSymbols | undefined
> = {
  [NetworkId['ethereum-mainnet']]: 'ETH',
  [NetworkId['ethereum-sepolia']]: undefined,
  [NetworkId['celo-mainnet']]: 'CEL',
  [NetworkId['celo-alfajores']]: undefined,
  [NetworkId['polygon-pos-mainnet']]: 'POL',
  [NetworkId['polygon-pos-amoy']]: undefined,
  [NetworkId['arbitrum-one']]: 'ARB',
  [NetworkId['arbitrum-sepolia']]: undefined,
  [NetworkId['op-mainnet']]: 'OPT',
  [NetworkId['op-sepolia']]: undefined,
  [NetworkId['base-mainnet']]: 'BAS',
  [NetworkId['base-sepolia']]: undefined,
}

type AllbridgeApiResponse = {
  [key in SupportedAllbridgeChainSymbols]: NetworkInfo
}

interface TokenInfo {
  name: string
  poolAddress: Address
  tokenAddress: Address
  decimals: number
  symbol: string
  poolInfo: PoolInfo
  feeShare: string
  apr: string
  apr7d: string
  apr30d: string
  lpRate: string
}

interface PoolInfo {
  aValue: string
  dValue: string
  tokenBalance: string
  vUsdBalance: string
  totalLpAmount: string
  accRewardPerShareP: string
  p: number
}

interface TransferTime {
  allbridge: number
  wormhole: number
  cctp: number | null
}

interface TxCostAmount {
  swap: string
  transfer: string
  maxAmount: string
}

interface NetworkInfo {
  tokens: TokenInfo[]
  chainId: number
  bridgeAddress: Address
  swapAddress: Address
  transferTime: Record<SupportedAllbridgeChainSymbols, TransferTime>
  confirmations: number
  txCostAmount: TxCostAmount
}

const cache = new LRUCache({
  max: 1,
  // In milliseconds
  ttl: 10 * 60 * 1000,
})

const TOKEN_INFO_RESPONSE_KEY =
  'https://core.api.allbridgecoreapi.net/token-info'

export async function getAllbridgeTokenInfo({
  networkId,
}: {
  networkId: NetworkId
}): Promise<NetworkInfo | undefined> {
  let allbridgeTokensInfoResponse = cache.get(
    TOKEN_INFO_RESPONSE_KEY,
  ) as AllbridgeApiResponse
  if (!allbridgeTokensInfoResponse) {
    allbridgeTokensInfoResponse = await got
      .get('https://core.api.allbridgecoreapi.net/token-info')
      .json()
    cache.set(TOKEN_INFO_RESPONSE_KEY, allbridgeTokensInfoResponse)
  }

  const allbridgeBlockchain =
    NETWORK_ID_TO_ALLBRIDGE_BLOCKCHAIN_SYMBOL[networkId]
  return allbridgeBlockchain
    ? allbridgeTokensInfoResponse[allbridgeBlockchain]
    : undefined
}
