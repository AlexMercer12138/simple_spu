const assert = require('assert');
const dgram = require('dgram');
const dns = require('dns');
const fs = require('fs');
const http = require('http');
const http2 = require('http2');
const https = require('https');
const net = require('net');
const path = require('path');
const tls = require('tls');

const DNS_MODULE_METHODS = Object.freeze([
    'lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny',
    'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs',
    'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTlsa', 'resolveTxt', 'reverse',
]);
const DNS_RESOLVER_METHODS = Object.freeze([
    'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname',
    'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa',
    'resolveSrv', 'resolveTlsa', 'resolveTxt', 'reverse',
]);
const logFile = requiredEnvironment('MERC32_SMOKE_NETWORK_GUARD_LOG');
const token = requiredEnvironment('MERC32_SMOKE_NETWORK_GUARD_TOKEN');
assert.match(token, /^[0-9a-f]{64}$/u, 'network guard token is invalid');

let selfTestActive = false;
let selfTestsRan = false;
const optionalSelfTests = installNetworkGuard();
record({ event: 'installed' });

function installNetworkGuard() {
    for (const [owner, names, prefix] of [
        [http, ['request', 'get'], 'http'],
        [https, ['request', 'get'], 'https'],
        [http2, ['connect'], 'http2'],
        [tls, ['connect'], 'tls'],
        [dns, DNS_MODULE_METHODS, 'dns'],
        [dns.Resolver.prototype, DNS_RESOLVER_METHODS, 'dns.Resolver.prototype'],
    ]) patchMethods(owner, names, prefix);

    const dnsPromises = dns.promises;
    if (dnsPromises) {
        patchMethods(dnsPromises, DNS_MODULE_METHODS, 'dns.promises');
        if (dnsPromises.Resolver) {
            patchMethods(
                dnsPromises.Resolver.prototype,
                DNS_RESOLVER_METHODS,
                'dns.promises.Resolver.prototype',
            );
        }
    }

    patchMethods(dgram, ['createSocket'], 'dgram');
    patchMethods(
        dgram.Socket.prototype,
        ['bind', 'connect', 'send'],
        'dgram.Socket.prototype',
    );
    net.Socket.prototype.connect = createGuardedConnect(
        'net.Socket.prototype.connect',
        net.Socket.prototype.connect,
    );
    net.connect = createGuardedConnect('net.connect', net.connect);
    net.createConnection = createGuardedConnect('net.createConnection', net.createConnection);

    const optional = [];
    if (typeof globalThis.fetch === 'function') {
        replaceGlobal('fetch', 'fetch');
        optional.push(['fetch', () => globalThis.fetch('http://127.0.0.1:9/')]);
    }
    if (typeof globalThis.WebSocket === 'function') {
        replaceGlobal('WebSocket', 'WebSocket');
        optional.push(['WebSocket', () => new globalThis.WebSocket('ws://127.0.0.1:9/')]);
    }
    const undici = loadOptionalUndici();
    if (undici) {
        for (const name of [
            'connect', 'fetch', 'pipeline', 'request', 'stream', 'upgrade',
        ]) {
            if (replaceMethod(undici, name, `undici.${name}`)) {
                optional.push([
                    `undici.${name}`,
                    () => undici[name]('http://127.0.0.1:9/'),
                ]);
            }
        }
        for (const name of [
            'Agent', 'BalancedPool', 'Client', 'Dispatcher', 'EnvHttpProxyAgent',
            'MockAgent', 'Pool', 'ProxyAgent', 'RetryAgent',
        ]) {
            const prototype = undici[name]?.prototype;
            const api = `undici.${name}.prototype.dispatch`;
            if (replaceMethod(prototype, 'dispatch', api)) {
                optional.push([api, () => Reflect.apply(prototype.dispatch, {}, [])]);
            }
        }
    }
    process.env.MERC32_SMOKE_NETWORK_GUARD_ACTIVE = '1';
    return optional;
}

function patchMethods(owner, names, prefix) {
    for (const name of names) replaceMethod(owner, name, `${prefix}.${name}`);
}

function replaceMethod(owner, name, api) {
    if (!owner || typeof owner[name] !== 'function') return false;
    owner[name] = (...args) => deny(api, args.length);
    return true;
}

function replaceGlobal(name, api) {
    Object.defineProperty(globalThis, name, {
        configurable: true,
        value: function (...args) {
            return deny(api, args.length);
        },
        writable: true,
    });
}

function createGuardedConnect(api, original) {
    return function (...args) {
        if (isAllowedIpcConnect(args)) return Reflect.apply(original, this, args);
        return deny(api, args.length);
    };
}

function isAllowedIpcConnect(args) {
    const first = args[0];
    const candidate = typeof first === 'string'
        ? first
        : first && typeof first === 'object' && first.port === undefined
            && first.host === undefined
            ? first.path
            : undefined;
    if (typeof candidate !== 'string' || candidate.length === 0
        || candidate.includes('\0')) return false;
    if (process.platform === 'win32') {
        const folded = candidate.toLocaleLowerCase('en-US');
        return (folded.startsWith('\\\\.\\pipe\\')
            || folded.startsWith('\\\\?\\pipe\\'))
            && candidate.length > '\\\\.\\pipe\\'.length;
    }
    return path.isAbsolute(candidate);
}

function deny(api, argumentCount) {
    record({
        api,
        argumentCount,
        event: 'denied',
        phase: selfTestActive ? 'self-test' : 'runtime',
    });
    const error = new Error(`MERC32 installed smoke denied network API ${api}.`);
    error.code = 'MERC32_NETWORK_DENIED';
    error.networkApi = api;
    throw error;
}

function activate() {
    heartbeat(token, 'active');
    return Object.freeze({ assertReady, heartbeat, runSelfTests });
}

function assertReady(candidate) {
    authenticate(candidate);
    return process.env.MERC32_SMOKE_NETWORK_GUARD_ACTIVE === '1';
}

function heartbeat(candidate, stage) {
    authenticate(candidate);
    assert.match(stage, /^[a-z][a-z-]*$/u, `unsafe guard heartbeat stage ${stage}`);
    record({ event: 'heartbeat', stage });
}

function runSelfTests(candidate) {
    authenticate(candidate);
    assert.strictEqual(selfTestsRan, false, 'network guard self-tests ran more than once');
    const deniedApis = [];
    const socket = new net.Socket();
    const tests = [
        ['dgram.createSocket', () => dgram.createSocket('udp4')],
        ['dgram.Socket.prototype.send', () => Reflect.apply(
            dgram.Socket.prototype.send,
            {},
            [Buffer.from('self-test', 'utf8'), 9, '127.0.0.1'],
        )],
        ['dns.Resolver.prototype.resolve', () => new dns.Resolver()
            .resolve('example.invalid', () => {})],
        ['dns.lookup', () => dns.lookup('example.invalid', () => {})],
        ['dns.promises.Resolver.prototype.resolve', () => new dns.promises.Resolver()
            .resolve('example.invalid')],
        ['dns.promises.resolve', () => dns.promises.resolve('example.invalid')],
        ['http.request', () => http.request('http://127.0.0.1:9/')],
        ['http2.connect', () => http2.connect('http://127.0.0.1:9/')],
        ['https.request', () => https.request('https://127.0.0.1:9/')],
        ['net.Socket.prototype.connect', () => socket.connect({
            host: '127.0.0.1',
            port: 9,
        })],
        ['net.connect', () => net.connect({ host: '127.0.0.1', port: 9 })],
        ['net.createConnection', () => net.createConnection({
            host: '127.0.0.1',
            port: 9,
        })],
        ['tls.connect', () => tls.connect({ host: '127.0.0.1', port: 9 })],
        ...optionalSelfTests,
    ];
    selfTestActive = true;
    try {
        for (const [api, invoke] of tests) {
            assert.throws(invoke, (error) => error?.code === 'MERC32_NETWORK_DENIED'
                && error.networkApi === api, `network guard self-test did not deny ${api}`);
            deniedApis.push(api);
        }
    } finally {
        selfTestActive = false;
        socket.destroy();
    }
    const namedPipeAllowed = selfTestNamedPipeAllowance();
    selfTestsRan = true;
    heartbeat(candidate, 'self-test-complete');
    return Object.freeze({
        deniedApis: Object.freeze(deniedApis),
        namedPipeAllowed,
    });
}

function selfTestNamedPipeAllowance() {
    const receiver = {};
    let received;
    const original = function (...args) {
        received = { args, receiver: this };
        return this;
    };
    const guarded = createGuardedConnect('named-pipe-self-test', original);
    const endpoint = process.platform === 'win32'
        ? '\\\\.\\pipe\\merc32-network-guard-self-test'
        : '/tmp/merc32-network-guard-self-test.sock';
    const options = { path: endpoint };
    const result = Reflect.apply(guarded, receiver, [options]);
    return result === receiver && received?.receiver === receiver
        && received.args.length === 1 && received.args[0] === options;
}

function loadOptionalUndici() {
    try {
        return require('undici');
    } catch (error) {
        if (error?.code === 'MODULE_NOT_FOUND') return undefined;
        throw error;
    }
}

function authenticate(candidate) {
    assert.strictEqual(candidate, token, 'network guard authentication token mismatch');
}

function record(fields) {
    fs.appendFileSync(logFile, `${JSON.stringify({
        ...fields,
        pid: process.pid,
        token,
        version: 1,
    })}\n`, { encoding: 'utf8' });
}

function requiredEnvironment(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing installed-smoke environment variable ${name}.`);
    return value;
}

module.exports = { activate };
