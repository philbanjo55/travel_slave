# Philm Reciprocity — Wear OS

Standalone Wear OS app for the Galaxy Watch Ultra (and any Wear OS 3+ watch). Full reciprocity calculator matching the Philm+Frame phone app, designed for in-field use with gloves.

## Features

- **11 film stocks for 4×5 + 5 for 120** with one-tap switching
- **Rotary input** (digital touch bezel / crown gesture) adjusts metered exposure
- **Quick Button** (Galaxy Watch Ultra customizable button) triggers countdown
- **Countdown timer** matches the RN app — 3·2·1 tick haptic, GO double-buzz, DONE triple-buzz
- **Aperture priority** — enter desired actual seconds, get new f-stop
- **Filter stack** — multi-select 6 filters, running total with metered preview
- **Reference table** — adjusted exposure at 1s through 10min for current stock
- **Custom film stock** with adjustable P value (1.00–1.60)
- **Delta 100 P toggle** (1.26 / 1.20)
- **Pan F+ 50** ⭐ (new HARMAN 2026 release)

## Design

- Pure black background, white accent — matches Philm+Frame phone app exactly
- Georgia/serif display for large numbers (`28sp` corrected exposure, `80sp` countdown)
- Minimal chrome, full-bleed compositions
- Standalone — no companion phone app needed, runs entirely on the watch

## Project structure

```
wear/
├── settings.gradle.kts         ← Project root
├── build.gradle.kts            ← Top-level plugins
├── gradle.properties
├── gradle/
│   ├── libs.versions.toml      ← Version catalog (single source of truth for deps)
│   └── wrapper/gradle-wrapper.properties
└── app/
    ├── build.gradle.kts        ← Module config
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml
        ├── kotlin/com/philmframe/wear/
        │   ├── MainActivity.kt              ← Activity host + hardware key handler
        │   ├── data/
        │   │   ├── Reciprocity.kt           ← Math engine (ported from .ts)
        │   │   ├── Filters.kt               ← Filter stack data
        │   │   ├── AppState.kt              ← Single state holder
        │   │   └── TimerTrigger.kt          ← Quick Button → countdown bus
        │   ├── ui/
        │   │   ├── Theme.kt                 ← Philm B&W design system port
        │   │   ├── PhilmReciprocityApp.kt   ← Top-level pager nav
        │   │   ├── ReciprocityScreen.kt     ← Main calculator
        │   │   ├── FilmPickerScreen.kt      ← Stock + format toggle
        │   │   ├── FilterStackScreen.kt
        │   │   ├── AperturePriorityScreen.kt
        │   │   ├── ReferenceTableScreen.kt
        │   │   └── CountdownScreen.kt       ← 3-2-1 + live timer + done
        │   ├── buzz/
        │   │   └── Buzz.kt                  ← Haptic patterns (1:1 with RN)
        │   └── input/
        │       └── RotaryScrollable.kt      ← Digital bezel handler
        └── res/
            ├── values/strings.xml
            ├── values/colors.xml
            ├── drawable/ic_launcher_foreground.xml
            └── mipmap-anydpi-v26/ic_launcher.xml
```

## Build & install (your Galaxy Watch Ultra)

### One-time setup
1. Install Android Studio Hedgehog (2023.1.1) or newer
2. In the Studio SDK Manager, ensure these are installed:
   - Android SDK Platform 34
   - Wear OS Emulator System Image (API 34) — for testing without hardware
3. On your watch: Settings → About → Software Information → tap "Software version" 7 times → enables Developer Mode
4. On your watch: Settings → Developer Options → enable **ADB Debugging** and **Wireless Debugging**

### Open the project
```bash
cd ~/philmframe/wear
# Open the `wear` folder (not the parent) in Android Studio
```

Studio will auto-download Gradle 8.7 and required SDK components on first sync. Takes ~5-10 min.

### Build
```bash
./gradlew :app:assembleDebug
```
APK lands at `app/build/outputs/apk/debug/app-debug.apk`.

### Install to your watch via ADB

```bash
# Pair watch (one time per workstation)
adb pair <watch-ip>:<pair-port>          # codes shown on watch when you tap "Pair new device"
# Connect
adb connect <watch-ip>:<adb-port>         # IP and port shown on Wireless Debugging screen
# Install
./gradlew :app:installDebug
# or: adb install app/build/outputs/apk/debug/app-debug.apk
```

App appears in your watch's app drawer as **Philm Reciprocity**.

### Map Quick Button (optional but recommended)
On your phone, open the **Galaxy Wearable** app:
- Watch settings → Advanced features → Customize keys → **Quick Button** → set to Philm Reciprocity

Now pressing the Quick Button while the app is open immediately starts the countdown.

## Hardware notes

- **Digital bezel** on Galaxy Watch Ultra: drag finger around screen edge → emits `RotaryScrollEvent` to whatever's focused. We handle this in `RotaryScrollable.kt`. Crown gesture (vertical swipe on side) works too.
- **Adaptive rotary steps**: <5s = 0.5s steps, <30s = 1s, <2min = 5s, <10min = 15s, else 60s
- **Quick Button**: only fires to our app when our app is in foreground. From watch face, the button does whatever the user has set system-wide.
- **Always-on**: countdown screen sets `FLAG_KEEP_SCREEN_ON` to prevent screen-off mid-exposure.

## Future ideas

- Tile (glanceable card from watch face) showing current stock + last metered value
- Watch face complication showing reciprocity-adjusted time at a glance
- Sync stock selection back to phone via Wearable Data Layer API
- Save shoot logs to local storage with timestamps
