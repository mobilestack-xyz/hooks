import { Address } from 'viem'
import { logger } from '../../log'
import { getClient } from '../../runtime/client'
import { getTokenId } from '../../runtime/getTokenId'
import { toDecimalNumber } from '../../types/numbers'
import {
  PositionDefinition,
  PositionsHook,
  PricePerShareContext,
  UnknownAppTokenError,
} from '../../types/positions'
import { cellarV0821Abi } from './abis/cellar'
import { getSommStrategiesData } from './api'

const hook: PositionsHook = {
  getInfo() {
    return {
      name: 'Somm',
    }
  },
  async getPositionDefinitions({ networkId, address }) {
    const client = getClient(networkId)
    const cellars = await getSommStrategiesData(networkId)
    const positionDefinitions: PositionDefinition[] = []

    const results = await Promise.allSettled(
      cellars.map(async (cellar) => {
        // Note that according to the hard coded config in the Somm website
        // source code
        // https://github.com/PeggyJV/sommelier-strangelove/blob/ca7bd6605bc868a1393d820f13b341ae5a5f1ead/src/utils/config.ts,
        // cellars implement one of 4 ABIs (CellarV0816, CellarV0821,
        // CellarV0821MultiDeposit, CellarV0815). All of these ABIs have the
        // 'asset', 'symbol', and 'name' functions so for simplicity, we are
        // using the CellarV0821 ABI for all cellars in the below rpc calls.
        if (address) {
          const balance = await client.readContract({
            address: cellar.address,
            abi: cellarV0821Abi,
            functionName: 'balanceOf',
            args: [address as Address],
          })

          if (balance === 0n) {
            // Only return positions with a non-zero balance when an address is provided
            return null
          }
        }

        const [underlyingAsset, underlyingAssetSymbol, cellarName] =
          await Promise.all([
            client.readContract({
              address: cellar.address,
              abi: cellarV0821Abi,
              functionName: 'asset',
            }),
            client.readContract({
              address: cellar.address,
              abi: cellarV0821Abi,
              functionName: 'symbol',
            }),
            client.readContract({
              address: cellar.address,
              abi: cellarV0821Abi,
              functionName: 'name',
            }),
          ])

        return {
          type: 'app-token-definition' as const,
          pricePerShare: async ({ tokensByTokenId }: PricePerShareContext) => {
            const tokenId = getTokenId({
              address: cellar.address,
              networkId,
            })
            const { decimals } = tokensByTokenId[tokenId]
            return [toDecimalNumber(BigInt(cellar.shareValue), decimals)]
          },
          networkId,
          address: cellar.address,
          tokens: [
            {
              address: underlyingAsset.toLowerCase(),
              networkId,
            },
          ],
          displayProps: () => {
            return {
              title: cellarName,
              description: `${underlyingAssetSymbol}${
                cellar.apy !== undefined
                  ? ` (APY: ${cellar.apy.toFixed(2)}%)`
                  : ''
              }`,
              imageUrl:
                'https://raw.githubusercontent.com/mobilestack-xyz/hooks/main/src/apps/somm/assets/somm.png',
              manageUrl: cellar.strategySlug
                ? `https://app.somm.finance/strategies/${cellar.strategySlug}/manage`
                : undefined,
            }
          },
        }
      }),
    )

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        if (result.value) {
          positionDefinitions.push(result.value)
        }
      } else {
        logger.error(
          {
            error: result.reason,
          },
          'Skipping Somm position that failed to resolve',
        )
      }
    })

    return positionDefinitions
  },
  async getAppTokenDefinition({ networkId, address }) {
    throw new UnknownAppTokenError({ networkId, address })
  },
}

export default hook
