# Android runtime — embedded GeckoView browser

This is the Android implementation for the AI Chat app. It does **not** control Chrome or another external browser. It embeds GeckoView inside the app, creates one GeckoSession per provider, and keeps provider sessions inactive when they are not visible.

## Why this architecture

Android Chrome does not expose desktop Chrome extension semantics for a third-party app. GeckoView lets an app embed Gecko, install a built-in WebExtension, and use native messaging between the extension and Android code. The provider pages remain the source of the AI answer.

Official GeckoView documentation describes built-in WebExtensions under `assets/`, `ensureBuiltIn`, native messaging with `runtime.connectNative`, tab delegates, and inactive `GeckoSession`s. GeckoView is resolved to the newest release from maven.mozilla.org.

## Build

Open the `android/` directory in Android Studio and let Gradle download the Android and Mozilla dependencies. Java 17 is required by GeckoView.

Build with Android Studio: open the `android/` directory, allow Gradle sync, then choose **Build > Make Project** or **Build > Build Bundle(s) / APK(s) > Build APK(s)**. The generated debug APK is under `android/app/build/outputs/apk/debug/`. This repository intentionally does not commit the Gradle wrapper binary; Android Studio supplies/uses its configured Gradle distribution.

## First run

1. Launch the app.
2. Choose a provider.
3. Tap **BROWSER**.
4. Sign in normally on that provider page.
5. Tap **DONE**.
6. Send a prompt from the app.

The provider session stays inside the app. Later prompts can run while that provider session is inactive/not visible. If you deliberately open the provider browser view, it becomes the visible GeckoView session; when the app is backgrounded or the browser view is hidden, that session is marked inactive again.

## Data path

```text
Android UI
  -> AndroidGeckoBridge
  -> built-in WebExtension/native messaging
  -> real provider webpage
  -> content script
  -> native app
  -> Android UI
```

There are no provider API calls.

## Files and links

The content script extracts HTTP(S) links and small downloadable/image results. Returned files are base64-transported through the native bridge, saved in the app's private files area, and exposed with Android `FileProvider` for opening/sharing.

A 20 MB per-file cap is enforced to keep native messaging memory use reasonable.

## Limits

The app cannot guarantee that every provider page will continue to work after a provider redesigns its DOM or blocks automation. Provider selectors live in `assets/ai-chat-extension/content.js` and are intentionally isolated there.

Android may reclaim background processes under memory pressure. "Background" here means the provider GeckoSession is not the visible screen while the app process is alive; it is not a guarantee of indefinite execution after the OS kills the app.
