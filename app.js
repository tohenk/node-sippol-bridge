/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2020-2022 Toha <tohenk@yahoo.com>
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

const fs = require('fs');
const path = require('path');
const util = require('util');
const Cmd = require('@ntlab/ntlib/cmd');
const Work = require('@ntlab/work/work');
const SippolBridge = require('./bridge');
const SippolQueue = require('./queue');
const SippolNotifier = require('./notifier');

Cmd.addBool('help', 'h', 'Show program usage').setAccessible(false);
Cmd.addVar('config', 'c', 'Set configuration file', 'filename');
Cmd.addVar('port', 'p', 'Set web server port to listen', 'port');
Cmd.addVar('url', '', 'Set SIPPOL url', 'url');
Cmd.addVar('username', 'u', 'Set login username', 'username');
Cmd.addVar('password', 'p', 'Set login password', 'password');
Cmd.addVar('profile', '', 'Use conncetion profile', 'profile');

if (!Cmd.parse() || (Cmd.get('help') && usage())) {
    process.exit();
}

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
        this.dequeue.setInfo({version: this.VERSION});
        this.dequeue
            .on('queue', queue => this.handleNotify(queue))
            .on('queue-done', queue => this.handleNotify(queue))
            .on('queue-error', queue => this.handleNotify(queue))
        ;
    }

    createBridges() {
        Object.keys(this.configs).forEach(name => {
            let options = this.configs[name];
            let config = Object.assign({}, this.config, options);
            let browser = config.browser ? config.browser : 'default';
            if (browser) {
                if (!this.sessions[browser]) this.sessions[browser] = 0;
                this.sessions[browser]++;
                if (this.sessions[browser] > 1) config.session = 's' + this.sessions[browser];
            }
            if (!config.username || !config.password) {
                throw new Error(util.format('Unable to create bridge %s: username or password must be supplied!', name));
            }
            let bridge = new SippolBridge(config);
            bridge.name = name;
            bridge.year = config.year;
            this.bridges.push(bridge);
            console.log('Sippol bridge created: %s (%s)', name, bridge.accepts ? bridge.accepts.join(', ') : '*');
        });
    }

    createServer() {
        const { createServer } = require('http');
        const http = createServer();
        const port = Cmd.get('port') | 3000;
        const opts = {};
        if (this.config.cors) {
            opts.cors = this.config.cors;
        } else {
            opts.cors = {origin: '*'};
        }
        const { Server } = require('socket.io');
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
                    this.dequeue.setConsumer(this);
                    console.log('Queue processing is ready...');
                })
                .catch(err => console.log(err))
            ;
            this.checkReadiness();
        });
    }

    checkReadiness() {
        const readinessTimeout = this.config.readinessTimeout || 30000; // 30 seconds
        this.startTime = Date.now();
        let interval = setInterval(() => {
            let now = Date.now();
            let isReady = this.readyCount() == this.bridges.length;
            if (isReady) {
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
                const queue = SippolQueue.createSppQueue(data, socket.callback);
                queue.maps = this.config.maps;
                queue.info = queue.getMappedData('penerima.penerima');
                console.log('SPP: %s %s', data[this.config.datakey], queue.info ? queue.info : '');
                const res = SippolQueue.addQueue(queue);
                socket.emit('spp', res);
            })
            .on('upload', data => {
                let res;
                if (data.Id) {
                    const queue = SippolQueue.createUploadQueue(data, socket.callback);
                    res = SippolQueue.addQueue(queue);
                    if (data.info) queue.info = data.info;
                    console.log('Upload: %s %s', data.Id, queue.info ? queue.info : '');
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
                    let key;
                    let parts = [];
                    let partComplete = false;
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
                            const udata = this.uploads[data.Id];
                            const queue = SippolQueue.createUploadQueue(udata, socket.callback);
                            res = SippolQueue.addQueue(queue);
                            if (udata.info) queue.info = udata.info;
                            console.log('Upload from partial: %s %s', udata.Id, queue.info ? queue.info : '');
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
                console.log('Query: %s', data.term);
                if (data.notify) {
                    const queue = SippolQueue.createQueryQueue({year: data.year, term: data.term, notify: true}, socket.callback);
                    queue.info = data.term;
                    let res = SippolQueue.addQueue(queue);
                    socket.emit('query', res);
                } else {
                    const f = () => new Promise((resolve, reject) => {
                        const queue = SippolQueue.createQueryQueue({year: data.year, term: data.term}, socket.callback);
                        SippolQueue.addQueue(queue);
                        queue.info = data.term;
                        queue.resolve = resolve;
                        queue.reject = reject;
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
                const queue = SippolQueue.createListQueue(options, socket.callback);
                const res = SippolQueue.addQueue(queue);
                socket.emit('list', res);
            })
            .on('download', data => {
                const options = {year: data.year, timeout: 0};
                this.getDateForOptions(options, data);
                const queue = SippolQueue.createDownloadQueue(options, socket.callback);
                const res = SippolQueue.addQueue(queue);
                socket.emit('download', res);
            })
        ;
    }

    getDateForOptions(options, data) {
        ['spp', 'spm', 'sp2d'].forEach(key => {
            if (data[key] && (
                !isNaN(data[key]) || (typeof data[key] == 'string' && data[key].indexOf('T') > 0)
                )
            ) {
                options[key] = new Date(data[key]);
            }
        });
    }

    handleNotify() {
        this.sockets.forEach(socket => {
            socket.emit('status', this.dequeue.getStatus());
        });
    }

    getQueueHandler(queue) {
        let bridge;
        const year = queue.data && queue.data.year ? queue.data.year : null;
        // get prioritized bridge based on accepts type
        this.bridges.forEach(b => {
            if (b.isOperational() && b.year == year && Array.isArray(b.accepts) && b.accepts.indexOf(queue.type) >= 0) {
                bridge = b;
                return true;
            }
        });
        // fallback to default bridge
        if (!bridge) {
            this.bridges.forEach(b => {
                if (b.isOperational() && b.year == year && b.accepts == undefined) {
                    bridge = b;
                    return true;
                }
            });
        }
        return bridge;
    }

    canHandle(queue) {
        if (queue.type == SippolQueue.QUEUE_CALLBACK) {
            return true;
        }
        // only handle when bridge is ready
        return this.readyCount() > 0;
    }

    readyCount() {
        let readyCnt = 0;
        this.bridges.forEach(b => {
            if (b.isOperational()) readyCnt++;
        });
        return readyCnt;
    }

    canHandleNext(queue) {
        if (queue.type == SippolQueue.QUEUE_CALLBACK) {
            return !this.notify;
        }
        const bridge = this.getQueueHandler(queue);
        const current = this.dequeue.getCurrent();
        if (bridge && current) {
            return current.bridge != bridge && bridge.queue.status != SippolQueue.STATUS_PROCESSING;
        }
        return false;
    }

    processQueue(queue) {
        if (queue.type == SippolQueue.QUEUE_CALLBACK) {
            return new Promise((resolve, reject) => {
                this.notify = true;
                SippolNotifier.notify(queue)
                    .then(result => {
                        this.notify = false;
                        resolve(result);
                    })
                    .catch(err => {
                        this.notify = false;
                        reject(err);
                    })
                ;
            });
        }
        const bridge = this.getQueueHandler(queue);
        if (bridge) {
            bridge.queue = queue;
            queue.bridge = bridge;
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