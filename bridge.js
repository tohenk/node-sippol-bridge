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
const Work = require('@ntlab/ntlib/work');
const Queue = require('@ntlab/ntlib/queue');
const { Sippol } = require('./sippol');
const SippolQueue = require('./queue');

class SippolBridge {

    constructor(options) {
        this.sippol = new Sippol(this.getOptions(options));
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
        if (options.maxNotifiedItems) {
            this.maxNotifiedItems = options.maxNotifiedItems;
            delete options.maxNotifiedItems;
        }
        if (options.accepts) {
            this.accepts = options.accepts;
            delete options.accepts;
        }
        return options;
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

    selfTest() {
        return this.do(() => this.waitUntilReady());
    }

    isReady() {
        return this.sippol.ready;
    }

    waitUntilReady() {
        return new Promise((resolve, reject) => {
            const f = () => {
                if (this.isReady()) {
                    resolve();
                } else {
                    setTimeout(f, 100);
                }
            }
            f();
        });
    }

    sleep(ms) {
        return this.sippol.sleep(ms);
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
                .then(res => {
                    result = res;
                    done();
                })
                .catch(err => {
                    if (err) console.error(err);
                    done();
                })
            ;
        });
    }

    fetch(options) {
        return new Promise((resolve, reject) => {
            this.sippol.fetchData(options)
                .then(items => resolve(items))
                .catch(err => reject(err))
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

    notifyItems(items, callback) {
        let maxNotifiedItems = this.maxNotifiedItems || 500;
        let parts = items;
        while (parts.length) {
            let n = maxNotifiedItems > 0 && parts.length > maxNotifiedItems ?
                maxNotifiedItems : parts.length;
            let part = parts.splice(0, n);
            const callbackQueue = SippolQueue.createCallbackQueue({items: part}, callback);
            SippolQueue.addQueue(callbackQueue);
        }
    }

    query(queue) {
        return this.do(() => new Promise((resolve, reject) => {
            this.getPenerima(queue.data.term)
                .then(items => {
                    const matches = this.filterItems(items);
                    if (matches.length && queue.callback && queue.data.notify) {
                        this.notifyItems(matches, queue.callback);
                    }
                    resolve(matches);
                })
                .catch(err => reject(err))
            ;
        }));
    }

    listSpp(queue) {
        return new Promise((resolve, reject) => {
            this.list(queue.data)
                .then(items => {
                    const matches = this.filterItems(items, {year: queue.data.year});
                    if (matches.length && queue.callback) {
                        this.notifyItems(matches, queue.callback);
                    }
                    resolve(matches);
                })
                .catch(err => reject(err))
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
                    .then(items => {
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
                                SippolQueue.addQueue(callbackQueue);
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
                    .catch(err => reject(err))
                ;
            }),
            () => new Promise((resolve, reject) => {
                if (!id) {
                    this.sippol.createSpp(queue.data)
                        .then(() => resolve())
                        .catch(err => reject(err))
                    ;
                } else {
                    this.sippol.updateSpp(id, queue.data)
                        .then(() => resolve())
                        .catch(err => reject(err))
                    ;
                }
            }),
            () => new Promise((resolve, reject) => {
                this.getPenerima(penerima)
                    .then(items => {
                        matches = this.filterItems(items, {nominal: jumlah, untuk: untuk});
                        if (matches.length && queue.callback) {
                            const callbackQueue = SippolQueue.createCallbackQueue({spp: matches[0]}, queue.callback);
                            SippolQueue.addQueue(callbackQueue);
                        }
                        resolve(items);
                    })
                    .catch(err => reject(err))
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
                    merge(mergedocs[docgroup], docfilename, err => {
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
                        .catch(err => reject(err))
                    ;
                })
            ;
        }));
        // upload docs
        w.push(() => new Promise((resolve, reject) => {
            this.sippol.uploadDocs(queue.data.Id, docs)
                .then(res => {
                    result = res;
                    if (res && queue.callback) {
                        const callbackQueue = SippolQueue.createCallbackQueue({Id: queue.data.Id, docs: res}, queue.callback);
                        SippolQueue.addQueue(callbackQueue);
                    }
                    resolve();
                })
                .catch(err => {
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
                fs.writeFile(filename, new Uint8Array(data), err => {
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