module.exports = {
  expo: {
    ...require('./app.json').expo,
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
