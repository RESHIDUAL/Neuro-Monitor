# Neuro Monitor: Build 2 steps (full app) on Windows 11

Build 2 adds the real app: dashboard, guided test (5 core + 3 contextual activities), live monitor,
medications, neurologist PDF report and settings. New native libraries: expo-sqlite 57.0.7,
react-native-svg 15.15.4, expo-print 57.0.2, expo-sharing 57.0.27, expo-keep-awake 57.0.2.
New native libraries mean one more full native build (about 15 to 25 minutes).

## Step B1: Stop everything from Build 1
Close Metro (Ctrl+C) and the simulator. Then in PowerShell:
```powershell
cd C:\dev\neuromon\android
.\gradlew --stop
cd C:\dev
Rename-Item neuromon neuromon_build1
```
(Build 1 stays in `C:\dev\neuromon_build1`, including its release APK if you built it.)

Give Gradle more memory (one time; fixes the "out of JVM Metaspace" warning):
```powershell
Add-Content "$env:USERPROFILE\.gradle\gradle.properties" "`norg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g"
Get-Content "$env:USERPROFILE\.gradle\gradle.properties"
```

## Step B2: Unzip Build 2 and install packages
```powershell
Expand-Archive "$env:USERPROFILE\Downloads\neuromon_build2_app.zip" -DestinationPath C:\dev -Force
cd C:\dev\neuromon
npm ci
```

## Step B3: Build and run on the emulator (emulator must show `device` in `adb devices`)
```powershell
npx expo run:android
```
On first launch: tap "I understand and consent".

## Step B4: Try it with synthetic data
1. More tab: choose a **Preprocessing profile** (A or B). Nothing is pre-selected on purpose.
2. More tab: Data source **In-app demo signal**, mode **Rest** (or keep UDP and run the laptop simulator:
   `adb emu redir add udp:8888:8888` then `python tools\band_simulator.py --mode rest`).
3. Test tab: choose the wrist, **Start core test**, run all five activities (30 s each), optionally one contextual activity, then **Finish**.
4. Report tab: **Create and share PDF**.
Every screen marks synthetic data and the unconfirmed preprocessing.

## Step B5: Standalone release APK (final deliverable)
```powershell
cd C:\dev\neuromon\android
.\gradlew assembleRelease "-PreactNativeArchitectures=x86_64,arm64-v8a"
adb install -r app\build\outputs\apk\release\app-release.apk
```
APK: `C:\dev\neuromon\android\app\build\outputs\apk\release\app-release.apk`
Check with Metro stopped: More tab -> Run model self-test must show PASS for both models
(Build 2 loads the models through expo-asset, which fixes the release-build "no protocol" error).

## Real band on a phone (later)
Phone hotspot on 2.4 GHz with the band's Wi-Fi name and password, firmware sending to `WiFi.gatewayIP()`,
app Data source = Wi-Fi wristband (UDP). Feedback packets to the band remain disabled.
