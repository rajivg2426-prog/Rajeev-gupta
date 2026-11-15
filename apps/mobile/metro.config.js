// Expo's default Metro config already understands npm workspaces (watchFolders and
// nodeModulesPaths include the repo root), so the only addition is NativeWind.
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css" });
