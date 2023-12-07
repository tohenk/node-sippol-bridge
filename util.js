
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

const crypto = require('crypto');

/**
 * Sippol utility.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SippolUtil {

    /**
     * Generate identifier.
     *
     * @returns {string}
     */
    static genId() {
        const shasum = crypto.createHash('sha1');
        shasum.update(new Date().getTime().toString());
        return shasum.digest('hex').substring(0, 8);
    }

    /**
     * Scan for date values and update object if applicable.
     *
     * @param {object} result Result object
     * @param {object} data Input data
     * @param {string[]} keys Date keys
     */
    static getDateForOptions(result, data, keys) {
        if (Array.isArray(keys)) {
            keys.forEach(key => {
                const value = data[key];
                if (value) {
                    let values;
                    if (!isNaN(value)) {
                        values = new Date(value);
                    }
                    if (typeof value == 'string') {
                        const dates = value.split('~');
                        dates.forEach(dt => {
                            try {
                                const d = new Date(dt);
                                if (!values) {
                                    values = {};
                                }
                                if (!values.from) {
                                    values.from = d;
                                } else {
                                    values.to = d;
                                }
                            }
                            catch (err) {
                                console.error('Unable to parse date: %s!', err);
                            }
                        });
                    }
                    if (values) {
                        result[key] = values;
                    }
                }
            });
        }
    }

    /**
     * Get defined date information from object.
     *
     * @param {object} result Data object to inspect
     * @param {string[]} keys Date keys
     * @returns {string}
     */
    static getDateInfo(result, keys) {
        let res;
        if (Array.isArray(keys)) {
            keys.forEach(key => {
                let value = result[key];
                if (value) {
                    const values = [];
                    if (value instanceof Date) {
                        values.push(value.toISOString());
                    }
                    if (value.from instanceof Date) {
                        values.push(value.from.toISOString());
                    }
                    if (value.to instanceof Date) {
                        values.push(value.to.toISOString());
                    }
                    res = `${key.toUpperCase()}: ${values.join(' - ')}`;
                    return true;
                }
            });
        }
        return res;
    }
}

module.exports = SippolUtil;