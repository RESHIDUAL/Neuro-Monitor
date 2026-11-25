// Metro bundles .tflite model files as app assets (needed by react-native-fast-tflite).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('tflite');

module.exports = config;
