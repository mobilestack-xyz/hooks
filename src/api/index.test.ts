import request from 'supertest'
// See https://github.com/GoogleCloudPlatform/functions-framework-nodejs/pull/461#issuecomment-1184147725
// Using the workaround with NodeNext module resolution causes a cascade of other issues
// @ts-expect-error
import { getTestServer } from '@google-cloud/functions-framework/testing'
import { getPositions } from '../runtime/getPositions'
import { getShortcuts } from '../runtime/getShortcuts'
import { Position } from '../types/positions'
import { SerializedDecimalNumber } from '../types/numbers'
import { NetworkId } from '../types/networkId'
import { getConfig } from './config'

jest.mock('./config')
jest.mocked(getConfig).mockReturnValue({
  POSITION_IDS: [],
  GET_TOKENS_INFO_URL: 'https://valoraapp.com/mock-endpoint',
  GOOGLE_CLOUD_PROJECT: 'dev-project',
  SHORTCUT_IDS: [],
  NETWORK_ID_TO_RPC_URL: {}
})
import './index' // NOTE: there are side effects of importing this module-- loading config params from the environment in particular. so mocking configs MUST be done before importing.
jest.mock('../runtime/getPositions')
jest.mock('../runtime/getShortcuts')

const TEST_POSITIONS: Position[] = [
  {
    type: 'app-token',
    appId: 'ubeswap',
    appName: 'Ubeswap',
    networkId: NetworkId['celo-mainnet'],
    address: '0x31f9dee850b4284b81b52b25a3194f2fc8ff18cf',
    symbol: 'ULP',
    decimals: 18,
    label: 'Pool: G$ / cUSD',
    displayProps: {
      title: 'G$ / cUSD',
      description: 'Pool',
      imageUrl: '',
    },
    tokenId: 'celo-mainnet:0x31f9dee850b4284b81b52b25a3194f2fc8ff18cf',
    tokens: [
      {
        type: 'base-token',
        networkId: NetworkId['celo-mainnet'],
        address: '0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a',
        symbol: 'G$',
        decimals: 18,
        priceUsd: '0.00015738574843135427' as SerializedDecimalNumber,
        balance: '12445.060074286696111325' as SerializedDecimalNumber,
        tokenId: 'celo-mainnet:0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a',
      },
      {
        type: 'base-token',
        networkId: NetworkId['celo-mainnet'],
        address: '0x765de816845861e75a25fca122bb6898b8b1282a',
        symbol: 'cUSD',
        decimals: 18,
        priceUsd: '1' as SerializedDecimalNumber,
        balance: '2.061316226302041758' as SerializedDecimalNumber,
        tokenId: 'celo-mainnet:0x765de816845861e75a25fca122bb6898b8b1282a',
      },
    ],
    pricePerShare: [
      '77.77845724145984437582' as SerializedDecimalNumber,
      '0.0128827016512212377' as SerializedDecimalNumber,
    ],
    priceUsd: '0.0130404016454077124' as SerializedDecimalNumber,
    balance: '160.006517430032680046' as SerializedDecimalNumber,
    supply: '170.324243277473535226' as SerializedDecimalNumber,
    availableShortcutIds: [],
  },
]

jest.mocked(getPositions).mockResolvedValue(TEST_POSITIONS)

const TEST_SHORTCUTS: Awaited<ReturnType<typeof getShortcuts>> = [
  {
    appId: 'ubeswap',
    id: 'claim-reward',
    name: 'Claim',
    description: 'Claim rewards for staked liquidity',
    networkIds: [NetworkId['celo-mainnet']],
    category: 'claim',
    async onTrigger(networkId, address, positionAddress) {
      // Bogus implementation for testing
      return [
        {
          networkId,
          from: address,
          to: positionAddress,
          data: '0xTEST',
        },
      ]
    },
  },
]

jest.mocked(getShortcuts).mockResolvedValue(TEST_SHORTCUTS)

const WALLET_ADDRESS = '0x0000000000000000000000000000000000007E57'

describe('GET /getPositions', () => {
  it('returns balances', async () => {
    const server = getTestServer('hooks-api')
    await request(server)
      .get('/getPositions')
      .query({
        networkId: 'celo-mainnet',
        address: WALLET_ADDRESS,
      })
      .expect(200)
      .expect({ message: 'OK', data: TEST_POSITIONS })
  })

  it('returns 400 when address is missing', async () => {
    const server = getTestServer('hooks-api')
    const response = await request(server)
      .get('/getPositions')
      .query({
        networkId: 'celo-mainnet',
      })
      .expect(400)
    expect(response.body).toMatchInlineSnapshot(`
      {
        "details": {
          "_errors": [],
          "query": {
            "_errors": [],
            "address": {
              "_errors": [
                "address is required",
              ],
            },
          },
        },
        "message": "Invalid request",
      }
    `)
  })
})

describe('GET /getShortcuts', () => {
  it('returns shortcuts', async () => {
    const server = getTestServer('hooks-api')
    const response = await request(server).get('/getShortcuts').expect(200)
    expect(response.body).toEqual({
      message: 'OK',
      data: TEST_SHORTCUTS.map(({ onTrigger, ...shortcut }) => ({
        ...shortcut,
      })),
    })
  })
})

describe('POST /triggerShortcut', () => {
  it('calls the shortcut onTrigger and returns transactions', async () => {
    const server = getTestServer('hooks-api')
    const response = await request(server)
      .post('/triggerShortcut')
      .send({
        networkId: 'celo-mainnet',
        address: WALLET_ADDRESS,
        appId: TEST_SHORTCUTS[0].appId,
        shortcutId: TEST_SHORTCUTS[0].id,
        positionAddress: TEST_POSITIONS[0].address,
      })
      .expect(200)
    expect(response.body).toEqual({
      message: 'OK',
      data: {
        transactions: [
          {
            networkId: 'celo-mainnet',
            from: WALLET_ADDRESS.toLowerCase(),
            to: TEST_POSITIONS[0].address,
            data: '0xTEST',
          },
        ],
      },
    })
  })

  it("returns 400 when the shortcut doesn't exist", async () => {
    const server = getTestServer('hooks-api')
    const response = await request(server)
      .post('/triggerShortcut')
      .send({
        networkId: 'celo-mainnet',
        address: WALLET_ADDRESS,
        appId: TEST_SHORTCUTS[0].appId,
        shortcutId: 'flarf',
        positionAddress: TEST_POSITIONS[0].address,
      })
      .expect(400)
    expect(response.body).toMatchInlineSnapshot(`
      {
        "message": "No shortcut found with id 'flarf' for app 'ubeswap', available shortcuts: claim-reward",
      }
    `)
  })
})
