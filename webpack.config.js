const path = require('path');

module.exports = {
  mode: 'development',
  entry: './src/index.js',
  output: {
    library: 'ndnts',
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
};
