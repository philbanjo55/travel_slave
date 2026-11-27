// babel-preset-expo adds the react-native-worklets plugin (Reanimated 4) itself
// when the package is installed, so it is not listed here.
module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
