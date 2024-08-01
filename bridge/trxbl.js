/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2020-2024 Toha <tohenk@yahoo.com>
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

const Queue = require('@ntlab/work/queue');
const SippolBridge = require('.');
const { SippolTrxbl } = require('../sippol/trxbl');
const { SippolQueue } = require('../queue');
const SippolUtil = require('../util');

class SippolTrxblBridge extends SippolBridge {

    initialize(options) {
        this.optionKeys = ['accepts', 'maxNotifiedItems'];
        this.sippol = new SippolTrxbl(this.getOptions(options));
        this.works = this.sippol.works;
    }

    defaultWorks(options) {
        const works = super.defaultWorks(options);
        const extended = [
            [w => this.sippol.navigateApp(), w => options.role],
            [w => this.sippol.showData('SPJ GU'), w => options.role],
            [w => this.sippol.refresh(), w => options.role],
            [w => this.sippol.sleep(this.sippol.opdelay), w => options.role],
        ];
        works.push(...extended);
        return works;
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
        if (limit === 0) {
            callback(items, () => {});
        } else {
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
    }

    doList(options) {
        options = options || {};
        if (options.clear) {
            this.items = {};
        }
        this.getRoleFromKeg(options);
        return this.do(w => this.sippol.fetch(options), options);
    }

    download(queue) {
        return this.works([
            [w => this.doList(Object.assign({continueOnError: true}, queue.data))],
            [w => new Promise((resolve, reject) => {
                const items = w.getRes(0);
                const isDownload = typeof queue.download === 'function';
                if (queue.callback || isDownload) {
                    SippolUtil.exportXls([...items])
                        .then(buffer => {
                            const sid = SippolUtil.genId();
                            if (isDownload) {
                                queue.download(buffer, sid);
                            } else {
                                this.createCallback({sid: sid, download: buffer}, queue.callback, queue => {
                                    queue.resolve = () => next();
                                    queue.reject = () => next();
                                });
                            }
                        })
                        .catch(err => reject(err))
                    ;
                }
                resolve(items);
            }), w => w.getRes(0)],
        ]);
    }
}

module.exports = SippolTrxblBridge;