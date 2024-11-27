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

const SippolCmd = require('.');
const { SippolQueue } = require('../queue');
const SippolUtil = require('../util');

class SippolCmdTrxblDownload extends SippolCmd {

    dates = ['date']

    consume(payload) {
        const { socket, data } = payload;
        if (data.year && (data.keg || data.all)) {
            const roles = this.parent.config.roles.roles;
            const kegs = data.all ? Object.keys(roles) : (Array.isArray(data.keg) ? data.keg : [data.keg]);
            const options = {year: data.year};
            SippolUtil.getDateForOptions(options, data, this.dates);
            const res = [];
            const users = [];
            for (const keg of kegs) {
                if (users.indexOf(roles[keg]) >= 0) {
                    continue;
                }
                users.push(roles[keg]);
                res.push(this.dequeue.createQueue({
                    type: SippolQueue.QUEUE_DOWNLOAD,
                    data: Object.assign({}, options, {keg, timeout: 0}),
                    info: SippolUtil.getDateInfo(options, this.dates),
                    download: data.ondownload,
                    callback: socket?.callback,
                }));
            }
            if (res.length > 1) {
                return {status: 'queued', id: res.map(q => q.id)};
            }
            if (res.length === 1) {
                return res[0];
            }
        }
        return this.createError('Ignoring download without year, keg, or all option');
    }
}

module.exports = SippolCmdTrxblDownload;