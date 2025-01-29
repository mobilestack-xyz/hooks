// Helper script to trigger a shortcut
/* eslint-disable no-console */
import yargs from 'yargs'
import {
  Address,
  createWalletClient,
  http,
  createPublicClient,
  Chain,
} from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  celo,
  celoAlfajores,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia,
} from 'viem/chains'
import { getShortcuts } from '../src/runtime/getShortcuts'
import { NetworkId } from '../src/types/networkId'
import { z } from 'zod'

const CELO_DERIVATION_PATH = "m/44'/52752'/0'/0/0"

const NETWORK_ID_TO_CHAIN: Record<NetworkId, Chain> = {
  [NetworkId['celo-mainnet']]: celo,
  [NetworkId['celo-alfajores']]: celoAlfajores,
  [NetworkId['ethereum-mainnet']]: mainnet,
  [NetworkId['ethereum-sepolia']]: sepolia,
  [NetworkId['arbitrum-one']]: arbitrum,
  [NetworkId['arbitrum-sepolia']]: arbitrumSepolia,
  [NetworkId['base-mainnet']]: base,
  [NetworkId['base-sepolia']]: baseSepolia,
  [NetworkId['op-mainnet']]: optimism,
  [NetworkId['op-sepolia']]: optimismSepolia,
  [NetworkId['polygon-pos-mainnet']]: polygon,
  [NetworkId['polygon-pos-amoy']]: polygonAmoy,
}

const argv = yargs(process.argv.slice(2))
  .parserConfiguration({
    'parse-numbers': false, // prevents 0x{string} from being parsed as a number
  })
  .usage(
    'Usage: $0 --network <network> --address <address> --app <appId> --shortcut <shortcutId> --triggerInputShape <triggerInputShape> [--mnemonic <mnemonic>] [--derivationPath <derivationPath>]',
  )
  .env('')
  .options({
    networkId: {
      alias: 'n',
      describe: 'Network ID to get positions for',
      choices: Object.values(NetworkId),
      default: NetworkId['celo-mainnet'],
    },
    address: {
      alias: 'a',
      describe: 'Address to get positions for',
      type: 'string',
      demandOption: true,
    },
    app: {
      alias: 'p',
      describe: 'App ID of the shortcut to trigger',
      type: 'string',
      demandOption: true,
    },
    shortcut: {
      alias: 's',
      describe: 'Shortcut ID to trigger',
      type: 'string',
      demandOption: true,
    },
    triggerInput: {
      describe:
        'JSON for the triggerInput of shortcut. It should respect the triggerInputShape of the shortcut.',
      type: 'string',
      default: '{}',
    },
    mnemonic: {
      describe: 'Mnemonic to use to sign the shortcut transaction(s)',
      type: 'string',
    },
    derivationPath: {
      describe: 'Derivation path to use to sign the shortcut transaction(s)',
      type: 'string',
      default: CELO_DERIVATION_PATH,
    },
  })
  .parseSync()

void (async () => {
  const shortcuts = await getShortcuts(argv.networkId, argv.address, [argv.app])

  const shortcut = shortcuts.find((s) => s.id === argv.shortcut)
  if (!shortcut) {
    throw new Error(
      `No shortcut found with id '${
        argv.shortcut
      }', available shortcuts: ${shortcuts.map((s) => s.id).join(', ')}`,
    )
  }

  // TODO: consider showing a user friendly prompt to fill in the trigger input
  // or at least a list of the expected fields
  // This just throws a Zod error if the input is not valid
  const triggerInput = z
    .object(shortcut.triggerInputShape)
    .parse(JSON.parse(argv.triggerInput))

  const triggerArgs = {
    networkId: argv.networkId,
    address: argv.address,
    ...triggerInput,
  }

  console.log(
    `Triggering shortcut '${shortcut.id}' for app '${shortcut.appId}'`,
    triggerArgs,
  )
  const result = await shortcut.onTrigger(triggerArgs)

  console.log('Transaction(s) to send:', result)

  if (!argv.mnemonic) {
    console.log('No mnemonic provided, skipping transaction sending')
    return
  }

  const account = mnemonicToAccount(argv.mnemonic, {
    ...(argv.networkId === NetworkId['celo-mainnet'] && {path: argv.derivationPath as any})
  })

  if (account.address.toLowerCase() !== argv.address.toLowerCase()) {
    throw new Error(
      `Derived address '${account.address}' from mnemonic does not match the provided address '${argv.address}'`,
    )
  }

  const fromNetworkId: NetworkId = triggerInput?.swapFromToken?.networkId

  const networkId = fromNetworkId ?? argv.networkId

  console.log(`Sending transactions on network: ${networkId}`)
  const wallet = createWalletClient({
    account,
    chain: NETWORK_ID_TO_CHAIN[networkId],
    transport: http(),
  })
  const client = createPublicClient({
    chain: NETWORK_ID_TO_CHAIN[networkId],
    transport: http(),
  })

  for (const transaction of result.transactions) {
    const txHash = await wallet.sendTransaction({
     from: transaction.from as Address,
      to: transaction.to as Address,
      data: transaction.data as `0x${string}`,
    })
    console.log(`Transaction sent, waiting for receipt: ${txHash}`)

    const receipt = await client.waitForTransactionReceipt({ hash: txHash })

    console.log('Transaction receipt:', receipt)
  }
})()
