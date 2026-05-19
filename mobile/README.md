# Proliferate Mobile

Expo-managed mobile client scaffold for the Web/Mobile stack.

This PR intentionally keeps product UI shallow. Shared design, auth, cloud
viewer state, and the real mobile shell land in the follow-up stack PRs.

## App Identity

- Expo project: `proliferate-mobile`
- owner: `pablojosecodes`
- iOS bundle id: `ai.proliferate.mobile`
- URL scheme: `proliferate`
- App Store Connect app id: `6770219581`
- Sign in with Apple capability: enabled
- export compliance: `ITSAppUsesNonExemptEncryption=false`

## Local Development

```bash
pnpm install --frozen-lockfile
pnpm --filter @proliferate/mobile start
pnpm --filter @proliferate/mobile typecheck
```

## iOS Build And Submit

EAS manages the iOS distribution certificate and provisioning profile remotely.
Use an Expo account with access to the `pablojosecodes` project and an Apple
Developer Program account with access to the App Store Connect app.

Before treating this as the durable product release path, transfer the EAS
project to the Proliferate organization and update `owner` / `projectId` in
`app.json`. The checked-in project owner reflects the bootstrap TestFlight setup.

```bash
pnpm --filter @proliferate/mobile build:ios
pnpm --filter @proliferate/mobile submit:ios
```

Preview/internal builds use:

```bash
pnpm --filter @proliferate/mobile build:ios:preview
```

## Scope Notes

- Do not add shared design or product shell code in this PR.
- Do not duplicate components that will move to shared packages later.
- Keep this scaffold buildable while later PRs layer on auth and real UI.
