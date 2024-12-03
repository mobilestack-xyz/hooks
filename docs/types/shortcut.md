---
sidebar_position: 2
---

# Shortcut Hooks

A user's Mobile Stack wallet invokes shortcut hooks when determining asset or dapp related calls-to-action for the user. For example, when a user opens a Mobile Stack app's homescreen. A shortcut hook returns a human readable summary of available actions (_e.g._, "Claim your 1 cUSD earnings") and if the user chooses to act on them, a set of blockchain or in-app transactions will be executed by the app with the user's consent.

> **Note**
> The UI/UX for shortcut hooks in Mobile Stack apps is currently focused on "earn" and "claim rewards" use cases and requires a [position pricing hook](position.md) to be implemented as well. We plan to expand them to other use cases in the future (shortcuts with custom inputs, not linked to positions, or across dapps).

## Developing a Shortcut Hook

### Structure

Hooks are organized by application. For instance GoodDollar hooks are located in [`https://github.com/mobilestack-xyz/hooks/tree/main/src/apps/gooddollar`](https://github.com/mobilestack-xyz/hooks/tree/main/src/apps/gooddollar).

Shortcut hooks must implement the [`ShortcutsHook`](https://github.com/mobilestack-xyz/hooks/blob/main/src/types/shortcuts.ts) TypeScript interface.

### Creating a Shortcut Hook

To create a shortcut hook for your application named `MyApp`, you will need to create a new folder with the name `my-app` in `src/apps` and add a `shortcuts.ts` file. The file should export an object with the following properties:

```ts
import { ShortcutsHook } from '../../types/shortcuts'

const hook: ShortcutsHook = {
  async getShortcutDefinitions() {
    // TODO: implement
  },
}

export default hook
```

### Implementing `getShortcutDefinitions`

The `getShortcutDefinitions` function is called by a Mobile Stack app to get the list of shortcuts.

It should return an array of [`ShortcutDefinition`](https://github.com/mobilestack-xyz/hooks/blob/main/src/types/shortcuts.ts) objects.

#### GoodDollar Example

Here's a simplified example of a `getShortcutDefinitions` implementation for claiming GoodDollar rewards.

Please take a look at the [full implementation](https://github.com/mobilestack-xyz/hooks/blob/main/src/apps/gooddollar/shortcuts.ts) for more details.

```ts
const hook: ShortcutsHook = {
  getShortcutDefinitions() {
    return [
      {
        id: 'claim-reward',
        name: 'Claim',
        description: 'Claim daily UBI rewards',
        networks: ['celo'],
        category: 'claim',
        async onTrigger(network, address, positionAddress) {
          // This isn't strictly needed, but will help while we're developing shortcuts
          const { request } = await client.simulateContract({
            address: positionAddress as Address, // This is the ubi contract address
            abi: ubiSchemeAbi,
            functionName: 'claim',
            account: address as Address,
          })

          const data = encodeFunctionData({
            abi: request.abi,
            args: request.args,
            functionName: request.functionName,
          })

          return [
            {
              network,
              from: address,
              to: positionAddress,
              data,
            },
          ]
        },
      },
    ]
  },
}
```

Here you can see that it contains the following properties:

- `id`: the unique identifier for the shortcut
- `name`: the title of the button used to trigger the shortcut
- `description`: the description of the shortcut
- `networks`: the networks the shortcut is available on
- `category`: the category of the shortcut
- `onTrigger`: the function that is called when the shortcut is triggered

Once the shortcut is defined, the Mobile Stack app needs to know when to show it to the user, by linking it to an existing [position](position.md).

This is done by adding the `availableShortcutIds` property to the position definition and setting the `category` to `claimable` for the appropriate token(s).

This way the Mobile Stack app will be able to determine that the position has claimable token(s) and what shortcut to call to claim them.

```ts
const position: ContractPositionDefinition = {
  type: 'contract-position-definition',
  // Setting the `category` to `claimable` to indicate that the token can be claimed
  tokens: [{ address: G$_ADDRESS, network, category: 'claimable' }],
  // Setting the `availableShortcutIds` to the shortcut id defined above
  availableShortcutIds: ['claim-reward'],
  // [...] more properties omitted for brevity
}
```

Once this all done, the Mobile Stack app will show the GoodDollar shortcut in the rewards screen, with the available reward amount, and the button to claim it.

### Testing a Shortcut Hook

The [hooks live preview](../live-preview.md) mode in a Mobile Stack app is the easiest way to test your shortcut hook while developing it.

Alternatively, you can use the following scripts via the command line.

#### List shortcuts

To see your shortcut hook, you can use the `getShortcuts` script.

```sh
yarn getShortcuts --apps <app-name>[,<app-name2>]
```

Example for GoodDollar:

```sh
yarn getShortcuts --apps gooddollar
```

#### List positions with linked shortcuts

To see positions linked to your shortcut hook, you can use with the `getPositions` script.

```sh
yarn getPositions --network <network> --address <address> --apps <app-name>[,<app-name2>]
```

Example for GoodDollar:

```sh
yarn getPositions --network celo --address 0x2b8441ef13333ffa955c9ea5ab5b3692da95260d --apps gooddollar
```

#### Trigger shortcuts

To test triggering your shortcut hook, you can use the `triggerShortcut` script.

```sh
yarn triggerShortcut --network <network> --address <address> --app <app-name> --shortcut <shortcut-id> --positionAddress <position-address>
```

This will return the transactions that would be executed by the Mobile Stack app, after approval by the user.

You can also optionally pass the `--mnemonic` and `--derivationPath` (defaults to the Celo derivation path: `m/44'/52752'/0'/0/0`) options to actually sign and send the returned transaction(s).

Example for GoodDollar:

```sh
yarn triggerShortcut --network celo --address 0x11489ae0761343c3b03c630a63b00fa025bc4eea --app gooddollar --shortcut claim-reward --positionAddress 0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1
```
