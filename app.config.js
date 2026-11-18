// APP_VARIANT=test (eas.json profile `test`) builds "Philm+Frame TEST" under its
// own package id, so a trial build installs next to the real app instead of
// replacing it. Its icon is the real one inverted (black on white), so the
// two are easy to tell apart on the home screen.
const isTest = process.env.APP_VARIANT === 'test';
const base = require('./app.json').expo;

module.exports = {
  expo: {
    ...base,
    ...(isTest ? { name: `${base.name} TEST`, icon: './src/assets/icon-test.png' } : {}),
    extra: {
      ...base.extra,
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
      // TEST build tag: changing it changes the build fingerprint, so the next push builds a fresh TEST APK
      // (13 Nov 2026: Phil's TEST app stopped taking instant updates; bumping version / versionCode does not
      // change the fingerprint). The real app is not affected.
      ...(isTest ? { testBuild: '2026-11-13' } : {}),
    },
    android: {
      ...base.android,
      ...(isTest ? {
        package: `${base.android.package}.test`,
        adaptiveIcon: { foregroundImage: './src/assets/adaptive-icon-test.png', backgroundColor: '#ffffff' },
      } : {}),
      config: {
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_API_KEY || '',
        },
      },
    },
  },
};
