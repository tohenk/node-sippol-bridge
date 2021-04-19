/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2020 Toha <tohenk@yahoo.com>
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
const Cmd = require('@ntlab/ntlib/cmd');
const Work = require('@ntlab/ntlib/work');
const { SippolBridge, SippolQueue } = require('./bridge');

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

    config = {}
    uploads = {}
    bridge = null
    bridge2 = null
    sockets = []

    initialize() {
        let filename, profile;
        // read configuration from command line values
        filename = Cmd.get('config') ? Cmd.get('config') : path.join(__dirname, 'config.json');
        if (fs.existsSync(filename)) {
            console.log('Reading configuration %s', filename);
            this.config = JSON.parse(fs.readFileSync(filename));
        }
        if (Cmd.get('url')) this.config.url = Cmd.get('url');
        if (Cmd.get('username')) this.config.username = Cmd.get('username');
        if (Cmd.get('password')) this.config.password = Cmd.get('password');
        if (!this.config.workdir) this.config.workdir = __dirname;

        if (!this.config.username || !this.config.password) {
            console.error('Both username or password must be supplied!');
            return;
        }
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
        return true;
    }

    createBridge() {
        if (null == this.bridge) {
            this.bridge = new SippolBridge(this.config);
            this.bridge
                .on('queue', (queue) => this.handleNotify())
                .on('queue-done', (queue) => this.handleNotify())
                .on('queue-error', (queue) => this.handleNotify())
            ;
        }
    }

    createBridge2() {
        if (null == this.bridge2) {
            const config = Object.assign({}, this.config);
            if (config.browser == this.config.browser) config.session = 's2';
            this.bridge2 = new SippolBridge(config);
        }
    }

    createServer() {
        const port = Cmd.get('port') | 3000;
        const http = require('http').createServer();
        const opts = {};
        if (this.config.cors) {
            opts.cors = this.config.cors;
        } else {
            opts.cors = {origin: '*'};
        }
        const io = require('socket.io')(http, opts);
        io.of('/sippol')
            .on('connection', (socket) => {
                this.handleConnection(socket);
            })
        ;
        http.listen(port, () => {
            console.log('Application ready on port %s...', port);
            Work.works([
                () => this.bridge.isReady(),
                () => this.bridge.selfTest(),
            ]);
        });
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
                socket.emit('status', this.bridge.getStatus());
            })
            .on('setup', (data) => {
                if (data.callback) {
                    socket.callback = data.callback;
                }
                socket.emit('setup', {version: this.bridge.VERSION});
            })
            .on('spp', (data) => {
                const queue = SippolQueue.createSppQueue(data, socket.callback);
                const res = this.bridge.addQueue(queue);
                queue.info = queue.getMappedData('penerima.penerima');
                console.log('SPP: %s %s', data[this.bridge.datakey], queue.info ? queue.info : '');
                socket.emit('spp', res);
            })
            .on('upload', (data) => {
                let res;
                if (data.Id) {
                    const queue = SippolQueue.createUploadQueue(data, socket.callback);
                    res = this.bridge.addQueue(queue);
                    if (data.info) queue.info = data.info;
                    console.log('Upload: %s %s', data.Id, queue.info ? queue.info : '');
                } else {
                    const msg = 'Ignoring upload without Id';
                    console.log(msg);
                    res = {error: msg}
                }
                socket.emit('upload', res);
            })
            .on('upload-part', (data) => {
                let res;
                if (data.Id) {
                    if (this.uploads[data.Id] == undefined) {
                        this.uploads[data.Id] = {Id: data.Id};
                        if (data.info) this.uploads[data.Id].info = data.info;
                        if (data.term) this.uploads[data.Id].term = data.term;
                    }
                    let key;
                    let parts = [];
                    let partComplete = false;
                    Object.keys(data).forEach((k) => {
                        if (['Id', 'info', 'term', 'seq', 'tot', 'size', 'len'].indexOf(k) < 0) {
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
                            res = this.bridge.addQueue(queue);
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
            .on('query', (data) => {
                console.log('Query: %s', data.term);
                const f = () => new Promise((resolve, reject) => {
                    const queue = SippolQueue.createQueryQueue({term: data.term}, socket.callback);
                    this.bridge.addQueue(queue);
                    queue.info = data.term;
                    queue.resolve = resolve;
                    queue.reject = reject;
                });
                f()
                    .then((items) => {
                        socket.emit('query', {result: items});
                    })
                    .catch((err) => {
                        socket.emit('query', {error: err instanceof Error ? err.message : err});
                    })
                ;
            })
            .on('list', (data) => {
                this.createBridge2();
                const options = {year: data.year};
                ['spp', 'spm', 'sp2d'].forEach((key) => {
                    if (data[key] && (
                        !isNaN(data[key]) || (typeof data[key] == 'string' && data[key].indexOf('T') > 0)
                        )
                    ) {
                        options[key] = new Date(data[key]);
                    }
                });
                const queue = SippolQueue.createListQueue(options, socket.callback);
                const res = this.bridge2.addQueue(queue);
                socket.emit('list', res);
            })
        ;
    }

    handleNotify() {
        this.sockets.forEach((socket) => {
            socket.emit('status', this.bridge.getStatus());
        });
    }

    run() {
        if (this.initialize()) {
            this.createBridge();
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