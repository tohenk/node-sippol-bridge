/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2020-2024 Toha <tohenk@yahoo.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const path = require('path');
const Cmd = require('@ntlab/ntlib/cmd');

Cmd.addBool('help', 'h', 'Show program usage').setAccessible(false);
Cmd.addVar('mode', 'm', 'Set bridge mode, spp or bl', 'bridge-mode');
Cmd.addVar('config', 'c', 'Set configuration file', 'filename');
Cmd.addVar('port', 'p', 'Set server port to listen', 'port');
Cmd.addVar('url', '', 'Set SIPPOL url', 'url');
Cmd.addVar('profile', '', 'Use profile for operation', 'profile');
Cmd.addBool('queue', 'q', 'Enable queue saving and loading');
Cmd.addBool('noop', '', 'Do not process queue');

if (!Cmd.parse() || (Cmd.get('help') && usage())) {
    process.exit();
}

const fs = require('fs');
const util = require('util');
const Work = require('@ntlab/work/work');
const SippolSppBridge = require('./bridge/spp');
const SippolTrxblBridge = require('./bridge/trxbl');
const { SippolQueue } = require('./queue');
const SippolNotifier = require('./notifier');
const SippolCmd = require('./cmd');
const debug = require('debug')('sippol:main');

class App {

    VERSION = 'SIPPOL-BRIDGE-3.0'

    BRIDGE_SPP = 'spp'
    BRIDGE_TRXBL = 'bl'

    config = {}
    bridges = []
    sockets = []
    sessions = {}

    initialize() {
        // read configuration from command line values
        let profile, filename = Cmd.get('config') ? Cmd.get('config') : path.join(__dirname, 'config.json');
        if (fs.existsSync(filename)) {
            const config = JSON.parse(fs.readFileSync(filename));
            if (config.global) {
                this.config = config.global;
                this.configs = config.bridges;
            } else {
                this.config = config;
            }
        }
        for (const c of ['mode', 'url']) {
            if (Cmd.get(c)) {
                this.config[c] = Cmd.get(c);
            }
        }
        if (!this.config.mode) {
            return false;
        }
        if (!this.config.workdir) {
            this.config.workdir = __dirname;
        }
        if (!this.config.downloaddir) {
            this.config.downloaddir = path.join(this.config.workdir, 'download');
        }
        if (fs.existsSync(filename)) {
            console.log('Configuration loaded from %s', filename);
        }
        // load roles
        filename = path.join(__dirname, 'roles.json');
        if (fs.existsSync(filename)) {
            this.config.roles = JSON.parse(fs.readFileSync(filename));
            console.log('Roles loaded from %s', filename);
        }
        // load bridge specific configuration
        switch (this.config.mode) {
            case this.BRIDGE_SPP:
                // load form maps
                filename = path.join(__dirname, 'maps.json');
                if (fs.existsSync(filename)) {
                    this.config.maps = JSON.parse(fs.readFileSync(filename));
                    console.log('Maps loaded from %s', filename);
                }
                // load doc maps
                filename = path.join(__dirname, 'docs.json');
                if (fs.existsSync(filename)) {
                    this.config.docs = JSON.parse(fs.readFileSync(filename));
                    console.log('Document maps loaded from %s', filename);
                }
                // add default bridges
                if (!this.configs) {
                    const year = new Date().getFullYear();
                    this.configs = {[`sippol-${year}`]: {year}};
                }
                break;
        }
        // load profile
        this.config.profiles = {};
        filename = path.join(__dirname, 'profiles.json');
        if (fs.existsSync(filename)) {
            const profiles = JSON.parse(fs.readFileSync(filename));
            if (profiles.profiles) {
                this.config.profiles = profiles.profiles;
            }
            if (profiles.active) {
                profile = profiles.active;
            }
        }
        if (Cmd.get('profile')) {
            profile = Cmd.get('profile');
        }
        if (profile && this.config.profiles[profile]) {
            console.log('Using profile %s', profile);
            const keys = ['timeout', 'wait', 'delay', 'opdelay'];
            for (const key in this.config.profiles[profile]) {
                if (keys.indexOf(key) < 0) {
                    continue;
                }
                this.config[key] = this.config.profiles[profile][key];
            }
        }
        return true;
    }

    createDequeuer() {
        this.dequeue = SippolQueue.createDequeuer();
        this.dequeue.setInfo({version: this.VERSION, ready: () => this.ready ? 'Yes' : 'No'});
        this.dequeue.createQueue = data => {
            let queue;
            switch (data.type) {
                case SippolQueue.QUEUE_SPP:
                    queue = SippolQueue.createSppQueue(data.data, data.callback);
                    queue.maps = this.config.maps;
                    queue.info = queue.getMappedData('penerima.penerima');
                    break;
                case SippolQueue.QUEUE_UPLOAD:
                    queue = SippolQueue.createUploadQueue(data.data, data.callback);
                    break;
                case SippolQueue.QUEUE_QUERY:
                    queue = SippolQueue.createQueryQueue(data.data, data.callback);
                    break;
                case SippolQueue.QUEUE_LIST:
                    queue = SippolQueue.createListQueue(data.data, data.callback);
                    break;
                case SippolQueue.QUEUE_DOWNLOAD:
                    queue = SippolQueue.createDownloadQueue(data.data, data.callback);
                    if (typeof data.download === 'function') {
                        queue.download = data.download;
                    }
                    break;
            }
            if (queue) {
                if (data.id) {
                    queue.id = data.id;
                }
                if (!queue.info) {
                    if (data.info) {
                        queue.info = data.info;
                    } else if (data.data.info) {
                        queue.info = data.data.info;
                    }
                }
                if (data.resolve !== undefined) {
                    queue.resolve = data.resolve;
                }
                if (data.reject !== undefined) {
                    queue.reject = data.reject;
                }
                if (queue.type === SippolQueue.QUEUE_SPP && SippolQueue.hasPendingQueue(queue)) {
                    return {message: `SPP ${queue.info} is already in queue!`};
                }
                console.log('+ %s: %s', queue.type.toUpperCase(), queue.info);
                return SippolQueue.addQueue(queue);
            }
        }
        this.dequeue
            .on('queue', () => this.handleNotify())
            .on('queue-done', () => this.handleNotify())
            .on('queue-error', () => this.handleNotify())
        ;
        if (Cmd.get('queue')) {
            const f = () => {
                console.log('Please wait, saving queues...');
                this.dequeue.saveQueue();
                this.dequeue.saveLogs();
                process.exit();
            }
            process.on('SIGINT', () => f());
            process.on('SIGTERM', () => f());
        }
    }

    createBridges() {
        const bridges = Object.keys(this.configs);
        bridges.forEach(name => {
            const options = this.configs[name];
            const config = Object.assign({}, this.config, options);
            if (config.enabled !== undefined && !config.enabled) {
                return true;
            }
            const browser = config.browser ? config.browser : 'default';
            if (browser) {
                if (!this.sessions[browser]) {
                    this.sessions[browser] = 0;
                }
                this.sessions[browser]++;
                if (this.sessions[browser] > 1) {
                    config.session = 's' + this.sessions[browser];
                }
            }
            let bridge;
            switch (this.config.mode) {
                case this.BRIDGE_SPP:
                    bridge = new SippolSppBridge(config);
                    break;
                case this.BRIDGE_TRXBL:
                    bridge = new SippolTrxblBridge(config);
                    break;
            }
            if (bridge) {
                bridge.name = name;
                bridge.year = config.year;
                this.bridges.push(bridge);
                console.log('Sippol bridge created: %s (%s)', name, bridge.accepts ? bridge.accepts.join(', ') : '*');
            }
        });
    }

    createServer(serve = true) {
        const { createServer } = require('http');
        const { Server } = require('socket.io');
        const http = createServer();
        const port = Cmd.get('port') || 3000;
        if (serve) {
            const opts = {};
            if (this.config.cors) {
                opts.cors = this.config.cors;
            } else {
                opts.cors = {origin: '*'};
            }
            const io = new Server(http, opts);
            io.of('/sippol')
                .on('connection', socket => {
                    this.handleConnection(socket);
                })
            ;
        }
        http.listen(port, () => {
            console.log('Application ready on port %s...', port);
            const selfTests = [];
            this.bridges.forEach(bridge => {
                selfTests.push(w => bridge.selfTest());
            });
            Work.works(selfTests)
                .then(() => {
                    if (Cmd.get('queue')) {
                        this.dequeue.loadQueue();
                    }
                    if (Cmd.get('noop')) {
                        console.log('Bridge ready, queuing only...');
                    } else {
                        console.log('Queue processing is ready...');
                        this.dequeue.setConsumer(this);
                    }
                })
                .catch(err => {
                    if (err) {
                        console.error('Self test reaches an error: %s!', err);
                    } else {
                        console.error('Self test reaches an error!');
                    }
                })
            ;
            this.checkReadiness();
        });
    }

    registerCommands() {
        const prefixes = {[this.BRIDGE_SPP]: 'spp', [this.BRIDGE_TRXBL]: 'trxbl'};
        SippolCmd.register(this, prefixes[this.config.mode]);
    }

    checkReadiness() {
        const readinessTimeout = this.config.readinessTimeout || 30000; // 30 seconds
        this.startTime = Date.now();
        const interval = setInterval(() => {
            const now = Date.now();
            this.ready = this.readyCount() === this.bridges.length;
            if (this.ready) {
                clearInterval(interval);
                console.log('Readiness checking is done...');
            } else {
                if (now - this.startTime > readinessTimeout) {
                    throw new Error(util.format('Bridge is not ready within %d seconds timeout!', readinessTimeout / 1000));
                }
            }
        }, 1000);
        console.log('Readiness checking has been started...');
    }

    handleConnection(socket) {
        console.log('Client connected: %s', socket.id);
        SippolCmd.handle(socket);
    }

    handleNotify() {
        this.sockets.forEach(socket => {
            socket.emit('status', this.dequeue.getStatus());
        });
    }

    isBridgeReady(bridge) {
        // bridge currently has no queue
        // or the last queue has been finished
        if (bridge && (bridge.queue === undefined || bridge.queue.finished())) {
            return true;
        }
        return false;
    }

    getQueueHandler(queue, ready = true) {
        const bridges = [];
        const year = queue.data && queue.data.year ? queue.data.year : null;
        // get prioritized bridge based on accepts type
        this.bridges.forEach(b => {
            if (b.isOperational() && b.year == year && Array.isArray(b.accepts) && b.accepts.indexOf(queue.type) >= 0) {
                if (!ready || this.isBridgeReady(b)) {
                    bridges.push(b);
                }
            }
        });
        // fallback to default bridge
        if (!bridges.length) {
            this.bridges.forEach(b => {
                if (b.isOperational() && b.year == year && b.accepts === undefined) {
                    if (!ready || this.isBridgeReady(b)) {
                        bridges.push(b);
                    }
                }
            });
        }
        return bridges;
    }

    readyCount() {
        let readyCnt = 0;
        this.bridges.forEach(b => {
            if (b.isOperational()) {
                readyCnt++;
            }
        });
        return readyCnt;
    }

    isBridgeIdle(queue) {
        const handlers = this.getQueueHandler(queue, false);
        if (handlers.length === 0) {
            debug('No handler', queue);
            queue.setStatus(SippolQueue.STATUS_SKIPPED);
        }
        const bridges = handlers.filter(b => this.isBridgeReady(b));
        return bridges.length ? true : false;
    }

    canProcessQueue() {
        if (this.readyCount() > 0) {
            const queue = this.dequeue.getNext();
            if (queue) {
                if (!queue.logged) {
                    debug('Next queue', queue);
                    queue.logged = true;
                }
            }
            return queue && (
                queue.type === SippolQueue.QUEUE_CALLBACK ||
                queue.status === SippolQueue.STATUS_SKIPPED ||
                this.isBridgeIdle(queue));
        }
        return false;
    }

    canHandleNextQueue(queue) {
        return this.isBridgeIdle(queue);
    }

    processQueue(queue) {
        if (queue.type === SippolQueue.QUEUE_CALLBACK) {
            return SippolNotifier.notify(queue);
        }
        const bridges = this.getQueueHandler(queue);
        if (bridges.length) {
            const bridge = bridges[Math.floor(Math.random() * bridges.length)];
            bridge.queue = queue;
            queue.bridge = bridge;
            queue.ontimeout = () => bridge.sippol.stop();
            switch (queue.type) {
                case SippolQueue.QUEUE_SPP:
                    return bridge.create(queue);
                case SippolQueue.QUEUE_UPLOAD:
                    return bridge.upload(queue);
                case SippolQueue.QUEUE_QUERY:
                    return bridge.query(queue);
                case SippolQueue.QUEUE_LIST:
                    return bridge.list(queue);
                case SippolQueue.QUEUE_DOWNLOAD:
                    return bridge.download(queue);
            }
        }
        return Promise.reject(util.format('No bridge can handle %s!', queue.getInfo()));
    }

    createDownloadData(dateKey, args) {
        const roles = Object.keys(this.config.roles.roles);
        const dt = new Date();
        let from, to;
        if (Array.isArray(args) && args.length) {
            [from, to] = args[0].split('~');
        } else {
            from = `${dt.getFullYear()}-01-01`;
            to = `${dt.getFullYear()}-${dt.getMonth().toString().padStart(2, '0')}-${dt.getDate().toString().padStart(2, '0')}`;
        }
        return {
            year: dt.getFullYear(),
            keg: roles[0],
            [dateKey]: [from, to].join('~'),
        }
    }

    run() {
        if (this.initialize()) {
            this.createDequeuer();
            this.createBridges();
            this.registerCommands();
            let cmd, serve = true;
            if (Cmd.args.length) {
                cmd = Cmd.args.shift();
            }
            switch (this.config.mode) {
                case this.BRIDGE_SPP:
                    if (cmd === 'download') {
                        if (this.config.roles) {
                            const data = Object.assign(this.createDownloadData('sp2d', Cmd.args), {
                                ondownload: (stream, name) => {
                                    const zipname = path.join(this.config.workdir, name + '.zip');
                                    fs.writeFileSync(zipname, stream);
                                    console.log(`Saved to ${zipname}...`);
                                    process.exit();
                                }
                            });
                            SippolCmd.get('spp:download').consume({data});
                        } else {
                            console.error('Download skipped, no roles available!');
                            process.exit();
                        }
                        serve = false;
                    }
                    break;
                case this.BRIDGE_TRXBL:
                    if (cmd === 'download') {
                        if (this.config.roles) {
                            const data = Object.assign(this.createDownloadData('date', Cmd.args), {
                                ondownload: (stream, name) => {
                                    const xlsname = path.join(this.config.workdir, name + '.xlsx');
                                    fs.writeFileSync(xlsname, stream);
                                    console.log(`Saved to ${xlsname}...`);
                                    process.exit();
                                }
                            });
                            SippolCmd.get('trxbl:download').consume({data});
                        } else {
                            console.error('Download skipped, no roles available!');
                            process.exit();
                        }
                        serve = false;
                    }
                    break;
            }
            this.createServer(serve);
            return true;
        } else {
            usage();
        }
    }
}

(function run() {
    new App().run();
})();

function usage() {
    console.log('Usage:');
    console.log('  node %s [options] [command] [params]', path.basename(process.argv[1]));
    console.log('');
    console.log('Command in spp mode:');
    console.log('   download   Download SPP then exit after completion');
    console.log('');
    console.log('Command in bl mode:');
    console.log('   download   Download SPJ then exit after completion');
    console.log('');
    console.log('Options:');
    console.log(Cmd.dump());
    console.log('');
    return true;
}