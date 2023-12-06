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

const { Sippol, SippolPaginator, SippolDataFetcher, SippolAnnouncedError } = require('.');
const { By, Key, WebElement } = require('selenium-webdriver');
const Queue = require('@ntlab/work/queue');
const debug = require('debug')('sippol:spp');

/**
 * Perform row data filtering and decide it should included or ignored.
 *
 * @callback rowFilterCallback
 * @param {string} id Row id
 * @returns {boolean} True to include the row, false otherwise
 */

/**
 * Sippol app to handle SPP.
 */
class SippolSpp extends Sippol {

    SPP_DRAFT = 1
    SPP_SPM = 2
    SPP_SP2D = 3
    SPP_CAIR = 4
    SPP_BATAL = 5

    DATA_SPP = 1
    DATA_SPM = 2
    DATA_SP2D = 3
    DATA_PENERIMA = 4

    FETCH_DATA = 1
    FETCH_DOWNLOAD = 2

    configure() {
        this.app = '#/keuda-spp';
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
        this.fetcher = new SippolSppDataFetcher(this);
    }

    /**
     * Get document type alias.
     *
     * @param {string} doc Document name
     * @returns {string}
     */
    getDocType(doc) {
        for (const key in this.docs) {
            if (doc.indexOf(this.docs[key]) === 0) {
                return key;
            }
        }
    }

    /**
     * Get data key.
     *
     * @param {number} type Key value
     * @returns {string}
     */
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

    /**
     * Perform SPP type filtering.
     *
     * @param {string} jenis SPP type
     * @param {boolean} wait Wait for loader
     * @returns {Promise}
     */
    showJenis(jenis, wait = true) {
        return this.toolbar.navigateMenuByTitle('Jenis SP2D', jenis, {wait: wait});
    }

    /**
     * Perform SPP status filtering.
     *
     * @param {string} status SPP status
     * @param {boolean} wait Wait for loader
     * @returns {Promise}
     */
    showData(status, wait = true) {
        status = status || this.status.SEMUA;
        return this.toolbar.navigateMenuByIcon('fa-folder', {'ng-click': status}, {wait: wait});
    }

    /**
     * Perform SPP data filtering.
     *
     * @param {string} data Filter value
     * @param {number} type Data to filter
     * @returns {Promise}
     */
    filter(data, type = this.DATA_SPM) {
        const m = this.dataKey(type);
        if (!m) {
            return Promise.reject('Invalid filter type: ' + type);
        }
        return this.works([
            [w => this.waitFor(By.xpath(`//input[@ng-model="vm.${m}"]`))],
            [w => this.fillInput(w.getRes(0), null === data ? data : data + (type !== this.DATA_PENERIMA ? Key.ENTER : ''))],
            [w => this.refresh(), w => type === this.DATA_PENERIMA]
        ]);
    }

    /**
     * Reset SPP data filtering.
     *
     * @returns {Promise}
     */
    resetFilter() {
        return this.works([
            [w => this.filter(null, this.DATA_SPP)],
            [w => this.filter(null, this.DATA_SPM)],
            [w => this.filter(null, this.DATA_SP2D)],
            [w => this.filter(null, this.DATA_PENERIMA)],
        ]);
    }

    getRowId(el) {
        return this.works([
            [w => el.findElement(By.xpath('./td[2]'))],
            [w => w.getRes(0).getAttribute('title')],
            [w => Promise.resolve(this.pickPid(w.getRes(1)))],
        ]);
    }

    /**
     * Retrieve data from row element.
     *
     * @param {WebElement} el Row element
     * @param {SippolData} data Result
     * @param {rowFilterCallback} filter Filter callback
     * @returns {Promise}
     */
    retrData(el, data, filter) {
        return this.works([
            [w => this.retrDataStatusFromRow(el)],
            [w => this.getRowId(el), w => w.getRes(0)],
            [w => Promise.resolve(filter(w.getRes(1))), w => w.getRes(0)],
            [w => this.retrDataFromForm(el, data), w => w.getRes(0) && w.getRes(2)],
        ]);
    }

    /**
     * Retrieve SPP data from SPP form.
     *
     * @param {WebElement} el Row element
     * @param {SippolData} data Result
     * @returns {Promise}
     */
    retrDataFromForm(el, data) {
        return this.works([
            [w => this.clickEditSppButton(el)],
            [w => this.waitLoader()],
            [w => this.getValuesFromSppForm(data)],
        ]);
    }

    /**
     * Populate Sippol data using form values.
     *
     * @param {SippolData} data Result
     * @returns {Promise}
     */
    getValuesFromSppForm(data) {
        return this.works([
            // wait for form to completely shown
            [w => this.waitFor(By.xpath('//form[@name="editForm"]'))],
            // get form title
            [w => this.getText([By.id('mySppLabel')], w.getRes(0))],
            // get values
            [w => this.getFormValues(w.getRes(0), ['syarat', 'noSpp', 'tglSpp', 'noSpm', 'tglSpm', 'noSp2d', 'tglSp2d', 'tglCair',
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
                const pid = w.getRes(1)[0];
                const values = w.getRes(2);
                const cancelled = w.getRes(4);
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
                        case data.CairTanggal !== null:
                            data.Status = this.SPP_CAIR;
                            break;
                        case data.SP2DTanggal !== null:
                            data.Status = this.SPP_SP2D;
                            break;
                        case data.SPMNomor !== null:
                            data.Status = this.SPP_SPM;
                            break;
                        default:
                            data.Status = this.SPP_DRAFT;
                            break;
                    }
                }
                data.Syarat = values.syarat;
                resolve(data);
            })],
        ]);
    }

    /**
     * Retrieve SPP data from row element.
     *
     * @param {WebElement} el Row element
     * @param {SippolData} data Result 
     * @returns {Promise}
     */
    retrDataFromRow(el, data) {
        return this.works([
            [w => this.retrDataIdFromRow(el)],
            [w => this.getText([
                By.xpath('./td[3]/span[1]'),         By.xpath('./td[3]/span[2]'), // SPP
                By.xpath('./td[4]/span[1]/strong'),  By.xpath('./td[4]/span[2]'), // SPM
                By.xpath('./td[5]/span[1]/strong'),  By.xpath('./td[5]/span[2]'), // SP2D
                By.xpath('./td[7]/strong'),                                       // Nominal
            ], el)],
            [w => new Promise((resolve, reject) => {
                const id = w.getRes(0);
                const values = w.getRes(1);
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

    /**
     * Retrieve status from row element if its okay.
     *
     * @param {WebElement} el Row element
     * @returns {Promise<boolean>}
     */
    retrDataStatusFromRow(el) {
        return this.works([
            [w => el.findElement(By.xpath('./td[3]/span[@ng-show="spp.pkSppFlag!=0"]'))],
            [w => w.getRes(0).getAttribute('class')],
            [w => Promise.resolve(w.getRes(1).indexOf('glyphicon-remove') < 0)],
        ]);
    }

    /**
     * Save SPP xml as download.
     *
     * @param {WebElement} el Row element
     * @returns {Promise}
     */
    saveSpp(el) {
        return this.works([
            [w => this.getText([
                By.xpath('./td[2]'),                 // Jenis
                By.xpath('./td[5]/span[1]/strong'),  // SP2D Nomor
            ], el)],
            [w => el.findElement(By.xpath('./td[2]'))],
            [w => w.getRes(1).getAttribute('title'), w => w.getRes(1)],
            [w => el.findElement(By.xpath('./td[6]/span/span[@ng-show="spp.tglCair"]'))],
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

    /**
     * Create SPP.
     *
     * @param {object} data SPP data
     * @returns {Promise}
     */
    createSpp(data) {
        return this.works([
            [w => this.clickAddSppButton()],
            [w => this.waitLoader()],
            [w => this.fillSppForm(data)],
        ]);
    }

    /**
     * Update SPP.
     *
     * @param {string} id SPP id
     * @param {object} data SPP data
     * @returns {Promise}
     */
    updateSpp(id, data) {
        return this.works([
            [w => this.locate(id)],
            [w => this.clickEditSppButton(w.getRes(0)), w => w.getRes(0)],
            [w => this.waitLoader(), w => w.getRes(0)],
            [w => this.fillSppForm(data), w => w.getRes(0)],
            [w => Promise.reject(SippolAnnouncedError.create('SPP with id ' + id + ' is not found!')), w => !w.getRes(0)],
        ]);
    }

    /**
     * Navigate to create new SPP.
     *
     * @returns {Promise<WebElement>}
     */
    clickAddSppButton() {
        return this.toolbar.navigateByIcon('glyphicon-plus');
    }

    /**
     * Show edit SPP form.
     *
     * @param {WebElement} el Row element
     * @returns {Promise}
     */
    clickEditSppButton(el) {
        return this.works([
            [w => el.findElement(By.xpath('./td[2]'))],
            [w => w.getRes(0).click()],
            [w => this.click({el: el, data: By.xpath('./td[9]/button[@ng-click="vm.sppEdit(spp)"]')})],
        ]);
    }

    /**
     * Fill in SPP form.
     *
     * @param {object} data SPP data
     * @returns {Promise}
     */
    fillSppForm(data) {
        const works = [];
        const tabs = ['spp', 'penerima', 'gaji', 'rincian', 'spm', 'sp2d', 'tu'];
        const forms = this.getSppFormData(data);
        for (const key in forms) {
            const tabIdx = tabs.indexOf(key);
            if (tabIdx < 0) {
                continue;
            }
            const xpath = By.xpath('//div[@id="agrTab"]/ul/li[@index="' + tabIdx + '"]/a');
            works.push([w => this.waitAndClick(xpath)]);
            if (key === 'rincian') {
                // process only once
                const idx = works.length;
                works.push([w => this.getDriver().findElements(By.xpath('//tr[@ng-repeat="trsRek in vm.trsReks track by trsRek.id"]'))]);
                works.push([w => this.waitAndClick(By.xpath('//button[@ng-click="vm.trsRekAdd()"]')), w => w.getRes(idx).length === 0]);
                works.push([w => this.fillInForm(forms[key],
                    By.xpath('//h4[@id="myTrsRekLabel"]'),
                    By.xpath('//h4[@id="myTrsRekLabel"]/../../div[@class="modal-footer"]/button[contains(@ng-disabled,"vm.isSaving")]')
                ), w => w.getRes(idx).length === 0]);
            } else {
                works.push([w => this.fillInForm(forms[key], xpath)]);
            }
        }
        works.push([w => this.sleep(this.opdelay)]);
        works.push([w => this.waitAndClick(By.xpath('//h4[@id="mySppLabel"]/../../div[@class="modal-footer"]/button[contains(@ng-disabled,"vm.isSaving")]'))]);
        return this.works(works);
    }

    /**
     * Get SPP form data values.
     *
     * @param {object} data SPP data
     * @returns {object}
     */
    getSppFormData(data) {
        const forms = {};
        for (const key in this.maps) {
            forms[key] = this.getMappedFormData(data, this.maps[key]);
        }
        return forms;
    }

    /**
     * Get SPP data for fill in form.
     *
     * @param {object} data SPP data
     * @param {object} maps SPP mapping
     * @returns {Array}
     */
    getMappedFormData(data, maps) {
        const result = [];
        for (const key in maps) {
            const mapping = {};
            let identifier = key;
            let addwait = false;
            if (identifier.startsWith('+')) {
                identifier = identifier.substr(1);
                addwait = true;
            }
            if (identifier.startsWith('#')) {
                identifier = identifier.substr(1);
                mapping.target = By.id(identifier);
            } else {
                mapping.target = By.name(identifier);
            }
            let value = maps[key];
            if (typeof value === 'string' && data[value]) {
                value = data[value];
            }
            // handle tgl
            if (identifier.indexOf('tgl') >= 0 && typeof value === 'string') {
                const p = value.indexOf(' ');
                if (p > 0) {
                    value = value.substr(0, p);
                }
            }
            // handle rek bank
            if ((identifier === 'bank' || identifier === 'bankCab') && data[maps.bank]) {
                const xvalue = data[maps.bank];
                let matches;
                if (matches = xvalue.toUpperCase().match(/(CABANG|CAPEM)/)) {
                    if (identifier === 'bank') {
                        value = xvalue.substr(0, matches.index - 1).trim();
                    } else {
                        value = xvalue.substr(matches.index).trim();
                    }
                }
            }
            mapping.value = value;
            // handle autocomplete
            if (identifier.indexOf('search') === 0) {
                mapping.wait = true;
                mapping.done = (data, next) => {
                    // wait for autocomplete-row
                    this.works([
                        [w => this.sleep(this.opdelay)],
                        [w => this.getDriver().findElements(By.xpath('//div[@class="angucomplete-row"]'))],
                        [w => new Promise((resolve, reject) => {
                            const q = new Queue(w.getRes(1), el => {
                                this.works([
                                    [x => el.getText()],
                                    [x => el.click(), x => x.getRes(0).indexOf(data.value) >= 0],
                                    [x => Promise.reject(), x => x.getRes(0).indexOf(data.value) < 0],
                                ])
                                .then(() => resolve())
                                .catch(err => q.next());
                            });
                            q.once('done', () => reject('No match for ' + data.value));
                        })],
                        [w => this.waitLoader(), w => addwait],
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
            } else if (addwait) {
                mapping.done = (data, next) => {
                    this.waitLoader()
                        .then(() => next())
                        .catch(err => reject(err));
                }
            }
            result.push(mapping);
        }
        return result;
    }

    /**
     * Upload SPP documents.
     *
     * @param {string} id SPP id
     * @param {object} docs SPP documents
     * @returns {Promise}
     */
    uploadDocs(id, docs) {
        return this.works([
            [w => this.locate(id)],
            [w => w.getRes(0).click(),
                w => w.getRes(0)],
            [w => w.getRes(0).findElement(By.xpath('./td[6]/span/span[@ng-show="spp.syaratId"]')),
                w => w.getRes(0)],
            [w => w.getRes(2).click(),
                w => w.getRes(0)],
            [w => this.sleep(this.opdelay),
                w => w.getRes(0)],
            [w => this.getDriver().findElements(By.xpath('//ul/li[@ng-repeat="dok in spp.doks"]')),
                w => w.getRes(0)],
            [w => this.uploadDocFiles(w.getRes(5), docs),
                w => w.getRes(0)],
            [w => Promise.reject(SippolAnnouncedError.create('Unable to upload, SPP with id ' + id + ' is not found!')),
                w => !w.getRes(0)],
        ]);
    }

    /**
     * Perform SPP documents upload.
     *
     * @param {WebElement[]} elements Document elements
     * @param {object} docs SPP documents
     * @returns {Promise}
     */
    uploadDocFiles(elements, docs) {
        return new Promise((resolve, reject) => {
            const result = {};
            let idx = -1;
            const q = new Queue(elements, el => {
                idx++;
                this.works([
                    [w => el.getText()],
                    [w => el.findElement(By.xpath('./span[contains(@class,"glyphicon-download")]'))],
                    [w => w.getRes(1).isDisplayed()],
                    [w => new Promise((resolve, reject) => {
                        const doctype = this.getDocType(w.getRes(0));
                        if (!doctype) {
                            debug('%s: document not available!', w.getRes(0));
                            return resolve();
                        }
                        if (w.getRes(2)) {
                            debug('%s: document already uploaded!', w.getRes(0));
                            if (!result.skipped) {
                                result.skipped = [];
                            }
                            result.skipped.push(doctype);
                            return resolve();
                        }
                        if (docs[doctype] && fs.existsSync(docs[doctype])) {
                            this.uploadDocFile(w.getRes(1), docs[doctype], idx)
                                .then(res => {
                                    if (res) {
                                        if (!result.updated) {
                                            result.updated = [];
                                        }
                                        result.updated.push(doctype);
                                    }
                                    resolve();
                                })
                                .catch(err => reject(err))
                            ;
                        } else {
                            debug('%s: %s not found!', w.getRes(0), docs[doctype]);
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

    /**
     * Perform document upload.
     *
     * @param {WebElement} el Document element
     * @param {string} file Document filename
     * @param {number} index Document index
     * @returns {Promise}
     */
    uploadDocFile(el, file, index) {
        return this.works([
            [w => this.getDriver().findElements(By.xpath('//label/input[@type="file" and @ngf-select="vm.sppSyaratUp($file, spp, dok)"]'))],
            [w => Promise.resolve(debug('uploading document %s', file)),
                w => index < w.getRes(0).length],
            [w => w.getRes(0)[index].sendKeys(file),
                w => index < w.getRes(0).length],
            [w => new Promise((resolve, reject) => {
                    const stime = Date.now();
                    // wait for upload to complete
                    const f = () => {
                        el.isDisplayed()
                            .then(visible => {
                                if (visible) {
                                    resolve(true);
                                } else {
                                    // should we retry?
                                    const ctime = Date.now();
                                    if (ctime - stime <= this.updelay) {
                                        setTimeout(f, 100);
                                    } else {
                                        debug('upload for %s timed out!', file);
                                        resolve(false);
                                    }
                                }
                            })
                            .catch(err => reject(err))
                        ;
                    }
                    f();
                }),
                w => index < w.getRes(0).length],
            [w => Promise.resolve(w.getRes(3)),
                w => index < w.getRes(0).length],
        ]);
    }
}

class SippolSppDataFetcher extends SippolDataFetcher {

    onFetchOptions(options) {
        if (options.mode === undefined) {
            options.mode = this.parent.FETCH_DATA;
        }
        options.dates = {spp: 'tglSpp', spm: 'tglSpm', sp2d: 'tglSp2d'};
        // add a pause when downloading
        if (options.mode === this.parent.FETCH_DOWNLOAD) {
            options.finalize = () => {
                debug('Waiting for last download to complete...');
                return this.parent.sleep();
            }
        }
        debug(`Fetch mode set to ${options.mode === this.parent.FETCH_DATA ? 'DATA' : 'DOWNLOAD'}...`);
    }

    fetchWorks(options) {
        const works = super.fetchWorks(options);
        const filters = {spp: this.parent.DATA_SPP, spm: this.parent.DATA_SPM, sp2d: this.parent.DATA_SP2D};
        let sortkey;
        Object.keys(filters).forEach(key => {
            const value = options[key];
            let sorted;
            if (value instanceof Date || (typeof value === 'object' && value.from instanceof Date)) {
                sorted = SippolPaginator.SORT_ASCENDING;
            }
            if (sorted) {
                works.push([w => this.paginator.sort(this.parent.dataKey(filters[key]), sorted)]);
                sortkey = key;
            }
        });
        if (sortkey) {
            const status = {spp: this.parent.status.SPM, spm: this.parent.status.SP2D, sp2d: this.parent.status.SP2D_CAIR};
            if (status[sortkey]) {
                works.unshift([w => this.parent.showData(status[sortkey])]);
            }
        }
        return works;
    }

    fetchRunWorks(el, items, options) {
        const works = super.fetchRunWorks(el, items, options);
        switch (options.mode) {
            case this.parent.FETCH_DATA:
                works.push([x => new Promise((resolve, reject) => {
                    const data = new SippolData();
                    this.parent.retrData(el, data, id => {
                        let retval = true;
                        items.forEach(item => {
                            if (item.Id == id) {
                                retval = false;
                                return true;
                            }
                        });
                        return retval;
                    }).then(okay => {
                        let added = okay ? true : false;
                        if (added && options.spptype && data.Syarat) {
                            added = options.spptype == data.Syarat;
                        }
                        delete data.Syarat;
                        if (added) {
                            items.push(data);
                        }
                        resolve();
                    }).catch(err => reject(err));
                }), x => x.res]);
                break;
            case this.parent.FETCH_DOWNLOAD:
                works.push([x => new Promise((resolve, reject) => {
                    this.parent.saveSpp(el)
                        .then(res => {
                            if (res) {
                                items.push(res);
                            }
                            resolve();
                        })
                        .catch(err => reject(err))
                    ;
                }), x => x.res]);
                break;
        }
        return works;
    }

    fetchRunMatchSelector(key) {
        return By.xpath(`.//span[@ng-show="spp.${key}"]`);
    }

    fetchRunMatchDate(value) {
        const values = value.split(',');
        return this.parent.pickDate(values[1], true);
    }
}

class SippolData {

    copyFrom(data) {
        if (data instanceof SippolData) {
            for (const key in data) {
                this[key] = data[key];
            }
        }
    }
}

module.exports = { SippolSpp, SippolData };