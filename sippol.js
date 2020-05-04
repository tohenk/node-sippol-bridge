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

    FILTER_SPP = 1
    FILTER_SPM = 2
    FILTER_SP2D = 3
    FILTER_PENERIMA = 4

    MAIN_PATH = '#/keuda-spp';

    initialize() {
        if (!this.url) {
            throw new Error('SIPPOL url must be supplied!');
        }
        this.delay = this.options.delay || 500;
        this.opdelay = this.options.opdelay || 400;
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
        if (value.length) {
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
        if (value.length) {
            return parseInt(value);
        }
        return null;
    }

    pickFloat(value) {
        if (value.length) {
            return parseFloat(value.replace(/\./g, '').replace(/,/g, ''));
        }
        return null;
    }

    pickDate(value) {
        value = (value.substr(0, 1) == ',' ? value.substr(1) : value).trim();
        if (value.length) {
            return value;
        }
        return null;
    }

    getDocType(doc) {
        for (let key in this.docs) {
            if (doc.indexOf(this.docs[key]) == 0) {
                return key;
            }
        }
    }

    filterKey(type) {
        if (!this.filterKeys) {
            this.filterKeys = {
                'noSpp': this.FILTER_SPP,
                'noSpm': this.FILTER_SPM,
                'noSp2d': this.FILTER_SP2D,
                'key': this.FILTER_PENERIMA
            };
        }
        const idx = Object.values(this.filterKeys).indexOf(type);
        if (idx >= 0) {
            return Object.keys(this.filterKeys)[idx];
        }
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
                this.getDriver().quit()
                    .then(() => {
                        this.driver = null;
                        resolve();
                    })
                    .catch((err) => reject(err))
                ;
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

    filterData(data, type = this.FILTER_SPM) {
        return new Promise((resolve, reject) => {
            const m = this.filterKey(type);
            if (!m) {
                return reject('Invalid filter type: ' + type);
            }
            this.waitFor(By.xpath('//input[@ng-model="vm._X_"]'.replace(/_X_/, m)))
                .then((el) => {
                    this.fillInput(el, null == data ? data : data + (type != this.FILTER_PENERIMA ? Key.ENTER : ''))
                        .then(() => {
                            if (type == this.FILTER_PENERIMA) {
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
            () => this.filterData(null, this.FILTER_SPP),
            () => this.filterData(null, this.FILTER_SPM),
            () => this.filterData(null, this.FILTER_SP2D),
            () => this.filterData(null, this.FILTER_PENERIMA),
        ]);
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

    getPages(pager) {
        return new Promise((resolve, reject) => {
            this.findPager(pager)
                .then((el) => {
                    if (el) {
                        el.findElements(By.xpath('.//li/a'))
                            .then((elements) => {
                                let pages = 1;
                                let current;
                                const q = new Queue(elements, (item) => {
                                    this.getText([By.xpath('.')], item)
                                        .then((result) => {
                                            let page;
                                            [page] = result;
                                            if (!isNaN(page)) {
                                                pages = Math.max(pages, parseInt(page));
                                                item.findElement(By.xpath('..'))
                                                    .then((p) => {
                                                        p.getAttribute('class')
                                                            .then((classes) => {
                                                                if (classes.indexOf('active') >= 0) {
                                                                    current = parseInt(page);
                                                                }
                                                                q.next();
                                                            })
                                                        ;
                                                    })
                                                ;
                                            } else {
                                                q.next();
                                            }
                                        })
                                    ;
                                });
                                q.on('done', () => {
                                    resolve([pages, current]);
                                });
                            })
                        ;
                    } else {
                        resolve([1, undefined]);
                    }
                })
            ;
        });
    }

    gotoPage(pager, page) {
        return new Promise((resolve, reject) => {
            this.findPager(pager)
                .then((el) => {
                    if (el) {
                        el.findElement(By.xpath('.//li/a[text()="_PAGE_"]'.replace(/_PAGE_/, page)))
                            .then((clicker) => {
                                clicker.click()
                                    .then(() => {
                                        this.sleep(this.delay)
                                            .then(() => resolve(clicker))
                                        ;
                                    })
                                ;
                            })
                            .catch(() => resolve())
                        ;
                    } else {
                        resolve();
                    }
                })
            ;
        });
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
                                        this.gotoPage(pager, 1)
                                            .then(() => resolve(retval))
                                        ;
                                    } else {
                                        resolve(retval);
                                    }
                                } else {
                                    this.gotoPage(pager, page)
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
                                                if (err instanceof Error) throw err;
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
                this.getPages(pager)
                    .then((result) => {
                        [pages] = result;
                        if (options.direction < 0) {
                            page = pages;
                            this.gotoPage(pager, page)
                                .then(() => w())
                            ;
                        } else {
                            w();
                        }
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

    fetchData(useForm = true) {
        let items = [];
        return this.eachData(
            (el) => {
                const data = new SippolData();
                return [
                    () => new Promise((resolve, reject) => {
                        this.retrData(el, data, useForm)
                            .then(() => {
                                items.push(data);
                                resolve();
                            })
                            .catch((err) => reject(err))
                        ;
                    })
                ];
            },
            () => Promise.resolve(items)
        );
    }

    retrData(el, data, useForm) {
        return new Promise((resolve, reject) => {
            if (useForm) {
                this.retrDataFromForm(el, data)
                    .then(() => resolve())
                    .catch((err) => reject(err))
                ;
            } else {
                this.retrDataFromRow(el, data)
                    .then(() => resolve())
                    .catch((err) => reject(err))
                ;
            }
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
                                    form.findElement(By.xpath('//div[@ng-show="vm.spp.pkId"]/span/span[text()="Batal"]'))
                                        .then((el) => {
                                            el.isDisplayed()
                                                .then((visible) => {
                                                    data.Status = visible ? this.SPP_BATAL : this.SPP_DRAFT;
                                                    resolve();
                                                })
                                            ;
                                        })
                                    ;
                                    break;
                            }
                            resolve();
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
                                                    // wait for upload to complete
                                                    const waitUpload = () => {
                                                        xel.isDisplayed()
                                                            .then((visible) => {
                                                                if (visible) {
                                                                    if (!result.updated) result.updated = [];
                                                                    result.updated.push(doctype);
                                                                    resolve();
                                                                } else {
                                                                    setTimeout(waitUpload, 100);
                                                                }
                                                            })
                                                        ;
                                                    }
                                                    waitUpload();
                                                })
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

module.exports = {Sippol: Sippol, SippolData: SippolData};