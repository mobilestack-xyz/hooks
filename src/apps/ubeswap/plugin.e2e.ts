import plugin from './plugin'

describe('getPositionDefinitions', () => {
  it('should get the address definitions successfully', async () => {
    const positions = await plugin.getPositionDefinitions(
      'celo',
      '0x2b8441ef13333ffa955c9ea5ab5b3692da95260d',
    )
    // Simple check to make sure we got some definitions
    expect(positions.length).toBeGreaterThan(0)
  })

  it('should get no definitions for an address with no blockchain interaction', async () => {
    const positions = await plugin.getPositionDefinitions(
      'celo',
      '0x0000000000000000000000000000000000007E57',
    )
    expect(positions.length).toBe(0)
  })
})
