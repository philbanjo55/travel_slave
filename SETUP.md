# PHILM+FRAME — Setup Guide

## One time Mac setup (~30 min)

### 1. Install Node.js
Go to nodejs.org → download LTS version → install it.

### 2. Install Expo CLI + EAS CLI
Open Terminal and run:
```
npm install -g expo-cli eas-cli
```

### 3. Create Expo account
Go to expo.dev → sign up free → remember your username

### 4. Create Supabase project
Go to supabase.com → New Project → name it "philmframe"
Save your:
- Project URL (looks like https://xxxx.supabase.co)
- Anon public key (long string starting with eyJ)

### 5. Run the database schema
In Supabase dashboard → SQL Editor → paste contents of supabase/schema.sql → Run

### 6. Add your credentials to the app
Open src/services/supabase.ts and replace:
- YOUR_SUPABASE_URL → your project URL
- YOUR_SUPABASE_ANON_KEY → your anon key

### 7. Get a free Google Maps API key
Go to console.cloud.google.com → create project → enable Maps SDK for Android
Add the key to app.json where it says YOUR_GOOGLE_MAPS_API_KEY

### 8. Build the APK
In Terminal, navigate to this folder and run:
```
cd philmframe
npm install
eas login
eas build --platform android --profile preview
```
Expo builds it in the cloud (~10 min), gives you a download link.
Download the APK on your Android phone and install it.

### 9. Enable unknown apps on Android
Settings → Apps → Special app access → Install unknown apps
Allow your browser to install APKs.

---

## After setup — workflow forever

1. Come to Claude chat
2. Plan and edit trips like normal
3. Claude pushes changes directly to Supabase
4. Open the app → auto syncs → done

No more file downloads. No more computer. Ever.

---

## Future updates to the app itself
If we add new features to the app, you run one command:
```
eas build --platform android --profile preview
```
Takes 10 min, gives new APK, install over the old one.
This is rare — the app shell barely ever needs to change.
