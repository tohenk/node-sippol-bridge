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

const SippolCmd = require('.');
const { SippolQueue } = require('../queue');

class SippolCmdSppQuery extends SippolCmd {

    consume(payload) {
        let res;
        const { socket, data } = payload;
        if (data.year && data.keg && data.term) {
            if (data.notify) {
                res = this.dequeue.createQueue({
                    type: SippolQueue.QUEUE_QUERY,
                    data: {year: data.year, keg: data.keg, term: data.term, notify: true},
                    info: data.term,
                    callback: socket?.callback,
                });
            } else {
                const f = () => new Promise((resolve, reject) => {
                    const res = this.dequeue.createQueue({
                        type: SippolQueue.QUEUE_QUERY,
                        data: {year: data.year, keg: data.keg, term: data.term},
                        info: data.term,
                        resolve: resolve,
                        reject: reject,
                        callback: socket?.callback,
                    });
                });
                f()
                    .then(items => {
                        if (socket) {
                            socket.emit(this.name, {result: items});
                        }
                    })
                    .catch(err => {
                        if (socket) {
                            socket.emit(this.name, this.createError(err));
                        }
                    })
                ;
            }
        } else {
            res = this.createError('Ignoring query without year, keg, or term');
        }
        return res;
    }
}

module.exports = SippolCmdSppQuery;