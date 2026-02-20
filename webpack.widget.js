const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    mode: isProd ? 'production' : 'development',
    entry: './src/widget.tsx',
    output: {
      path: path.resolve(__dirname, 'dist-widget'),
      filename: 'widget.js',
      library: {
        name: 'GradeAtacado',
        type: 'umd',
      },
      globalObject: 'this',
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: [
            {
              loader: 'ts-loader',
              options: {
                configFile: 'tsconfig.widget.json',
                transpileOnly: true,
              },
            },
          ],
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [
            isProd ? MiniCssExtractPlugin.loader : 'style-loader',
            'css-loader',
            {
              loader: 'postcss-loader',
              options: {
                postcssOptions: {
                  plugins: [
                    require('tailwindcss'),
                    require('autoprefixer'),
                  ],
                },
              },
            },
          ],
        },
      ],
    },
    plugins: [
      new MiniCssExtractPlugin({
        filename: 'widget.css',
      }),
    ],
    optimization: {
      minimize: isProd,
      usedExports: true,
      sideEffects: false,
    },
    performance: {
      hints: isProd ? 'warning' : false,
      maxEntrypointSize: 102400, // 100KB before gzip; gzip ~50% = ~50KB
      maxAssetSize: 102400,
    },
    devtool: isProd ? false : 'source-map',
  };
};
