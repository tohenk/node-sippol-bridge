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
const SippolUtil = require('../util');

class SippolCmdSppList extends SippolCmd {

    dates = ['spp', 'spm', 'sp2d']

    consume(payload) {
        const { socket, data } = payload;
        if (data.year && data.keg) {
            const options = {year: data.year, keg: data.keg, timeout: 0};
            SippolUtil.getDateForOptions(options, data, this.dates);
            return this.dequeue.createQueue({
                type: SippolQueue.QUEUE_LIST,
                data: options,
                info: SippolUtil.getDateInfo(options, this.dates),
                callback: socket?.callback,
            });
        }
        return this.createError('Ignoring list without year or keg');
    }
}

module.exports = SippolCmdSppList;