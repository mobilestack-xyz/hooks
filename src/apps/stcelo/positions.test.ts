import { t } from '../../../test/i18next'
import { NetworkId } from '../../types/networkId'
import { TokenDefinition } from '../../types/positions'
import hook from './positions'

const mockReadContract = jest.fn()
jest.mock('../../runtime/client', () => ({
  getClient: jest.fn(() => ({
    readContract: mockReadContract,
  })),
}))

describe('stCELO hook', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return the correct hook info', () => {
    expect(hook.getInfo()).toEqual({
      name: 'stCELO',
    })
  })

  describe('getPositionDefinitions', () => {
    const mockAddress = '0x2b8441ef13333ffa955c9ea5ab5b3692da95260d'

    it('should return position definition with correct data for mainnet', async () => {
      mockReadContract.mockImplementation(async ({ functionName }) => {
        switch (functionName) {
          case 'exchangeRate':
            return 1050000000000000000n // 1.05
          case 'totalAssets':
            return 1000000000000000000000n // 1000
          default:
            throw new Error(`Unexpected function: ${functionName}`)
        }
      })

      const positions = await hook.getPositionDefinitions({
        networkId: NetworkId['celo-mainnet'],
        address: mockAddress,
        t,
      })

      expect(positions.length).toBe(1)
      expect(positions[0]).toMatchObject({
        type: 'app-token-definition',
        networkId: NetworkId['celo-mainnet'],
        address: '0x4aAD04D41FD7fd495503731C5a2579e19054C432',
        tokens: [
          {
            address: '0x471EcE3750Da237f93B8E339c536989b8978a438',
            networkId: NetworkId['celo-mainnet'],
          },
        ],
        displayProps: {
          title: 'stCELO',
          description: 'Liquid Staked CELO - Earn staking rewards while keeping your CELO liquid. Note: 3-day unstaking period applies.',
          imageUrl: 'https://app.stcelo.xyz/_next/static/media/token-stcelo.5935f866.svg',
          manageUrl: 'https://app.stcelo.xyz',
        },
      })
    })

    it('should return position definition with correct data for alfajores', async () => {
      mockReadContract.mockImplementation(async ({ functionName }) => {
        switch (functionName) {
          case 'exchangeRate':
            return 1050000000000000000n // 1.05
          case 'totalAssets':
            return 1000000000000000000000n // 1000
          default:
            throw new Error(`Unexpected function: ${functionName}`)
        }
      })

      const positions = await hook.getPositionDefinitions({
        networkId: NetworkId['celo-alfajores'],
        address: mockAddress,
        t,
      })

      expect(positions.length).toBe(1)
      expect(positions[0]).toMatchObject({
        type: 'app-token-definition',
        networkId: NetworkId['celo-alfajores'],
        address: '0xd11CC172D802c1a94e81c5F432471bD34d1828A1',
        tokens: [
          {
            address: '0xF194afDf50B03e69Bd7D057c1Aa9e10c9954E4C9',
            networkId: NetworkId['celo-alfajores'],
          },
        ],
      })
    })

    it('should return empty array for unsupported networks', async () => {
      const positions = await hook.getPositionDefinitions({
        networkId: NetworkId['ethereum-mainnet'],
        address: mockAddress,
        t,
      })

      expect(positions).toEqual([])
      expect(mockReadContract).not.toHaveBeenCalled()
    })

    it('should return empty array when no address provided', async () => {
      const positions = await hook.getPositionDefinitions({
        networkId: NetworkId['celo-mainnet'],
        address: undefined,
        t,
      })

      expect(positions).toEqual([])
      expect(mockReadContract).not.toHaveBeenCalled()
    })
  })

  describe('getAppTokenDefinition', () => {
    it('should throw UnknownAppTokenError for unknown token', async () => {
      const tokenDefinition: TokenDefinition = {
        networkId: NetworkId['celo-mainnet'],
        address: '0x1234567890123456789012345678901234567890',
      }
      await expect(hook.getAppTokenDefinition!(tokenDefinition)).rejects.toThrow('Unknown app token')
    })

    it('should throw UnknownAppTokenError for unsupported network', async () => {
      const tokenDefinition: TokenDefinition = {
        networkId: NetworkId['ethereum-mainnet'],
        address: '0x4aAD04D41FD7fd495503731C5a2579e19054C432',
      }
      await expect(hook.getAppTokenDefinition!(tokenDefinition)).rejects.toThrow('Unknown app token')
    })
  })
}) 