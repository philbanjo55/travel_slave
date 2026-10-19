module.exports = {
  expo: {
    ...require('./app.json').expo,
    extra: {
      ...require('./app.json').expo.extra,
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    },
    android: {
      ...require('./app.json').expo.android,
      config: {
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_API_KEY || '',
        },
      },
    },
  },
};
