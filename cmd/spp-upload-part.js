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

class SippolCmdSppUploadPartial extends SippolCmd {

    uploads = {}

    consume(payload) {
        let res;
        const { socket, data } = payload;
        if (data.Id && data.keg) {
            let key, partComplete = false;
            if (this.uploads[data.Id] === undefined) {
                this.uploads[data.Id] = {Id: data.Id, keg: data.keg};
                if (data.year) this.uploads[data.Id].year = data.year;
                if (data.info) this.uploads[data.Id].info = data.info;
                if (data.term) this.uploads[data.Id].term = data.term;
            }
            const parts = [];
            Object.keys(data).forEach(k => {
                if (['Id', 'info', 'keg', 'term', 'year', 'seq', 'tot', 'size', 'len'].indexOf(k) < 0) {
                    let buff = Buffer.from(data[k]);
                    if (this.uploads[data.Id][k] != undefined) {
                        buff = Buffer.concat([this.uploads[data.Id][k], buff]);
                    }
                    this.uploads[data.Id][k] = buff;
                    key = k;
                }
            });
            if (this.uploads[data.Id][key] !== undefined) {
                if (this.uploads[data.Id][key].length == data.size) {
                    partComplete = true;
                    parts.push(key);
                }
            }
            if (parts.length) {
                if (data.seq == data.tot && partComplete) {
                    res = this.dequeue.createQueue({
                        type: SippolQueue.QUEUE_UPLOAD,
                        data: this.uploads[data.Id],
                        callback: socket?.callback,
                    });
                    delete this.uploads[data.Id];
                } else {
                    res = {part: parts};
                }
            } else if (!partComplete && key) {
                res = {part: [key], len: this.uploads[data.Id][key].length};
            } else {
                res = this.createError(`Document part not found for ${data.Id}`);
            }
        } else {
            res = this.createError('Ignoring upload part without Id or keg');
        }
        return res;
    }
}

module.exports = SippolCmdSppUploadPartial;