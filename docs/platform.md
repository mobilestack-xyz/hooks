---
sidebar_position: 2
---

# Mobile Stack Hooks Platform

## Developing a hook

Developers must implement hooks in TypeScript and integrate them with
one of the existing per-hook type GitHub repositories.

We hope to make hooks easy to develop but also want to easily iterate
on the Mobile Stack Hooks Platform for developing and deploying hooks. For
now we require all deployed hook code to be located in Mobile Stack GitHub
repositories so we can help improve and maintain them (e.g., when
we implement breaking changes to the platform), but in the future we
expect to impose fewer requirements on how hooks are developed.

## Execution environment

Each hook executes in a Node.js 20 environment. Currently we
implement this as a [Google Cloud
Function](https://cloud.google.com/functions/docs/concepts/execution-environment), which has several important implications:

- statelessness: your hook cannot store data locally (_e.g._, in memory)
- timeout: the app will timeout waiting for a hook to execute
- background: the app destroys the hook environment after it returns so
  it's not possible to continue computation in the hook after
  returning a result

Eventually every hook will execute in a sandboxed JavaScript
environment (like [Secure ECMAScript
(SES)](https://github.com/endojs/endo/tree/master/packages/ses), which
MetaMask Snaps use) and we encourage hook developers to have that
high-level model in mind when developing their hooks and avoid
depending on Google Cloud Function specific attributes (_e.g._, reading
the reserved environment variable `K_SERVICE`)

## Deploying a hook to a Mobile Stack app

To deploy your hook you must:

1. submit a PR to the appropriate GitHub repository and work with a
   Valora engineer to merge your PR; and
2. confirm with a Valora engineer that they added your hook to the
   list of enabled hooks.
