# Arbitrum swap and deposit

```
yarn triggerShortcut --networkId arbitrum-one --address <your_address> --app beefy --shortcut swap-deposit --mnemonic "<your_mnemonic>" --triggerInput '{
    "swapFromToken": {
        "tokenId": "arbitrum-one:0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        "amount": "1",
        "decimals": 6,
        "address": "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        "isNative": false
    },
    "positionAddress": "0xe6EFe71fc3442343037B72776e02daFA2ee9aF1A",
    "tokenAddress": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
}'
```

# X-chain swap and deposit

## DAI on base to WETH Beefy Pool on arbitrum

```
yarn triggerShortcut --networkId arbitrum-one --address your_address --app beefy --shortcut swap-deposit --mnemonic "your_mnemonic" --triggerInput '{
    "swapFromToken": {
        "tokenId": "base-mainnet:0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
        "amount": "1",
        "decimals": 18,
        "address": "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
        "isNative": false,
        "networkId": "base-mainnet"
    },
    "positionAddress": "0xe6efe71fc3442343037b72776e02dafa2ee9af1a",
    "tokenAddress": "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"
}'
```

## ETH on base to WETH Beefy Pool on arbitrum

```
yarn triggerShortcut --networkId arbitrum-one --address your_address --app beefy --shortcut swap-deposit --mnemonic "your_mnemonic" --triggerInput '{
    "swapFromToken": {
        "tokenId": "base-mainnet:native",
        "amount": "0.0002",
        "decimals": 18,
        "isNative": true,
        "networkId": "base-mainnet"
    },
    "enableAppFee": false,
    "positionAddress": "0xe6efe71fc3442343037b72776e02dafa2ee9af1a",
    "tokenAddress": "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"
}'
```