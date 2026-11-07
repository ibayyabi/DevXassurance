// Preload for isolated runs: any attempt to reach the network throws.
// Node 20 has no network permission flag, so the common entry points are
// replaced instead: fetch, net/tls sockets, http(s) requests, dns lookups, UDP.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const blocked = (what) => () => {
  throw new Error(`network blocked in isolated run: ${what}`);
};

globalThis.fetch = async () => blocked("fetch")();
globalThis.WebSocket = class { constructor() { blocked("WebSocket")(); } };

const net = require("node:net");
net.Socket.prototype.connect = blocked("net.Socket.connect");
net.connect = blocked("net.connect");
net.createConnection = blocked("net.createConnection");

const tls = require("node:tls");
tls.connect = blocked("tls.connect");

for (const name of ["node:http", "node:https"]) {
  const mod = require(name);
  mod.request = blocked(`${name}.request`);
  mod.get = blocked(`${name}.get`);
}

const dns = require("node:dns");
dns.lookup = blocked("dns.lookup");
dns.resolve = blocked("dns.resolve");
dns.promises.lookup = async () => blocked("dns.promises.lookup")();
dns.promises.resolve = async () => blocked("dns.promises.resolve")();

require("node:dgram").createSocket = blocked("dgram.createSocket");
