# Mobile Stack Hooks

[![GitHub License](https://img.shields.io/github/license/mobilestack-xyz/hooks?color=blue)](https://github.com/mobilestack-xyz/hooks/blob/main/LICENSE)
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/mobilestack-xyz/hooks/.github/workflows/workflow.yaml?branch=main)](https://github.com/mobilestack-xyz/hooks/actions/workflows/workflow.yaml?query=branch%3Amain)
[![Codecov](https://img.shields.io/codecov/c/github/mobilestack-xyz/hooks)](https://codecov.io/gh/mobilestack-xyz/hooks)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/mobilestack-xyz/hooks#contributing)

Mobile Stack Hooks allows developers to extend an app's functionality (_e.g._, the Valora wallet) by writing short programs called "hooks". These hooks are called in response to certain in-app or blockchain events and are used to provide the application with additional information and features.

Check out the [Hooks documentation](https://docs.mobilestack.xyz/hooks/) for more information.

Currently, this repository contains position pricing and shortcut hooks.

## Developing Hooks

To develop hooks, you will need to have Node.js installed on your computer.

### Setup

1. Clone this repository to your local machine.
2. Run `yarn install` to install the necessary dependencies.

### Position Pricing

See the [documentation](docs/types/position.md) for developing position pricing hooks.

### Shortcuts

See the [documentation](docs/types/shortcut.md) for developing shortcut hooks.

## Contributing

Do you have ideas for more types of hooks that would be useful for users?
Please reach out to us on [Discord](https://discord.com/invite/J5XMtMkwC4).

<!-- TODO If you'd like to contribute to this repository, please follow the [Contributing Guidelines](CONTRIBUTING.md).-->

We welcome bug reports, feature requests, and code contributions.
