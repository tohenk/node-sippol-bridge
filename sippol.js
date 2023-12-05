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

const WebRobot = require('@ntlab/webrobot');
const Queue = require('@ntlab/work/queue');
const { By, WebElement } = require('selenium-webdriver');
const util = require('util');
const debug = require('debug')('sippol');

/**
 * Handles common functionality to do interaction with Sippol such as login, logout,
 * and common boilerplate to access specific app.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class Sippol extends WebRobot {

    DATE_MATCH = 1
    DATE_BEFORE = 2
    DATE_AFTER = 3

    DEFAULT_PATH = '#/keuda-spp'

    initialize() {
        if (!this.url) {
            throw new Error('SIPPOL url must be supplied!');
        }
        this.toolbar = new SippolToolbar(this);
        this.paginator = new SippolPaginator(this);
        this.delay = this.options.delay || 500;
        this.opdelay = this.options.opdelay || 400;
        this.updelay = this.options.updelay || 30000;
        WebRobot.expectErr(SippolStopError);
        WebRobot.expectErr(SippolAnnouncedError);
        this.onOpen = () => {
            this.reset();
        }
        this.configure();
    }

    /**
     * Do instance configuration.
     */
    configure() {
    }

    /**
     * Do reset on open url.
     */
    reset() {
    }

    /**
     * Get id part from string, the id accepted is in the form of #[0-9]+.
     *
     * @param {string} value The value
     * @returns {number}
     */
    pickPid(value) {
        if (value !== undefined && value.length) {
            let matches;
            if (matches = value.match(/#(\d+)/)) {
                return this.pickNumber(matches[1]);
            }
        }
        return null;
    }

    /**
     * Get string and ignore empty one.
     *
     * @param {string} value The value
     * @returns {string}
     */
    pickStr(value) {
        if (typeof value === 'string') {
            value = value.trim();
            if (value.length) {
                return value;
            }
        }
        return null;
    }

    /**
     * Get number from string.
     *
     * @param {string} value The value
     * @returns {number}
     */
    pickNumber(value) {
        if (value !== undefined && value.length) {
            return parseInt(value);
        }
        return null;
    }

    /**
     * Get float number from string.
     *
     * @param {string} value The value
     * @returns {number}
     */
    pickFloat(value) {
        if (value !== undefined && value.length) {
            return parseFloat(value.replace(/\./g, '').replace(/,/g, ''));
        }
        return null;
    }

    /**
     * Get date from string.
     *
     * @param {string} value The value
     * @param {boolean} toDate Convert as date object
     * @returns {string|Date}
     */
    pickDate(value, toDate = false) {
        if (value !== undefined) {
            value = (value.substr(0, 1) === ',' ? value.substr(1) : value).trim();
            if (value.length) {
                if (toDate) {
                    value = this.decodeDate(value);
                }
                return value;
            }
        }
        return null;
    }

    /**
     * Decode a date string into Date.
     *
     * @param {string} value The value
     * @returns {Date}
     */
    decodeDate(value) {
        const dtpart = value.split('/');
        if (dtpart.length === 3) {
            if (dtpart[2].length < 4) {
                dtpart[2] = new Date().getFullYear().toString().substr(0, 2) + dtpart[2];
            }
            value = new Date(parseInt(dtpart[2]), parseInt(dtpart[1]) - 1, parseInt(dtpart[0]));
        }
        return value;
    }

    /**
     * Get dates from values.
     *
     * @param {object} values Values
     * @returns {Array<Date>}
     */
    getDates(values) {
        const result = [];
        if (values.dates) {
            Object.keys(values.dates).forEach(key => {
                const value = values[key];
                const d = {};
                if (value instanceof Date) {
                    d.from = value;
                } else if (typeof value === 'object' && value.from instanceof Date) {
                    d.from = value.from;
                    if (value.to instanceof Date) {
                        d.to = value.to;
                    }
                }
                if (d.from) {
                    result[values.dates[key]] = d;
                }
            });
        }
        return result;
    }

    /**
     * Get max date.
     *
     * @param {Date} dateRef Reference date
     * @param {Date} now 
     * @returns {Date}
     */
    getMaxDate(dateRef, now) {
        const dateMax = new Date(dateRef.getFullYear(), 11, 31);
        if (now === undefined) {
            now = new Date();
        }
        return now <= dateMax ? now : dateMax;
    }

    /**
     * Number to string with leading zero padded to length.
     *
     * @param {number} value Value
     * @param {number} len String length
     * @returns {string}
     */
    fillZero(value, len) {
        return parseInt(value).toString().padStart(len, '0');
    }

    /**
     * Get key.
     *
     * @param {Array} keys Keys array
     * @param {string} value Key value
     * @returns {string}
     */
    getKey(keys, value) {
        const idx = Object.values(keys).indexOf(value);
        if (idx >= 0) {
            return Object.keys(keys)[idx];
        }
    }

    /**
     * Start interaction.
     *
     * @returns {Promise}
     */
    start() {
        return this.works([
            [w => this.open()],
            [w => this.waitLoader()],
            [w => this.login()],
            [w => this.isLoggedIn()],
            [w => this.navigateApp()],
        ]);
    }

    /**
     * End interaction.
     *
     * @returns {Promise}
     */
    stop() {
        return this.close();
    }

    /**
     * Login to Sippol.
     *
     * @param {string} username Username
     * @param {string} password Password
     * @param {boolean} force Set true to force login by logout first
     * @returns {Promise}
     */
    login(username, password, force = true) {
        return this.works([
            [w => this.isLoggedIn(true)],
            [w => this.logout(),
                w => w.getRes(0) && force],
            [w => this.waitAndClick(By.xpath('//button[@ng-click="vm.login()"]')),
                w => !w.getRes(0) || force],
            [w => this.fillInForm([
                        {target: By.id('username'), value: username},
                        {target: By.id('password'), value: password},
                        {target: By.id('rememberMe'), value: false}
                    ],
                    By.xpath('//h4[@data-translate="login.title"]'),
                    By.xpath('//button[@data-translate="login.form.button"]')
                ),
                w => !w.getRes(0) || force],
            [w => this.waitLoader(),
                w => !w.getRes(0) || force],
        ]);
    }

    /**
     * Logout from Sippol.
     *
     * @returns {Promise}
     */
    logout() {
        return this.works([
            [w => this.findElement(By.id('account-menu'))],
            [w => w.getRes(0).click()],
            [w => this.findElement(By.id('logout'))],
            [w => w.getRes(2).click()],
        ]);
    }

    /**
     * Check login state.
     *
     * @param {boolean} retval Resolve login state
     * @returns {Promise<boolean>|Promise}
     */
    isLoggedIn(retval) {
        return new Promise((resolve, reject) => {
            this.getDriver().getCurrentUrl()
                .then(url => {
                    const current = url.substr(url.indexOf('#'));
                    const loggedIn = current === this.DEFAULT_PATH;
                    if (retval) {
                        resolve(loggedIn);
                    } else if (loggedIn) {
                        resolve();
                    } else {
                        reject();
                    }
                })
            ;
        });
    }

    /**
     * Navigate to current app.
     *
     * @returns {Promise}
     */
    navigateApp() {
        return this.works([
            [w => this.getDriver().getCurrentUrl()],
            [w => Promise.resolve(w.getRes(0).substr(0, w.getRes(0).indexOf('#')))],
            [w => Promise.resolve(w.getRes(0).substr(w.getRes(0).indexOf('#')))],
            [w => this.open(w.getRes(1) + this.app), w => w.getRes(2) !== this.app],
        ]);
    }

    /**
     * Wait for loading indicator to complete.
     *
     * @returns {Promise}
     */
    waitLoader() {
        return this.waitPresence(By.id('loading-bar-spinner'), null, By.id('loading-bar'));
    }

    /**
     * Wait an element until its gone.
     *
     * @param {object|By} data Element to wait for
     * @param {WebElement} data.el Parent element
     * @param {By} data.data Element selector
     * @param {number} time Wait time
     * @param {WebElement} check Element to check to consider as gone
     * @returns {Promise}
     */
    waitPresence(data, time = null, check = null) {
        if (null === time) {
            time = this.wait;
        }
        return new Promise((resolve, reject) => {
            let shown = false;
            const t = Date.now();
            const f = () => {
                this.works([
                    [w => this.findElements(data)],
                    [w => new Promise((resolve, reject) => {
                        let wait = true;
                        if (shown && w.res.length === 0) {
                            wait = false;
                        }
                        if (w.res.length === 1 && !shown) {
                            shown = true;
                        }
                        // is timed out
                        if (!shown && Date.now() - t > time) {
                            wait = false;
                        }
                        resolve(wait);
                    })],
                ])
                .then(result => {
                    // element is still present
                    if (result) {
                        // consider it is done when a check element has gone
                        if (check && Date.now() - t > time * 3) {
                            this.waitPresence(check)
                                .then(() => resolve())
                                .catch(err => reject(err));
                        } else {
                            setTimeout(f, !shown ? 250 : 500);
                        }
                    } else {
                        resolve();
                    }
                })
                .catch(err => reject(err));
            }
            f();
        });
    }

    /**
     * Refresh data.
     *
     * @param {boolean} wait Wait for loader
     * @returns {Promise}
     */
    refresh(wait = true) {
        return this.works([
            [w => this.toolbar.navigateByIcon('glyphicon-refresh')],
            [w => this.waitLoader(), w => wait],
        ]);
    }

    /**
     * Locate a row id.
     *
     * @param {string|number} id Row id
     * @returns {Promise}
     */
    locate(id) {
        let match;
        return this.paginator.each({
            work: el => {
                match = el;
                return [];
            },
            done: () => Promise.resolve(match),
            filter: elements => new Promise((resolve, reject) => {
                const matched = [];
                const q = new Queue(elements, el => {
                    this.getRowId(el)
                        .then(xid => {
                            if (id == xid) {
                                matched.push(el);
                                q.done();
                            } else {
                                q.next();
                            }
                        })
                        .catch(err => reject(err))
                    ;
                });
                q.once('done', () => {
                    resolve(matched);
                });
            }),
            direction: -1, // start from last page
        });
    }

    /**
     * Get row id.
     *
     * @param {WebElement} el Row element
     * @returns {Promise<string|number>}
     */
    getRowId(el) {
        return Promise.reject('Not implemented!');
    }

    /**
     * Iterate all data.
     *
     * @param {object} options Parameters
     * @returns {Promise}
     */
    fetch(options) {
        options = options || {};
        if (typeof this.onFetchOptions === 'function') {
            this.onFetchOptions(options);
        }
        const items = [];
        const works = this.fetchWorks(options);
        const dates = this.getDates(options);
        const keys = Object.keys(dates);
        if (keys.length) {
            const from = dates[keys[0]].from;
            const to = dates[keys[0]].to ? this.getMaxDate(from, dates[keys[0]].to) : this.getMaxDate(from);
            const months = [];
            const names = ['Januari', 'Pebruari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'Nopember', 'Desember'];
            for (let i = from.getMonth(); i <= to.getMonth(); i++) {
                months.push(names[i]);
            }
            works.push([w => new Promise((resolve, reject) => {
                let i = 0;
                options.n = months.length;
                const q = new Queue(months, m => {
                    options.i = ++i;
                    this.works([
                        [x => this.toolbar.navigateMenuByTitle(this._m ? this._m : 'BLN', m, {deep: true, wait: true})],
                        [x => Promise.resolve(this._m = m)],
                        [x => this.fetchRun(options, items)],
                    ])
                    .then(() => q.next())
                    .catch(err => reject(err));
                });
                q.once('done', () => resolve(items));
            })]);
        } else {
            Object.assign(options, {n: 1, i: 1});
            works.push([w => this.fetchRun(options, items)]);
        }
        return this.works(works);
    }

    /**
     * A list of works for fetch.
     *
     * @param {object} options Parameters
     * @returns {Array}
     */
    fetchWorks(options) {
        return [];
    }

    /**
     * A run for fetch.
     *
     * @param {object} options Parameters
     * @param {Array} items Collected result
     * @returns {Promise}
     */
    fetchRun(options, items) {
        Object.assign(options, {
            work: el => this.fetchRunWorks(el, items, options),
            done: () => Promise.resolve(items),
        });
        return this.paginator.each(options);
    }

    /**
     * A list of works for each fetch run.
     *
     * @param {WebElement} el Row element
     * @param {Array} items Collected result
     * @param {object} options Parameters
     * @returns {Array}
     */
    fetchRunWorks(el, items, options) {
        const works = [];
        const dates = this.getDates(options);
        Object.keys(dates).forEach(key => {
            if (dates[key].from) {
                works.push([w => new Promise((resolve, reject) => {
                    this.fetchRunMatch(el, key, dates[key].from, dates[key].to)
                        .then(result => {
                            switch (result) {
                                case this.DATE_MATCH:
                                    return resolve(true);
                                case this.DATE_BEFORE:
                                    return resolve(false);
                                default:
                                    reject(new SippolStopError());
                            }
                        })
                        .catch(err => reject(err))
                    ;
                })]);
            }
        });
        if (!works.length) {
            works.push([w => Promise.resolve(true)]);
        }
        return works;
    }

    /**
     * Perform check for each row for date range match.
     *
     * @param {WebElement} el Row element
     * @param {string} key Row key
     * @param {Date} from Start date
     * @param {Date} to End date 
     * @returns {Promise}
     */
    fetchRunMatch(el, key, from, to) {
        return this.works([
            [w => el.findElement(this.fetchRunMatchSelector(key))],
            [w => w.getRes(0).isDisplayed()],
            [w => Promise.resolve(this.DATE_BEFORE), w => !w.getRes(1)],
            [w => w.getRes(0).getText(), w => w.getRes(1)],
            [w => new Promise((resolve, reject) => {
                const value = w.res;
                const s = value.split(',');
                const dt = this.pickDate(s[1], true);
                let result;
                if (!to) {
                    result = dt >= from ? this.DATE_MATCH : this.DATE_AFTER;
                } else {
                    if (from <= dt && dt <= to) {
                        result = this.DATE_MATCH;
                    } else if (dt < from) {
                        result = this.DATE_BEFORE;
                    } else {
                        result = this.DATE_AFTER;
                    }
                }
                resolve(result);
            }), w => w.res],
        ], {alwaysResolved: true});
    }

    /**
     * Get each row key selector for match comparison.
     *
     * @param {string} key Row key
     * @returns {By}
     */
    fetchRunMatchSelector(key) {
        throw new Error('Selector not implemented!');
    }
}

/**
 * A toolbar for activating various app functions.
 */
class SippolToolbar {

    /**
     * Constructor.
     *
     * @param {Sippol} parent Parent
     */
    constructor(parent) {
        this.parent = parent;
    }

    /**
     * Navigate to toolbar button.
     *
     * @param {By} selector Button selector
     * @returns {Promise<WebElement>}
     */
    navigate(selector) {
        return this.parent.works([
            [w => this.parent.findElement(selector)],
            [w => w.getRes(0).click(), w => w.getRes(0)],
            [w => Promise.resolve(w.getRes(0)), w => w.getRes(0)],
        ]);
    }

    /**
     * Navigate to toolbar button using its text.
     *
     * @param {string} title Button text
     * @returns {Promise<WebElement>}
     */
    navigateByTitle(title) {
        return this.navigate(By.xpath(`//div[contains(@class,"btn-toolbar")]/div/button/span[contains(text(),"${title}")]/..`));
    }

    /**
     * Navigate to toolbar button using its icon.
     *
     * @param {string} icon Button icon
     * @returns {Promise<WebElement>}
     */
    navigateByIcon(icon) {
        return this.navigate(By.xpath(`//div[contains(@class,"btn-toolbar")]/div/button/span[contains(@class,"${icon}")]/..`));
    }

    /**
     * Navigate to toolbar menu using selector.
     *
     * @param {By} selector Button selector
     * @param {string} name Menu title
     * @param {boolean} wait Add a wait after clicking menu
     * @returns {Promise}
     */
    navigateMenuBy(selector, name, wait = true) {
        let attr;
        if (typeof name === 'object') {
            const keys = Object.keys(name);
            attr = `@${keys[0]}`;
            name = name[keys[0]];
        } else {
            attr = 'text()';
        }
        return this.parent.works([
            [w => this.navigate(selector)],
            [w => w.getRes(0).findElement(By.xpath(`../ul/li[@role="menuitem"]/a[contains(${attr},"${name}")]`)), w => w.getRes(0)],
            [w => w.getRes(1).click(), w => w.getRes(1)],
            [w => this.parent.waitLoader(), w => w.getRes(1) && wait],
        ]);
    }

    /**
     * Navigate to toolbar menu using button text.
     *
     * @param {string} title Button text
     * @param {string} name Menu title
     * @param {object} options Options
     * @param {boolean} options.wait Add a wait after clicking menu
     * @param {boolean} options.deep Search in sub group buttons
     * @returns {Promise}
     */
    navigateMenuByTitle(title, name, options = {}) {
        options = options || {}
        if (options.wait === undefined) {
            options.wait = true;
        }
        return this.navigateMenuBy(
            By.xpath(`//div[contains(@class,"btn-toolbar")]/div${options.deep ? '/div' : ''}/button/span[contains(text(),"${title}")]/..`),
            name, options.wait);
    }

    /**
     * Navigate to toolbar menu using button icon.
     *
     * @param {string} icon Button icon
     * @param {string} name Menu title
     * @param {object} options Options
     * @param {boolean} options.wait Add a wait after clicking menu
     * @param {boolean} options.deep Search in sub group buttons
     * @returns {Promise}
     */
    navigateMenuByIcon(icon, name, options = {}) {
        options = options || {}
        if (options.wait === undefined) {
            options.wait = true;
        }
        return this.navigateMenuBy(
            By.xpath(`//div[contains(@class,"btn-toolbar")]/div${options.deep ? '/div' : ''}/button/span[contains(@class,"${icon}")]/..`),
            name, options.wait);
    }
}

/**
 * A data pagination for iterating Sippol data.
 */
class SippolPaginator {

    /**
     * Constructor.
     *
     * @param {Sippol} parent Parent
     */
    constructor(parent) {
        this.parent = parent;
    }

    /**
     * Perform data sort.
     *
     * @param {string} key Data type to sort
     * @param {number} dir Sort direction
     * @returns {Promise}
     */
    sort(key, dir = SippolPaginator.SORT_ASCENDING) {
        if (!key) {
            return Promise.reject('Sort key is required!');
        }
        return this.parent.works([
            [w => this.parent.findElement(By.xpath(`//th[@jh-sort-by="${key}"]/span[contains(@class,"glyphicon")]`))],
            [w => this.ensureSorted(w.getRes(0), dir)],
        ]);
    }

    /**
     * Ensure data is sorted.
     *
     * @param {WebElement} el Element sort clicker
     * @param {number} dir Sort direction
     * @returns {Promise}
     */
    ensureSorted(el, dir) {
        let sorted;
        const f = () => {
            return new Promise((resolve, reject) => {
                if (sorted) {
                    return resolve();
                }
                this.isSorted(el, dir)
                    .then(sort => {
                        if (sort) {
                            sorted = sort;
                        }
                        resolve();
                    })
                    .catch(err => reject(err))
                ;
            })
        }
        return this.parent.works([f, f]);
    }

    /**
     * Check if element is sorted as intended.
     *
     * @param {WebElement} el Element sort clicker
     * @param {number} dir Sort direction
     * @returns {Promise}
     */
    isSorted(el, dir) {
        if (!el) {
            return Promise.reject('No sort element');
        }
        return this.parent.works([
            [w => el.getAttribute('class')],
            [w => new Promise((resolve, reject) => {
                let sorted;
                let xclass = w.getRes(0);
                xclass = xclass.substr(xclass.indexOf(' ')).trim();
                switch (dir) {
                    case SippolPaginator.SORT_ASCENDING:
                        sorted = xclass === 'glyphicon-sort-by-attributes';
                        break;
                    case SippolPaginator.SORT_DESCENDING:
                        sorted = xclass === 'glyphicon-sort-by-attributes-alt';
                        break;
                }
                resolve(sorted);
            })],
            [w => el.click(), w => !w.getRes(1)],
        ]);
    }

    /**
     * Find pagination element.
     *
     * @param {By} pager Pager selector
     * @returns {Promise<WebElement>}
     */
    findPager(pager) {
        return this.parent.works([
            [w => this.parent.findElement(pager)],
            [w => w.getRes(0).isDisplayed()],
            [w => new Promise((resolve, reject) => {
                if (w.getRes(1)) {
                    resolve(w.getRes(0))
                } else {
                    reject();
                }
            })],
        ], {alwaysResolved: true});
    }

    /**
     * Find page portion from a pagination.
     *
     * @param {WebElement} pager Pagination element
     * @param {string|number} page Page to find
     * @param {object} options The options
     * @param {boolean} options.wait Add wait after clicking the page
     * @param {boolean} options.returnPage Return page instead the pagination
     * @returns {Promise<WebElement>|Promise<number>}
     */
    findPage(pager, page, options) {
        const isPage = ['first', 'prev', 'next', 'last'].indexOf(page) < 0;
        const xpath = isPage ? './/li[contains(@class,"pagination-page")]/a[text()="_PAGE_"]' :
            './/li[contains(@class,"pagination-_PAGE_")]/a';
        return this.parent.works([
            // find desired navigation button
            [w => pager.findElements(By.xpath(xpath.replace(/_PAGE_/, page)))],
            // ensure navigation button is clickable
            [w => w.getRes(0)[0].findElement(By.xpath('./..'))],
            // check for disabled class
            [w => w.getRes(1).getAttribute('class')],
            // should it be clicked
            [w => Promise.resolve(w.getRes(2) && w.getRes(2).indexOf('disabled') < 0)],
            // click it if it's not disabled
            [w => w.getRes(0)[0].click(), w => w.getRes(3)],
            // wait
            [w => this.parent.waitLoader(), w => w.getRes(3) && options.wait],
            // done
            [w => new Promise((resolve, reject) => {
                // no result
                if (w.getRes(0).length === 0) {
                    resolve();
                // return page
                } else if (options.returnPage) {
                    resolve(w.getRes(0)[0]);
                // return pager
                } else {
                    resolve(pager);
                }
            })],
        ]);
    }

    /**
     * Navigate to page.
     *
     * @param {By} pager Pager selector
     * @param {string|number} page Page number
     * @param {object} options 
     * @returns {Promise<WebElement>|Promise<number>}
     */
    navigatePage(pager, page, options) {
        options = options || {};
        if (typeof options.wait === 'undefined') {
            options.wait = true;
        }
        return this.parent.works([
            [w => this.findPager(pager)],
            [w => this.findPage(w.getRes(0), page, options), w => w.getRes(0)],
        ]);
    }

    /**
     * Get page numbers from pagination.
     *
     * @param {By} pager Pager selector
     * @param {number} dir Navigate direction 
     * @returns {Promise<number>}
     */
    getPages(pager, dir) {
        return this.parent.works([
            [w => this.navigatePage(pager, 'last')],
            [w => w.getRes(0).findElements(By.xpath('.//li[contains(@class,"pagination-page")]')), w => w.getRes(0)],
            [w => this.parent.getText([By.xpath('.')], w.getRes(1)[w.getRes(1).length - 1]), w => w.getRes(0)],
            [w => this.navigatePage(pager, 'first'), w => dir > 0],
            [w => new Promise((resolve, reject) => {
                let pages = 1;
                if (w.getRes(2)) {
                    pages = parseInt(w.getRes(2));
                }
                resolve(pages);
            })],
        ]);
    }

    /**
     * A run for each data iteration.
     *
     * @param {object} data Run data
     * @returns {Promise}
     */
    runIterate(data) {
        return this.parent.works([
            // get items
            [w => this.parent.findElements(data.selector)],
            // apply filter
            [w => data.filter(w.getRes(0)), w => typeof data.filter === 'function'],
            // filtered items
            [w => Promise.resolve(typeof data.filter === 'function' ? w.getRes(1) : w.getRes(0))],
            // process items
            [w => new Promise((resolve, reject) => {
                const result = {items: w.res, next: true};
                // handler to finish each iteration
                const finishRun = next => {
                    if (typeof data.done === 'function') {
                        data.done()
                            .then(res => {
                                debug('finish iteration with %s', res);
                                result.retval = res;
                                next();
                            })
                            .catch(err => {
                                debug('finish iteration with error %s', err);
                                reject(err);
                            })
                        ;
                    } else {
                        next();
                    }
                }
                // process each elements
                if (result.items.length) {
                    const q = new Queue(result.items, el => {
                        const works = data.works(el);
                        if (data.click) {
                            if (data.parentClick) {
                                works.push([x => el.findElement(By.xpath('./..')).click()]);
                            } else {
                                works.push([x => el.click()]);
                            }
                        }
                        if (data.wait) {
                            works.push([x => this.parent.sleep(this.delay)]);
                        }
                        this.parent.works([
                            [x => el.isDisplayed(), x => data.visible],
                            [x => Promise.resolve(!data.visible || getRes(0))],
                            [x => this.parent.works(works), x => x.getRes(1)],
                        ])
                        .then(() => finishRun(() => q.next()))
                        .catch(err => {
                            // is iteration stopped?
                            if (err instanceof SippolStopError) {
                                debug('got stop signal');
                                result.next = false;
                                q.done();
                            } else {
                                this.parent.works([
                                    [x => Promise.resolve(err && typeof data.info === 'function')],
                                    [x => data.info(el), x => x.getRes(0)],
                                    [x => Promise.resolve(console.error('Got error processing %s: %s!', x.getRes(1), err)), x => x.getRes(0)],
                                ]).then(() => {
                                    if (data.continueOnError) {
                                        finishRun(() => q.next());
                                    } else {
                                        reject(err);
                                    }
                                });
                            }
                        });
                    });
                    q.once('done', () => resolve(result));
                } else {
                    finishRun(() => resolve(result))
                }
            })],
        ]);
    }

    /**
     * Do iterate each data in pagination.
     *
     * @param {object} data Iterate data
     * @returns {Promise}
     */
    iterate(data) {
        if (data.direction === undefined) {
            data.direction = 1;
        }
        return this.parent.works([
            // get pages
            [w => this.getPages(data.pager, data.direction), w => data.pager],
            [w => Promise.resolve(data.pages = data.pager ? w.getRes(0) : 1)],
            [w => Promise.resolve(data.page = data.direction > 0 ? 1 : data.pages)],
            // process items
            [w => new Promise((resolve, reject) => {
                let retval;
                // handler for resolve
                const done = stop => {
                    debug('each resolved with %s', retval);
                    if (stop && typeof data.finalize === 'function') {
                        data.finalize()
                            .then(() => resolve(retval))
                            .catch(err => resolve(retval))
                        ;
                    } else {
                        resolve(retval);
                    }
                }
                // handler to go to next page or resolve when no more pages
                const nextPageOrResolve = (next = true) => {
                    if (next && data.pager) {
                        data.page += data.direction;
                        debug('next page %s', data.page);
                        if ((data.direction > 0 && data.page > data.pages) || (data.direction < 0 && data.page < 1)) {
                            // if more than 1 page, go back to first page if needed
                            if (data.pages > 1 && data.resetPage) {
                                this.navigatePage(data.pager, 'first')
                                    .then(() => done(data.i === data.n))
                                ;
                            } else {
                                done(data.i === data.n);
                            }
                        } else {
                            this.navigatePage(data.pager, data.page, {returnPage: true})
                                .then(page => {
                                    if (page) {
                                        run();
                                    } else {
                                        done(data.i === data.n);
                                    }
                                })
                            ;
                        }
                    } else {
                        done(true);
                    }
                }
                // handler loop
                const run = () => {
                    this.runIterate(data)
                        .then(result => {
                            if (result.retval !== undefined) {
                                retval = result.retval;
                            }
                            nextPageOrResolve(result.next);
                        })
                        .catch(err => reject(err))
                    ;
                }
                // run it
                run();
            })],
        ]);
    }

    /**
     * Iterate each data in pagination.
     *
     * @param {object} options Iterate data
     * @returns {Promise}
     */
    each(options) {
        const xpath = '//div[@class="container-fluid"]/div/div[@class="row"]/div[5]/div/table';
        Object.assign(options, {
            selector: By.xpath(xpath + '/tbody/tr[@ng-repeat-start]'),
            pager: By.xpath(xpath + '/tfoot/tr/td/ul[contains(@class,"pagination")]'),
            info: el => this.parent.getRowId(el),
            works: el => options.work(el),
        });
        return this.iterate(options);
    }

    static get SORT_ASCENDING() {
        return 1;
    }

    static get SORT_DESCENDING() {
        return 2;
    }
}

class SippolStopError extends Error {
}

class SippolAnnouncedError extends Error {

    toString() {
        return this.message;
    }

    [util.inspect.custom](depth, options, inspect) {
        return this.toString();
    }

    static create(message) {
        return new SippolAnnouncedError(message);
    }
}

module.exports = { Sippol, SippolPaginator, SippolStopError, SippolAnnouncedError };