import { NetworkId } from '../../types/networkId'
import hook from './shortcuts'

describe('getShortcutDefinitions', () => {
  it('should get the definitions successfully', async () => {
    const shortcuts = await hook.getShortcutDefinitions(
      NetworkId['arbitrum-one'],
    )
    expect(shortcuts.length).toBeGreaterThan(0)
  })

  describe('deposit.onTrigger', () => {
    it('should return transactions', async () => {
      const shortcuts = await hook.getShortcutDefinitions(
        NetworkId['arbitrum-one'],
      )
      const shortcut = shortcuts.find((shortcut) => shortcut.id === 'deposit')
      expect(shortcut).toBeDefined()

      const { transactions } = await shortcut!.onTrigger({
        networkId: NetworkId['arbitrum-one'],
        address: '0x2b8441ef13333ffa955c9ea5ab5b3692da95260d',
        tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
        tokenDecimals: 6,
        positionAddress: '0xa73b0b48e26e4b8b24cead149252cc275dee99a6', // RYUSD
        tokens: [
          {
            tokenId: 'arbitrum-one:0xaf88d065e77c8cc2239327c5edb3a432268e5831',
            amount: '10',
          },
        ],
      })

      expect(transactions.length).toEqual(2)
    })
  })

  describe('withdraw.onTrigger', () => {
    it('should return transactions', async () => {
      const shortcuts = await hook.getShortcutDefinitions(
        NetworkId['arbitrum-one'],
      )
      const shortcut = shortcuts.find((shortcut) => shortcut.id === 'withdraw')
      expect(shortcut).toBeDefined()

      const { transactions } = await shortcut!.onTrigger({
        networkId: NetworkId['arbitrum-one'],
        address: '0x2b8441ef13333ffa955c9ea5ab5b3692da95260d',
        tokens: [
          {
            tokenId: 'arbitrum-one:0xb9A27ba529634017b12e3cbbbFFb6dB7908a8C8B',
            amount: '1',
          },
        ],
        positionAddress: '0xa73b0b48e26e4b8b24cead149252cc275dee99a6', // RYUSD
        tokenDecimals: 6,
      })

      expect(transactions.length).toEqual(1)
    })
  })
})
