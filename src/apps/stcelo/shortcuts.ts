import { Address, encodeFunctionData, parseUnits } from 'viem'
import { createShortcut, ShortcutsHook, tokenAmounts } from '../../types/shortcuts'
import { NetworkId } from '../../types/networkId'
import { z } from 'zod'
import { stCeloAbi } from './abis/stcelo'
import { ZodAddressLowerCased } from '../../types/address'

// stCELO contract addresses
const STCELO_ADDRESS: {
  [networkId in NetworkId]: Address | undefined
} = {
  [NetworkId['celo-mainnet']]: '0x4aAD04D41FD7fd495503731C5a2579e19054C432',
  [NetworkId['ethereum-mainnet']]: undefined,
  [NetworkId['arbitrum-one']]: undefined,
  [NetworkId['op-mainnet']]: undefined,
  [NetworkId['polygon-pos-mainnet']]: undefined,
  [NetworkId['base-mainnet']]: undefined,
  [NetworkId['ethereum-sepolia']]: undefined,
  [NetworkId['arbitrum-sepolia']]: undefined,
  [NetworkId['op-sepolia']]: undefined,
  [NetworkId['celo-alfajores']]: '0xd11CC172D802c1a94e81c5F432471bD34d1828A1',
  [NetworkId['polygon-pos-amoy']]: undefined,
  [NetworkId['base-sepolia']]: undefined,
}

const hook: ShortcutsHook = {
  async getShortcutDefinitions(networkId: NetworkId) {
    const stCeloAddress = STCELO_ADDRESS[networkId]
    if (!stCeloAddress) {
      return []
    }

    return [
      createShortcut({
        id: 'deposit',
        name: 'Deposit',
        description: 'Stake CELO to earn rewards',
        networkIds: [networkId],
        category: 'deposit',
        triggerInputShape: {
          tokens: tokenAmounts.length(1),
          tokenAddress: ZodAddressLowerCased,
          tokenDecimals: z.coerce.number(),
        },
        async onTrigger({ networkId, address, tokens, tokenDecimals }) {
          const walletAddress = address as Address
          const amountToDeposit = parseUnits(tokens[0].amount, tokenDecimals)

          return {
            transactions: [
              {
                networkId,
                from: walletAddress,
                to: stCeloAddress,
                data: encodeFunctionData({
                  abi: stCeloAbi,
                  functionName: 'deposit',
                  args: [amountToDeposit],
                }),
              },
            ],
          }
        },
      }),
      createShortcut({
        id: 'withdraw',
        name: 'Withdraw',
        description: 'Unstake CELO (3-day waiting period)',
        networkIds: [networkId],
        category: 'withdraw',
        triggerInputShape: {
          tokens: tokenAmounts.length(1),
          tokenDecimals: z.coerce.number(),
        },
        async onTrigger({ networkId, address, tokens, tokenDecimals }) {
          const walletAddress = address as Address
          const amountToWithdraw = parseUnits(tokens[0].amount, tokenDecimals)

          return {
            transactions: [
              {
                networkId,
                from: walletAddress,
                to: stCeloAddress,
                data: encodeFunctionData({
                  abi: stCeloAbi,
                  functionName: 'withdraw',
                  args: [amountToWithdraw],
                }),
              },
            ],
          }
        },
      }),
    ]
  },
}

export default hook 