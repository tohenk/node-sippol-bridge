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

    QUEUE_SPP = 1
    QUEUE_NOTIFY_SPP = 2
    QUEUE_UPLOAD = 3

    STATUS_NEW = 1
    STATUS_PROCESSING = 2
    STATUS_DONE = 3
    STATUS_ERROR = 4

    constructor(options) {
        this.sippol = new Sippol(options);
        this.items = {};
        this.callback = [];
        this.queues = {};
        this.queue = new Queue([], (data) => {
            this.setQueueStatus(data.id, this.STATUS_PROCESSING);
            this.processQueue(data)
                .then((res) => {
                    this.setQueueResult(data.id, this.STATUS_DONE, res);
                    this.queue.next();
                })
                .catch((err) => {
                    if (err) console.error(err);
                    this.setQueueResult(data.id, this.STATUS_ERROR, err);
                    this.queue.next();
                })
            ;
        },
        () => this.sippol.ready ? true : false);
    }

    processQueue(queue) {
        switch (queue.type) {
            case this.QUEUE_SPP:
                return this.createSpp(queue.data);
            case this.QUEUE_NOTIFY_SPP:
                return this.notifySpp(queue.data);
            case this.QUEUE_UPLOAD:
                return this.uploadDocs(queue.data);
        }
    }

    genId() {
        const shasum = crypto.createHash('sha1');
        shasum.update(new Date().getTime().toString());
        return shasum.digest('hex').substr(0, 8);
    }

    addCallback(url) {
        if (this.callback.indexOf(url) < 0) {
            this.callback.push(url);
        }
    }

    addQueue(type, data) {
        const id = this.genId();
        const queue = {id: id, type: type, data: data, status: this.STATUS_NEW};
        this.queue.requeue([queue]);
        this.queues[id] = queue;

        return {status: 'queued', id: id};
    }

    setQueueStatus(id, status) {
        if (this.queues[id]) {
            this.queues[id].status = status;
            console.log('Queue status changed for %s(%d) => %d', id, this.queues[id].type,
                this.queues[id].status);
        }
    }

    setQueueResult(id, status, res) {
        if (this.queues[id]) {
            this.queues[id].status = status;
            if (res) this.queues[id].result = res;
            console.log('Queue result updated for %s(%d) => %s', id, this.queues[id].type,
                this.queues[id].result ? this.queues[id].result : 'NONE');
        }
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

    list() {
        return this.do(() => this.fetch());
    }

    getPenerima(penerima) {
        return Work.works([
            () => this.sippol.filterData(penerima, this.sippol.FILTER_PENERIMA),
            () => this.sippol.sleep(this.sippol.opdelay),
            () => this.fetch()
        ]);
    }

    getSpp(id) {
        return new Promise((resolve, reject) => {
            let items = this.getItemByNpwp(id);
            for (let i = 0; i < items.length; i++) {
                if (items[i].Status == this.sippol.SPP_BATAL) {
                    continue;
                }
                return resolve(items[i]);
            }
            resolve();
        });
    }

    getSpps(year) {
        return new Promise((resolve, reject) => {
            let result = [];
            try {
                for (let pid in this.items) {
                    if (this.items[pid].Status == this.sippol.SPP_BATAL) {
                        continue;
                    }
                    if (this.items[pid].SPPTanggal && this.items[pid].SPPTanggal.indexOf(year) != 0) {
                        continue;
                    }
                    result.push(this.items[pid]);
                }
                resolve(result);
            }
            catch (err) {
                console.error(err);
            }
            resolve(result);
        });
    }

    createSpp(data) {
        // filter items with the same PENERIMA
        const f = (items) => {
            let result = [];
            if (items) {
                for (let i = 0; i < items.length; i++) {
                    if (items[i].Status == this.sippol.SPP_BATAL) continue;
                    if (items[i].Nominal == data.JUMLAH) {
                        result.push(items[i]);
                    }
                }
            }
            return result;
        }
        return this.do([
            () => new Promise((resolve, reject) => {
                this.getPenerima(data.PENERIMA)
                    .then((items) => {
                        let matches = f(items);
                        if (matches.length) {
                            reject('SPP for ' + data.PENERIMA + ' has been created!');
                        } else {
                            resolve();
                        }
                    })
                    .catch((err) => reject(err))
                ;
            }),
            () => this.sippol.createSpp(data),
            () => new Promise((resolve, reject) => {
                this.getPenerima(data.PENERIMA)
                    .then((items) => {
                        let matches = f(items);
                        if (matches.length) {
                            this.addQueue(this.QUEUE_NOTIFY_SPP, items[0]);
                        }
                        resolve(items);
                    })
                    .catch((err) => reject(err))
                ;
            }),
        ]);
    }

    notifySpp(data) {
        if (this.callback.length == 0) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            let status;
            const q = new Queue(this.callback, (url) => {
                const parsedUrl = require('url').parse(url);
                const http = require('https:' == parsedUrl.protocol ? 'https' : 'http');
                const payload = JSON.stringify({spp: data});
                const options = {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload)
                    }
                }
                let result;
                const req = http.request(url, options, (res) => {
                    res.setEncoding('utf8');
                    res.on('data', (chunk) => {
                        result = chunk;
                    });
                    res.on('end', () => {
                        if (result) {
                            status = util.format('SPP notification %s => %s', url, result);
                        }
                        q.next();
                    });
                });
                req.on('error', (e) => {
                    status = util.format('Notification error %s: %s', url, e.message);
                });
                req.write(payload);
                req.end();
            });
            q.once('done', () => resolve(status));
        });
    }

    uploadDocs(data) {
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
            return path.join(doctmpdir, data.Id + '_' + docname.toLowerCase() + '.pdf');
        }
        // save documents to file
        Object.keys(doctypes).forEach((doctype) => {
            w.push(() => new Promise((resolve, reject) => {
                const docfilename = docfname(doctype);
                if (!fs.existsSync(doctmpdir)) fs.mkdirSync(doctmpdir);
                if (fs.existsSync(docfilename)) fs.unlinkSync(docfilename);
                this.saveDoc(docfilename, data[doctype])
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
        // merged docs if necessary
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
            this.sippol.uploadDocs(data.Id, docs)
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

module.exports = SippolBridge;