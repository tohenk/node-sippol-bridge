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

class SippolBridge {

    STATE_NONE = 1
    STATE_SELF_TEST = 2
    STATE_OPERATIONAL = 3

    constructor(options) {
        this.state = this.STATE_NONE;
        this.roles = options.roles.roles || {};
        this.users = options.roles.users || {};
        this.initialize(options);
    }

    initialize(options) {
    }

    getOptions(options) {
        if (Array.isArray(this.optionKeys)) {
            this.optionKeys.forEach(opt => {
                if (options[opt]) {
                    this[opt] = options[opt];
                    delete options[opt];
                }
            });
        }
        return options;
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
        return this.state === this.STATE_OPERATIONAL;
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

    defaultWorks() {
        return [];
    }

    do(theworks, options) {
        options = options || {};
        const works = this.defaultWorks(options);
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

    sleep(ms) {
        return this.sippol.sleep(ms);
    }
}

module.exports = SippolBridge;