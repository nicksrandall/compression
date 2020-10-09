import http, { IncomingMessage, ServerResponse } from 'http';
import request from 'supertest';
import test from 'ava';
import Compression, { Options } from './index';

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
    {},
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

function shouldNotHaveHeader(header: string) {
  return (res: IncomingMessage) => {
    if (header.toLowerCase() in res.headers) {
      throw Error(`req should not have header: ${header}`);
    }
  };
}

function createServer(
  opts: Options,
  fn: (req: IncomingMessage, res: ServerResponse) => void
) {
  const _compression = Compression(opts);
  return http.createServer(
    _compression((req, res) => {
      fn(req, res);
    })
  );
}
