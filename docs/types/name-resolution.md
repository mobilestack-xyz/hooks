# Name Resolution Hooks

A user's Mobile Stack wallet invokes name resolution hooks when the user
types a recipient for sending funds to. Each name resolution hook
returns a list of addresses matching the recipient. Mobile Stack apps enable
name resolution hooks for
[SocialConnect](https://github.com/celo-org/SocialConnect),
[Nomspace](https://nom.space/) (a.k.a., ".nom"), and [Masa Finance's
Prosperity Passport](https://app.prosperity.global/) (a.k.a.,
".celo") by default.
