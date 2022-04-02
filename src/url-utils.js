import { BlockList } from 'net';

const dns = require('dns').promises;

export default async function urlAllowed(urlStr) {
  let url;
  try {
    url = new URL(urlStr);
  } catch (e) {
    return false;
  }

  const { hostname, protocol } = url;

  const allowedProtocols = ['http:', 'https:'];
  if (!allowedProtocols.includes(protocol.toLowerCase())) {
    return false;
  }

  let ip;
  try {
    // Note we are only allowing IPv4 for now. IPv6 will require additional work.
    ip = (await dns.lookup(hostname, { family: 4 })).address;
  } catch (e) {
    return false;
  }

  if (!ip) return false;

  const blockList = new BlockList();
  blockList.addSubnet('0.0.0.0', 8);
  blockList.addSubnet('10.0.0.0', 8);
  blockList.addSubnet('127.0.0.0', 8);
  blockList.addSubnet('169.254.0.0', 16);
  blockList.addSubnet('172.16.0.0', 12);
  blockList.addSubnet('192.168.0.0', 16);

  return !blockList.check(ip);
}
