/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2020-2023 Toha <tohenk@yahoo.com>
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
Cmd.addVar('config', 'c', 'Set configuration file', 'filename');
Cmd.addVar('port', 'p', 'Set server port to listen', 'port');
Cmd.addVar('url', '', 'Set SIPPOL url', 'url');
Cmd.addVar('username', 'u', 'Set login username', 'username');
Cmd.addVar('password', 'p', 'Set login password', 'password');
Cmd.addVar('profile', '', 'Use profile for operation', 'profile');
Cmd.addBool('queue', 'q', 'Enable queue saving and loading');
Cmd.addBool('noop', '', 'Do not process queue');

if (!Cmd.parse() || (Cmd.get('help') && usage())) {
    process.exit();
}

const fs = require('fs');
const util = require('util');
const Work = require('@ntlab/work/work');
const SippolBridge = require('./bridge');
const SippolQueue = require('./queue');
const SippolNotifier = require('./notifier');

class App {

    VERSION = 'SIPPOL-BRIDGE-1.0'

    config = {}
    bridges = []
    sockets = []
    uploads = {}
    sessions = {}

    initialize() {
        let filename, profile;
        // read configuration from command line values
        filename = Cmd.get('config') ? Cmd.get('config') : path.join(__dirname, 'config.json');
        if (fs.existsSync(filename)) {
            console.log('Reading configuration %s', filename);
            const config = JSON.parse(fs.readFileSync(filename));
            if (config.global) {
                this.config = config.global;
                this.configs = config.bridges;
            } else {
                this.config = config;
            }
        }
        if (Cmd.get('url')) this.config.url = Cmd.get('url');
        if (Cmd.get('username')) this.config.username = Cmd.get('username');
        if (Cmd.get('password')) this.config.password = Cmd.get('password');
        if (!this.config.workdir) this.config.workdir = __dirname;
        if (!this.config.downloaddir) this.config.downloaddir = path.join(this.config.workdir, 'download');

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
        // load profile
        this.config.profiles = {};
        filename = path.join(__dirname, 'profiles.json');
        if (fs.existsSync(filename)) {
            const profiles = JSON.parse(fs.readFileSync(filename));
            if (profiles.profiles) this.config.profiles = profiles.profiles;
            if (profiles.active) profile = profiles.active;
        }
        if (Cmd.get('profile')) profile = Cmd.get('profile');
        if (profile && this.config.profiles[profile]) {
            console.log('Using profile %s', profile);
            const keys = ['timeout', 'wait', 'delay', 'opdelay'];
            for (let key in this.config.profiles[profile]) {
                if (keys.indexOf(key) < 0) continue;
                this.config[key] = this.config.profiles[profile][key];
            }
        }
        // add default bridges
        if (!this.configs) {
            this.configs = {yr: {year: new Date().getFullYear()}};
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
                if (queue.type === SippolQueue.QUEUE_SPP && SippolQueue.hasNewQueue(queue)) {
                    return {message: `SPP ${queue.info} sudah dalam antrian!`};
                }
                console.log('%s: %s', queue.type.toUpperCase(), queue.info);
                return SippolQueue.addQueue(queue);
            }
        }
        this.dequeue
            .on('queue', queue => this.handleNotify(queue))
            .on('queue-done', queue => this.handleNotify(queue))
            .on('queue-error', queue => this.handleNotify(queue))
        ;
        if (Cmd.get('queue')) {
            process.on(process.platform === 'win32' ? 'SIGINT' : 'SIGTERM', () => {
                console.log('Please wait, saving queues...');
                this.dequeue.saveQueue();
                this.dequeue.saveLogs();
                process.exit();
            });
        }
    }

    createBridges() {
        Object.keys(this.configs).forEach(name => {
            const options = this.configs[name];
            const config = Object.assign({}, this.config, options);
            if (config.enabled !== undefined && !config.enabled) {
                return true;
            }
            const browser = config.browser ? config.browser : 'default';
            if (browser) {
                if (!this.sessions[browser]) this.sessions[browser] = 0;
                this.sessions[browser]++;
                if (this.sessions[browser] > 1) config.session = 's' + this.sessions[browser];
            }
            if (!config.username || !config.password) {
                throw new Error(util.format('Unable to create bridge %s: username or password must be supplied!', name));
            }
            const bridge = new SippolBridge(config);
            bridge.name = name;
            bridge.year = config.year;
            this.bridges.push(bridge);
            console.log('Sippol bridge created: %s (%s)', name, bridge.accepts ? bridge.accepts.join(', ') : '*');
        });
    }

    createServer() {
        const { createServer } = require('http');
        const { Server } = require('socket.io');
        const http = createServer();
        const port = Cmd.get('port') || 3000;
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
                    this.dequeue.setConsumer(this);
                    console.log('Queue processing is ready...');
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

    checkReadiness() {
        const readinessTimeout = this.config.readinessTimeout || 30000; // 30 seconds
        this.startTime = Date.now();
        let interval = setInterval(() => {
            let now = Date.now();
            this.ready = this.readyCount() == this.bridges.length;
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
        socket
            .on('disconnect', () => {
                console.log('Client disconnected: %s', socket.id);
                const idx = this.sockets.indexOf(socket);
                if (idx >= 0) {
                    this.sockets.splice(idx);
                }
            })
            .on('notify', () => {
                if (this.sockets.indexOf(socket) < 0) {
                    this.sockets.push(socket);
                    console.log('Client notification enabled: %s', socket.id);
                }
            })
            .on('status', () => {
                socket.emit('status', this.dequeue.getStatus());
            })
            .on('setup', data => {
                if (data.callback) {
                    socket.callback = data.callback;
                }
                socket.emit('setup', {version: this.VERSION});
            })
            .on('spp', data => {
                const res = this.dequeue.createQueue({
                    type: SippolQueue.QUEUE_SPP,
                    data: data,
                    callback: socket.callback,
                });
                socket.emit('spp', res);
            })
            .on('upload', data => {
                let res;
                if (data.Id) {
                    res = this.dequeue.createQueue({
                        type: SippolQueue.QUEUE_UPLOAD,
                        data: data,
                        callback: socket.callback,
                    });
                } else {
                    const msg = 'Ignoring upload without Id';
                    console.log(msg);
                    res = {error: msg}
                }
                socket.emit('upload', res);
            })
            .on('upload-part', data => {
                let res;
                if (data.Id) {
                    if (this.uploads[data.Id] == undefined) {
                        this.uploads[data.Id] = {Id: data.Id};
                        if (data.year) this.uploads[data.Id].year = data.year;
                        if (data.info) this.uploads[data.Id].info = data.info;
                        if (data.term) this.uploads[data.Id].term = data.term;
                    }
                    const parts = [];
                    let partComplete = false;
                    let key;
                    Object.keys(data).forEach(k => {
                        if (['Id', 'info', 'term', 'year', 'seq', 'tot', 'size', 'len'].indexOf(k) < 0) {
                            let buff = Buffer.from(data[k], 'base64');
                            if (this.uploads[data.Id][k] != undefined) {
                                buff = Buffer.concat([this.uploads[data.Id][k], buff]);
                            }
                            this.uploads[data.Id][k] = buff;
                            key = k;
                        }
                    });
                    if (this.uploads[data.Id][key] != undefined) {
                        if (this.uploads[data.Id][key].length == data.size) {
                            partComplete = true;
                            parts.push(key);
                        }
                    }
                    if (parts.length) {
                        if (data.seq == data.tot && partComplete) {
                            res = this.dequeue.createQueue({
                                type: SippolQueue.QUEUE_UPLOAD,
                                data: this.uploads[data.Id],
                                callback: socket.callback,
                            });
                            delete this.uploads[data.Id];
                        } else {
                            res = {part: parts};
                        }
                    } else if (!partComplete && key) {
                        res = {part: [key], len: this.uploads[data.Id][key].length};
                    } else {
                        res = {error: 'Document part not found for ' + data.Id};
                    }
                } else {
                    const msg = 'Ignoring partial upload without Id';
                    console.log(msg);
                    res = {error: msg}
                }
                socket.emit('upload-part', res);
            })
            .on('query', data => {
                if (data.notify) {
                    const res = this.dequeue.createQueue({
                        type: SippolQueue.QUEUE_QUERY,
                        data: {year: data.year, term: data.term, notify: true},
                        info: data.term,
                        callback: socket.callback,
                    });
                    socket.emit('query', res);
                } else {
                    const f = () => new Promise((resolve, reject) => {
                        const res = this.dequeue.createQueue({
                            type: SippolQueue.QUEUE_QUERY,
                            data: {year: data.year, term: data.term},
                            info: data.term,
                            resolve: resolve,
                            reject: reject,
                            callback: socket.callback,
                        });
                    });
                    f()
                        .then(items => {
                            socket.emit('query', {result: items});
                        })
                        .catch(err => {
                            socket.emit('query', {error: err instanceof Error ? err.message : err});
                        })
                    ;
                }
            })
            .on('list', data => {
                const options = {year: data.year, timeout: 0};
                this.getDateForOptions(options, data);
                const res = this.dequeue.createQueue({
                    type: SippolQueue.QUEUE_LIST,
                    data: options,
                    info: data.term,
                    callback: socket.callback,
                });
                socket.emit('list', res);
            })
            .on('download', data => {
                const options = {year: data.year, timeout: 0};
                this.getDateForOptions(options, data);
                const res = this.dequeue.createQueue({
                    type: SippolQueue.QUEUE_DOWNLOAD,
                    data: options,
                    info: data.term,
                    callback: socket.callback,
                });
                socket.emit('download', res);
            })
            .on('logs', data => {
                if (data.id) {
                    socket.emit('logs', {ref: data.id, logs: this.dequeue.getLogs()});
                }
            })
        ;
    }

    getDateForOptions(options, data) {
        ['spp', 'spm', 'sp2d'].forEach(key => {
            const value = data[key];
            if (value) {
                let values;
                if (!isNaN(value)) {
                    values = new Date(value);
                }
                if (typeof value == 'string') {
                    const dates = value.split('~');
                    dates.forEach(dt => {
                        try {
                            const d = new Date(dt);
                            if (!values) {
                                values = {};
                            }
                            if (!values.from) {
                                values.from = d;
                            } else {
                                values.to = d;
                            }
                        }
                        catch (err) {
                            console.error('Unable to parse date: %s!', err);
                        }
                    });
                }
                if (values) {
                    options[key] = values;
                }
            }
        });
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

    getQueueHandler(queue) {
        const bridges = [];
        const year = queue.data && queue.data.year ? queue.data.year : null;
        // get prioritized bridge based on accepts type
        this.bridges.forEach(b => {
            if (b.isOperational() && b.year == year && Array.isArray(b.accepts) && b.accepts.indexOf(queue.type) >= 0) {
                if (this.isBridgeReady(b)) {
                    bridges.push(b);
                }
            }
        });
        // fallback to default bridge
        if (!bridges.length) {
            this.bridges.forEach(b => {
                if (b.isOperational() && b.year == year && b.accepts === undefined) {
                    if (this.isBridgeReady(b)) {
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
            if (b.isOperational()) readyCnt++;
        });
        return readyCnt;
    }

    isBridgeIdle(queue) {
        const bridges = this.getQueueHandler(queue);
        return bridges.length ? true : false;
    }

    canProcessQueue() {
        if (this.readyCount() > 0) {
            const queue = this.dequeue.getNext();
            return queue && (queue.type == SippolQueue.QUEUE_CALLBACK || this.isBridgeIdle(queue));
        }
        return false;
    }

    canHandleNextQueue(queue) {
        return this.isBridgeIdle(queue);
    }

    processQueue(queue) {
        if (queue.type == SippolQueue.QUEUE_CALLBACK) {
            return SippolNotifier.notify(queue);
        }
        const bridges = this.getQueueHandler(queue);
        if (bridges.length) {
            const bridge = bridges[Math.floor(Math.random() * bridges.length)];
            bridge.queue = queue;
            queue.bridge = bridge;
            queue.ontimeout = () => bridge.sippol.stop();
            if (Cmd.get('noop')) {
                return new Promise((resolve, reject) => {
                    setTimeout(() => resolve(`Queue ${queue.type}:${queue.id} handled by ${bridge.name}`), 60000);
                });
            } else {
                switch (queue.type) {
                    case SippolQueue.QUEUE_SPP:
                        return bridge.createSpp(queue);
                    case SippolQueue.QUEUE_UPLOAD:
                        return bridge.uploadDocs(queue);
                    case SippolQueue.QUEUE_QUERY:
                        return bridge.query(queue);
                    case SippolQueue.QUEUE_LIST:
                        return bridge.listSpp(queue);
                    case SippolQueue.QUEUE_DOWNLOAD:
                        return bridge.downloadSpp(queue);
                }
            }
        }
        return Promise.reject(util.format('No bridge can handle %s!', queue.getInfo()));
    }

    run() {
        if (this.initialize()) {
            this.createDequeuer();
            this.createBridges();
            this.createServer();
            return true;
        }
    }
}

(function run() {
    new App().run();
})();

function usage() {
    console.log('Usage:');
    console.log('  node %s [options]', path.basename(process.argv[1]));
    console.log('');
    console.log('Options:');
    console.log(Cmd.dump());
    console.log('');
    return true;
}