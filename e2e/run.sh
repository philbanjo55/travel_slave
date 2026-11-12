#!/usr/bin/env bash
# Runs inside the emulator job. Read-only: see e2e/fetchGuard.ts.
set -u
mkdir -p out
# Three-button navigation, like Phil's phone: the cut-off checks need the tall Home / Back bar, not the thin gesture line.
adb shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.threebutton || true
sleep 3
echo "INFO navigation_mode=$(adb shell settings get secure navigation_mode | tr -d '\r') (0 = three buttons, 2 = gestures)"
adb install -r -g apk/app.apk
adb shell pm grant com.philmframe.app.test android.permission.POST_NOTIFICATIONS || true
adb emu geo fix -77.1067 38.8816 || true
adb logcat -c || true
adb logcat -v time > out/logcat.txt 2>&1 &
LOGCAT=$!
python3 e2e/verify_buttons.py || echo "verify_buttons exited with $?"
adb shell svc wifi enable || true
adb shell svc data enable || true

kill $LOGCAT 2>/dev/null || true
grep -h "E2E_" out/logcat.txt > out/blocked-writes.txt || true
grep -h "ReactNativeJS" out/logcat.txt > out/js-console.txt || true
grep -hE "FATAL|AndroidRuntime" out/logcat.txt > out/native-errors.txt || true
exit 0
