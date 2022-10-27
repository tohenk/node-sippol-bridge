
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

const util = require('util');
const EventEmitter = require('events');
const Queue = require('@ntlab/work/queue');
const SippolUtil = require('./util');

let dequeue;

class SippolDequeue extends EventEmitter {

    info = {}

    constructor() {
        super();
        this.time = new Date();
        this.queues = [];
        this.queue = new Queue([], queue => this.doQueue(queue), () => this.canProcess());
        this.timeout = 5 * 60 * 1000;
    }

    doQueue(queue) {
        if (this.consumer) {
            try {
                queue.start();
                this.emit('queue', queue);
                this.consumer.processQueue(queue)
                    .then(res => {
                        queue.done(res);
                        this.setLastQueue(queue);
                        if (typeof queue.resolve == 'function') {
                            queue.resolve(res);
                        }
                        this.emit('queue-done', queue);
                        this.queue.next();
                    })
                    .catch(err => {
                        queue.error(err);
                        this.setLastQueue(queue);
                        if (typeof queue.reject == 'function') {
                            queue.reject(err);
                        }
                        this.emit('queue-error', queue);
                        this.queue.next();
                    })
                ;
            }
            catch (err) {
                console.error('Got an error while processing queue: %s!', err);
                this.queue.next();
            }
        }
    }

    canProcess() {
        return this.consumer ? this.consumer.canProcessQueue() : false;
    }

    setConsumer(consumer) {
        this.consumer = consumer;
        if (this.consumer) {
            if (this.queues.length) {
                this.queue.next();
            }
            const f = () => {
                // check for timeout
                let queue = this.getCurrent();
                if (queue && queue.status == SippolQueue.STATUS_PROCESSING) {
                    const t = new Date().getTime();
                    const d = t - queue.time.getTime();
                    const timeout = queue.data && queue.data.timeout != undefined ?
                        queue.data.timeout : this.timeout;
                    if (timeout > 0 && d > timeout) {
                        queue.setStatus(SippolQueue.STATUS_TIMED_OUT);
                        if (typeof queue.ontimeout == 'function') {
                            queue.ontimeout()
                                .then(() => this.queue.next())
                                .catch(() => this.queue.next())
                            ;
                        } else {
                            this.queue.next();
                        }
                    }
                }
                // check for next queue
                queue = this.getNext();
                if (queue && queue.type != SippolQueue.QUEUE_CALLBACK) {
                    if (this.consumer.canHandleNextQueue(queue)) {
                        this.queue.next();
                    }
                }
                // run on next
                setTimeout(f, 100);
            }
            f();
        }
        return this;
    }

    setInfo(info) {
        this.info = Object.assign({}, info);
        return this;
    }

    add(queue) {
        if (!queue.id) {
            queue.setId(SippolUtil.genId());
        }
        this.queues.push(queue);
        this.queue.requeue([queue], queue.type == SippolQueue.QUEUE_CALLBACK ? true : false);
        return {status: 'queued', id: queue.id};
    }

    getCurrent() {
        return this.queue.queue;
    }

    getNext() {
        return this.queue.queues.length ? this.queue.queues[0] : null;
    }

    getLast() {
        return this.last;
    }

    setLastQueue(queue) {
        if (queue.type != SippolQueue.QUEUE_CALLBACK) {
            this.last = queue;
        }
        return this;
    }

    getStatus() {
        const status = Object.assign({}, this.buildInfo(this.info), {
            time: this.time.toString(),
            total: this.queues.length,
            queue: this.queue.queues.length,
        });
        let queue = this.getCurrent();
        if (queue && queue.status == SippolQueue.STATUS_PROCESSING) {
            status.current = queue.getInfo();
        }
        queue = this.getLast();
        if (queue) {
            status.last = {};
            status.last.name = queue.getInfo();
            if (queue.time) {
                status.last.time = queue.time.toString();
            }
            status.last.status = queue.getStatusText();
            if (this.last.result) {
                status.last.result = util.inspect(queue.result);
            }
        }
        return status;
    }

    buildInfo(info) {
        const result = {};
        Object.keys(info).forEach(k => {
            let v = info[k];
            if (typeof v == 'function') {
                v = v();
            }
            result[k] = v;
        });
        return result;
    }
}

class SippolQueue
{
    constructor() {
        this.status = SippolQueue.STATUS_NEW;
    }

    setType(type) {
        this.type = type;
    }

    setId(id) {
        this.id = id;
    }

    setData(data) {
        this.data = data;
    }

    setCallback(callback) {
        this.callback = callback;
    }

    setStatus(status) {
        if (this.status != status) {
            this.status = status;
            console.log('Queue %s %s', this.getInfo(), this.getStatusText());
        }
    }

    setResult(result) {
        if (this.result != result) {
            this.result = result;
            console.log('Queue %s result: %s', this.getInfo(), this.result instanceof Error ? this.result.toString() : this.result);
        }
    }

    setTime(time) {
        if (time == null || time == undefined) {
            time = new Date();
        }
        this.time = time;
    }

    getTypeText() {
        return this.type;
    }

    getStatusText() {
        return this.status;
    }

    getMappedData(name) {
        if (this.maps && typeof name == 'string') {
            let o = this.maps;
            let parts = name.split('.');
            while (parts.length) {
                let n = parts.shift();
                if (n.substring(0, 1) == '#') n = n.substring(1);
                if (o[n]) {
                    o = o[n];
                } else {
                    o = null;
                    break;
                }
            }
            if (typeof o == 'string' && this.data[o]) {
                return this.data[o];
            }
        }
    }

    getInfo() {
        let info = this.info;
        if (!info && this.type == SippolQueue.QUEUE_CALLBACK) {
            info = this.callback;
        }
        return info ? util.format('%s:%s (%s)', this.getTypeText(), this.id, info) :
            util.format('%s:%s', this.getTypeText(), this.id);
    }

    start() {
        this.setTime();
        this.setStatus(SippolQueue.STATUS_PROCESSING);
    }

    done(result) {
        this.setStatus(SippolQueue.STATUS_DONE);
        this.setResult(result);
    }

    error(error) {
        this.setStatus(SippolQueue.STATUS_ERROR);
        this.setResult(error);
    }

    finished() {
        return [SippolQueue.STATUS_DONE, SippolQueue.STATUS_ERROR, SippolQueue.STATUS_TIMED_OUT].indexOf(this.status) >= 0;
    }

    static create(type, data, callback = null) {
        const queue = new this();
        queue.setType(type);
        queue.setData(data);
        if (callback) {
            queue.callback = callback;
        }
        return queue;
    }

    static createSppQueue(data, callback = null) {
        return this.create(SippolQueue.QUEUE_SPP, data, callback);
    }

    static createUploadQueue(data, callback = null) {
        return this.create(SippolQueue.QUEUE_UPLOAD, data, callback);
    }

    static createQueryQueue(data, callback = null) {
        return this.create(SippolQueue.QUEUE_QUERY, data, callback);
    }

    static createListQueue(data, callback = null) {
        return this.create(SippolQueue.QUEUE_LIST, data, callback);
    }

    static createDownloadQueue(data, callback = null) {
        return this.create(SippolQueue.QUEUE_DOWNLOAD, data, callback);
    }

    static createCallbackQueue(data, callback = null) {
        return this.create(SippolQueue.QUEUE_CALLBACK, data, callback);
    }

    static createDequeuer() {
        if (!dequeue) {
            dequeue = new SippolDequeue();
        }
        return dequeue;
    }

    static addQueue(queue) {
        if (!dequeue) {
            throw new Error('No dequeue instance has been created!');
        }
        return dequeue.add(queue);
    }

    static get QUEUE_SPP() { return 'spp' }
    static get QUEUE_UPLOAD() { return 'upload' }
    static get QUEUE_QUERY() { return 'query' }
    static get QUEUE_LIST() { return 'list' }
    static get QUEUE_DOWNLOAD() { return 'download' }
    static get QUEUE_CALLBACK() { return 'callback' }

    static get STATUS_NEW() { return 'new' }
    static get STATUS_PROCESSING() { return 'processing' }
    static get STATUS_DONE() { return 'done' }
    static get STATUS_ERROR() { return 'error' }
    static get STATUS_TIMED_OUT() { return 'timeout' }
}

module.exports = SippolQueue;
