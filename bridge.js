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

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');
const EventEmitter = require('events');
const Work = require('@ntlab/ntlib/work');
const Queue = require('@ntlab/ntlib/queue');
const { Sippol } = require('./sippol');

class SippolBridge extends EventEmitter {

    VERSION = 'SIPPOL-BRIDGE-1.0'

    time = null

    constructor(options) {
        super();
        this.time = new Date();
        this.sippol = new Sippol(this.getOptions(options));
        this.queues = [];
        this.queue = new Queue([], (queue) => {
            this.emit('queue', queue);
            queue.setTime();
            queue.setStatus(SippolQueue.STATUS_PROCESSING);
            this.processQueue(queue)
                .then((res) => {
                    queue.setStatus(SippolQueue.STATUS_DONE);
                    queue.setResult(res);
                    this.setLastQueue(queue);
                    if (typeof queue.resolve == 'function') {
                        queue.resolve(res);
                    }
                    this.emit('queue-done', queue);
                    this.queue.next();
                })
                .catch((err) => {
                    queue.setStatus(SippolQueue.STATUS_ERROR);
                    queue.setResult(err);
                    this.setLastQueue(queue);
                    if (typeof queue.reject == 'function') {
                        queue.reject(err);
                    }
                    this.emit('queue-error', queue);
                    this.queue.next();
                })
            ;
        },
        () => this.sippol.ready ? true : false);
        this.sippol.onready = () => {
            this.queue.next();
        }
    }

    getOptions(options) {
        if (options.datakey) {
            this.datakey = options.datakey;
            delete options.datakey;
        }
        if (options.docs) {
            this.docs = options.docs;
            delete options.docs;
        }
        return options;
    }

    getStatus() {
        const status = {
            version: this.VERSION,
            time: this.time.toString(),
            total: this.queues.length,
            queue: this.queue.queues.length,
        }
        if (this.queue.queue) {
            status.current = this.queue.queue.getInfo();
        }
        if (this.xqueue) {
            status.last = {};
            status.last.name = this.xqueue.getInfo();
            if (this.xqueue.time) {
                status.last.time = this.xqueue.time.toString();
            }
            status.last.status = this.xqueue.getStatusText();
            if (this.xqueue.result) {
                status.last.result = util.inspect(this.xqueue.result);
            }
        }
        return status;
    }

    setLastQueue(queue) {
        if (queue.type != SippolQueue.QUEUE_CALLBACK) {
            this.xqueue = queue;
        }
    }

    processQueue(queue) {
        switch (queue.type) {
            case SippolQueue.QUEUE_SPP:
                return this.createSpp(queue);
            case SippolQueue.QUEUE_UPLOAD:
                return this.uploadDocs(queue);
            case SippolQueue.QUEUE_QUERY:
                return this.query(queue);
            case SippolQueue.QUEUE_LIST:
                return this.listSpp(queue);
            case SippolQueue.QUEUE_CALLBACK:
                return this.notify(queue);
        }
    }

    genId() {
        const shasum = crypto.createHash('sha1');
        shasum.update(new Date().getTime().toString());
        return shasum.digest('hex').substr(0, 8);
    }

    addQueue(queue) {
        if (!queue.id) {
            queue.setId(this.genId());
            queue.maps = this.sippol.maps;
        }
        this.queues.push(queue);
        this.queue.requeue([queue]);
        return {status: 'queued', id: queue.id};
    }

    filterItems(items, filter) {
        const result = [];
        if (items) {
            filter = filter || {};
            for (let i = 0; i < items.length; i++) {
                if (items[i].Status == this.sippol.SPP_BATAL) {
                    continue;
                }
                if (filter.status && items[i].Status != filter.status) {
                    continue;
                }
                if (filter.nominal && items[i].Nominal != filter.nominal) {
                    continue;
                }
                if (filter.untuk && items[i].Untuk != filter.untuk) {
                    continue;
                }
                if (filter.year && (!items[i].SPPTanggal || items[i].SPPTanggal.indexOf(filter.year) != 0)) {
                    continue;
                }
                result.push(items[i]);
            }
        }
        return result;
    }

    sleep(ms) {
        return this.sippol.sleep(ms);
    }

    isReady() {
        return new Promise((resolve, reject) => {
            const f = () => {
                if (this.sippol.ready) {
                    resolve();
                } else {
                    setTimeout(f, 100);
                }
            }
            f();
        });
    }

    do(works) {
        let w = [
            () => this.sippol.start(),
            () => this.sippol.showData(),
            () => this.sippol.sleep(this.sippol.opdelay),
        ];
        if (Array.isArray(works)) {
            Array.prototype.push.apply(w, works);
        }
        if (typeof works == 'function') {
            w.push(works);
        }
        return new Promise((resolve, reject) => {
            let result;
            const done = () => {
                this.sippol.stop()
                    .then(() => resolve(result))
                    .catch(() => resolve(result))
                ;
            }
            Work.works(w)
                .then((res) => {
                    result = res;
                    done();
                })
                .catch((err) => {
                    if (err) console.error(err);
                    done();
                })
            ;
        });
    }

    selfTest() {
        return this.do(() => Promise.resolve());
    }

    fetch(options) {
        return new Promise((resolve, reject) => {
            this.sippol.fetchData(options)
                .then((items) => {
                    resolve(items);
                })
                .catch((err) => reject(err))
            ;
        });
    }

    list(options) {
        options = options || {};
        if (options.clear) this.items = {};
        return this.do(() => this.fetch(options));
    }

    getPenerima(penerima) {
        return Work.works([
            () => this.sippol.filterData(penerima, this.sippol.DATA_PENERIMA),
            () => this.sippol.sleep(this.sippol.opdelay),
            () => this.fetch()
        ]);
    }

    notifyCallback(url, data) {
        return new Promise((resolve, reject) => {
            // https://nodejs.org/dist/latest-v14.x/docs/api/http.html#http_http_request_options_callback
            let buff, result, err;
            const parsedUrl = require('url').parse(url);
            const http = require('https:' == parsedUrl.protocol ? 'https' : 'http');
            const payload = JSON.stringify(data);
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            }
            const req = http.request(url, options, (res) => {
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    if (buff) {
                        buff += chunk;
                    } else {
                        buff = chunk;
                    }
                });
                res.on('end', () => {
                    result = buff;
                });
            });
            req.on('error', (e) => {
                err = e;
            });
            req.on('close', () => {
                if (result) {
                    resolve(util.format('%s', result));
                } else {
                    reject(err);
                }
            });
            req.write(payload);
            req.end();
        });
    }

    notify(queue) {
        return this.notifyCallback(queue.callback, queue.data);
    }

    query(queue) {
        return this.do(() => new Promise((resolve, reject) => {
            this.getPenerima(queue.data.term)
                .then((items) => {
                    const matches = this.filterItems(items);
                    resolve(matches);
                })
                .catch((err) => reject(err))
            ;
        }));
    }

    listSpp(queue) {
        return new Promise((resolve, reject) => {
            this.list(queue.data)
                .then((items) => {
                    const matches = this.filterItems(items, {year: queue.data.year});
                    if (matches.length && queue.callback) {
                        const callbackQueue = SippolQueue.createCallbackQueue({items: matches}, queue.callback);
                        this.addQueue(callbackQueue);
                    }
                    resolve(matches);
                })
                .catch((err) => reject(err))
            ;
        });
    }

    createSpp(queue) {
        let id, matches;
        const penerima = queue.getMappedData('penerima.penerima');
        const jumlah = queue.getMappedData('rincian.jumlah');
        const untuk = queue.getMappedData('spp.untuk');
        return this.do([
            () => new Promise((resolve, reject) => {
                this.getPenerima(penerima)
                    .then((items) => {
                        matches = this.filterItems(items, {nominal: jumlah, untuk: untuk});
                        if (matches.length) {
                            if (queue.callback) {
                                let idx = -1;
                                // compare datakey
                                if (this.datakey) {
                                    for (let i = 0; i < matches.length; i++) {
                                        if (matches[i][this.datakey] == queue.data[this.datakey]) {
                                            idx = i;
                                            break;
                                        }
                                    }
                                }
                                if (idx < 0) idx = 0;
                                const callbackQueue = SippolQueue.createCallbackQueue({
                                    spp: matches[idx],
                                    ref: queue.data[this.datakey] ? queue.data[this.datakey] : null
                                }, queue.callback);
                                this.addQueue(callbackQueue);
                            }
                            return reject('SPP for ' + penerima + ' has been created!');
                        }
                        // try to edit incomplete SPP
                        matches = this.filterItems(items, {nominal: 0, status: this.sippol.SPP_DRAFT});
                        if (matches.length) {
                            id = matches[0].Id;
                        }
                        resolve();
                    })
                    .catch((err) => reject(err))
                ;
            }),
            () => new Promise((resolve, reject) => {
                if (!id) {
                    this.sippol.createSpp(queue.data)
                        .then(() => resolve())
                        .catch((err) => reject(err))
                    ;
                } else {
                    this.sippol.updateSpp(id, queue.data)
                        .then(() => resolve())
                        .catch((err) => reject(err))
                    ;
                }
            }),
            () => new Promise((resolve, reject) => {
                this.getPenerima(penerima)
                    .then((items) => {
                        matches = this.filterItems(items, {nominal: jumlah, untuk: untuk});
                        if (matches.length && queue.callback) {
                            const callbackQueue = SippolQueue.createCallbackQueue({spp: matches[0]}, queue.callback);
                            this.addQueue(callbackQueue);
                        }
                        resolve(items);
                    })
                    .catch((err) => reject(err))
                ;
            }),
        ]);
    }

    uploadDocs(queue) {
        let result;
        const w = [];
        const docs = {};
        const mergedocs = {};
        const doctmpdir = path.join(this.sippol.workdir, 'doctmp');
        const docfname = (docname) => {
            return path.join(doctmpdir, queue.data.Id + '_' + docname.toLowerCase() + '.pdf');
        }
        // save documents to file
        if (this.docs) {
            Object.keys(this.docs).forEach((doctype) => {
                w.push(() => new Promise((resolve, reject) => {
                    const docfilename = docfname(doctype);
                    if (!fs.existsSync(doctmpdir)) fs.mkdirSync(doctmpdir);
                    if (fs.existsSync(docfilename)) fs.unlinkSync(docfilename);
                    this.saveDoc(docfilename, queue.data[doctype])
                        .then((filename) => {
                            let docgroup = this.docs[doctype];
                            if (typeof docgroup == 'string') {
                                if (!mergedocs[docgroup]) {
                                    mergedocs[docgroup] = [];
                                }
                                mergedocs[docgroup].push(filename);
                            } else {
                                docs[doctype] = filename;
                            }
                            resolve();
                        })
                        .catch(() => resolve())
                    ;
                }));
            });
        }
        // merge docs if necessary
        w.push(() => new Promise((resolve, reject) => {
            if (mergedocs.length == 0) {
                resolve();
            } else {
                const merge = require('easy-pdf-merge');
                const q = new Queue(Object.keys(mergedocs), (docgroup) => {
                    const docfilename = docfname(docgroup.toLowerCase());
                    merge(mergedocs[docgroup], docfilename, (err) => {
                        if (err) {
                            console.error(err);
                        } else {
                            docs[docgroup] = docfilename;
                        }
                        q.next();
                    });
                });
                q.once('done', () => resolve());
            }
        }));
        // filter to speed up
        w.push(() => new Promise((resolve, reject) => {
            const term = queue.data.term ? queue.data.term : queue.data.info;
            if (!term) return resolve();
            this.sippol.filterData(term, this.sippol.DATA_PENERIMA)
                .then(() => resolve())
                .catch(() => {
                    this.sippol.resetFilter()
                        .then(() => resolve())
                        .catch((err) => reject(err))
                    ;
                })
            ;
        }));
        // upload docs
        w.push(() => new Promise((resolve, reject) => {
            this.sippol.uploadDocs(queue.data.Id, docs)
                .then((res) => {
                    result = res;
                    if (res && queue.callback) {
                        const callbackQueue = SippolQueue.createCallbackQueue({Id: queue.data.Id, docs: res}, queue.callback);
                        this.addQueue(callbackQueue);
                    }
                    resolve();
                })
                .catch((err) => {
                    result = err;
                    resolve();
                })
            ;
        }));
        // cleanup files
        w.push(() => new Promise((resolve, reject) => {
            const files = [];
            Array.prototype.push.apply(files, Object.values(docs));
            Object.values(mergedocs).forEach((docfiles) => {
                Array.prototype.push.apply(files, docfiles);
            });
            files.forEach((file) => {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            });
            resolve(result);
        }));
        return this.do(w);
    }

    saveDoc(filename, data) {
        return new Promise((resolve, reject) => {
            if (Buffer.isBuffer(data)) {
                fs.writeFile(filename, new Uint8Array(data), (err) => {
                    if (err) return reject(err);
                    resolve(filename);
                });
            } else {
                reject();
            }
        });
    }
}

class SippolQueue
{
    constructor() {
        this.status = SippolQueue.STATUS_NEW;
    }

    setType(type) {
        this.type = type;
    }

    setId(id) {
        this.id = id;
    }

    setData(data) {
        this.data = data;
    }

    setCallback(callback) {
        this.callback = callback;
    }

    setStatus(status) {
        if (this.status != status) {
            this.status = status;
            console.log('Queue %s %s', this.getInfo(), this.getStatusText());
        }
    }

    setResult(result) {
        if (this.result != result) {
            this.result = result;
            console.log('Queue %s result: %s', this.getInfo(), this.result);
        }
    }

    setTime(time) {
        if (time == null || time == undefined) {
            time = new Date();
        }
        this.time = time;
    }

    getTextFromId(id, values) {
        return Object.keys(values)[Object.values(values).indexOf(id)];
    }

    getTypeText() {
        if (!this.types) {
            this.types = Object.freeze({
                'spp': SippolQueue.QUEUE_SPP,
                'upload': SippolQueue.QUEUE_UPLOAD,
                'query': SippolQueue.QUEUE_QUERY,
                'list': SippolQueue.QUEUE_LIST,
                'callback': SippolQueue.QUEUE_CALLBACK,
            });
        }
        return this.getTextFromId(this.type, this.types);
    }

    getStatusText() {
        if (!this.statuses) {
            this.statuses = Object.freeze({
                'new': SippolQueue.STATUS_NEW,
                'processing': SippolQueue.STATUS_PROCESSING,
                'done': SippolQueue.STATUS_DONE,
                'error': SippolQueue.STATUS_ERROR,
            });
        }
        return this.getTextFromId(this.status, this.statuses);
    }

    getMappedData(name) {
        if (this.maps && typeof name == 'string') {
            let o = this.maps;
            let parts = name.split('.');
            while (parts.length) {
                let n = parts.shift();
                if (n.substr(0, 1) == '#') n = n.substr(1);
                if (o[n]) {
                    o = o[n];
                } else {
                    o = null;
                    break;
                }
            }
            if (typeof o == 'string' && this.data[o]) {
                return this.data[o];
            }
        }
    }

    getInfo() {
        let info = this.info;
        if (!info && this.type == SippolQueue.QUEUE_CALLBACK) {
            info = this.callback;
        }
        return info ? util.format('%s:%s (%s)', this.getTypeText(), this.id, info) :
            util.format('%s:%s', this.getTypeText(), this.id);
    }

    static create(type, data, callback = null) {
        const queue = new this();
        queue.setType(type);
        queue.setData(data);
        if (callback) {
            queue.callback = callback;
        }
        return queue;
    }

    static createSppQueue(data, callback = null) {
        return this.create(SippolQueue.QUEUE_SPP, data, callback);
    }

    static createUploadQueue(data, callback = null) {
        return this.create(SippolQueue.QUEUE_UPLOAD, data, callback);
    }

    static createQueryQueue(data, callback = null) {
        return this.create(SippolQueue.QUEUE_QUERY, data, callback);
    }

    static createListQueue(data, callback = null) {
        return this.create(SippolQueue.QUEUE_LIST, data, callback);
    }

    static createCallbackQueue(data, callback = null) {
        return this.create(SippolQueue.QUEUE_CALLBACK, data, callback);
    }

    static get QUEUE_SPP() { return 1 }
    static get QUEUE_UPLOAD() { return 2 }
    static get QUEUE_QUERY() { return 3 }
    static get QUEUE_LIST() { return 4 }
    static get QUEUE_CALLBACK() { return 5 }

    static get STATUS_NEW() { return 1 }
    static get STATUS_PROCESSING() { return 2 }
    static get STATUS_DONE() { return 3 }
    static get STATUS_ERROR() { return 4 }
}

module.exports = {
    SippolBridge: SippolBridge,
    SippolQueue: SippolQueue
}