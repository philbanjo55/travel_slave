// Raise Android's AsyncStorage ceiling.
//
// AsyncStorage on Android is a single SQLite database with a maximum size, and
// it defaults to 6 MB. Past that every setItem throws SQLITE_FULL — observed
// directly on this app at 6009 kB:
//
//     database or disk is full (code 13 SQLITE_FULL[13])
//
// The failure is caught per key, so the app keeps running and keeps showing
// correct data; it is only on restart, when the stale cache is replayed, that
// anything looks wrong. This trip stores ~1.7 MB of weather for 72 stops, and
// 18 sources per stop with a score each is not a payload that shrinks.
//
// The library reads this value from gradle.properties. There is no android/
// directory in a managed Expo project, so it is set through a config plugin
// instead, which means it only takes effect in a native build (EAS or a local
// prebuild) — Expo Go ships its own binary and ignores it.
const { withGradleProperties } = require('@expo/config-plugins');

const KEY = 'AsyncStorage_db_size_in_MB';
const SIZE_MB = 200;

module.exports = function withAsyncStorageDbSize(config) {
  return withGradleProperties(config, cfg => {
    // Replace rather than append: a duplicate key in gradle.properties is not
    // an error, it just silently takes whichever Gradle reads last.
    cfg.modResults = cfg.modResults.filter(
      item => !(item.type === 'property' && item.key === KEY)
    );
    cfg.modResults.push({ type: 'property', key: KEY, value: String(SIZE_MB) });
    return cfg;
  });
};
