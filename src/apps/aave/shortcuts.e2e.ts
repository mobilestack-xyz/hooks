import hook from './shortcuts'
import { NetworkId } from '../../types/networkId'

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

      const transactions = await shortcut!.onTrigger({
        networkId: NetworkId['arbitrum-one'],
        address: '0x2b8441ef13333ffa955c9ea5ab5b3692da95260d',
        token: {
          address: '0x724dc807b04555b71ed48a6896b6f41593b8c637', // USDC
          amount: '10',
          decimals: 6,
        },
      })

      expect(transactions.length).toEqual(2)
    })
  })
})
