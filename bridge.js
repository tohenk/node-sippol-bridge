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
const Work = require('@ntlab/work/work');
const Queue = require('@ntlab/work/queue');
const { Sippol } = require('./sippol');
const SippolQueue = require('./queue');
const JSZip = require('jszip');

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
        if (options.maxDownloadItems) {
            this.maxDownloadItems = options.maxDownloadItems;
            delete options.maxDownloadItems;
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
        return this.do(w => this.waitUntilReady());
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

    do(theworks, status) {
        const works = [
            w => this.sippol.start(),
            w => this.sippol.showData(status),
            w => this.sippol.sleep(this.sippol.opdelay),
        ];
        if (Array.isArray(theworks)) {
            Array.prototype.push.apply(works, theworks);
        }
        if (typeof theworks == 'function') {
            works.push(theworks);
        }
        return Work.works(works, {done: w => this.sippol.stop()});
    }

    list(options) {
        options = options || {};
        if (options.clear) this.items = {};
        return this.do(w => this.sippol.fetchData(options), options.status);
    }

    getPenerima(penerima) {
        return Work.works([
            w => this.sippol.filterData(penerima, this.sippol.DATA_PENERIMA),
            w => this.sippol.sleep(this.sippol.opdelay),
            w => this.sippol.fetchData(),
        ]);
    }

    notifyItems(items, callback) {
        if (Array.isArray(items)) {
            this.processItemsWithLimit(items, part => {
                const callbackQueue = SippolQueue.createCallbackQueue({items: part}, callback);
                SippolQueue.addQueue(callbackQueue);
            }, this.maxNotifiedItems || 500);
        } else {
            const callbackQueue = SippolQueue.createCallbackQueue(items, callback);
            SippolQueue.addQueue(callbackQueue);
        }
    }

    processItemsWithLimit(items, callback, limit) {
        let maxItems = limit || 100;
        let count = items.length;
        let pos = 0;
        while (count) {
            let n = maxItems > 0 && count > maxItems ? maxItems : count;
            let part = items.slice(pos, n);
            callback(part);
            count -= n;
            pos += n;
        }
    }

    query(queue) {
        return this.do(w => new Promise((resolve, reject) => {
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

    createSpp(queue) {
        let id, matches;
        const penerima = queue.getMappedData('penerima.penerima');
        const jumlah = queue.getMappedData('rincian.jumlah');
        const untuk = queue.getMappedData('spp.untuk');
        return this.do([
            w => new Promise((resolve, reject) => {
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
            w => new Promise((resolve, reject) => {
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
            w => new Promise((resolve, reject) => {
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

    listSpp(queue) {
        return Work.works([
            w => this.list(queue.data),
            w => new Promise((resolve, reject) => {
                const items = w.getRes(0);
                const matches = this.filterItems(items, {year: queue.data.year});
                if (matches.length && queue.callback) {
                    this.notifyItems(matches, queue.callback);
                }
                resolve(matches);
            }),
        ]);
    }

    downloadSpp(queue) {
        return Work.works([
            w => this.list(Object.assign({
                mode: this.sippol.FETCH_DOWNLOAD,
                status: this.sippol.status.SP2D_CAIR
            }, queue.data)),
            w => new Promise((resolve, reject) => {
                const items = w.getRes(0);
                const downloaddir = this.sippol.options.downloaddir;
                if (items.length && queue.callback) {
                    this.processItemsWithLimit(items, part => {
                        const zip = new JSZip();
                        const q = new Queue(part, spp => {
                            const filename = path.join(downloaddir, spp);
                            if (fs.existsSync(filename)) {
                                fs.readFile(filename, (err, data) => {
                                    if (!err) {
                                        zip.file(spp, data);
                                    }
                                    q.next();
                                });
                            }
                        }, this.maxDownloadItems || 250);
                        q.once('done', () => {
                            zip.generateAsync({type: 'nodebuffer'})
                                .then(stream => {
                                    this.notifyItems({download: stream}, queue.callback);
                                });
                        });
                    });
                }
                resolve(items);
            }),
        ]);
    }

    uploadDocs(queue) {
        let result;
        const works = [];
        const docs = {};
        const mergedocs = {};
        const doctmpdir = path.join(this.sippol.workdir, 'doctmp');
        const docfname = (docname) => {
            return path.join(doctmpdir, queue.data.Id + '_' + docname.toLowerCase() + '.pdf');
        }
        // save documents to file
        if (this.docs) {
            Object.keys(this.docs).forEach((doctype) => {
                works.push(w => new Promise((resolve, reject) => {
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
        works.push(w => new Promise((resolve, reject) => {
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
        works.push(w => new Promise((resolve, reject) => {
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
        works.push(w => new Promise((resolve, reject) => {
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
        works.push(w => new Promise((resolve, reject) => {
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
        return this.do(works);
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