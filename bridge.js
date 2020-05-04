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
const {Sippol} = require('./sippol');
const Work = require('./lib/work');
const Queue = require('./lib/queue');

class SippolBridge {

    VERSION = 'SIPPOL-BRIDGE-1.0'

    constructor(options) {
        this.sippol = new Sippol(options);
        this.items = {};
        this.queues = [];
        this.queue = new Queue([], (queue) => {
            queue.setStatus(SippolQueue.STATUS_PROCESSING);
            this.processQueue(queue)
                .then((res) => {
                    queue.setStatus(SippolQueue.STATUS_DONE);
                    queue.setResult(res);
                    if (typeof queue.resolve == 'function') {
                        queue.resolve(res);
                    }
                    this.queue.next();
                })
                .catch((err) => {
                    if (err) console.error(err);
                    queue.setStatus(SippolQueue.STATUS_ERROR);
                    queue.setResult(err);
                    if (typeof queue.reject == 'function') {
                        queue.reject(err);
                    }
                    this.queue.next();
                })
            ;
        },
        () => this.sippol.ready ? true : false);
    }

    processQueue(queue) {
        switch (queue.type) {
            case SippolQueue.QUEUE_SPP:
                return this.createSpp(queue);
            case SippolQueue.QUEUE_NOTIFY_SPP:
                return this.notifySpp(queue);
            case SippolQueue.QUEUE_UPLOAD:
                return this.uploadDocs(queue);
            case SippolQueue.QUEUE_QUERY:
                return this.query(queue);
            case SippolQueue.QUEUE_LIST:
                return this.listSpp(queue);
            case SippolQueue.QUEUE_NOTIFY_LIST:
                return this.notifyListSpp(queue);
        }
    }

    genId() {
        const shasum = crypto.createHash('sha1');
        shasum.update(new Date().getTime().toString());
        return shasum.digest('hex').substr(0, 8);
    }

    addQueue(queue) {
        const id = this.genId();
        queue.setId(id);
        this.queues.push(queue);
        this.queue.requeue([queue]);
        return {status: 'queued', id: id};
    }

    updateItems(items) {
        if (items) {
            for (let i = 0; i < items.length; i++) {
                let pid = items[i].Id;
                if (!pid) continue;
                if (!this.items[pid]) {
                    this.items[pid] = items[i];
                } else {
                    this.items[pid].copyFrom(items[i]);
                }
            }
        }
    }

    getItemByNpwp(value) {
        let result = [];
        for (let pid in this.items) {
            if (this.items[pid].NPWP == value) {
                result.push(this.items[pid]);
            }
        }
        return result;
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

    fetch() {
        return new Promise((resolve, reject) => {
            this.sippol.fetchData()
                .then((items) => {
                    this.updateItems(items);
                    resolve(items);
                })
                .catch((err) => reject(err))
            ;
        });
    }

    list(clear = false) {
        if (clear) this.items = {};
        return this.do(() => this.fetch());
    }

    getPenerima(penerima) {
        return Work.works([
            () => this.sippol.filterData(penerima, this.sippol.FILTER_PENERIMA),
            () => this.sippol.sleep(this.sippol.opdelay),
            () => this.fetch()
        ]);
    }

    notifyCallback(url, data) {
        return new Promise((resolve, reject) => {
            let status, result;
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
                    result = chunk;
                });
                res.on('end', () => {
                    if (result) {
                        status = util.format('Callback %s => %s', url, result);
                    }
                    resolve(status);
                });
            });
            req.on('error', (e) => {
                status = util.format('Callback error %s: %s', url, e.message);
            });
            req.write(payload);
            req.end();
        });
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
            this.list()
                .then((items) => {
                    const matches = this.filterItems(items, {year: queue.data.year});
                    if (matches.length && queue.callback) {
                        const notifyListQueue = SippolQueue.createNotifyListQueue(matches, queue.callback);
                        this.addQueue(notifyListQueue);
                    }
                    resolve(matches);
                })
                .catch((err) => reject(err))
            ;
        });
    }

    notifyListSpp(queue) {
        return this.notifyCallback(queue.callback, {items: queue.data});
    }

    createSpp(queue) {
        let id, matches;
        return this.do([
            () => new Promise((resolve, reject) => {
                this.getPenerima(queue.data.PENERIMA)
                    .then((items) => {
                        matches = this.filterItems(items, {nominal: queue.data.JUMLAH});
                        if (matches.length) {
                            return reject('SPP for ' + queue.data.PENERIMA + ' has been created!');
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
                this.getPenerima(queue.data.PENERIMA)
                    .then((items) => {
                        matches = this.filterItems(items, {nominal: queue.data.JUMLAH});
                        if (matches.length && queue.callback) {
                            const notifyQueue = SippolQueue.createNotifySppQueue(matches[0], queue.callback);
                            this.addQueue(notifyQueue);
                        }
                        resolve(items);
                    })
                    .catch((err) => reject(err))
                ;
            }),
        ]);
    }

    notifySpp(queue) {
        return this.notifyCallback(queue.callback, {spp: queue.data});
    }

    uploadDocs(queue) {
        let result;
        const w = [];
        const docs = {};
        const mergefiles = [];
        const doctypes = {
            REKENING: false,
            NPHD: false,
            PAKTA: false,
            KTPKETUA: true,
            KTPBENDAHARA: true,
            KWITANSI: true,
            SPTJ: true,
            RAB: true,
            SPKONSULTAN: true,
            SK: true
        };
        const doctmpdir = path.join(this.sippol.workdir, 'doctmp');
        const docfname = (docname) => {
            return path.join(doctmpdir, queue.data.Id + '_' + docname.toLowerCase() + '.pdf');
        }
        // save documents to file
        Object.keys(doctypes).forEach((doctype) => {
            w.push(() => new Promise((resolve, reject) => {
                const docfilename = docfname(doctype);
                if (!fs.existsSync(doctmpdir)) fs.mkdirSync(doctmpdir);
                if (fs.existsSync(docfilename)) fs.unlinkSync(docfilename);
                this.saveDoc(docfilename, queue.data[doctype])
                    .then((filename) => {
                        if (doctypes[doctype] == true) {
                            mergefiles.push(filename);
                        } else {
                            docs[doctype] = filename;
                        }
                        resolve();
                    })
                    .catch(() => resolve())
                ;
            }));
        });
        // merge docs if necessary
        w.push(() => new Promise((resolve, reject) => {
            if (mergefiles.length == 0) {
                resolve();
            } else {
                const merge = require('easy-pdf-merge');
                const docfilename = docfname('lain');
                merge(mergefiles, docfilename, (err) => {
                    if (err) {
                        console.error(err);
                        return resolve();
                    }
                    docs.LAIN = docfilename;
                    resolve();
                });
            }
        }));
        // upload docs
        w.push(() => new Promise((resolve, reject) => {
            this.sippol.uploadDocs(queue.data.Id, docs)
                .then((res) => {
                    result = res;
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
            Array.prototype.push.apply(files, mergefiles);
            Array.prototype.push.apply(files, Object.values(docs));
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
            if (data) {
                const buffer = Buffer.from(data, 'base64');
                fs.writeFile(filename, new Uint8Array(buffer), (err) => {
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
            console.log('Queue status %s:%s => %s', this.getTypeText(), this.id, this.getStatusText());
        }
    }

    setResult(result) {
        if (this.result != result) {
            this.result = result;
            console.log('Queue result %s:%s => %s', this.getTypeText(), this.id, this.result);
        }
    }

    getTextFromId(id, values) {
        return Object.keys(values)[Object.values(values).indexOf(id)];
    }

    getTypeText()
    {
        if (!this.types) {
            this.types = Object.freeze({
                'spp': SippolQueue.QUEUE_SPP,
                'spp-notify': SippolQueue.QUEUE_NOTIFY_SPP,
                'upload': SippolQueue.QUEUE_UPLOAD,
                'query': SippolQueue.QUEUE_QUERY,
                'list': SippolQueue.QUEUE_LIST,
                'list-notify': SippolQueue.QUEUE_NOTIFY_LIST,
            });
        }
        return this.getTextFromId(this.type, this.types);
    }

    getStatusText()
    {
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

    static create(type, data, callback = null) {
        const queue = new SippolQueue();
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

    static createNotifySppQueue(data, callback = null) {
        return this.create(SippolQueue.QUEUE_NOTIFY_SPP, data, callback);
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

    static createNotifyListQueue(data, callback = null) {
        return this.create(SippolQueue.QUEUE_NOTIFY_LIST, data, callback);
    }

    static get QUEUE_SPP() { return 1 }
    static get QUEUE_NOTIFY_SPP() {return 2 }
    static get QUEUE_UPLOAD() { return 3 }
    static get QUEUE_QUERY() {return 4 }
    static get QUEUE_LIST() {return 5 }
    static get QUEUE_NOTIFY_LIST() {return 6 }

    static get STATUS_NEW() { return 1 }
    static get STATUS_PROCESSING() { return 2 }
    static get STATUS_DONE() { return 3 }
    static get STATUS_ERROR() { return 4 }
}

module.exports = {
    SippolBridge: SippolBridge,
    SippolQueue: SippolQueue
}