import { z } from 'zod'
import {
  tokenAmountWithMetadata,
  Transaction,
  TriggerOutputShape,
} from '../types/shortcuts'
import { EvmContractCall, Hook as SquidHook } from '@0xsquid/squid-types'
import { NetworkId } from '../types/networkId'
import {
  Address,
  encodeFunctionData,
  erc20Abi,
  parseUnits,
  zeroAddress,
} from 'viem'
import { logger } from '../log'
import { getConfig } from '../config'
import got from './got'
import { HTTPError } from 'got'
import { getClient } from '../runtime/client'
import { SwapTransaction } from '../types/swaps'

type GetSwapQuoteResponse = {
  unvalidatedSwapTransaction?: SwapTransaction
  details: {
    swapProvider?: string
  }
  errors: {
    provider: string
    error: {
      message: string
      details: unknown
    }
  }[]
}

export async function prepareSwapTransactions({
  swapFromToken,
  postHook,
  swapToTokenAddress,
  networkId,
  walletAddress,
  enableAppFee,
}: {
  swapFromToken: z.infer<typeof tokenAmountWithMetadata>
  postHook: Omit<
    SquidHook,
    'fundAmount' | 'fundToken' | 'provider' | 'logoURI' | 'calls'
  > & { calls: EvmContractCall[] } // we don't support CosmosCall
  swapToTokenAddress: Address
  networkId: NetworkId
  walletAddress: Address
  enableAppFee?: boolean
}): Promise<TriggerOutputShape<'swap-deposit'>> {
  const amountToSwap = parseUnits(swapFromToken.amount, swapFromToken.decimals)
  // use the token's networkId if present, but fallback to the networkId
  // as older clients supporting only same chain swap and deposit won't set it.
  const fromNetworkId = swapFromToken.networkId ?? networkId

  const swapParams = {
    buyToken: swapToTokenAddress,
    buyIsNative: false,
    buyNetworkId: networkId,
    ...(swapFromToken.address && { sellToken: swapFromToken.address }),
    sellIsNative: swapFromToken.isNative,
    sellNetworkId: fromNetworkId,
    sellAmount: amountToSwap.toString(),
    slippagePercentage: '1',
    postHook,
    userAddress: walletAddress,
    enableAppFee,
  }

  const url = getConfig().GET_SWAP_QUOTE_URL

  let swapQuote: GetSwapQuoteResponse

  try {
    swapQuote = await got
      .post(url, { json: swapParams })
      .json<GetSwapQuoteResponse>()
  } catch (err) {
    if (err instanceof HTTPError) {
      logger.warn(
        {
          err,
          response: err.response.body,
          swapParams,
        },
        'Got a non-2xx response from getSwapQuote',
      )
    } else {
      logger.warn({ err, swapParams }, 'Error getting swap quote')
    }
    throw err
  }

  if (!swapQuote.unvalidatedSwapTransaction) {
    logger.warn(
      {
        swapParams,
        swapQuote,
      },
      'No unvalidatedSwapTransaction in swapQuote',
    )
    throw new Error('Unable to get swap quote')
  }

  const client = getClient(fromNetworkId)

  const transactions: Transaction[] = []
  const { allowanceTarget } = swapQuote.unvalidatedSwapTransaction

  if (allowanceTarget !== zeroAddress && swapFromToken.address) {
    const approvedAllowanceForSpender = await client.readContract({
      address: swapFromToken.address,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [walletAddress, allowanceTarget],
    })

    if (approvedAllowanceForSpender < amountToSwap) {
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [allowanceTarget, amountToSwap],
      })

      const approveTx: Transaction = {
        networkId: fromNetworkId,
        from: walletAddress,
        to: swapFromToken.address,
        data,
      }
      transactions.push(approveTx)
    }
  }

  const { from, to, data, value, gas, estimatedGasUse, simulationStatus } =
    swapQuote.unvalidatedSwapTransaction

  const swapTx: Transaction = {
    networkId: fromNetworkId,
    from,
    to,
    data,
    value: BigInt(value),
    // if gas was simulated, add a 15% buffer
    gas:
      simulationStatus === 'success'
        ? (BigInt(gas) * 115n) / 100n
        : BigInt(gas),
    estimatedGasUse: estimatedGasUse ? BigInt(estimatedGasUse) : undefined,
  }

  transactions.push(swapTx)

  return {
    transactions,
    dataProps: { swapTransaction: swapQuote.unvalidatedSwapTransaction },
  }
}
