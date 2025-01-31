import fs from 'fs'

export class Metrics {
  networks: {
    'celo-mainnet': number
    'ethereum-mainnet': number
    'arbitrum-one': number
    'op-mainnet': number
    'celo-alfajores': number
    'ethereum-sepolia': number
    'arbitrum-sepolia': number
    'op-sepolia': number
    'polygon-pos-mainnet': number
    'polygon-pos-amoy': number
    'base-mainnet': number
    'base-sepolia': number
  }
  apps: {
    aave: number
    allbridge: number
    beefy: number
    compound: number
    curve: number
    gooddollar: number
    halofi: number
    hedgey: number
    'locked-celo': number
    mento: number
    moola: number
    'stake-dao': number
    ubeswap: number
    uniswap: number
    walletconnect: number
  }
  appNames: string[]
  networkNames: string[]

  constructor() {
    this.networks = {
      'celo-mainnet': 0,
      'ethereum-mainnet': 0,
      'arbitrum-one': 0,
      'op-mainnet': 0,
      'celo-alfajores': 0,
      'ethereum-sepolia': 0,
      'arbitrum-sepolia': 0,
      'op-sepolia': 0,
      'polygon-pos-mainnet': 0,
      'polygon-pos-amoy': 0,
      'base-mainnet': 0,
      'base-sepolia': 0,
    }
    this.apps = {
      aave: 0,
      allbridge: 0,
      beefy: 0,
      compound: 0,
      curve: 0,
      gooddollar: 0,
      halofi: 0,
      hedgey: 0,
      'locked-celo': 0,
      mento: 0,
      moola: 0,
      'stake-dao': 0,
      ubeswap: 0,
      uniswap: 0,
      walletconnect: 0,
    }
    this.appNames = Object.keys(this.apps)
    this.networkNames = Object.keys(this.networks)
  }

  updateApp(appName: string) {
    if (appName && this.appNames.includes(appName)) {
      // @ts-expect-error Only app names are allowed
      this.apps[appName] += 1
    }
  }

  updateNetwork(networkId: string) {
    if (networkId && this.networkNames.includes(networkId)) {
      // @ts-expect-error Only app names are allowed
      this.networks[networkId] += 1
    }
  }

  save() {
    fs.writeFileSync(
      '.metrics.json',
      JSON.stringify({
        apps: this.apps,
        networks: this.networks,
      }),
    )
  }
}

export const metrics = new Metrics()
