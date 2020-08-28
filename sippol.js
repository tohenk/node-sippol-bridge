/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2020 Toha <tohenk@yahoo.com>
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
const {By, Key} = require('selenium-webdriver');
const WebRobot = require('./lib/webrobot');
const Queue = require('./lib/queue');
const Work = require('./lib/work');

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
                dtpart[2] = (now.getFullYear() % 100) * 100 + parseInt(dtpart[2]);
            }
            value = new Date(parseInt(dtpart[2]), parseInt(dtpart[1]) - 1, parseInt(dtpart[0]));
        }
        return value;
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
            () => this.open(),
            () => this.sleep(),
            () => this.login(),
            () => this.isLoggedIn()
        ]);
    }

    stop() {
        return new Promise((resolve, reject) => {
            if (this.driver) {
                try {
                    this.getDriver().quit()
                        .then(() => {
                            this.driver = null;
                            resolve();
                        })
                        .catch((err) => {
                            this.driver = null;
                            reject(err);
                        })
                    ;
                }
                catch (err) {
                    this.driver = null;
                    reject(err);
                }
            } else {
                resolve();
            }
        });
    }

    login() {
        return new Promise((resolve, reject) => {
            this.isNeedLoggingIn()
                .then(() => {
                    Work.works([
                        () => this.waitAndClick(By.xpath('//button[@ng-click="vm.login()"]')),
                        () => this.fillInForm([
                                    {target: By.id('username'), value: this.username},
                                    {target: By.id('password'), value: this.password},
                                    //{target: By.id('rememberMe'), value: false}
                                ],
                                By.xpath('//h4[@data-translate="login.title"]'),
                                By.xpath('//button[@data-translate="login.form.button"]')
                        ),
                        () => this.sleep(this.wait)
                    ])
                        .then(() => resolve())
                        .catch((err) => reject(err))
                    ;
                })
                .catch(() => resolve())
            ;
        });
    }

    isLoggedIn() {
        return new Promise((resolve, reject) => {
            this.getDriver().getCurrentUrl()
                .then((url) => {
                    if (url.indexOf(this.MAIN_PATH) > 0) {
                        resolve();
                    } else {
                        reject('Not logged in!');
                    }
                })
            ;
        });
    }

    isNeedLoggingIn() {
        return new Promise((resolve, reject) => {
            this.isLoggedIn()
                .then(() => reject())
                .catch(() => resolve())
            ;
        });
    }

    showData(status) {
        status = status || this.status.SEMUA;
        if (Object.values(this.status).indexOf(status) < 0) {
            return Promise.reject(new Error('Status of ' + status + ' is unknown!'));
        }
        return Work.works([
            () => this.waitAndClick(By.xpath('//div[contains(@class,"btn-toolbar")]/div[3]/button[@id="dir-button"]')),
            () => this.waitAndClick(By.xpath('//ul/li/a[@ng-click="vm.dokStatus=\'_X_\'"]'.replace(/_X_/, status))),
        ]);
    }

    refreshData() {
        return this.waitAndClick(By.xpath('//button[@ng-click="vm.loadAll()"]'));
    }

    filterData(data, type = this.DATA_SPM) {
        return new Promise((resolve, reject) => {
            const m = this.dataKey(type);
            if (!m) {
                return reject('Invalid filter type: ' + type);
            }
            this.waitFor(By.xpath('//input[@ng-model="vm._X_"]'.replace(/_X_/, m)))
                .then((el) => {
                    this.fillInput(el, null == data ? data : data + (type != this.DATA_PENERIMA ? Key.ENTER : ''))
                        .then(() => {
                            if (type == this.DATA_PENERIMA) {
                                this.refreshData()
                                    .then(() => resolve())
                                    .catch((err) => reject(err))
                                ;
                            } else {
                                resolve();
                            }
                        })
                    ;
                })
                .catch((err) => reject(err))
            ;
        });
    }

    resetFilter() {
        return Work.works([
            () => this.filterData(null, this.DATA_SPP),
            () => this.filterData(null, this.DATA_SPM),
            () => this.filterData(null, this.DATA_SP2D),
            () => this.filterData(null, this.DATA_PENERIMA),
        ]);
    }

    sortData(type, dir = this.SORT_ASCENDING) {
        return new Promise((resolve, reject) => {
            const m = this.dataKey(type);
            if (!m) {
                return reject('Invalid sort type: ' + type);
            }
            this.findElement(By.xpath('//th[@jh-sort-by="_X_"]/span[contains(@class,"glyphicon")]'.replace(/_X_/, m)))
                .then((el) => {
                    this.ensureSorted(el, dir)
                        .then(() => resolve())
                        .catch((err) => reject(err))
                    ;
                })
                .catch((err) => reject(err))
            ;
        });
    }

    ensureSorted(el, dir) {
        let sorted;
        const f = () => {
            return new Promise((resolve, reject) => {
                if (sorted) return resolve();
                this.isSorted(el, dir)
                    .then((sort) => {
                        if (sort) sorted = sort;
                        resolve();
                    })
                    .catch((err) => reject(err))
                ;
            })
        }
        return Work.works([f, f]);
    }

    isSorted(el, dir) {
        if (!el) return Promise.reject('No sort element');
        return new Promise((resolve, reject) => {
            el.getAttribute('class')
                .then((xclass) => {
                    xclass = xclass.substr(xclass.indexOf(' ')).trim();
                    let sorted;
                    switch (dir) {
                        case this.SORT_ASCENDING:
                            sorted = xclass == 'glyphicon-sort-by-attribute';
                            break;
                        case this.SORT_DESCENDING:
                            sorted = xclass == 'glyphicon-sort-by-attribute-alt';
                            break;
                    }
                    if (!sorted) {
                        el.click()
                            .then(() => resolve(false))
                            .catch((err) => reject(err))
                        ;
                    } else {
                        resolve(true);
                    }
                })
            ;
        })
    }

    findPager(pager) {
        return new Promise((resolve, reject) => {
            this.findElement(pager)
                .then((el) => {
                    el.isDisplayed()
                        .then((visible) => {
                            if (visible) {
                                resolve(el);
                            } else {
                                resolve();
                            }
                        })
                    ;
                })
                .catch((err) => resolve())
            ;
        });
    }

    navigatePage(pager, page, options) {
        return new Promise((resolve, reject) => {
            options = options || {};
            if (typeof options.wait == 'undefined') options.wait = true;
            this.findPager(pager)
                .then((xpager) => {
                    if (!xpager) return resolve();
                    const isPage = ['first', 'prev', 'next', 'last'].indexOf(page) < 0;
                    let needClick = isPage ? true : false;
                    let xpage;
                    const w = [
                        // find desired navigation button
                        () => new Promise((resolve, reject) => {
                            const xpath = isPage ? './/li[contains(@class,"pagination-page")]/a[text()="_PAGE_"]' :
                                './/li[contains(@class,"pagination-_PAGE_")]/a';
                            xpager.findElements(By.xpath(xpath.replace(/_PAGE_/, page)))
                                .then((elements) => {
                                    if (elements.length) {
                                        xpage = elements[0];
                                    }
                                    resolve();
                                })
                            ;
                        })
                    ];
                    if (!isPage) {
                        // ensure navigation button is clickable
                        w.push(() => new Promise((resolve, reject) => {
                            if (!xpage) return resolve();
                            xpage.findElement(By.xpath('./..'))
                                .then((xel) => {
                                    xel.getAttribute('class')
                                        .then((xclass) => {
                                            if (xclass.indexOf('disabled') < 0) {
                                                needClick = true;
                                            }
                                            resolve();
                                        })
                                    ;
                                })
                            ;
                        }));
                    }
                    // click it
                    w.push(() => new Promise((resolve, reject) => {
                        if (!needClick) return resolve();
                        xpage.click()
                            .then(() => resolve())
                            .catch((err) => reject(err))
                        ;
                    }));
                    if (options.wait) {
                        w.push(() => this.sleep());
                    }
                    Work.works(w)
                        .then(() => resolve(options.returnPage ? xpage : xpager))
                        .catch(() => resolve())
                    ;
                })
            ;
        });
    }

    getPages(pager, dir) {
        let pages = 1;
        let xpager;
        return Work.works([
            () => new Promise((resolve, reject) => {
                this.navigatePage(pager, 'last')
                    .then((result) => {
                        if (result) xpager = result;
                        resolve();
                    })
                ;
            }),
            () => new Promise((resolve, reject) => {
                if (!xpager) return resolve();
                xpager.findElements(By.xpath('.//li[contains(@class,"pagination-page")]'))
                    .then((elements) => {
                        this.getText([By.xpath('.')], elements[elements.length - 1])
                            .then((xpage) => {
                                pages = parseInt(xpage);
                                resolve();
                            })
                        ;
                    })
                ;
            }),
            () => new Promise((resolve, reject) => {
                if (dir > 0) {
                    this.navigatePage(pager, 'first')
                        .then(() => resolve(pages))
                    ;
                } else {
                    resolve(pages);
                }
            })
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
            const w = () => {
                this.getDriver().findElements(check)
                    .then((elements) => {
                        // handler to go to next page or resolve when no more pages
                        const nextPageOrResolve = (next = true) => {
                            if (next && pager) {
                                page += options.direction;
                                if ((options.direction > 0 && page > pages) || (options.direction < 0 && page < 1)) {
                                    // if more than 1 page, go back to first page if needed
                                    if (pages > 1 && options.resetPage) {
                                        this.navigatePage(pager, 'first')
                                            .then(() => resolve(retval))
                                        ;
                                    } else {
                                        resolve(retval);
                                    }
                                } else {
                                    this.navigatePage(pager, page, {returnPage: true})
                                        .then((el) => {
                                            if (el) {
                                                w();
                                            } else {
                                                resolve(retval);
                                            }
                                        })
                                    ;
                                }
                            } else {
                                resolve(retval);
                            }
                        }
                        // handler to finish each iteration
                        const finishEach = (next) => {
                            if (typeof done == 'function') {
                                done()
                                    .then((res) => {
                                        retval = res;
                                        next();
                                    })
                                    .catch((err) => {
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
                                const q = new Queue(elements, (el) => {
                                    const f = () => {
                                        const items = works(el);
                                        if (options.click) items.push(() => el.click());
                                        if (options.wait) items.push(() => this.sleep(this.delay));
                                        Work.works(items)
                                            .then(() => {
                                                finishEach(() => q.next());
                                            })
                                            .catch((err) => {
                                                // is iteration stopped?
                                                if (err instanceof SippolStopError) {
                                                    next = false;
                                                    q.done();
                                                } else {
                                                    if (err instanceof Error) throw err;
                                                }
                                            })
                                        ;
                                    }
                                    if (options.visible) {
                                        el.isDisplayed().then((visible) => {
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
                            filter(elements)
                                .then((items) => doit(items, false))
                                .catch((err) => reject(err))
                            ;
                        } else {
                            doit(elements);
                        }
                    })
                    .catch((err) => reject(err))
                ;
            }
            if (pager) {
                this.getPages(pager, options.direction)
                    .then((result) => {
                        pages = result;
                        page = options.direction > 0 ? 1 : pages;
                        w();
                    })
                ;
            } else {
                w();
            }
        });
    }

    eachData(work, done, filter, direction = 1) {
        const xpath = '//div[@class="container-fluid"]/div/div[@class="row"]/div[5]/div/table';
        return this.each({
            check: By.xpath(xpath + '/tbody/tr[@ng-repeat-start]/td[1]'),
            pager: By.xpath(xpath + '/tfoot/tr/td/ul[contains(@class,"pagination")]'),
            works: (el) => work(el),
            done: done,
            filter: filter,
            direction: direction
        });
    }

    locateData(id) {
        let match;
        return this.eachData(
            (el) => {
                match = el;
                return [];
            },
            () => Promise.resolve(match),
            (elements) => new Promise((resolve, reject) => {
                const matched = [];
                const q = new Queue(elements, (el) => {
                    this.retrDataIdFromRow(el)
                        .then((xid) => {
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
        const w = this.fetchDataWorks(options);
        w.push(() => this.eachData(
            (el) => {
                const data = new SippolData();
                const works = this.fetchDataEachWorks(el, options);
                works.push(() => new Promise((resolve, reject) => {
                    this.retrData(el, data, options.useForm)
                        .then((okay) => {
                            if (okay) items.push(data);
                            resolve();
                        })
                        .catch((err) => reject(err))
                    ;
                }));
                return works;
            },
            () => Promise.resolve(items)
        ));
        return Work.works(w);
    }

    fetchDataWorks(options) {
        const works = [];
        const filters = {spp: this.DATA_SPP, spm: this.DATA_SPM, sp2d: this.DATA_SP2D};
        Object.keys(filters).forEach((key) => {
            if (options[key] instanceof Date) {
                works.push(() => this.sortData(filters[key], this.SORT_DESCENDING));
            }
        });
        return works;
    }

    fetchDataEachWorks(el, options) {
        const works = [];
        const filters = {spp: 'tglSpp', spm: 'tglSpm', sp2d: 'tglSp2d'};
        Object.keys(filters).forEach((key) => {
            if (options[key] instanceof Date) {
                works.push(() => new Promise((resolve, reject) => {
                    this.fetchDataEachMatch(el, filters[key], options[key])
                        .then((okay) => {
                            if (!okay) {
                                reject(new SippolStopError());
                            } else {
                                resolve();
                            }
                        })
                    ;
                }));
            }
        });
        return works;
    }

    fetchDataEachMatch(el, filter, since) {
        return new Promise((resolve, reject) => {
            let okay = true;
            el.findElement(By.xpath('./..//span[@ng-show="spp._X_"]'.replace(/_X_/, filter)))
                .then((xel) => {
                    xel.isDisplayed()
                        .then((visible) => {
                            okay = visible;
                            if (okay) {
                                xel.getText()
                                    .then((value) => {
                                        const s = value.split(',');
                                        const dt = this.pickDate(s[1], true);
                                        okay = dt >= since;
                                        resolve(okay);
                                    })
                                ;
                            } else {
                                resolve(okay);
                            }
                        })
                    ;
                })
                .catch(() => resolve(false))
            ;
        });
    }

    retrData(el, data, useForm) {
        return new Promise((resolve, reject) => {
            this.retrDataStatusFromRow(el)
                .then((okay) => {
                    // process only not cancelled data
                    if (okay) {
                        if (useForm) {
                            this.retrDataFromForm(el, data)
                                .then(() => resolve(true))
                                .catch((err) => reject(err))
                            ;
                        } else {
                            this.retrDataFromRow(el, data)
                                .then(() => resolve(true))
                                .catch((err) => reject(err))
                            ;
                        }
                    } else {
                        resolve(false);
                    }
                })
                .catch((err) => reject(err))
            ;
        });
    }

    retrDataFromForm(el, data) {
        return Work.works([
            () => this.clickEditSppButton(el),
            () => this.getValuesFromSppForm(data),
        ]);
    }

    getValuesFromSppForm(data) {
        return new Promise((resolve, reject) => {
            this.waitFor(By.xpath('//form[@name="editForm"]'))
                .then((form) => {
                    Work.works([
                        () => new Promise((resolve, reject) => {
                            this.getText([By.id('mySppLabel')], form)
                                .then((result) => {
                                    data.Id = this.pickPid(result[0]);
                                    resolve();
                                })
                                .catch((err) => reject(err))
                            ;
                        }),
                        () => new Promise((resolve, reject) => {
                            this.getFormValues(form, ['noSpp', 'tglSpp', 'noSpm', 'tglSpm', 'noSp2d', 'tglSp2d', 'tglCair',
                                'penerima', 'alamat', 'npwp', 'kode', 'noKontrak', 'tglKontrak', 'bank', 'bankCab', 'bankRek',
                                'afektasi', 'untuk', 'ket'
                            ])
                                .then((values) => {
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
                                    resolve();
                                })
                                .catch((err) => reject(err))
                            ;
                        }),
                        () => new Promise((resolve, reject) => {
                            form.findElement(By.xpath('//div[@ng-show="vm.spp.pkId"]/span/span[text()="Batal"]'))
                                .then((el) => {
                                    el.isDisplayed()
                                        .then((visible) => {
                                            if (visible) {
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
                                            resolve();
                                        })
                                    ;
                                })
                            ;
                        }),
                        () => this.click({el: form, data: By.xpath('//button[@class="close"]')})
                    ])
                        .then(() => resolve())
                        .catch((err) => reject(err))
                    ;
                })
                .catch((err) => reject(err))
            ;
        });
    }

    retrDataFromRow(el, data) {
        return Work.works([
            () => new Promise((resolve, reject) => {
                this.retrDataIdFromRow(el)
                    .then((id) => {
                        data.Id = id;
                        resolve();
                    })
                    .catch((err) => reject(err))
                ;
            }),
            () => new Promise((resolve, reject) => {
                this.getText([
                    By.xpath('./../td[3]/span[1]'),         By.xpath('./../td[3]/span[2]'), // SPP
                    By.xpath('./../td[4]/span[1]/strong'),  By.xpath('./../td[4]/span[2]'), // SPM
                    By.xpath('./../td[5]/span[1]/strong'),  By.xpath('./../td[5]/span[2]'), // SP2D
                    By.xpath('./../td[7]/strong'),                                          // Nominal
                ], el)
                    .then((result) => {
                        data.SPPNomor = this.pickNumber(result[0]);
                        data.SPPTanggal = this.pickDate(result[1]);
                        data.SPMNomor = this.pickNumber(result[2]);
                        data.SPMTanggal = this.pickDate(result[3]);
                        data.SP2DNomor = this.pickNumber(result[4]);
                        data.SP2DTanggal = this.pickDate(result[5]);
                        data.Nominal = this.pickFloat(result[6]);
                        resolve();
                    })
                    .catch((err) => reject(err))
                ;
            })
        ]);
    }

    retrDataIdFromRow(el) {
        return new Promise((resolve, reject) => {
            el.findElement(By.xpath('./../td[2]'))
                .then((xel) => {
                    xel.getAttribute('title')
                        .then((title) => {
                            resolve(this.pickPid(title));
                        })
                    ;
                })
                .catch((err) => reject(err))
            ;
        });
    }

    retrDataStatusFromRow(el) {
        return new Promise((resolve, reject) => {
            el.findElement(By.xpath('./../td[3]/span[@ng-show="spp.pkSppFlag!=0"]'))
                .then((xel) => {
                    xel.getAttribute('class')
                        .then((xclass) => {
                            resolve(xclass.indexOf('glyphicon-remove') < 0);
                        })
                    ;
                })
                .catch((err) => reject(err))
            ;
        });
    }

    createSpp(data) {
        return Work.works([
            () => this.clickAddSppButton(),
            () => this.sleep(this.opdelay),
            () => this.fillSppForm(data),
        ]);
    }

    updateSpp(id, data) {
        return new Promise((resolve, reject) => {
            this.locateData(id)
                .then((el) => {
                    if (el) {
                        Work.works([
                            () => this.clickEditSppButton(el),
                            () => this.sleep(this.opdelay),
                            () => this.fillSppForm(data),
                        ])
                            .then(() => resolve())
                            .catch((err) => reject(err))
                        ;
                    } else {
                        reject('SPP with id ' + id + ' not found!');
                    }
                })
            ;
        });
    }

    clickAddSppButton() {
        return this.waitAndClick(By.xpath('//div[contains(@class,"btn-toolbar")]/div[1]/button[@ng-click="vm.sppAdd()"]'));
    }

    clickEditSppButton(el) {
        let rel;
        let needClick = true;
        return Work.works([
            () => new Promise((resolve, reject) => {
                el.findElement(By.xpath('./..'))
                    .then((xel) => {
                        rel = xel;
                        resolve();
                    })
                    .catch((err) => reject(err))
                ;
            }),
            () => new Promise((resolve, reject) => {
                rel.getAttribute('class')
                    .then((xclass) => {
                        if (xclass == 'info') needClick = false;
                        resolve();
                    })
                ;
            }),
            () => new Promise((resolve, reject) => {
                if (needClick) {
                    el.click()
                        .then(() => resolve())
                        .catch((err) => reject(err))
                    ;
                } else {
                    resolve();
                }
            }),
            () => this.click({el: el, data: By.xpath('./../td[9]/button[@ng-click="vm.sppEdit(spp)"]')}),
        ]);
    }

    fillSppForm(data) {
        let w = [];
        let tabs = ['spp', 'penerima', 'gaji', 'rincian', 'spm', 'sp2d', 'tu'];
        let forms = this.getSppFormData(data);
        for (let key in forms) {
            let tabIdx = tabs.indexOf(key);
            let xpath = By.xpath('//div[@id="agrTab"]/ul/li[@index="' + tabIdx + '"]/a');
            w.push(() => this.waitAndClick(xpath));
            if (key == 'rincian') {
                // process only once
                w.push(() => new Promise((resolve, reject) => {
                    this.getDriver().findElements(By.xpath('//tr[@ng-repeat="trsRek in vm.trsReks track by trsRek.id"]'))
                        .then((elements) => {
                            if (!elements.length) {
                                Work.works([
                                    () => this.waitAndClick(By.xpath('//button[@ng-click="vm.trsRekAdd()"]')),
                                    () => this.fillInForm(forms[key], By.xpath('//h4[@id="myTrsRekLabel"]'),
                                        By.xpath('//h4[@id="myTrsRekLabel"]/../../div[@class="modal-footer"]/button[contains(@ng-disabled,"vm.isSaving")]')
                                    ),
                                ])
                                    .then(() => resolve())
                                    .catch((err) => reject(err))
                                ;
                            } else {
                                resolve();
                            }
                        })
                    ;
                }));
            } else {
                w.push(() => this.fillInForm(forms[key], xpath));
            }
        }
        w.push(() => this.sleep(this.opdelay));
        w.push(() => this.waitAndClick(By.xpath('//h4[@id="mySppLabel"]/../../div[@class="modal-footer"]/button[contains(@ng-disabled,"vm.isSaving")]')));
        return Work.works(w);
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
            if (key.substr(0, 1) == '#') {
                identifier = key.substr(1);
                mapping.target = By.id(identifier);
            } else {
                mapping.target = By.name(key);
            }
            let value = maps[key];
            if (typeof value == 'string' && data[value]) {
                value = data[value];
            }
            // handle tgl
            if (identifier.indexOf('tgl') == 0) {
                let p = value.indexOf(' ');
                if (p > 0) {
                    value = value.substr(0, p);
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
                        () => this.sleep(),
                        () => new Promise((resolve, reject) => {
                            this.getDriver().findElements(By.xpath('//div[@class="angucomplete-row"]'))
                                .then((elements) => {
                                    const q = new Queue(elements, (el) => {
                                        el.getText()
                                            .then((result) => {
                                                if (result.indexOf(data.value) >= 0) {
                                                    el.click()
                                                        .then(() => resolve())
                                                        .catch((err) => reject(err))
                                                    ;
                                                } else {
                                                    q.next();
                                                }
                                            })
                                        ;
                                    });
                                    q.once('done', () => reject('No match for ' + data.value));
                                })
                                .catch((err) => reject(err))
                            ;
                        })
                    ])
                        .then(() => next())
                        .catch((err) => {
                            // retry once more
                            if (!data.retry) {
                                data.retry = true;
                                data.handler();
                            } else if (err instanceof Error) {
                                throw err;
                            }
                        })
                    ;
                }
            }
            result.push(mapping);
        }
        return result;
    }

    uploadDocs(id, docs) {
        let el, elements, result = {};
        return Work.works([
            () => new Promise((resolve, reject) => {
                this.locateData(id)
                    .then((xel) => {
                        if (xel) {
                            el = xel;
                            resolve();
                        } else {
                            reject('SPP with id ' + id + ' is not found!');
                        }
                    })
                ;
            }),
            () => new Promise((resolve, reject) => {
                this.click({el: el, data: By.xpath('../td[6]/span/span[@ng-show="spp.syaratId"]')})
                    .then(() => resolve())
                    .catch((err) => reject(err))
                ;
            }),
            () => new Promise((resolve, reject) => {
                this.getDriver().findElements(By.xpath('//ul/li[@ng-repeat="dok in spp.doks"]'))
                    .then((xelements) => {
                        if (xelements.length) {
                            elements = xelements;
                            resolve();
                        } else {
                            reject('No document available!');
                        }
                    })
                ;
            }),
            () => new Promise((resolve, reject) => {
                let idx = -1;
                const q = new Queue(elements, (el) => {
                    idx++;
                    let xel, title, visible;
                    Work.works([
                        () => new Promise((resolve, reject) => {
                            el.getText()
                                .then((text) => {
                                    title = text;
                                    resolve();
                                })
                            ;
                        }),
                        () => new Promise((resolve, reject) => {
                            el.findElement(By.xpath('./span[contains(@class,"glyphicon-download")]'))
                                .then((d) => {
                                    xel = d;
                                    resolve();
                                })
                                .catch((err) => reject(err))
                            ;
                        }),
                        () => new Promise((resolve, reject) => {
                            xel.isDisplayed()
                                .then((xvisible) => {
                                    visible = xvisible;
                                    resolve();
                                })
                            ;
                        }),
                        () => new Promise((resolve, reject) => {
                            let doctype = this.getDocType(title);
                            if (!doctype) {
                                return resolve();
                            }
                            if (visible) {
                                if (!result.skipped) result.skipped = [];
                                result.skipped.push(doctype);
                                return resolve();
                            }
                            if (docs[doctype] && fs.existsSync(docs[doctype])) {
                                this.getDriver().findElements(By.xpath('//label/input[@type="file" and @ngf-select="vm.sppSyaratUp($file, spp, dok)"]'))
                                    .then((files) => {
                                        if (idx < files.length) {
                                            console.log('Uploading document %s', docs[doctype]);
                                            files[idx].sendKeys(docs[doctype])
                                                .then(() => {
                                                    const stime = Date.now();
                                                    // wait for upload to complete
                                                    const waitUpload = () => {
                                                        xel.isDisplayed()
                                                            .then((visible) => {
                                                                if (visible) {
                                                                    if (!result.updated) result.updated = [];
                                                                    result.updated.push(doctype);
                                                                    resolve();
                                                                } else {
                                                                    // should we retry?
                                                                    const ctime = Date.now();
                                                                    if (ctime - stime <= this.updelay) {
                                                                        setTimeout(waitUpload, 100);
                                                                    } else {
                                                                        console.log('Upload for %s timed out!', docs[doctype]);
                                                                        reject();
                                                                    }
                                                                }
                                                            })
                                                        ;
                                                    }
                                                    waitUpload();
                                                })
                                                .catch((err) => reject(err))
                                            ;
                                        } else {
                                            resolve();
                                        }
                                    })
                                ;
                            } else {
                                resolve();
                            }
                        }),
                    ])
                        .then(() => q.next())
                        .catch(() => q.next())
                    ;
                });
                q.once('done', () => resolve(result));
            }),
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

module.exports = {
    Sippol: Sippol,
    SippolData: SippolData,
    SippolStopError: SippolStopError
};