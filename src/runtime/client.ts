import {
  Chain,
  createPublicClient,
  http,
  HttpTransport,
  HttpTransportConfig,
  PublicClient,
} from 'viem'
import {
  arbitrum,
  arbitrumSepolia,
  celo,
  celoAlfajores,
  mainnet,
  optimism,
  optimismSepolia,
  sepolia,
  polygon,
  polygonAmoy,
  base,
  baseSepolia,
} from 'viem/chains'
import { NetworkId } from '../types/networkId'
import { getConfig } from '../config'
import { metrics } from '../metrics'
import { logger } from '../log'

const MULTICALL_ADDRESS = '0XCA11BDE05977B3631167028862BE2A173976CA11'

const networkIdToViemChain: Record<NetworkId, Chain> = {
  [NetworkId['celo-mainnet']]: celo,
  [NetworkId['ethereum-mainnet']]: mainnet,
  [NetworkId['arbitrum-one']]: arbitrum,
  [NetworkId['op-mainnet']]: optimism,
  [NetworkId['celo-alfajores']]: celoAlfajores,
  [NetworkId['ethereum-sepolia']]: sepolia,
  [NetworkId['arbitrum-sepolia']]: arbitrumSepolia,
  [NetworkId['op-sepolia']]: optimismSepolia,
  [NetworkId['polygon-pos-mainnet']]: polygon,
  [NetworkId['polygon-pos-amoy']]: polygonAmoy,
  [NetworkId['base-mainnet']]: base,
  [NetworkId['base-sepolia']]: baseSepolia,
}

const clientsCache = new Map<
  NetworkId,
  PublicClient<ReturnType<typeof http>, Chain> | undefined
>()

export function getClient(
  networkId: NetworkId,
  appName?: string,
): PublicClient<ReturnType<typeof http>, Chain> {
  let client = clientsCache.get(networkId)
  if (client) {
    return client
  }

  const rpcUrl = getConfig().NETWORK_ID_TO_RPC_URL[networkId]
  function loggingHttpTransport(
    url?: string,
    config: HttpTransportConfig = {},
  ): HttpTransport {
    return http(url, {
      onFetchRequest: async (request) => {
        const body = await request.json()
        metrics.updateNetwork(networkId)
        if (appName) {
          metrics.updateApp(appName)
        }
        let  message = `${networkId}: `
        message += appName ? `[${appName}] ` : ''
        message += `Call to ${body.params[0].to}`
        if (body.params[0].to.toUpperCase() === MULTICALL_ADDRESS) {
          message += `(multicall) `
        }
        console.log(message)
        logger.trace({ msg: message })
        metrics.save()
      },
      ...config,
    })
  }

  client = createPublicClient({
    chain: networkIdToViemChain[networkId],
    transport: loggingHttpTransport(rpcUrl),
    // This enables call batching via multicall
    // meaning client.call, client.readContract, etc. will batch calls (using multicall)
    // when the promises are scheduled in the same event loop tick (or within `wait` ms)
    // for instance when Promise.all is used
    // Note: directly calling multiple client.multicall won't batch, they are sent separately
    // See https://viem.sh/docs/clients/public.html#eth_call-aggregation-via-multicall
    batch: {
      multicall: {
        wait: 0,
      },
    },
  })
  clientsCache.set(networkId, client)
  return client
}
