---
sidebar_position: 1
---

# Position Pricing Hooks

> The [example position hook](https://github.com/mobilestack-xyz/hooks/blob/master/src/apps/example/positions.ts) is an easy way to get started.

A user's Mobile Stack wallet invokes position hooks when determining the types, quantity, and value of assets a user owns. If a position hook detects a user owns one or more positions, it provides information about the positions for the app to show to the user.

## Principle

A position pricing hook's main job is to return user owned positions and to break them down into underlying base tokens. The pricing of base tokens is done separately and is not needed by hooks authors.

Terms:

- **Base Tokens**: base assets which have a token to represent them (ERC20, ERC721, etc). Examples: CELO, cUSD, cEUR, UBE, MOO, etc.
- **App Tokens**: tokens which represent more complex positions within a dapp, like liquidity pool (LP) tokens, or staked positions.
- **Contract Positions**: things that are not represented by a token (example: locked CELO, farming positions, claimable tokens).

For example, a position hook detects that a user owns a position in a liquidity pool. It then provides information about the pool's assets and the user's share of the pool's assets.

- The liquidity pool is an app token.
- The pool's assets are base tokens.

From the information provided by the hook, the Mobile Stack app can show the user the value of their position in the pool.

## Developing a Position Pricing Hook

### Structure

Hooks are organized by application. For instance Ubeswap hooks are located in [`https://github.com/mobilestack-xyz/hooks/tree/main/src/apps/ubeswap`](https://github.com/mobilestack-xyz/hooks/tree/main/src/apps/ubeswap).

Position pricing hooks must implement the [`PositionsHook`](https://github.com/mobilestack-xyz/hooks/blob/main/src/types/positions.ts) TypeScript interface.

### Creating a Position Pricing Hook

To create a position pricing hook for your application named `MyApp`, you will need to create a new folder with the name `my-app` in `src/apps` and add a `positions.ts` file. The file should export an object with the following properties:

```ts
import { PositionsHook } from '../../types/positions'

const hook: PositionsHook = {
  getInfo() {
    return { name: 'MyDapp' }
  },
  async getPositionDefinitions({ network, address, t }) {
    // TODO: implement
  },
}

export default hook
```

### Implementing `getPositionDefinitions`

The `getPositionDefinitions` function is called by Mobile Stack apps to get the positions owned by a user.

It receives the following arguments:

- `network`: the network for which the positions should be returned.
- `address`: the address of the user for which the positions should be returned.

It should return an array of [`PositionDefinition`](https://github.com/mobilestack-xyz/hooks/blob/main/src/types/positions.ts) objects.

The `PositionDefinition` is either an `AppTokenPositionDefinition` or a `ContractPositionDefinition`, representing an app token or a contract position respectively.

#### App Token Position Definition

TODO

#### Contract Position Definition

##### Locked CELO Example

Here's a simplified example of a `getPositionDefinitions` implementation for representing locked CELO owned by a user.

Please take a look at the [full implementation](https://github.com/mobilestack-xyz/hooks/blob/main/src/apps/locked-celo/positions.ts) for more details.

```ts
const hook: PositionsHook = {
  getInfo() {
    return { name: 'MyDapp' }
  },
  async getPositionDefinitions({ network, address, t }) {
    // [...] more code here not shown for brevity
    const positions: PositionDefinition[] = [
      {
        type: 'contract-position-definition',
        network,
        address: LOCKED_GOLD_ADDRESS,
        tokens: [{ address: CELO_ADDRESS, network }],
        label: 'Locked CELO',
        balances: async () => {
          return [
            toDecimalNumber(
              totalLockedCelo + totalCeloUnlocking + totalCeloWithdrawable,
              CELO_DECIMALS,
            ),
          ]
        },
      },
    ]
    return positions
  },
}
```

Here you can see that it contains the following properties:

- `type`: the type of position definition. In this case, it's a `contract-position-definition`.
- `network`: the network of the position definition.
- `address`: the address of the contract for the position definition.
- `tokens`: the base tokens that the position definition represents. In this case, it's just CELO.
- `label`: a human-readable label for the position definition.
- `balances`: a function that returns the balances of the base tokens represented by the position definition.

This is how it fulfills the job of a position pricing hook, by declaratively defining the position with its underlying base tokens.

This is all that is needed for Mobile Stack apps to show the user the value of their locked CELO.

### Testing a Position Pricing Hook

The [hooks live preview](../live-preview.md) mode in a Mobile Stack app is the easiest way to test your position hook while developing it.

Alternatively, you can use the `getPositions` script via the command line.

```sh
yarn getPositions --network <network> --address <address> --apps <app-name>[,<app-name2>]
```

Example for locked-celo:

```sh
yarn getPositions --network celo --address 0x2b8441ef13333ffa955c9ea5ab5b3692da95260d --apps locked-celo
```

You can get additional logs about how positions are resolved by the runtime by setting the `LOG_LEVEL` environment variable to `debug`.

```sh
LOG_LEVEL=debug yarn getPositions --network celo --address 0x2b8441ef13333ffa955c9ea5ab5b3692da95260d --apps locked-celo
```
