# Proliferate Mobile

Expo-managed mobile client scaffold.

## iOS TestFlight

The app is configured with:

- bundle id: `ai.proliferate.mobile`
- app scheme: `proliferate`
- EAS build profiles in `eas.json`
- Sign in with Apple capability enabled
- export compliance flag set for standard encryption only

One-time setup still required from an authenticated Expo + Apple account:

```bash
cd mobile
pnpm dlx eas-cli@18.13.0 login
pnpm dlx eas-cli@18.13.0 init
pnpm build:ios
pnpm submit:ios
```

If the App Store Connect app record does not exist yet, create it with the same
bundle id before submit. EAS can manage certificates/profiles during the first
iOS build.

## Local

```bash
cd mobile
pnpm install
pnpm start
```
