// Build fingerprint settings (13 Nov 2026). The fingerprint decides whether a push becomes an instant update
// (same native side as an installed APK) or a new APK. By default it also hashes .gitignore, so adding three
// ignore lines on 12 Nov (c8bc5e6) made the next push build a new TEST APK that Phil never installed, and every
// later instant update went to that build instead of his. .gitignore does not change the native app: skip it,
// on top of the tool's default skips.
const { SourceSkips } = require('@expo/fingerprint');
const { DEFAULT_SOURCE_SKIPS } = require('@expo/fingerprint/build/Options');

/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  sourceSkips: DEFAULT_SOURCE_SKIPS | SourceSkips.GitIgnore,
};
