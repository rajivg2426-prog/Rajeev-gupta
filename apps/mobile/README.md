# @legalkart/mobile

The LegalKart app: Expo (managed, SDK 58), Expo Router, NativeWind, TanStack Query, Zustand,
react-hook-form + zod. See `docs/SYSTEM-DESIGN.md` → "Mobile app" for the design.

The screens are functional placeholders. The real UI comes from the design session; replace
`src/components/ui.tsx` and `src/theme/tokens.js` rather than restyling each screen.

## Run it

From the repo root:

```bash
npm install                          # installs every workspace
npm run dev:api                      # the API on http://localhost:8080 (another terminal)
npm run start -w @legalkart/mobile   # Metro + Expo dev server; scan the QR code with Expo Go
```

Other scripts: `android`, `ios`, `web`, `typecheck` (e.g. `npm run typecheck -w @legalkart/mobile`).

### Pointing the app at the API

The app reads two public env vars at bundle time (copy `.env.example` to `.env.local` in this folder):

| Variable | Default | Notes |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | `http://localhost:8080` | |
| `EXPO_PUBLIC_DEV_USER_ID` | `dev-user` | Sent as `x-user-id` until real auth exists |

`localhost` only works for the iOS simulator and web. On a **physical phone in Expo Go**, use your
computer's LAN IP (phone and computer on the same Wi-Fi), e.g.

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:8080 npm run start -w @legalkart/mobile
```

On the Android emulator use `http://10.0.2.2:8080`. Restart Metro with `--clear` after changing env vars.

Expo Go includes every native module this app uses (webview, file system, sharing, secure store,
clipboard, web browser, reanimated), so no development build is needed yet.

## Layout

```
src/app/            Expo Router routes (one file per screen)
  agreement/[id]/   property → details → parties → verify → preview → stamp → certificate → done
src/api/            typed API client: types.ts (mirrors the API), client.ts (fetch + ApiError),
                    endpoints.ts, queries.ts (TanStack Query hooks), money.ts (formatInr)
src/forms/          template JSON → react-hook-form values + zod schema
src/state/          Zustand stores: session (secure store), current draft id (AsyncStorage)
src/components/     placeholder UI primitives
src/theme/tokens.js design tokens consumed by tailwind.config.js
```

Monorepo notes: dependencies are hoisted to the root `node_modules`; Expo's default Metro config
resolves them, `metro.config.js` only adds NativeWind. Add packages with `npx expo install <pkg>`
from this folder so versions match the SDK.
