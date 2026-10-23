// APP_VARIANT=test (eas.json profile `test`) builds "Philm+Frame TEST" under its
// own package id, so a trial build installs next to the real app instead of
// replacing it.
const isTest = process.env.APP_VARIANT === 'test';
const base = require('./app.json').expo;

module.exports = {
  expo: {
    ...base,
    ...(isTest ? { name: `${base.name} TEST` } : {}),
    extra: {
      ...base.extra,
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    },
    android: {
      ...base.android,
      ...(isTest ? { package: `${base.android.package}.test` } : {}),
      config: {
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_API_KEY || '',
        },
      },
    },
  },
};
