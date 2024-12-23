import { ChainType, SquidCallType } from '@0xsquid/squid-types'
import { NetworkId } from '../types/networkId'
import { prepareSwapTransactions } from './prepareSwapTransactions'
import got from './got'
import { Address } from 'viem'

const mockGotPostJson = jest.fn()
const mockReadContract = jest.fn()

jest.mock('./got', () => ({
  HTTPError: jest.requireActual('./got').HTTPError,
  post: jest.fn(() => ({
    json: mockGotPostJson,
  })),
}))
jest.mock('../runtime/client', () => ({
  getClient: jest.fn(() => ({
    readContract: mockReadContract,
  })),
}))

const mockWalletAddress = '0x2b8441ef13333ffa955c9ea5ab5b3692da95260d'

const mockNativeSwapFromToken = {
  tokenId: 'op-mainnet:native',
  isNative: true,
  amount: '1',
  decimals: 18,
  networkId: NetworkId['op-mainnet'],
}

const mockErc20SwapFromToken = {
  tokenId: 'arbitrum-one:0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0',
  isNative: false,
  amount: '1',
  decimals: 6,
  address: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0' as Address,
}

const mockPostHook = {
  chainType: ChainType.EVM as const,
  calls: [
    {
      chainType: ChainType.EVM as const,
      callType: SquidCallType.FULL_TOKEN_BALANCE,
      target: '0x724dc807b04555b71ed48a6896b6f41593b8c637',
      callData: '0xapprove',
      value: '0',
      estimatedGas: '1000',
    },
    {
      chainType: ChainType.EVM as const,
      callType: SquidCallType.FULL_TOKEN_BALANCE,
      target: '0x724dc807b04555b71ed48a6896b6f41593b8c637',
      callData: '0xsupply',
      value: '0',
      estimatedGas: '2000',
    },
  ],
  description: 'Deposit to pool',
}

const swapTransaction = {
  allowanceTarget: '0x4c363649d45d93a39aa2e72cb1beae5e25c63e88',
  gas: '12345',
  estimatedGasUse: '12211',
  to: '0x12345678',
  from: mockWalletAddress,
  value: '111',
  data: '0xswapdata',
}

describe('prepareSwapTransactions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGotPostJson.mockResolvedValue({
      unvalidatedSwapTransaction: swapTransaction,
    })
    mockReadContract.mockResolvedValue(0)
  })

  it('prepares swap transaction from native token', async () => {
    const { transactions, dataProps } = await prepareSwapTransactions({
      networkId: NetworkId['arbitrum-one'],
      walletAddress: '0x2b8441ef13333ffa955c9ea5ab5b3692da95260d',
      swapFromToken: mockNativeSwapFromToken,
      swapToTokenAddress: '0x724dc807b04555b71ed48a6896b6f41593b8c637',
      postHook: mockPostHook,
    })

    expect(transactions).toHaveLength(1)
    expect(transactions[0]).toEqual({
      networkId: NetworkId['arbitrum-one'],
      from: mockWalletAddress,
      to: '0x12345678',
      data: '0xswapdata',
      value: 111n,
      gas: 14042n,
      estimatedGasUse: 12211n,
    })
    expect(dataProps).toEqual({ swapTransaction })
    expect(got.post).toHaveBeenCalledTimes(1)
    expect(got.post).toHaveBeenCalledWith(
      'https://api.mainnet.valora.xyz/getSwapQuote',
      {
        json: {
          buyToken: '0x724dc807b04555b71ed48a6896b6f41593b8c637',
          buyIsNative: false,
          buyNetworkId: NetworkId['arbitrum-one'],
          sellIsNative: true,
          sellNetworkId: NetworkId['op-mainnet'],
          sellAmount: (1e18).toString(),
          slippagePercentage: '1',
          postHook: mockPostHook,
          userAddress: mockWalletAddress,
        },
      },
    )
  })

  it('prepares swap transaction from erc20 token with network id not set', async () => {
    const { transactions, dataProps } = await prepareSwapTransactions({
      networkId: NetworkId['arbitrum-one'],
      walletAddress: '0x2b8441ef13333ffa955c9ea5ab5b3692da95260d',
      swapFromToken: mockErc20SwapFromToken,
      swapToTokenAddress: '0x724dc807b04555b71ed48a6896b6f41593b8c637',
      postHook: mockPostHook,
    })

    expect(transactions).toHaveLength(2)
    expect(transactions[0]).toEqual({
      networkId: NetworkId['arbitrum-one'],
      from: mockWalletAddress,
      to: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0',
      data: expect.any(String),
    })
    expect(transactions[1]).toEqual({
      networkId: NetworkId['arbitrum-one'],
      from: mockWalletAddress,
      to: '0x12345678',
      data: '0xswapdata',
      value: 111n,
      gas: 14042n,
      estimatedGasUse: 12211n,
    })
    expect(dataProps).toEqual({ swapTransaction })
    expect(got.post).toHaveBeenCalledTimes(1)
    expect(got.post).toHaveBeenCalledWith(
      'https://api.mainnet.valora.xyz/getSwapQuote',
      {
        json: {
          buyToken: '0x724dc807b04555b71ed48a6896b6f41593b8c637',
          buyIsNative: false,
          buyNetworkId: NetworkId['arbitrum-one'],
          sellToken: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0',
          sellIsNative: false,
          sellNetworkId: NetworkId['arbitrum-one'],
          sellAmount: (1e6).toString(),
          slippagePercentage: '1',
          postHook: mockPostHook,
          userAddress: mockWalletAddress,
        },
      },
    )
  })

  it('skips approve if swap amount is already approved', async () => {
    mockReadContract.mockResolvedValue(1e6)

    const { transactions } = await prepareSwapTransactions({
      networkId: NetworkId['arbitrum-one'],
      walletAddress: '0x2b8441ef13333ffa955c9ea5ab5b3692da95260d',
      swapFromToken: mockErc20SwapFromToken,
      swapToTokenAddress: '0x724dc807b04555b71ed48a6896b6f41593b8c637',
      postHook: mockPostHook,
    })

    expect(transactions).toHaveLength(1)
    expect(transactions[0]).toEqual({
      networkId: NetworkId['arbitrum-one'],
      from: mockWalletAddress,
      to: '0x12345678',
      data: '0xswapdata',
      value: 111n,
      gas: 14042n,
      estimatedGasUse: 12211n,
    })
  })

  it('throws if getting swap quote fails', async () => {
    mockGotPostJson.mockRejectedValueOnce(new Error('swap quote failed'))
    await expect(
      prepareSwapTransactions({
        networkId: NetworkId['arbitrum-one'],
        walletAddress: '0x2b8441ef13333ffa955c9ea5ab5b3692da95260d',
        swapFromToken: mockNativeSwapFromToken,
        swapToTokenAddress: '0x724dc807b04555b71ed48a6896b6f41593b8c637',
        postHook: mockPostHook,
      }),
    ).rejects.toThrow('swap quote failed')
  })

  it('throws if no swap quote is found in the response', async () => {
    mockGotPostJson.mockResolvedValueOnce({})
    await expect(
      prepareSwapTransactions({
        networkId: NetworkId['arbitrum-one'],
        walletAddress: '0x2b8441ef13333ffa955c9ea5ab5b3692da95260d',
        swapFromToken: mockNativeSwapFromToken,
        swapToTokenAddress: '0x724dc807b04555b71ed48a6896b6f41593b8c637',
        postHook: mockPostHook,
      }),
    ).rejects.toThrow('Unable to get swap quote')
  })
})
