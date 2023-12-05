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

const fs = require('fs');
const path = require('path');
const Queue = require('@ntlab/work/queue');
const { SippolAnnouncedError } = require('./sippol');
const { SippolSpp } = require('./spp');
const SippolQueue = require('./queue');
const SippolUtil = require('./util');
const JSZip = require('jszip');

class SippolBridge {

    STATE_NONE = 1
    STATE_SELF_TEST = 2
    STATE_OPERATIONAL = 3

    constructor(options) {
        this.sippol = new SippolSpp(this.getOptions(options));
        this.state = this.STATE_NONE;
        this.works = this.sippol.works;
        this.roles = options.roles.roles || {};
        this.users = options.roles.users || {};
    }

    getOptions(options) {
        const opts = ['datakey', 'spptype', 'accepts', 'docs', 'maxNotifiedItems', 'maxDownloadItems'];
        opts.forEach(opt => {
            if (options[opt]) {
                this[opt] = options[opt];
                delete options[opt];
            }
        });
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
        if (this.state < this.STATE_SELF_TEST) {
            this.state = this.STATE_SELF_TEST;
        }
        const f = () => {
            this.state = this.STATE_OPERATIONAL;
            return this.state;
        }
        return this.do([
            [w => this.waitUntilReady()],
            [w => Promise.resolve(f())],
        ]);
    }

    isOperational() {
        return this.state == this.STATE_OPERATIONAL;
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

    do(theworks, options) {
        options = options || {};
        const works = [
            [w => this.sippol.open()],
            [w => this.sippol.waitLoader()],
            [w => this.doAs(options.role), w => options.role],
            [w => this.sippol.isLoggedIn(), w => options.role],
            [w => this.sippol.showJenis('LS - Langsung'), w => options.role],
            [w => this.sippol.showData(options.status), w => options.role],
            [w => this.sippol.sleep(this.sippol.opdelay), w => options.role],
        ];
        if (Array.isArray(theworks)) {
            works.push(...theworks);
        }
        if (typeof theworks == 'function') {
            works.push(theworks);
        }
        return this.works(works, {
            done: err => {
                return this.works([
                    [w => this.sippol.stop()],
                    [w => new Promise((resolve, reject) => setTimeout(() => resolve(), this.sippol.opdelay))],
                ]);
            }
        });
    }

    doAs(role) {
        const user = this.roles[role];
        if (!user) {
            return Promise.reject(`Role not found: ${role}!`);
        }
        const cred = this.users[user];
        if (!cred) {
            return Promise.reject(`User not found: ${user}!`);
        }
        return this.sippol.login(cred.username, cred.password);
    }

    getRoleFromKeg(options) {
        if (options.keg) {
            if (!options.role) {
                options.role = options.keg;
            }
            delete options.keg;
        }
    }

    getRoleFromQueue(queue) {
        const res = {};
        if (queue.data.keg) {
            res.role = queue.data.keg;
        } else {
            const role = queue.getMappedData('info.role');
            if (role) {
                res.role = role;
            }
        }
        return res;
    }

    list(options) {
        options = options || {};
        if (options.clear) this.items = {};
        if (this.spptype) options.spptype = this.spptype;
        this.getRoleFromKeg(options);
        return this.do(w => this.sippol.fetch(options), options);
    }

    getPenerima(penerima) {
        return this.works([
            [w => this.sippol.filter(penerima, this.sippol.DATA_PENERIMA)],
            [w => this.sippol.sleep(this.sippol.opdelay)],
            [w => this.sippol.fetch()],
        ]);
    }

    createCallback(data, callback, init) {
        const callbackQueue = SippolQueue.createCallbackQueue(data, callback);
        if (typeof init == 'function') {
            init(callbackQueue);
        }
        return SippolQueue.addQueue(callbackQueue);
    }

    notifyItems(items, callback) {
        if (Array.isArray(items)) {
            this.processItemsWithLimit(items, (part, next) => {
                this.createCallback({items: part}, callback);
                next();
            }, this.maxNotifiedItems || 500);
        }
    }

    processItemsWithLimit(items, callback, limit) {
        const maxItems = limit || 100;
        let count = items.length;
        const n = maxItems > 0 ? Math.ceil(count / maxItems) : 1;
        let pos = 0;
        const q = new Queue(Array.from({length: n}), i => {
            let num = Math.min(maxItems > 0 ? maxItems : count, count);
            let part = items.slice(pos, pos + num);
            pos += num;
            count -= num;
            callback(part, () => q.next());
        });
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
        }), this.getRoleFromQueue(queue));
    }

    createSpp(queue) {
        let id, matches;
        const penerima = queue.getMappedData('penerima.penerima');
        const jumlah = queue.getMappedData('rincian.jumlah');
        const untuk = queue.getMappedData('spp.untuk');
        return this.do([
            [w => new Promise((resolve, reject) => {
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
                                this.createCallback({
                                    spp: matches[idx],
                                    ref: queue.data[this.datakey] ? queue.data[this.datakey] : null
                                }, queue.callback);
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
            })],
            [w => new Promise((resolve, reject) => {
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
            })],
            [w => new Promise((resolve, reject) => {
                this.getPenerima(penerima)
                    .then(items => {
                        matches = this.filterItems(items, {nominal: jumlah, untuk: untuk});
                        if (matches.length && queue.callback) {
                            this.createCallback({spp: matches[0]}, queue.callback);
                        }
                        resolve(items);
                    })
                    .catch(err => reject(err))
                ;
            })],
        ], this.getRoleFromQueue(queue));
    }

    listSpp(queue) {
        return this.works([
            [w => this.list(Object.assign({continueOnError: true}, queue.data))],
            [w => new Promise((resolve, reject) => {
                const items = w.getRes(0);
                const matches = this.filterItems(items, {year: queue.data.year});
                if (matches.length && queue.callback) {
                    this.notifyItems(matches, queue.callback);
                }
                resolve(matches);
            })],
        ]);
    }

    downloadSpp(queue) {
        const downloaddir = this.sippol.options.downloaddir;
        return this.works([
            [w => new Promise((resolve, reject) => {
                fs.readdir(downloaddir, {withFileTypes: true}, (err, files) => {
                    if (err) return reject(err);
                    files.forEach(file => {
                        if (file.isFile() && file.name.endsWith('.spp')) {
                            fs.unlinkSync(path.join(downloaddir, file.name));
                        }
                    });
                    resolve();
                });
            })],
            [w => this.list(Object.assign({
                mode: this.sippol.FETCH_DOWNLOAD,
                status: this.sippol.status.SP2D_CAIR,
                continueOnError: true
            }, queue.data))],
            [w => new Promise((resolve, reject) => {
                const items = w.getRes(1);
                if (items.length && queue.callback) {
                    const sid = SippolUtil.genId();
                    this.processItemsWithLimit(items, (part, next) => {
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
                            } else {
                                q.next();
                            }
                        });
                        q.once('done', () => {
                            if (Object.keys(zip.files).length) {
                                zip.generateAsync({
                                    type: 'nodebuffer',
                                    compression: 'DEFLATE',
                                    compressionOptions: {
                                        level: 9
                                    },
                                }).then(stream => {
                                    this.createCallback({sid: sid, download: stream}, queue.callback, queue => {
                                        queue.resolve = () => next();
                                        queue.reject = () => next();
                                    });
                                }).catch(err => reject(err));
                            } else {
                                next();
                            }
                        });
                    }, this.maxDownloadItems || 250);
                }
                resolve(items);
            }), w => w.getRes(1)],
        ]);
    }

    uploadDocs(queue) {
        let result;
        const docs = {};
        const merged = {};
        const doctmpdir = path.join(this.sippol.workdir, 'doctmp');
        const docfname = (docname) => {
            return path.join(doctmpdir, queue.data.Id + '_' + docname.toLowerCase() + '.pdf');
        }
        return this.do([
            // save documents to file
            [w => new Promise((resolve, reject) => {
                const q = new Queue(Object.keys(this.docs), doctype => {
                    const filename = docfname(doctype);
                    this.works([
                        [w => Promise.resolve(fs.mkdirSync(doctmpdir)), w => !fs.existsSync(doctmpdir)],
                        [w => Promise.resolve(fs.unlinkSync(filename)), w => fs.existsSync(filename)],
                        [w => this.saveDoc(filename, queue.data[doctype])],
                        [w => new Promise((resolve, reject) => {
                            const docgroup = this.docs[doctype];
                            if (typeof docgroup == 'string') {
                                if (!merged[docgroup]) {
                                    merged[docgroup] = [];
                                }
                                merged[docgroup].push(filename);
                            } else {
                                docs[doctype] = filename;
                            }
                            resolve();
                        }), w => w.getRes(2)],
                    ])
                    .then(() => q.next())
                    .catch(err => reject(err));
                });
                q.once('done', () => resolve());
            })],
            // merge docs if necessary
            [w => new Promise((resolve, reject) => {
                const merge = require('easy-pdf-merge');
                const q = new Queue(Object.keys(merged), docgroup => {
                    if (merged[docgroup].length > 1) {
                        const docfilename = docfname(docgroup.toLowerCase());
                        merge(merged[docgroup], docfilename, err => {
                            if (err) {
                                console.error('Merge document %s failed with %s!', docfilename, err);
                            } else {
                                docs[docgroup] = docfilename;
                            }
                            q.next();
                        });
                    } else {
                        docs[docgroup] = merged[docgroup][0];
                        q.next();
                    }
                });
                q.once('done', () => resolve());
            })],
            // filter to speed up
            [w => new Promise((resolve, reject) => {
                const term = queue.data.term ? queue.data.term : queue.data.info;
                if (!term) return resolve();
                this.sippol.filter(term, this.sippol.DATA_PENERIMA)
                    .then(() => resolve())
                    .catch(() => {
                        this.sippol.resetFilter()
                            .then(() => resolve())
                            .catch(err => reject(err))
                        ;
                    })
                ;
            })],
            // wait a little bit
            [w => this.sippol.sleep(this.sippol.opdelay)],
            // upload docs
            [w => new Promise((resolve, reject) => {
                this.sippol.uploadDocs(queue.data.Id, docs)
                    .then(res => {
                        result = res;
                        if (res && queue.callback) {
                            this.createCallback({Id: queue.data.Id, docs: res, year: queue.data.year}, queue.callback);
                        }
                        resolve();
                    })
                    .catch(err => {
                        result = err;
                        resolve();
                    })
                ;
            })],
            // cleanup files
            [w => new Promise((resolve, reject) => {
                const files = Object.values(docs);
                Object.values(merged).forEach(docfiles => {
                    files.push(...docfiles);
                });
                files.forEach(file => {
                    if (fs.existsSync(file)) {
                        fs.unlinkSync(file);
                    }
                });
                if (result instanceof SippolAnnouncedError) {
                    this.createCallback({Id: queue.data.Id, error: result.message, year: queue.data.year}, queue.callback);
                }
                resolve(result);
            })],
        ], this.getRoleFromQueue(queue));
    }

    saveDoc(filename, data) {
        return new Promise((resolve, reject) => {
            if (Buffer.isBuffer(data)) {
                fs.writeFile(filename, new Uint8Array(data), err => {
                    if (err) {
                        console.error('Write file %s failed with %s!', filename, err);
                        return resolve(false);
                    }
                    resolve(true);
                });
            } else {
                resolve(false);
            }
        });
    }
}

module.exports = SippolBridge;