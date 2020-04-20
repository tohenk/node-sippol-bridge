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

const {Sippol} = require('./sippol');
const Work = require('./lib/work');
const Queue = require('./lib/queue');

class SippolBridge {

    VERSION = 'SIPPOL-BRIDGE-1.0'

    QUEUE_SPP = 1
    QUEUE_NOTIFY_SPP = 2
    QUEUE_UPLOAD = 3

    constructor(options) {
        this.sippol = new Sippol(options);
        this.items = {};
        this.callback = [];
        this.queue = new Queue([], (data) => {
            this.processQueue(data)
                .then(() => this.queue.next())
                .catch(() => this.queue.next())
            ;
        });
    }

    addCallback(url) {
        if (this.callback.indexOf(url) < 0) {
            this.callback.push(url);
        }
    }

    processQueue(data) {
        switch (data.type) {
            case this.QUEUE_SPP:
                // filter items with the same PENERIMA
                const f = (items) => {
                    let result = [];
                    for (let i = 0; i < items.length; i++) {
                        if (items[i].Status == this.sippol.SPP_BATAL) continue;
                        if (items[i].Nominal == data.spp.JUMLAH) {
                            result.push(items[i]);
                        }
                    }
                    return result;
                }
                return this.do([
                    () => new Promise((resolve, reject) => {
                        this.getPenerima(data.spp.PENERIMA)
                            .then((items) => {
                                let matches = f(items);
                                if (matches.length) {
                                    reject('SPP for ' + data.spp.PENERIMA + ' has been created!');
                                } else {
                                    resolve();
                                }
                            })
                            .catch((err) => reject(err))
                        ;
                    }),
                    () => this.sippol.createSpp(data.spp),
                    () => new Promise((resolve, reject) => {
                        this.getPenerima(data.spp.PENERIMA)
                            .then((items) => {
                                let matches = f(items);
                                if (matches.length) {
                                    this.queue.requeue([{type: this.QUEUE_NOTIFY_SPP, spp: items[0]}]);
                                }
                                resolve(items);
                            })
                            .catch((err) => reject(err))
                        ;
                    }),
                ]);
            case this.QUEUE_NOTIFY_SPP:
                return this.notifySpp(data.spp);
        }
    }

    updateItems(items) {
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

    getItemByNpwp(value) {
        let result = [];
        for (let pid in this.items) {
            if (this.items[pid].NPWP == value) {
                result.push(this.items[pid]);
            }
        }
        return result;
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
            const done = () => {
                this.sippol.stop()
                    .then(() => resolve())
                    .catch(() => resolve())
                ;
            }
            Work.works(w)
                .then(() => done())
                .catch(() => done())
            ;
        });
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

    createSpp(data) {
        if (data.NPWP) {
            let items = this.getItemByNpwp(data.NPWP);
            for (let i = 0; i < items.length; i++) {
                if (items[i].Status == this.sippol.SPP_BATAL) {
                    continue;
                }
                return Promise.resolve({status: 'result', data: items[i]});
            }
        }
        this.queue.requeue([{type: this.QUEUE_SPP, spp: data}]);
        return Promise.resolve({status: 'queued'});
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

    notifySpp(data) {
        if (this.callback.length == 0) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const q = new Queue(this.callback, (url) => {
                const http = require('http');
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
                            console.log('SPP notification %s => %s', url, result);
                        }
                        q.next();
                    });
                });
                req.on('error', (e) => {
                    console.error('Notification error %s: %s', url, e.message);
                });
                req.write(payload);
                req.end();
            });
            q.on('done', () => resolve());
        });
    }
}

module.exports = SippolBridge;