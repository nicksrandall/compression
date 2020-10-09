# @nicksrandall/compression
[![Build Status](https://travis-ci.org/nicksrandall/compression.svg?branch=master)](https://travis-ci.org/nicksrandall/compression)
[![codecov](https://codecov.io/gh/nicksrandall/compression/branch/master/graph/badge.svg)](https://codecov.io/gh/nicksrandall/compression)

HTTP Compression library for Node.js (v10+)

Supports Brotli, Gzip, and Deflate

## Example

```js
const http = require('http');
const Compression = require('@nicksrandall/compression');
const compression = Compression({ /* optional zlib settings */ });
const server = http.createServer(compression((req, res) => {
  // your request listener
}));

server.listen(3000);
```
