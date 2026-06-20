const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const WebpackObfuscator = require('webpack-obfuscator');

module.exports = {
  mode: 'production',
  entry: {
    background: './src/background.js',
    'popup/popup': './src/popup/popup.js',
    'options/options': './src/options/options.js',
    'content/amazon-product': './src/content/amazon-product.js',
    'content/amazon-search': './src/content/amazon-search.js',
    'content/ebay-listing': './src/content/ebay-listing.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].bundle.js',
    clean: true,
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'src/manifest.json', to: 'manifest.json' },
        { from: 'src/popup/popup.html', to: 'popup/popup.html' },
        { from: 'src/popup/popup.css', to: 'popup/popup.css' },
        { from: 'src/options/options.html', to: 'options/options.html' },
        { from: 'src/options/options.css', to: 'options/options.css' },
        { from: 'src/content/amazon-overlay.css', to: 'content/amazon-overlay.css' },
        { from: 'src/content/ebay-overlay.css', to: 'content/ebay-overlay.css' },
        { from: 'src/icons', to: 'icons' },
        { from: 'src/templates', to: 'templates' },
      ],
    }),
    new WebpackObfuscator({
      rotateStringArray: true,
      stringArray: true,
      stringArrayShuffle: true,
      stringArrayThreshold: 0.75,
      identifierNamesGenerator: 'hexadecimal',
      renameGlobals: false,
      selfDefending: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.5,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.3,
      debugProtection: true,
      debugProtectionInterval: 2000,
      disableConsoleOutput: false,
      domainLock: [],
      transformObjectKeys: true,
      unicodeEscapeSequence: false,
    }),
  ],
  optimization: {
    minimize: true,
  },
};
