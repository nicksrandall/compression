import zlib from 'zlib';
import http, { IncomingMessage } from 'http';
import request from 'supertest';
import test from 'ava';
import crypto from 'crypto';
import Compression, { Options, ServerResponse } from './index';

test('should skip HEAD', (t) => {
  const server = createServer(
    { threshold: 0 },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end('hello, world');
    }
  );

  return request(server)
    .head('/')
    .set('Accept-Encoding', 'gzip')
    .expect(shouldNotHaveHeader('Content-Encoding'))
    .expect(200)
    .then(() => t.pass());
});

test('should skip unknown accept-encoding', (t) => {
  const server = createServer(
    { threshold: 0 },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end('hello, world');
    }
  );

  return request(server)
    .get('/')
    .set('Accept-Encoding', 'bogus')
    .expect(shouldNotHaveHeader('Content-Encoding'))
    .expect(200)
    .then(() => t.pass());
});

test('should skip if content-encoding already set', (t) => {
  const server = createServer(
    { threshold: 0 },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Encoding', 'x-custom');
      res.end('hello, world');
    }
  );

  return request(server)
    .get('/')
    .set('Accept-Encoding', 'gzip')
    .expect('Content-Encoding', 'x-custom')
    .expect(200, 'hello, world')
    .then(() => t.pass());
});

test('should set Vary', (t) => {
  const server = createServer(
    { threshold: 0 },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end('hello, world');
    }
  );

  return request(server)
    .get('/')
    .set('Accept-Encoding', 'br')
    .expect('Content-Encoding', 'br')
    .expect('Vary', 'Accept-Encoding')
    .then(() => t.pass());
});

test('should set Vary even if Accept-Encoding is not set', (t) => {
  const server = createServer(
    { threshold: 1000 },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end('hello, world');
    }
  );

  return request(server)
    .get('/')
    .expect('Vary', 'Accept-Encoding')
    .expect(shouldNotHaveHeader('Content-Encoding'))
    .expect(200)
    .then(() => t.pass());
});

test('should not set Vary if Content-Type does not pass filter', (t) => {
  const server = createServer(
    undefined,
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'image/jpeg');
      res.end('hello, world');
    }
  );

  return request(server)
    .get('/')
    .expect(shouldNotHaveHeader('Vary'))
    .expect(200)
    .then(() => t.pass());
});

test('should set Vary for HEAD request', (t) => {
  const server = createServer(
    { threshold: 0 },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end('hello, world');
    }
  );

  return request(server)
    .head('/')
    .set('Accept-Encoding', 'gzip')
    .expect('Vary', 'Accept-Encoding')
    .then(() => t.pass());
});

test('should transfer chunked', (t) => {
  const server = createServer(
    { threshold: 0 },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end('hello, world');
    }
  );

  return request(server)
    .get('/')
    .set('Accept-Encoding', 'br')
    .expect('Transfer-Encoding', 'chunked')
    .then(() => t.pass());
});

test('should remove Content-Length for chunked', (t) => {
  const server = createServer(
    { threshold: 0 },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end('hello, world');
    }
  );

  return request(server)
    .get('/')
    .expect('Content-Encoding', 'gzip')
    .expect(shouldNotHaveHeader('Content-Length'))
    .expect(200)
    .then(() => t.pass());
});

test('should work with encoding arguments', (t) => {
  const server = createServer(
    { threshold: 0 },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'text/plain');
      res.write('hello, ', 'utf8');
      res.end('world', 'utf8');
    }
  );

  return request(server)
    .get('/')
    .set('Accept-Encoding', 'gzip')
    .expect('Transfer-Encoding', 'chunked')
    .expect(200, 'hello, world')
    .then(() => t.pass());
});

test('should allow writing after close', (t) => {
  return new Promise((resolve) => {
    const server = createServer(
      { threshold: 0 },
      (_req: IncomingMessage, res: ServerResponse) => {
        res.setHeader('Content-Type', 'text/plain');
        res.once('close', function () {
          res.write('hello, ');
          res.end('world');
          resolve();
        });
        res.destroy();
      }
    );

    request(server)
      .get('/')
      .end(() => {});
  }).then(() => t.pass());
});

test('should back-pressure when compressed', (t) => {
  return new Promise((resolve, reject) => {
    let buf: any;
    let cb = after(2, resolve, reject);
    let client: IncomingMessage;
    let drained: boolean = false;
    let resp: ServerResponse & { flush: () => void };
    const server = createServer(
      { threshold: 0 },
      (_req: IncomingMessage, res: ServerResponse) => {
        resp = res as typeof resp;

        res.on('drain', () => {
          drained = true;
        });

        res.setHeader('Content-Type', 'text/plain');
        res.write('start');
        pressure();
      }
    );

    crypto.randomBytes(1024 * 128, (err, chunk) => {
      if (err) return t.fail(err.toString());
      buf = chunk;
      pressure();
    });

    function pressure() {
      if (!buf || !resp || !client) return;

      t.truthy(!drained);

      while (resp.write(buf) !== false) {
        resp.flush();
      }

      resp.on('drain', function () {
        t.truthy(resp.write('end'));
        resp.end();
      });

      resp.on('finish', cb);
      client.resume();
    }

    (request(server).get('/') as any)
      .request()
      .on('response', (res: IncomingMessage) => {
        client = res;
        t.is(res.headers['content-encoding'], 'gzip');
        res.pause();
        res.on('end', function () {
          server.close(cb);
        });
        pressure();
      })
      .end();
  }).then(() => t.pass());
});

test.skip('should back-pressure when uncompressed', (t) => {
  return new Promise((resolve, reject) => {
    let buf: any;
    let cb = after(2, resolve, reject);
    let client: IncomingMessage;
    let drained: boolean = false;
    let resp: ServerResponse & { flush: () => void };
    const server = createServer(
      {
        filter: (): boolean => {
          return false;
        },
      },
      (_req: IncomingMessage, res: ServerResponse) => {
        resp = res as typeof resp;

        res.on('drain', () => {
          drained = true;
        });

        res.setHeader('Content-Type', 'text/plain');
        res.write('start');
        pressure();
      }
    );

    crypto.randomBytes(1024 * 128, (err, chunk) => {
      if (err) return t.fail(err.toString());
      buf = chunk;
      pressure();
    });

    function pressure() {
      if (!buf || !resp || !client) return;

      while (resp.write(buf) !== false) {
        resp.flush();
      }

      resp.on('drain', () => {
        t.truthy(drained);
        t.truthy(resp.write('end'));
        resp.end();
      });

      resp.on('finish', cb);
      client.resume();
    }

    (request(server).get('/') as any)
      .request()
      .on('response', (res: IncomingMessage) => {
        client = res;
        shouldNotHaveHeader('Content-Encoding')(res);
        res.pause();
        res.on('end', () => {
          server.close(cb);
        });
        pressure();
      })
      .end();
  }).then(() => t.pass());
});

test('should transfer large bodies', (t) => {
  const buf = Buffer.alloc(1000000, '.');
  const server = createServer(
    { threshold: 0 },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end(buf);
    }
  );

  return request(server)
    .get('/')
    .set('Accept-Encoding', 'gzip')
    .expect('Transfer-Encoding', 'chunked')
    .expect('Content-Encoding', 'gzip')
    .expect(shouldHaveBodyLength(1000000))
    .expect(200, buf.toString())
    .then(() => t.pass());
});

test('should transfer large bodies with multiple writes', (t) => {
  const len = 40000;
  const buf = Buffer.alloc(len, '.');
  const server = createServer(
    { threshold: 0 },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'text/plain');
      res.write(buf);
      res.write(buf);
      res.write(buf);
      res.end(buf);
    }
  );

  return request(server)
    .get('/')
    .set('Accept-Encoding', 'gzip')
    .expect('Transfer-Encoding', 'chunked')
    .expect('Content-Encoding', 'gzip')
    .expect(shouldHaveBodyLength(len * 4))
    .expect(200)
    .then(() => t.pass());
});

test('should compress when streaming without a content-length', (t) => {
  const server = createServer(
    { threshold: 1000 },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'text/plain');
      res.write('hello, ');
      setTimeout(() => {
        res.end('world');
      }, 10);
    }
  );

  return request(server)
    .get('/')
    .set('Accept-Encoding', 'gzip')
    .expect('Content-Encoding', 'gzip')
    .then(() => t.pass());
});

test('should consider res.end() as 0 length', (t) => {
  const server = createServer(
    { threshold: 1 },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end();
    }
  );

  return request(server)
    .get('/')
    .set('Accept-Encoding', 'gzip')
    .expect(shouldNotHaveHeader('Content-Encoding'))
    .expect(200)
    .then(() => t.pass());
});

test('should return false writing after end', (t) => {
  const server = createServer(
    { threshold: 0 },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end('hello, world');
      t.false(res.write(null));
      t.falsy(res.end());
    }
  );

  return request(server)
    .get('/')
    .set('Accept-Encoding', 'gzip')
    .expect('Content-Encoding', 'gzip')
    .then(() => t.pass());
});

test('flush should always be present', (t) => {
  const server = createServer(
    undefined,
    (_req: IncomingMessage, res: ServerResponse) => {
      res.statusCode = typeof res.flush === 'function' ? 200 : 500;
      res.flush!();
      res.end();
    }
  );

  return request(server)
    .get('/')
    .expect(200)
    .then(() => t.pass());
});

test('should not compress response when "Cache-Control: no-transform"', (t) => {
  const server = createServer(
    { threshold: 0 },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Cache-Control', 'no-transform');
      res.setHeader('Content-Type', 'text/plain');
      res.end('hello, world');
    }
  );

  return request(server)
    .get('/')
    .set('Accept-Encoding', 'gzip')
    .expect('Cache-Control', 'no-transform')
    .expect(shouldNotHaveHeader('Content-Encoding'))
    .expect(200, 'hello, world')
    .then(() => t.pass());
});

test('when "Accept-Encoding: deflate"', (t) => {
  const server = createServer(
    { threshold: 0 },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end('hello, world');
    }
  );

  return request(server)
    .get('/')
    .set('Accept-Encoding', 'deflate')
    .expect('Content-Encoding', 'deflate')
    .then(() => t.pass());
});

test('when "Accept-Encoding: deflate, gzip"', (t) => {
  const server = createServer(
    { threshold: 0 },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end('hello, world');
    }
  );

  return request(server)
    .get('/')
    .set('Accept-Encoding', 'deflate, gzip')
    .expect('Content-Encoding', 'gzip')
    .then(() => t.pass());
});

test('req.flush should flush the response', (t) => {
  return new Promise((resolve, reject) => {
    let chunks = 0;
    let next: ReturnType<typeof writeAndFlush>;
    const server = createServer(
      { threshold: 0 },
      (_req: IncomingMessage, res: ServerResponse) => {
        next = writeAndFlush(res, 2, Buffer.alloc(1024));
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Length', '2048');
        next();
      }
    );

    function onchunk(chunk: any) {
      t.truthy(chunks++ < 2);
      t.is(chunk.length, 1024);
      next!();
    }

    (request(server).get('/').set('Accept-Encoding', 'gzip') as any)
      .request()
      .on(
        'response',
        unchunk('gzip', onchunk, (err?: Error) => {
          if (err) return reject(err);
          server.close(resolve);
        })
      )
      .end();
  }).then(() => t.pass());
});

test('when "Accept-Encoding: deflate, gzip, br"', (t) => {
  const server = createServer(
    { threshold: 0 },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end('hello, world');
    }
  );

  return request(server)
    .get('/')
    .set('Accept-Encoding', 'gzip, deflate, br')
    .expect('Content-Encoding', 'br')
    .then(() => t.pass());
});

function shouldHaveBodyLength(length: number) {
  return (res: IncomingMessage & { text: string }) => {
    if (res.text.length !== length) {
      throw Error(`req should have body length of: ${length}`);
    }
  };
}

function shouldNotHaveHeader(header: string) {
  return (res: IncomingMessage) => {
    if (header.toLowerCase() in res.headers) {
      throw Error(`req should not have header: ${header}`);
    }
  };
}

function createServer(
  opts: Options | undefined,
  fn: (req: IncomingMessage, res: ServerResponse) => void
) {
  const _compression = Compression(opts);
  return http.createServer(
    _compression((req, res) => {
      fn(req, res);
    })
  );
}

function after(
  count: number,
  callback: (...args: any[]) => any,
  err_cb: (...args: any[]) => any = noop
) {
  let bail = false;
  proxy.count = count;

  return count === 0 ? callback() : proxy;

  function proxy(err: Error, result: any) {
    if (proxy.count <= 0) {
      throw new Error('after called too many times');
    }
    --proxy.count;

    // after first error, rest are passed to err_cb
    if (err) {
      bail = true;
      callback(err);
      // future error callbacks will go to error handler
      callback = err_cb;
    } else if (proxy.count === 0 && !bail) {
      callback(null, result);
    }
  }
}

function noop() {}

function writeAndFlush(
  stream: ServerResponse,
  count: number,
  buf: Buffer
): () => void {
  var writes = 0;

  return function () {
    if (writes++ >= count) return;
    if (writes === count) return stream.end(buf);
    stream.write(buf);
    stream.flush!();
  };
}

function unchunk(
  encoding: 'gzip' | 'br' | 'deflate',
  onchunk: any,
  onend: any
): (res: IncomingMessage) => void {
  return (res: IncomingMessage) => {
    var stream;

    if (res.headers['content-encoding'] !== encoding) {
      throw new Error(`Content-Encoding header does not match`);
    }

    switch (encoding) {
      case 'deflate':
        stream = res.pipe(zlib.createInflate());
        break;
      case 'gzip':
        stream = res.pipe(zlib.createGunzip());
        break;
      case 'br':
        stream = res.pipe(zlib.createGunzip());
        break;
    }

    stream.on('data', onchunk);
    stream.on('end', onend);
  };
}
