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

const fs = require('fs');
const { By, Key } = require('selenium-webdriver');
const Queue = require('@ntlab/work/queue');
const Work = require('@ntlab/work/work');
const WebRobot = require('@ntlab/webrobot');
const debug = require('debug')('sippol');

class Sippol extends WebRobot {

    SPP_DRAFT = 1
    SPP_SPM = 2
    SPP_SP2D = 3
    SPP_CAIR = 4
    SPP_BATAL = 5

    DATA_SPP = 1
    DATA_SPM = 2
    DATA_SP2D = 3
    DATA_PENERIMA = 4

    SORT_ASCENDING = 1
    SORT_DESCENDING = 2

    FETCH_DATA = 1
    FETCH_DOWNLOAD = 2

    MAIN_PATH = '#/keuda-spp';

    initialize() {
        if (!this.url) {
            throw new Error('SIPPOL url must be supplied!');
        }
        this.delay = this.options.delay || 500;
        this.opdelay = this.options.opdelay || 400;
        this.updelay = this.options.updelay || 30000;
        this.username = this.options.username;
        this.password = this.options.password;
        this.maps = this.options.maps || {};
        this.status = Object.freeze({
            SEMUA: 'spp-semua',
            DRAFT: 'spp-proses',
            PROSES: 'sp-proses',
            BATAL: 'spp-batal',
            SPP: 'spp-sptu',
            SPP_KEP: 'spp-sptuj',
            SPP_REJECT: 'spp-sptujNo',
            SPP_APPROVE: 'spp-terbit',
            SPM: 'spm-proses',
            SPM_BATAL: 'spm-batal',
            SP2D: 'sp2d-proses',
            SP2D_BATAL: 'sp2d-batal',
            SP2D_APPROVE: 'sp2d-terbit',
            SP2D_NOT_CAIR: 'sp2d-nocair',
            SP2D_CAIR: 'sp2d-cair',
        });
        this.docs = Object.freeze({
            REKENING: 'Daftar Rekening dari Bank Umum',
            NPHD: 'Naskah Perjanjian Hibah Daerah (NPHD)',
            PAKTA: 'Pakta Integritas',
            LAIN: 'Dokumen kelengkapan lainnya',
        });
    }

    pickPid(value) {
        if (value != undefined && value.length) {
            let matches;
            if (matches = value.match(/#(\d+)/)) {
                return this.pickNumber(matches[1]);
            }
        }
        return null;
    }

    pickStr(value) {
        if (typeof value == 'string') {
            value = value.trim();
            if (value.length) {
                return value;
            }
        }
        return null;
    }

    pickNumber(value) {
        if (value != undefined && value.length) {
            return parseInt(value);
        }
        return null;
    }

    pickFloat(value) {
        if (value != undefined && value.length) {
            return parseFloat(value.replace(/\./g, '').replace(/,/g, ''));
        }
        return null;
    }

    pickDate(value, toDate = false) {
        if (value != undefined) {
            value = (value.substr(0, 1) == ',' ? value.substr(1) : value).trim();
            if (value.length) {
                if (toDate) {
                    value = this.decodeDate(value);
                }
                return value;
            }
        }
        return null;
    }

    decodeDate(value) {
        const dtpart = value.split('/');
        if (dtpart.length == 3) {
            if (dtpart[2].length < 4) {
                const now = new Date();
                dtpart[2] = parseInt(now.getFullYear().toString().substr(0, 2) + dtpart[2]);
            }
            value = new Date(parseInt(dtpart[2]), parseInt(dtpart[1]) - 1, parseInt(dtpart[0]));
        }
        return value;
    }

    fillZero(value, len) {
        let res = parseInt(value).toString();
        while (res.length < len) {
            res = '0' + res;
        }
        return res;
    }

    getDocType(doc) {
        for (let key in this.docs) {
            if (doc.indexOf(this.docs[key]) == 0) {
                return key;
            }
        }
    }

    getKey(keys, value) {
        const idx = Object.values(keys).indexOf(value);
        if (idx >= 0) {
            return Object.keys(keys)[idx];
        }
    }

    dataKey(type) {
        if (!this.dataKeys) {
            this.dataKeys = {
                'noSpp': this.DATA_SPP,
                'noSpm': this.DATA_SPM,
                'noSp2d': this.DATA_SP2D,
                'key': this.DATA_PENERIMA
            };
        }
        return this.getKey(this.dataKeys, type);
    }

    start() {
        return Work.works([
            w => this.open(),
            w => this.sleep(),
            w => this.login(),
            w => this.isLoggedIn(),
        ]);
    }

    stop() {
        return Work.works([
            [w => this.getDriver().quit(), w => this.driver],
        ], {done: () => {
            this.driver = null;
        }});
    }

    login() {
        return Work.works([
            [w => this.isLoggedIn(true)],
            [w => this.waitAndClick(By.xpath('//button[@ng-click="vm.login()"]')),
                w => !w.getRes(0)],
            [w => this.fillInForm([
                        {target: By.id('username'), value: this.username},
                        {target: By.id('password'), value: this.password},
                        //{target: By.id('rememberMe'), value: false}
                    ],
                    By.xpath('//h4[@data-translate="login.title"]'),
                    By.xpath('//button[@data-translate="login.form.button"]')
                ),
                w => !w.getRes(0)],
            [w => this.sleep(this.wait),
                w => !w.getRes(0)],
        ]);
    }

    isLoggedIn(retval) {
        return new Promise((resolve, reject) => {
            this.getDriver().getCurrentUrl()
                .then(url => {
                    const loggedIn = url.indexOf(this.MAIN_PATH) > 0 ? true : false;
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

    showData(status) {
        status = status || this.status.SEMUA;
        if (Object.values(this.status).indexOf(status) < 0) {
            return Promise.reject(new Error('Status of ' + status + ' is unknown!'));
        }
        return Work.works([
            w => this.waitAndClick(By.xpath('//div[contains(@class,"btn-toolbar")]/div[3]/button[@id="dir-button"]')),
            w => this.waitAndClick(By.xpath('//ul/li/a[@ng-click="vm.dokStatus=\'_X_\'"]'.replace(/_X_/, status))),
        ]);
    }

    refreshData() {
        return this.waitAndClick(By.xpath('//button[@ng-click="vm.loadAll()"]'));
    }

    filterData(data, type = this.DATA_SPM) {
        const m = this.dataKey(type);
        if (!m) {
            return Promise.reject('Invalid filter type: ' + type);
        }
        return Work.works([
            [w => this.waitFor(By.xpath('//input[@ng-model="vm._X_"]'.replace(/_X_/, m)))],
            [w => this.fillInput(w.getRes(0), null == data ? data : data + (type != this.DATA_PENERIMA ? Key.ENTER : ''))],
            [w => this.refreshData(), w => type == this.DATA_PENERIMA]
        ]);
    }

    resetFilter() {
        return Work.works([
            w => this.filterData(null, this.DATA_SPP),
            w => this.filterData(null, this.DATA_SPM),
            w => this.filterData(null, this.DATA_SP2D),
            w => this.filterData(null, this.DATA_PENERIMA),
        ]);
    }

    sortData(type, dir = this.SORT_ASCENDING) {
        const m = this.dataKey(type);
        if (!m) {
            return Promise.reject('Invalid sort type: ' + type);
        }
        return Work.works([
            w => this.findElement(By.xpath('//th[@jh-sort-by="_X_"]/span[contains(@class,"glyphicon")]'.replace(/_X_/, m))),
            w => this.ensureSorted(w.getRes(0), dir),
        ]);
    }

    ensureSorted(el, dir) {
        let sorted;
        const f = () => {
            return new Promise((resolve, reject) => {
                if (sorted) return resolve();
                this.isSorted(el, dir)
                    .then(sort => {
                        if (sort) sorted = sort;
                        resolve();
                    })
                    .catch(err => reject(err))
                ;
            })
        }
        return Work.works([f, f]);
    }

    isSorted(el, dir) {
        if (!el) return Promise.reject('No sort element');
        return Work.works([
            [w => el.getAttribute('class')],
            [w => new Promise((resolve, reject) => {
                let sorted;
                let xclass = w.getRes(0);
                xclass = xclass.substr(xclass.indexOf(' ')).trim();
                switch (dir) {
                    case this.SORT_ASCENDING:
                        sorted = xclass == 'glyphicon-sort-by-attribute';
                        break;
                    case this.SORT_DESCENDING:
                        sorted = xclass == 'glyphicon-sort-by-attribute-alt';
                        break;
                }
                resolve(sorted);
            })],
            [w => el.click(), w => !w.getRes(1)],
        ]);
    }

    findPager(pager) {
        return Work.works([
            w => this.findElement(pager),
            w => w.getRes(0).isDisplayed(),
            w => new Promise((resolve, reject) => {
                if (w.getRes(1)) {
                    resolve(w.getRes(0))
                } else {
                    reject();
                }
            }),
        ], {alwaysResolved: true});
    }

    findPage(pager, page, options) {
        const isPage = ['first', 'prev', 'next', 'last'].indexOf(page) < 0;
        const xpath = isPage ? './/li[contains(@class,"pagination-page")]/a[text()="_PAGE_"]' :
            './/li[contains(@class,"pagination-_PAGE_")]/a';
        return Work.works([
            // find desired navigation button
            [w => pager.findElements(By.xpath(xpath.replace(/_PAGE_/, page)))],
            // ensure navigation button is clickable
            [w => w.getRes(0)[0].findElement(By.xpath('./..'))],
            // check for disabled class
            [w => w.getRes(1).getAttribute('class')],
            // click it if it's not disabled
            [w => w.getRes(0)[0].click(), w => w.getRes(2) && w.getRes(2).indexOf('disabled') < 0],
            // wait
            [w => this.sleep(), w => options.wait],
            // done
            [w => new Promise((resolve, reject) => {
                // no result
                if (w.getRes(0).length == 0) {
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

    navigatePage(pager, page, options) {
        options = options || {};
        if (typeof options.wait == 'undefined') options.wait = true;
        return Work.works([
            [w => this.findPager(pager)],
            [w => this.findPage(w.getRes(0), page, options), w => w.getRes(0)],
        ]);
    }

    getPages(pager, dir) {
        return Work.works([
            [w => this.navigatePage(pager, 'last')],
            [w => w.getRes(0).findElements(By.xpath('.//li[contains(@class,"pagination-page")]')), w => w.getRes(0)],
            [w => this.getText([By.xpath('.')], w.getRes(1)[w.getRes(1).length - 1]), w => w.getRes(0)],
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

    each(options) {
        const check = options.check;
        const filter = options.filter;
        const works = options.works;
        const done = options.done;
        const pager = options.pager;
        if (options.click == undefined) options.click = true;
        if (options.wait == undefined) options.wait = true;
        if (options.visible == undefined) options.visible = false;
        if (options.direction == undefined) options.direction = 1;
        return new Promise((resolve, reject) => {
            let retval;
            let page = 1;
            let pages = 1;
            const run = () => {
                Work.works([
                    [w => this.getDriver().findElements(check)],
                    [w => new Promise((resolve, reject) => {
                        // handler to go to next page or resolve when no more pages
                        const nextPageOrResolve = (next = true) => {
                            if (next && pager) {
                                page += options.direction;
                                debug('next page %s', page);
                                if ((options.direction > 0 && page > pages) || (options.direction < 0 && page < 1)) {
                                    // if more than 1 page, go back to first page if needed
                                    if (pages > 1 && options.resetPage) {
                                        this.navigatePage(pager, 'first')
                                            .then(() => {
                                                debug('each resolved with %s', retval);
                                                resolve(retval);
                                            })
                                        ;
                                    } else {
                                        debug('each resolved with %s', retval);
                                        resolve(retval);
                                    }
                                } else {
                                    this.navigatePage(pager, page, {returnPage: true})
                                        .then(el => {
                                            if (el) {
                                                run();
                                            } else {
                                                debug('each resolved with %s', retval);
                                                resolve(retval);
                                            }
                                        })
                                    ;
                                }
                            } else {
                                debug('each resolved with %s', retval);
                                resolve(retval);
                            }
                        }
                        // handler to finish each iteration
                        const finishEach = next => {
                            if (typeof done == 'function') {
                                done()
                                    .then(res => {
                                        debug('finish iteration with %s', res);
                                        retval = res;
                                        next();
                                    })
                                    .catch(err => {
                                        debug('finish iteration with error %s', err);
                                        if (err instanceof Error) throw err;
                                    })
                                ;
                            } else {
                                next();
                            }
                        }
                        // handler to process each elements
                        const doit = (elements, next = true) => {
                            // check if elements exists
                            if (elements.length) {
                                const q = new Queue(elements, el => {
                                    const f = () => {
                                        const items = works(el);
                                        if (options.click) items.push(() => el.click());
                                        if (options.wait) items.push(() => this.sleep(this.delay));
                                        Work.works(items)
                                            .then(() => finishEach(() => q.next()))
                                            .catch(err => {
                                                // is iteration stopped?
                                                if (err instanceof SippolStopError) {
                                                    debug('Got stop signal');
                                                    next = false;
                                                    q.done();
                                                } else {
                                                    if (err instanceof Error) throw err;
                                                }
                                            })
                                        ;
                                    }
                                    if (options.visible) {
                                        el.isDisplayed().then(visible => {
                                            if (visible) {
                                                f();
                                            } else {
                                                q.next();
                                            }
                                        });
                                    } else {
                                        f();
                                    }
                                });
                                q.once('done', () => nextPageOrResolve(next));
                            } else {
                                // no elements found
                                if (pager) {
                                    nextPageOrResolve();
                                } else {
                                    finishEach(() => resolve(retval));
                                }
                            }
                        }
                        // apply filter
                        if (typeof filter == 'function') {
                            filter(w.getRes(0))
                                .then(items => doit(items, false))
                                .catch(err => reject(err))
                            ;
                        } else {
                            doit(w.getRes(0));
                        }
                    })],
                ])
                .then(res => resolve(res))
                .catch(err => reject(err));
            }
            if (pager) {
                this.getPages(pager, options.direction)
                    .then(result => {
                        pages = result;
                        page = options.direction > 0 ? 1 : pages;
                        run();
                    })
                ;
            } else {
                run();
            }
        });
    }

    eachData(work, done, filter, direction = 1) {
        const xpath = '//div[@class="container-fluid"]/div/div[@class="row"]/div[5]/div/table';
        return this.each({
            check: By.xpath(xpath + '/tbody/tr[@ng-repeat-start]/td[1]'),
            pager: By.xpath(xpath + '/tfoot/tr/td/ul[contains(@class,"pagination")]'),
            works: el => work(el),
            done: done,
            filter: filter,
            direction: direction
        });
    }

    locateData(id) {
        let match;
        return this.eachData(
            el => {
                match = el;
                return [];
            },
            () => Promise.resolve(match),
            (elements) => new Promise((resolve, reject) => {
                const matched = [];
                const q = new Queue(elements, el => {
                    this.retrDataIdFromRow(el)
                        .then(xid => {
                            if (id == xid) {
                                matched.push(el);
                                q.done();
                            } else {
                                q.next();
                            }
                        });
                });
                q.once('done', () => {
                    resolve(matched);
                });
            }),
            -1 // start from last page
        );
    }

    fetchData(options) {
        options = options || {};
        if (options.useForm == undefined) options.useForm = true;
        const items = [];
        const works = this.fetchDataWorks(options);
        works.push([w => this.eachData(
            el => {
                const mode = options.mode ? options.mode : this.FETCH_DATA;
                const xworks = this.fetchDataEachWorks(el, options);
                switch (mode) {
                    case this.FETCH_DATA:
                        xworks.push([x => new Promise((resolve, reject) => {
                            const data = new SippolData();
                            this.retrData(el, data, options.useForm)
                                .then(okay => {
                                    if (okay) items.push(data);
                                    resolve();
                                })
                                .catch(err => reject(err))
                            ;
                        })]);
                        break;
                    case this.FETCH_DOWNLOAD:
                        xworks.push([x => new Promise((resolve, reject) => {
                            this.saveSpp(el)
                                .then(res => {
                                    if (res) items.push(res);
                                    resolve();
                                })
                                .catch(err => reject(err))
                            ;
                        })]);
                        break;
                }
                return xworks;
            },
            () => Promise.resolve(items)
        )]);
        return Work.works(works);
    }

    fetchDataWorks(options) {
        const works = [];
        const filters = {spp: this.DATA_SPP, spm: this.DATA_SPM, sp2d: this.DATA_SP2D};
        Object.keys(filters).forEach(key => {
            if (options[key] instanceof Date) {
                works.push(() => this.sortData(filters[key], this.SORT_DESCENDING));
            }
        });
        return works;
    }

    fetchDataEachWorks(el, options) {
        const works = [];
        const filters = {spp: 'tglSpp', spm: 'tglSpm', sp2d: 'tglSp2d'};
        Object.keys(filters).forEach(key => {
            if (options[key] instanceof Date) {
                works.push([w => new Promise((resolve, reject) => {
                    this.fetchDataEachMatch(el, filters[key], options[key])
                        .then(okay => {
                            if (!okay) {
                                reject(new SippolStopError());
                            } else {
                                resolve();
                            }
                        })
                    ;
                })]);
            }
        });
        return works;
    }

    fetchDataEachMatch(el, filter, since) {
        return Work.works([
            [w => el.findElement(By.xpath('./..//span[@ng-show="spp._X_"]'.replace(/_X_/, filter)))],
            [w => w.getRes(0).isDisplayed()],
            [w => w.getRes(0).getText(), w => w.getRes(1)],
            [w => new Promise((resolve, reject) => {
                const value = w.getRes(2);
                const s = value.split(',');
                const dt = this.pickDate(s[1], true);
                resolve(dt >= since);
            }), w => w.getRes(2)],
        ], {alwaysResolved: true});
    }

    retrData(el, data, useForm) {
        return Work.works([
            [w => this.retrDataStatusFromRow(el)],
            [w => this.retrDataFromForm(el, data), w => w.getRes(0) && useForm],
            [w => this.retrDataFromRow(el, data), w => w.getRes(0) && !useForm],
        ]);
    }

    retrDataFromForm(el, data) {
        return Work.works([
            w => this.clickEditSppButton(el),
            w => this.getValuesFromSppForm(data),
        ]);
    }

    getValuesFromSppForm(data) {
        return Work.works([
            // wait for form to completely shown
            [w => this.waitFor(By.xpath('//form[@name="editForm"]'))],
            // get form title
            [w => this.getText([By.id('mySppLabel')], w.getRes(0))],
            // get values
            [w => this.getFormValues(w.getRes(0), ['noSpp', 'tglSpp', 'noSpm', 'tglSpm', 'noSp2d', 'tglSp2d', 'tglCair',
                'penerima', 'alamat', 'npwp', 'kode', 'noKontrak', 'tglKontrak', 'bank', 'bankCab', 'bankRek',
                'afektasi', 'untuk', 'ket'
            ])],
            // it is cancelled
            [w => w.getRes(0).findElement(By.xpath('//div[@ng-show="vm.spp.pkId"]/span/span[text()="Batal"]'))],
            // true when visible
            [w => w.getRes(3).isDisplayed()],
            // dismiss form
            [w => this.click({el: w.getRes(0), data: By.xpath('//button[@class="close"]')})],
            // parse data
            [w => new Promise((resolve, reject) => {
                let pid = w.getRes(1)[0];
                let values = w.getRes(2);
                let cancelled = w.getRes(4);
                data.Id = this.pickPid(pid);
                data.Kode = this.pickStr(values.kode);
                data.Penerima = this.pickStr(values.penerima);
                data.Alamat = this.pickStr(values.alamat);
                data.NPWP = this.pickNumber(values.npwp);
                data.AccBank = this.pickStr(values.bank + ' ' + values.bankCab);
                data.AccNo =this.pickStr(values.bankRek);
                data.SKNomor = this.pickStr(values.noKontrak);
                data.SKTanggal = this.pickDate(values.tglKontrak);
                data.Untuk = this.pickStr(values.untuk);
                data.Keterangan = this.pickStr(values.ket);
                data.SPPNomor = this.pickNumber(values.noSpp);
                data.SPPTanggal = this.pickDate(values.tglSpp);
                data.SPMNomor = this.pickNumber(values.noSpm);
                data.SPMTanggal = this.pickDate(values.tglSpm);
                data.SP2DNomor = this.pickNumber(values.noSp2d);
                data.SP2DTanggal = this.pickDate(values.tglSp2d);
                data.CairTanggal = this.pickStr(values.tglCair);
                data.Nominal = this.pickFloat(values.afektasi);
                if (cancelled) {
                    data.Status = this.SPP_BATAL;
                } else {
                    switch (true) {
                        case data.CairTanggal != null:
                            data.Status = this.SPP_CAIR;
                            break;
                        case data.SP2DTanggal != null:
                            data.Status = this.SPP_SP2D;
                            break;
                        case data.SPMNomor != null:
                            data.Status = this.SPP_SPM;
                            break;
                        default:
                            data.Status = this.SPP_DRAFT;
                            break;
                    }
                }
                resolve(data);
            })],
        ]);
    }

    retrDataFromRow(el, data) {
        return Work.works([
            [w => this.retrDataIdFromRow(el)],
            [w => this.getText([
                By.xpath('./../td[3]/span[1]'),         By.xpath('./../td[3]/span[2]'), // SPP
                By.xpath('./../td[4]/span[1]/strong'),  By.xpath('./../td[4]/span[2]'), // SPM
                By.xpath('./../td[5]/span[1]/strong'),  By.xpath('./../td[5]/span[2]'), // SP2D
                By.xpath('./../td[7]/strong'),                                          // Nominal
            ], el)],
            [w => new Promise((resolve, reject) => {
                let id = w.getRes(0);
                let values = w.getRes(1);
                data.Id = id;
                data.SPPNomor = this.pickNumber(values[0]);
                data.SPPTanggal = this.pickDate(values[1]);
                data.SPMNomor = this.pickNumber(values[2]);
                data.SPMTanggal = this.pickDate(values[3]);
                data.SP2DNomor = this.pickNumber(values[4]);
                data.SP2DTanggal = this.pickDate(values[5]);
                data.Nominal = this.pickFloat(values[6]);
                resolve(data);
            })],
        ]);
    }

    retrDataIdFromRow(el) {
        return Work.works([
            w => el.findElement(By.xpath('./../td[2]')),
            w => w.getRes(0).getAttribute('title'),
            w => Promise.resolve(this.pickPid(w.getRes(1))),
        ]);
    }

    retrDataStatusFromRow(el) {
        return Work.works([
            w => el.findElement(By.xpath('./../td[3]/span[@ng-show="spp.pkSppFlag!=0"]')),
            w => w.getRes(0).getAttribute('class'),
            w => Promise.resolve(w.getRes(1).indexOf('glyphicon-remove') < 0),
        ]);
    }

    saveSpp(el) {
        return Work.works([
            [w => this.getText([
                By.xpath('./../td[2]'),                 // Jenis
                By.xpath('./../td[5]/span[1]/strong'),  // SP2D Nomor
            ], el)],
            [w => el.findElement(By.xpath('./../td[2]'))],
            [w => w.getRes(1).getAttribute('title'), w => w.getRes(1)],
            [w => el.findElement(By.xpath('./../td[6]/span/span[@ng-show="spp.tglCair"]'))],
            [w => w.getRes(3).isDisplayed(), w => w.getRes(3)],
            [w => w.getRes(3).click(), w => w.getRes(4)],
            [w => new Promise((resolve, reject) => {
                const j = w.getRes(0)[0].split(' ');
                const sp2d = w.getRes(0)[1];
                const pid = this.pickPid(w.getRes(2));
                const filename = 'SP2D-' + j[1] + '-' + j[0] + this.fillZero(sp2d, 6) + '-' + this.fillZero(pid, 6) + '.spp';
                resolve(filename);
            })],
        ]);
    }

    createSpp(data) {
        return Work.works([
            w => this.clickAddSppButton(),
            w => this.sleep(this.opdelay),
            w => this.fillSppForm(data),
        ]);
    }

    updateSpp(id, data) {
        return Work.works([
            [w => this.locateData(id)],
            [w => this.clickEditSppButton(w.getRes(0)), w => w.getRes(0)],
            [w => this.sleep(this.opdelay), w => w.getRes(0)],
            [w => this.fillSppForm(data), w => w.getRes(0)],
            [w => Promise.reject('SPP with id ' + id + ' is not found!'), w => !w.getRes(0)],
        ]);
    }

    clickAddSppButton() {
        return this.waitAndClick(By.xpath('//div[contains(@class,"btn-toolbar")]/div[1]/button[@ng-click="vm.sppAdd()"]'));
    }

    clickEditSppButton(el) {
        return Work.works([
            [w => el.findElement(By.xpath('./..'))],
            [w => w.getRes(0).getAttribute('class')],
            [w => el.click(), w => w.getRes(1) != 'info'],
            [w => this.click({el: el, data: By.xpath('./../td[9]/button[@ng-click="vm.sppEdit(spp)"]')})],
        ]);
    }

    fillSppForm(data) {
        let works = [];
        let tabs = ['spp', 'penerima', 'gaji', 'rincian', 'spm', 'sp2d', 'tu'];
        let forms = this.getSppFormData(data);
        for (let key in forms) {
            let tabIdx = tabs.indexOf(key);
            let xpath = By.xpath('//div[@id="agrTab"]/ul/li[@index="' + tabIdx + '"]/a');
            works.push([w => this.waitAndClick(xpath)]);
            if (key == 'rincian') {
                // process only once
                let idx = works.length;
                works.push([w => this.getDriver().findElements(By.xpath('//tr[@ng-repeat="trsRek in vm.trsReks track by trsRek.id"]'))]);
                works.push([w => this.waitAndClick(By.xpath('//button[@ng-click="vm.trsRekAdd()"]')), w => w.getRes(idx).length == 0]);
                works.push([w => this.fillInForm(forms[key],
                    By.xpath('//h4[@id="myTrsRekLabel"]'),
                    By.xpath('//h4[@id="myTrsRekLabel"]/../../div[@class="modal-footer"]/button[contains(@ng-disabled,"vm.isSaving")]')
                ), w => w.getRes(idx).length == 0]);
            } else {
                works.push([w => this.fillInForm(forms[key], xpath)]);
            }
        }
        works.push([w => this.sleep(this.opdelay)]);
        works.push([w => this.waitAndClick(By.xpath('//h4[@id="mySppLabel"]/../../div[@class="modal-footer"]/button[contains(@ng-disabled,"vm.isSaving")]'))]);
        return Work.works(works);
    }

    getSppFormData(data) {
        let forms = {};
        for (let key in this.maps) {
            forms[key] = this.getMappedFormData(data, this.maps[key]);
        }
        return forms;
    }

    getMappedFormData(data, maps) {
        let result = [];
        for (let key in maps) {
            let mapping = {};
            let identifier = key;
            if (key.substring(0, 1) == '#') {
                identifier = key.substring(1);
                mapping.target = By.id(identifier);
            } else {
                mapping.target = By.name(key);
            }
            let value = maps[key];
            if (typeof value == 'string' && data[value]) {
                value = data[value];
            }
            // handle tgl
            if (identifier.indexOf('tgl') == 0 && typeof value == 'string') {
                let p = value.indexOf(' ');
                if (p > 0) {
                    value = value.substring(0, p);
                }
            }
            // handle rek bank
            if ((identifier == 'bank' || identifier == 'bankCab') && data[maps.bank]) {
                let xvalue = data[maps.bank];
                let matches;
                if (matches = xvalue.toUpperCase().match(/(CABANG|CAPEM)/)) {
                    if (identifier == 'bank') {
                        value = xvalue.substr(0, matches.index - 1).trim();
                    } else {
                        value = xvalue.substr(matches.index).trim();
                    }
                }
            }
            mapping.value = value;
            // handle autocomplete
            if (identifier.indexOf('search') == 0) {
                mapping.wait = true;
                mapping.done = (data, next) => {
                    // wait for autocomplete-row
                    Work.works([
                        [w => this.sleep()],
                        [w => this.getDriver().findElements(By.xpath('//div[@class="angucomplete-row"]'))],
                        [w => new Promise((resolve, reject) => {
                            const q = new Queue(w.getRes(1), el => {
                                Work.works([
                                    [x => el.getText()],
                                    [x => el.click(), x => x.getRes(0).indexOf(data.value) >= 0],
                                    [x => Promise.reject(), x => x.getRes(0).indexOf(data.value) < 0],
                                ])
                                .then(() => resolve())
                                .catch(err => q.next());
                            });
                            q.once('done', () => reject('No match for ' + data.value));
                        })],
                    ])
                    .then(() => next())
                    .catch(err => {
                        // retry once more
                        if (!data.retry) {
                            data.retry = true;
                            data.handler();
                        } else if (err instanceof Error) {
                            throw err;
                        }
                    });
                }
            }
            result.push(mapping);
        }
        return result;
    }

    uploadDocs(id, docs) {
        return Work.works([
            [w => this.locateData(id)],
            [w => this.click({el: w.getRes(0), data: By.xpath('../td[6]/span/span[@ng-show="spp.syaratId"]')}),
                w => w.getRes(0)],
            [w => this.getDriver().findElements(By.xpath('//ul/li[@ng-repeat="dok in spp.doks"]')),
                w => w.getRes(0)],
            [w => this.uploadDocFiles(w.getRes(2), docs),
                w => w.getRes(0)],
            [w => Promise.reject('Unable to upload, SPP with id ' + id + ' is not found!'),
                w => !w.getRes(0)],
        ]);
    }

    uploadDocFiles(elements, docs) {
        return new Promise((resolve, reject) => {
            let result = {};
            let idx = -1;
            const q = new Queue(elements, el => {
                idx++;
                Work.works([
                    [w => el.getText()],
                    [w => el.findElement(By.xpath('./span[contains(@class,"glyphicon-download")]'))],
                    [w => w.getRes(1).isDisplayed()],
                    [w => new Promise((resolve, reject) => {
                        let doctype = this.getDocType(w.getRes(0));
                        if (!doctype) {
                            return resolve();
                        }
                        if (w.getRes(2)) {
                            if (!result.skipped) result.skipped = [];
                            result.skipped.push(doctype);
                            return resolve();
                        }
                        if (docs[doctype] && fs.existsSync(docs[doctype])) {
                            this.uploadDocFile(w.getRes(1), docs[doctype], idx)
                                .then(res => {
                                    if (res) {
                                        if (!result.updated) result.updated = [];
                                        result.updated.push(doctype);
                                    }
                                    resolve();
                                })
                            ;
                        } else {
                            resolve();
                        }
                    })],
                ])
                .then(() => q.next())
                .catch(() => q.next());
            });
            q.once('done', () => resolve(result));
        });
    }

    uploadDocFile(el, file, index) {
        return Work.works([
            [w => this.getDriver().findElements(By.xpath('//label/input[@type="file" and @ngf-select="vm.sppSyaratUp($file, spp, dok)"]'))],
            [w => Promise.resolve(console.log('Uploading document %s', file)),
                w => idx < w.getRes(0).length],
            [w => w.getRes(0)[index].sendKeys(file),
                w => idx < w.getRes(0).length],
            [w => new Promise((resolve, reject) => {
                    const stime = Date.norun();
                    // wait for upload to complete
                    const f = () => {
                        el.isDisplayed()
                            .then(visible => {
                                if (visible) {
                                    resolve(true);
                                } else {
                                    // should we retry?
                                    const ctime = Date.norun();
                                    if (ctime - stime <= this.updelay) {
                                        setTimeout(f, 100);
                                    } else {
                                        console.log('Upload for %s timed out!', file);
                                        resolve(false);
                                    }
                                }
                            })
                        ;
                    }
                    f();
                }),
                w => idx < w.getRes(0).length],
            [w => Promise.resolve(w.getRes(3))],
        ]);
    }
}

class SippolData {
    copyFrom(data) {
        if (data instanceof SippolData) {
            for (let key in data) {
                this[key] = data[key];
            }
        }
    }
}

class SippolStopError extends Error {
}

module.exports = { Sippol, SippolData, SippolStopError };