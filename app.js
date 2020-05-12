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
const Cmd = require('./lib/cmd');
const Work = require('./lib/work');

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

(function run() {
    let config = {}, profile, filename;
    // read configuration from command line values
    filename = Cmd.get('config') ? Cmd.get('config') : path.join(__dirname, 'config.json');
    if (fs.existsSync(filename)) {
        console.log('Reading configuration %s', filename);
        config = JSON.parse(fs.readFileSync(filename));
    }
    if (Cmd.get('url')) config.url = Cmd.get('url');
    if (Cmd.get('username')) config.username = Cmd.get('username');
    if (Cmd.get('password')) config.password = Cmd.get('password');
    if (!config.workdir) config.workdir = __dirname;

    if (!config.username || !config.password) {
        console.error('Both username or password must be supplied!');
        return;
    }
    // load form maps
    filename = path.join(__dirname, 'maps.json');
    if (fs.existsSync(filename)) {
        config.maps = JSON.parse(fs.readFileSync(filename));
        console.log('Maps loaded from %s', filename);
    }
    // load profile
    config.profiles = {};
    filename = path.join(__dirname, 'profiles.json');
    if (fs.existsSync(filename)) {
        const profiles = JSON.parse(fs.readFileSync(filename));
        if (profiles.profiles) config.profiles = profiles.profiles;
        if (profiles.active) profile = profiles.active;
    }
    if (Cmd.get('profile')) profile = Cmd.get('profile');
    if (profile && config.profiles[profile]) {
        console.log('Using profile %s', profile);
        const keys = ['timeout', 'wait', 'delay', 'opdelay'];
        for (let key in config.profiles[profile]) {
            if (keys.indexOf(key) < 0) continue;
            config[key] = config.profiles[profile][key];
        }
    }

    const port = Cmd.get('port') | 3000;
    const {SippolBridge, SippolQueue} = require('./bridge');
    const bridge = new SippolBridge(config);
    const http = require('http').createServer();
    const io = require('socket.io')(http);
    io.of('/sippol').on('connection', (socket) => {
        console.log('Client connected: %s', socket.id);
        socket.on('disconnect', () => {
            console.log('Client disconnected: %s', socket.id);
        });
        socket.on('setup', (data) => {
            if (data.callback) {
                socket.callback = data.callback;
            }
            socket.emit('setup', {version: bridge.VERSION});
        });
        socket.on('spp', (data) => {
            const queue = SippolQueue.createSppQueue(data, socket.callback);
            const res = bridge.addQueue(queue);
            queue.info = queue.getMappedData('penerima.penerima');
            console.log('SPP: %s %s', data[bridge.datakey], queue.info ? queue.info : '');
            socket.emit('spp', res);
        });
        socket.on('upload', (data) => {
            let res;
            if (data.Id) {
                const queue = SippolQueue.createUploadQueue(data, socket.callback);
                res = bridge.addQueue(queue);
                if (data.info) queue.info = data.info;
                console.log('Upload: %s %s', data.Id, queue.info ? queue.info : '');
            } else {
                const msg = 'Ignoring upload without Id';
                console.log(msg);
                res = {error: msg}
            }
            socket.emit('upload', res);
        });
        socket.on('query', (data) => {
            console.log('Query: %s', data.term);
            const f = () => new Promise((resolve, reject) => {
                const queue = SippolQueue.createQueryQueue({term: data.term}, socket.callback);
                bridge.addQueue(queue);
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
        });
        socket.on('list', (data) => {
            const queue = SippolQueue.createListQueue({year: data.year}, socket.callback);
            const res = bridge.addQueue(queue);
            socket.emit('list', res);
        });
    });
    http.listen(port, () => {
        console.log('Application ready on port %s...', port);
        Work.works([
            () => bridge.isReady(),
            () => bridge.selfTest(),
        ]);
    });
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