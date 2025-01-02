import { TFunction } from 'i18next'
import {
  BaseBeefyVault,
  getApyBreakdown,
  getBeefyPrices,
  getBeefyVaults,
  getTvls,
} from './api'
import hook, { getDailyYieldRatePercentage } from './positions'
import { NetworkId } from '../../types/networkId'
import { Address } from 'viem'
import { AppTokenPositionDefinition } from '../../types/positions'
import BigNumber from 'bignumber.js'

const mockT = ((x: string) => x) as TFunction

const mockReadContract = jest.fn()
jest.mock('../../runtime/client', () => ({
  getClient: jest.fn(() => ({
    readContract: mockReadContract,
  })),
}))

jest.mock('./api.ts')

const mockBeefyVault: BaseBeefyVault = {
  id: 'defaultVault',
  name: 'Default Vault',
  type: 'auto',
  subType: 'concentrated',
  token: 'vaultToken',
  tokenAddress: '0x123456789' as Address,
  tokenDecimals: 8,
  tokenProviderId: '',
  earnedToken: '',
  earnContractAddress: '' as Address,
  status: '',
  platformId: '',
  assets: [],
  risks: [],
  strategyTypeId: '',
  network: 'arbitrum-one',
  chain: '',
  zaps: [],
  isGovVault: false,
  oracle: '',
  oracleId: '',
  createdAt: 12345,
  earnedTokenAddress: '0x987654321' as Address,
  depositTokenAddresses: [],
  strategy: '' as Address,
  pricePerFullShare: '120000000',
}

const mockBeefyVault1: BaseBeefyVault = {
  ...mockBeefyVault,
  id: 'vault1',
  name: 'Vault 1',
}

const mockBeefyVault2: BaseBeefyVault = {
  ...mockBeefyVault,
  id: 'vault2',
  name: 'Vault 2',
  tokenAddress: '0x111111111' as Address,
  createdAt: 135790,
  earnedTokenAddress: '0x999999999' as Address,
  pricePerFullShare: '1e+5',
}

const mockBeefyVaults = {
  vaults: [mockBeefyVault1, mockBeefyVault2],
  govVaults: [],
}
const mockBeefyPrices = { vault1: 1.2, vault2: 1000 }
const mockApyBreakdown = {
  vault1: { totalApy: 0.31 },
  vault2: { totalApy: 0.06 },
}
const mockTvls = { vault1: 98765, vault2: 1234567890 }
const mockGetTokenBalancesResponse: readonly bigint[] = [0n, 10n]

jest.mocked(getBeefyVaults).mockResolvedValue(mockBeefyVaults)
jest.mocked(getBeefyPrices).mockResolvedValue(mockBeefyPrices)
jest.mocked(getApyBreakdown).mockResolvedValue(mockApyBreakdown)
jest.mocked(getTvls).mockResolvedValue(mockTvls)

const vault: BaseBeefyVault = {
  type: 'gov',
  subType: 'cowcentrated',
} as BaseBeefyVault

const expectedBeefyVault = {
  address: '0x987654321',
  availableShortcutIds: ['deposit', 'withdraw', 'swap-deposit'],
  dataProps: {
    cantSeparateCompoundedInterest: true,
    claimType: 'rewards',
    contractCreatedAt: '1970-01-01T03:25:45.000Z',
    dailyYieldRatePercentage: 0.07400740957195229,
    depositTokenId: 'arbitrum-one:0x123456789',
    earningItems: [],
    manageUrl: 'https://app.beefy.com/vault/defaultVault',
    safety: undefined,
    tvl: '98765',
    withdrawTokenId: 'arbitrum-one:0x987654321',
    yieldRates: [
      {
        label: 'yieldRates.earningsApy',
        percentage: 31,
        tokenId: 'arbitrum-one:0x123456789',
      },
    ],
  },
  displayProps: expect.any(Function),
  networkId: 'arbitrum-one',
  pricePerShare: expect.any(Function),
  shortcutTriggerArgs: expect.any(Function),
  tokens: [
    {
      address: '0x123456789',
      fallbackPriceUsd: '1.2',
      networkId: 'arbitrum-one',
    },
  ],
  type: 'app-token-definition',
}

const expectedBeefyVault1 = {
  ...expectedBeefyVault,
  dataProps: {
    ...expectedBeefyVault.dataProps,
    manageUrl: 'https://app.beefy.com/vault/vault1',
  },
}

const expectedBeefyVault2 = {
  ...expectedBeefyVault,
  address: '0x999999999',
  dataProps: {
    ...expectedBeefyVault.dataProps,
    contractCreatedAt: '1970-01-02T13:43:10.000Z',
    dailyYieldRatePercentage: 0.015965358745284597,
    depositTokenId: 'arbitrum-one:0x111111111',
    manageUrl: 'https://app.beefy.com/vault/vault2',
    tvl: '1234567890',
    withdrawTokenId: 'arbitrum-one:0x999999999',
    yieldRates: [
      {
        label: 'yieldRates.earningsApy',
        percentage: 6,
        tokenId: 'arbitrum-one:0x111111111',
      },
    ],
  },
  tokens: [
    {
      address: '0x111111111',
      fallbackPriceUsd: '1000',
      networkId: 'arbitrum-one',
    },
  ],
}

const apyBreakdownWithCorrectComponents = {
  vaultApr: 0.1,
  clmApr: 0.2,
  tradingApr: 0.3,
}

const apyBreakdownWithIncorrectComponents = {
  unsupportedComponent: 0.1,
  totalApy: 0.5,
}

describe('getDailyYieldRatePercentage', () => {
  it('should return the correct daily yield rate percentage when there are components', () => {
    const dailyYieldRatePercentage = getDailyYieldRatePercentage(
      apyBreakdownWithCorrectComponents,
      vault,
    )
    expect(dailyYieldRatePercentage).toBeCloseTo(0.164)
  })
  it('should return the correct daily yield rate percentage when there are no correct components', () => {
    const dailyYieldRatePercentage = getDailyYieldRatePercentage(
      apyBreakdownWithIncorrectComponents,
      vault,
    )
    expect(dailyYieldRatePercentage).toBeCloseTo(0.111)
  })
  it('should not include rewardPoolApr in the daily yield rate percentage for gov cowcentrated vault', () => {
    const dailyYieldRatePercentage = getDailyYieldRatePercentage(
      { ...apyBreakdownWithCorrectComponents, rewardPoolApr: 0.4 },
      vault,
    )
    expect(dailyYieldRatePercentage).toBeCloseTo(0.164)
  })
  it('should return 0 if totalApy is undefined and no components', () => {
    const dailyYieldRatePercentage = getDailyYieldRatePercentage({}, vault)
    expect(dailyYieldRatePercentage).toBe(0)
  })
  it('should ignore components that are NaN', () => {
    const dailyYieldRatePercentage = getDailyYieldRatePercentage(
      {
        ...apyBreakdownWithCorrectComponents,
        merklApr: NaN,
      },
      vault,
    )
    expect(dailyYieldRatePercentage).toBeCloseTo(0.164)
  })
})

describe('hook', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })
  it('should return the correct hook info', () => {
    expect(hook.getInfo()).toEqual({
      name: 'Beefy',
    })
  })
  it('should return expected positions with balances when getPositionDefinitions is called with supported networkId and address', async () => {
    mockReadContract.mockResolvedValue(mockGetTokenBalancesResponse)
    const beefyPositions = await hook.getPositionDefinitions({
      networkId: NetworkId['arbitrum-one'],
      address: '0x12345',
      t: mockT,
    })
    expect(beefyPositions.length).toBe(1)
    expect(beefyPositions[0]).toEqual(expectedBeefyVault2)
  })
  it('should return all expected positions when getPositionDefinitions is called with supported networkId and no address', async () => {
    const beefyPositions = await hook.getPositionDefinitions({
      networkId: NetworkId['arbitrum-one'],
      address: undefined,
      t: mockT,
    })
    expect(beefyPositions.length).toBe(2)
    expect(beefyPositions[0]).toEqual(expectedBeefyVault1)
    expect(beefyPositions[1]).toEqual(expectedBeefyVault2)
  })
  it('should return an empty array when getPositionDefinitions is called with an unsupported networkId', async () => {
    const beefyPositions = await hook.getPositionDefinitions({
      networkId: NetworkId['celo-alfajores'],
      address: '0x12345',
      t: mockT,
    })
    expect(beefyPositions).toEqual([])
  })
  it('should return correct price per share', async () => {
    const mockPricePerShareContext = {
      tokensByTokenId: {
        'arbitrum-one:0x123456789': { decimals: 6 },
        'arbitrum-one:0x111111111': { decimals: 3 },
      },
    }
    const beefyPositions = await hook.getPositionDefinitions({
      networkId: NetworkId['arbitrum-one'],
      address: undefined,
      t: mockT,
    })
    expect(beefyPositions.length).toBe(2)

    const pricePerShare0 = (beefyPositions[0] as AppTokenPositionDefinition)
      .pricePerShare as Function
    const pricePerShare1 = (beefyPositions[1] as AppTokenPositionDefinition)
      .pricePerShare as Function

    expect(await pricePerShare0(mockPricePerShareContext)).toEqual([
      BigNumber('120'),
    ])
    expect(await pricePerShare1(mockPricePerShareContext)).toEqual([
      BigNumber('100'),
    ])
  })
})
